package org.nyao.music.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class CloudUser(val name: String, val username: String?, val picture: String?)
data class CloudDevice(val id: String, val device: String, val platform: String, val current: Boolean, val lastSeen: String)
/** Что играет на другом устройстве — для «Продолжить» */
data class RemoteNow(val deviceId: String, val device: String, val platform: String, val track: Track, val positionSec: Double, val playing: Boolean, val updatedAt: Long)

/**
 * Аккаунт Nyao на своём сервере (api.nmusic.bixtl.cc): вход через Telegram, история, «сейчас играет».
 * Токены Яндекса, YouTube и SoundCloud сюда не попадают — они остаются только на телефоне.
 * Перенос src/main/cloud.js.
 */
class NyaoCloud(private val prefs: Prefs, private val dir: File) {
    companion object {
        const val BASE = "https://api.nmusic.bixtl.cc"
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val HISTORY_MAX = 1500
        private const val DAY = 86_400_000L
    }

    private val _user = MutableStateFlow(prefs.nyaoUser?.let { runCatching { parseUser(JSONObject(it)) }.getOrNull() })
    val user: StateFlow<CloudUser?> = _user
    val loggedIn: Boolean get() = prefs.nyaoToken != null

    private val fileLock = Mutex()
    private var remoteRecent: Set<String> = emptySet()
    private var remoteRecentAt = 0L
    private var lastNowKey = ""
    private var lastNowAt = 0L

    private fun parseUser(o: JSONObject) = CloudUser(o.optString("name", "Telegram"), o.str("username"), o.str("picture"))

