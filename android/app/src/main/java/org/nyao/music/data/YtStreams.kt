package org.nyao.music.data

import android.net.Uri
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Прямые ссылки на аудио YouTube. Берём их у «мобильных» клиентов InnerTube (ANDROID_VR, iOS, visionOS):
 * они отдают ссылки без шифрованной подписи, поэтому не нужен JS-плеер YouTube.
 * Ссылка проверяется коротким запросом; если клиент получил 403 — он уходит «на скамейку» на 10 минут,
 * и берётся следующий (как в десктопной версии).
 */
class YtStreams(private val yt: YtMusicApi) {

    data class Client(
        val key: String,
        val name: String,
        val id: Int,
        val version: String,
        val userAgent: String,
        val extra: Map<String, Any>,
    )

    data class Stream(val url: String, val userAgent: String, val client: String, val expiresAt: Long, val contentLength: Long)

    companion object {
        private const val TAG = "NyaoYt"
        private const val BLOCK_MS = 10 * 60 * 1000L

        val CLIENTS = listOf(
            Client(
                "ANDROID_VR", "ANDROID_VR", 28, "1.65.10",
                "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
                mapOf("deviceMake" to "Oculus", "deviceModel" to "Quest 3", "androidSdkVersion" to 32, "osName" to "Android", "osVersion" to "12L"),
            ),
            Client(
                "IOS", "IOS", 5, "20.11.6",
                "com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)",
                mapOf("deviceMake" to "Apple", "deviceModel" to "iPhone10,4", "osName" to "iOS", "osVersion" to "16.7.7.20H330"),
            ),
            Client(
                "VISIONOS", "VISIONOS", 101, "1.02",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
                mapOf("deviceMake" to "Apple", "deviceModel" to "RealityDevice17,1", "osName" to "visionOS", "osVersion" to "26.5.23O471"),
            ),
        )
    }

    private val blocked = ConcurrentHashMap<String, Long>()
    private val cache = ConcurrentHashMap<String, Stream>()
    @Volatile var lastError: String? = null
        private set

    fun reportBlocked(client: String) {
        blocked[client] = System.currentTimeMillis() + BLOCK_MS
        Log.w(TAG, "клиент $client получил 403 — пропускаю его 10 минут")
    }

    fun invalidate(videoId: String) {
        cache.remove(videoId)?.let { reportBlocked(it.client) }
    }

    private fun order(): List<Client> {
        val now = System.currentTimeMillis()
        val free = CLIENTS.filter { (blocked[it.key] ?: 0) < now }
        return free.ifEmpty {
            // все на скамейке — сбрасываем и пробуем заново
            blocked.clear()
            yt.visitorData = null
            CLIENTS
        }
    }

    /** Блокирующий вызов: зовётся из потока загрузки ExoPlayer. */
    fun resolve(videoId: String): Stream {
        cache[videoId]?.let { if (it.expiresAt > System.currentTimeMillis() + 60_000) return it }
        kotlinx.coroutines.runBlocking { yt.ensureVisitor() }
        val errors = ArrayList<String>()
        for (round in 0..1) {
            for (c in order()) {
                try {
                    val s = player(c, videoId)
                    if (check(s)) {
                        cache[videoId] = s
                        lastError = null
                        Log.i(TAG, "$videoId → ${c.key}")
                        return s
                    }
                    reportBlocked(c.key)
                    errors += "${c.key}: 403"
                } catch (e: Exception) {
                    errors += "${c.key}: ${e.message}"
                }
            }
            // второй круг — с новым visitorData
            yt.visitorData = null
            kotlinx.coroutines.runBlocking { yt.ensureVisitor() }
        }
        lastError = errors.joinToString("; ")
        throw ApiException("YouTube не отдал звук: $lastError")
    }

    private fun player(c: Client, videoId: String): Stream {
        val client = JSONObject()
            .put("clientName", c.name)
            .put("clientVersion", c.version)
            .put("hl", "ru")
        c.extra.forEach { (k, v) -> client.put(k, v) }
        yt.visitorData?.let { client.put("visitorData", it) }
        val body = JSONObject()
            .put("context", JSONObject().put("client", client))
            .put("videoId", videoId)
            .put("contentCheckOk", true)
            .put("racyCheckOk", true)
        val rb = Request.Builder()
            .url("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .header("User-Agent", c.userAgent)
            .header("X-Youtube-Client-Name", c.id.toString())
            .header("X-Youtube-Client-Version", c.version)
            .header("Origin", "https://www.youtube.com")
        yt.visitorData?.let { rb.header("X-Goog-Visitor-Id", it) }
        val (code, text) = Net.execute(rb.build())
        if (code !in 200..299) throw ApiException("player $code")
        val r = JSONObject(text)
        val status = r.path("playabilityStatus")
        if (status?.optString("status") != "OK") throw ApiException(status?.str("reason") ?: status?.optString("status") ?: "недоступно")
        val formats = r.path("streamingData")?.arr("adaptiveFormats").objects()
            .filter { it.optString("mimeType").startsWith("audio/") && it.str("url") != null }
        // 251 — opus ~160 кбит/с, 140 — m4a 128 кбит/с; иначе — самый высокий битрейт
        val best = formats.firstOrNull { it.optInt("itag") == 251 }
            ?: formats.firstOrNull { it.optInt("itag") == 140 }
            ?: formats.maxByOrNull { it.optInt("bitrate") }
            ?: throw ApiException("нет аудиопотока без шифра")
        val url = best.optString("url")
        val uri = Uri.parse(url)
        val expire = uri.getQueryParameter("expire")?.toLongOrNull()?.times(1000) ?: (System.currentTimeMillis() + 3 * 3600_000L)
        val clen = best.optString("contentLength").toLongOrNull() ?: uri.getQueryParameter("clen")?.toLongOrNull() ?: -1L
        return Stream(url, c.userAgent, c.key, expire, clen)
    }

    /** Короткий запрос первых байт: googlevideo сразу отвечает 403, если ссылка «не наша» */
    private fun check(s: Stream): Boolean {
        val req = Request.Builder().url(s.url).header("User-Agent", s.userAgent).header("Range", "bytes=0-1").get().build()
        return try {
            Net.client.newCall(req).execute().use { it.code == 200 || it.code == 206 }
        } catch (_: Exception) {
            false
        }
    }
}