    private suspend fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val b = Request.Builder().url(BASE + path).header("User-Agent", "NyaoMusic-Android")
        prefs.nyaoToken?.let { b.header("Authorization", "Bearer $it") }
        val rb = body?.toString()?.toRequestBody(JSON_TYPE)
        when (method) {
            "GET" -> b.get()
            "DELETE" -> b.delete(rb)
            else -> b.method(method, rb ?: "{}".toRequestBody(JSON_TYPE))
        }
        val (code, text) = Net.call(b.build())
        val json = runCatching { JSONObject(text) }.getOrNull() ?: JSONObject()
        if (code == 401 && prefs.nyaoToken != null) forget()
        if (code !in 200..299) throw ApiException(json.str("error") ?: "Сервер Nyao ответил $code", code)
        return json
    }

    private fun forget() {
        prefs.nyaoToken = null
        prefs.nyaoUser = null
        _user.value = null
    }

    // ---------- Вход ----------

    /** Шаг 1: ссылка на Telegram, которую надо открыть в браузере, и id для опроса */
    suspend fun startLogin(device: String): Pair<String, String> {
        val r = request("POST", "/auth/start", JSONObject().put("device", device).put("platform", "android"))
        return r.getString("id") to r.getString("url")
    }

    /** Шаг 2: спрашиваем сервер, подтвердил ли пользователь вход. null — ещё ждём */
    suspend fun poll(id: String): CloudUser? {
        val r = request("GET", "/auth/poll?id=${java.net.URLEncoder.encode(id, "UTF-8")}")
        if (r.optString("status") != "done") return null
        prefs.nyaoToken = r.getString("token")
        val u = r.getJSONObject("user")
        prefs.nyaoUser = u.toString()
        return parseUser(u).also { _user.value = it }
    }

    suspend fun logout() {
        runCatching { if (loggedIn) request("POST", "/auth/logout") }
        forget()
    }

    suspend fun devices(): List<CloudDevice> {
        val r = request("GET", "/me")
        r.obj("user")?.let {
            prefs.nyaoUser = it.toString()
            _user.value = parseUser(it)
        }
        return r.arr("devices").objects().map {
            CloudDevice(it.optString("id"), it.optString("device"), it.optString("platform"), it.optBoolean("current"), it.optString("lastSeen"))
        }
    }

    suspend fun removeDevice(id: String) {
        request("DELETE", "/devices/$id")
    }

    // ---------- История ----------

    private val historyFile get() = File(dir, "history.json")
    private val outboxFile get() = File(dir, "cloud-outbox.json")

    private fun readArr(f: File): JSONArray = runCatching { JSONArray(f.readText()) }.getOrDefault(JSONArray())

    suspend fun recordPlay(t: Track, listenedSec: Int, skipped: Boolean) = fileLock.withLock {
        val play = JSONObject()
            .put("trackId", t.id).put("source", t.source).put("title", t.title).put("artist", t.artist)
            .put("cover", t.cover ?: JSONObject.NULL).put("duration", t.duration)
            .put("listened", listenedSec).put("skipped", skipped).put("playedAt", System.currentTimeMillis())
        val hist = readArr(historyFile)
        val next = JSONArray().put(play)
        for (i in 0 until minOf(hist.length(), HISTORY_MAX - 1)) next.put(hist.get(i))
        historyFile.writeText(next.toString())
        if (loggedIn) {
            val out = readArr(outboxFile).put(play)
            outboxFile.writeText(out.toString())
        }
    }

    suspend fun flush() {
        if (!loggedIn) return
        val out = fileLock.withLock { readArr(outboxFile) }
        if (out.length() == 0) return
        var i = 0
        while (i < out.length()) {
            val chunk = JSONArray()
            for (j in i until minOf(i + 200, out.length())) chunk.put(out.get(j))
            request("POST", "/history", JSONObject().put("plays", chunk))
            i += 200
        }
        fileLock.withLock {
            val now = readArr(outboxFile)
            val rest = JSONArray()
            for (j in out.length() until now.length()) rest.put(now.get(j))
            outboxFile.writeText(rest.toString())
        }
    }

    /** Недавно звучавшее на всех устройствах — волна это пропустит. Пропущенные треки помним дольше */
    suspend fun recentIds(days: Int = 3, skippedDays: Int = 14): Set<String> {
        val now = System.currentTimeMillis()
        val ids = HashSet<String>()
        val hist = fileLock.withLock { readArr(historyFile) }
        for (i in 0 until hist.length()) {
            val p = hist.optJSONObject(i) ?: continue
            val age = now - p.optLong("playedAt")
            if (age < days * DAY || (p.optBoolean("skipped") && age < skippedDays * DAY)) ids += p.optString("trackId")
        }
        if (loggedIn) {
            if (now - remoteRecentAt > 5 * 60_000L) {
                runCatching {
                    val r = request("GET", "/history?days=$skippedDays&limit=2000")
                    val set = HashSet<String>()
                    for (p in r.arr("plays").objects()) {
                        val at = runCatching { java.time.Instant.parse(p.optString("playedAt")).toEpochMilli() }.getOrDefault(0L)
                        if (now - at < days * DAY || p.optBoolean("skipped")) set += p.optString("trackId")
                    }
                    remoteRecent = set
                    remoteRecentAt = now
                }
            }
            ids += remoteRecent
        }
        return ids
    }

    // ---------- «Сейчас играет» ----------

    /** Смену трека и паузу шлём сразу, остальное — не чаще раза в 20 секунд */
    suspend fun setNow(t: Track?, positionSec: Double, playing: Boolean) {
        if (!loggedIn) return
        val key = "${t?.id ?: "-"}|$playing"
        val now = System.currentTimeMillis()
        if (key == lastNowKey && now - lastNowAt < 20_000) return
        lastNowKey = key
        lastNowAt = now
        val body = JSONObject().put("position", positionSec).put("playing", playing).put("context", Repo.mode.value.name.lowercase())
        if (t != null) body.put(
            "track",
            JSONObject().put("id", t.id).put("source", t.source).put("srcId", t.srcId).put("title", t.title).put("artist", t.artist)
                .put("album", t.album).put("albumId", t.albumId ?: JSONObject.NULL).put("duration", t.duration).put("cover", t.cover ?: JSONObject.NULL),
        )
        request("PUT", "/now", body)
    }

    suspend fun others(): List<RemoteNow> {
        if (!loggedIn) return emptyList()
        return request("GET", "/now").arr("devices").objects().mapNotNull { d ->
            val t = d.obj("track") ?: return@mapNotNull null
            val track = Track(
                id = t.optString("id"), source = t.optString("source"), srcId = t.optString("srcId"),
                title = t.optString("title"), artist = t.optString("artist"), album = t.optString("album"),
                albumId = t.str("albumId"), duration = t.optInt("duration"), cover = t.str("cover"),
            )
            if (track.id.isEmpty() || track.srcId.isEmpty()) return@mapNotNull null
            RemoteNow(d.optString("deviceId"), d.optString("device"), d.optString("platform"), track, d.optDouble("position", 0.0), d.optBoolean("playing"), d.optLong("updatedAt"))
        }
    }
}
