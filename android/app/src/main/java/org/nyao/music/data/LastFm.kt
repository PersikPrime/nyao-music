package org.nyao.music.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Скробблинг в Last.fm — перенос src/main/lastfm.js.
 * Вход — подтверждением в браузере (auth.getToken → страница Last.fm → auth.getSession).
 * Ключ сессии хранится только на телефоне (в личных настройках приложения).
 */
class LastFm(private val prefs: Prefs, dir: File) {
    companion object {
        private const val API = "https://ws.audioscrobbler.com/2.0/"
        private val KEY = org.nyao.music.BuildConfig.LASTFM_KEY
        private val SECRET = org.nyao.music.BuildConfig.LASTFM_SECRET

        fun sign(params: Map<String, String>, secret: String): String =
            md5(params.filterKeys { it != "format" && it != "callback" }.toSortedMap().entries.joinToString("") { it.key + it.value } + secret)

        fun mainArtist(a: String): String = a.split(Regex(",\\s+|\\s+feat\\.?\\s+|\\s+ft\\.?\\s+", RegexOption.IGNORE_CASE)).first().trim().ifBlank { a }

        fun shouldScrobble(duration: Int, listened: Int): Boolean = duration > 30 && listened >= minOf(duration / 2, 240)
    }

    data class State(val configured: Boolean, val name: String?, val waiting: Boolean = false, val queued: Int = 0)

    private val queueFile = File(dir, "lastfm-queue.json")
    private val lock = Mutex()
    @Volatile private var pending: String? = null
    private var lastNow = ""

    val configured: Boolean get() = KEY.isNotBlank() && SECRET.isNotBlank()
    private val _state = MutableStateFlow(State(configured, prefs.lastfmName))
    val state: StateFlow<State> = _state

    private fun publish(waiting: Boolean = _state.value.waiting) {
        _state.value = State(configured, prefs.lastfmName, waiting, readQueue().length())
    }

    private suspend fun call(method: String, params: Map<String, String> = emptyMap(), post: Boolean = false): JSONObject = withContext(Dispatchers.IO) {
        val p = LinkedHashMap<String, String>()
        p["method"] = method
        p["api_key"] = KEY
        p.putAll(params)
        p["api_sig"] = sign(p, SECRET)
        p["format"] = "json"
        val req = if (post) {
            val f = FormBody.Builder()
            p.forEach { (k, v) -> f.add(k, v) }
            Request.Builder().url(API).post(f.build())
        } else {
            Request.Builder().url(API.toHttpUrl().newBuilder().apply { p.forEach { (k, v) -> addQueryParameter(k, v) } }.build())
        }
        val (_, text) = Net.execute(req.header("User-Agent", "NyaoMusic-Android").build())
        val j = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
        if (j.has("error")) throw ApiException("Last.fm: ${j.optString("message", j.optString("error"))}", j.optInt("error"))
        j
    }

    /** Вход: открывает страницу Last.fm (openUrl) и ждёт подтверждения до 3 минут */
    suspend fun connect(openUrl: (String) -> Unit): String {
        if (!configured) throw ApiException("Last.fm не настроен в этой сборке")
        val token = call("auth.getToken").optString("token")
        pending = token
        publish(waiting = true)
        try {
            openUrl("https://www.last.fm/api/auth/?api_key=$KEY&token=$token")
            val started = System.currentTimeMillis()
            while (System.currentTimeMillis() - started < 180_000 && pending == token) {
                delay(3000)
                try {
                    val s = call("auth.getSession", mapOf("token" to token)).optJSONObject("session") ?: continue
                    prefs.lastfmName = s.optString("name")
                    prefs.lastfmKey = s.optString("key")
                    pending = null
                    publish(waiting = false)
                    runCatching { flush() }
                    return s.optString("name")
                } catch (e: ApiException) {
                    if (e.code != 14) throw e // 14 — ещё не подтвердили
                }
            }
            throw ApiException("Не дождался подтверждения в Last.fm — попробуй ещё раз")
        } finally {
            pending = null
            publish(waiting = false)
        }
    }

    fun cancel() {
        pending = null
        publish(waiting = false)
    }

    fun disconnect() {
        prefs.lastfmName = null
        prefs.lastfmKey = null
        publish(waiting = false)
    }

    suspend fun nowPlaying(t: Track) {
        val sk = prefs.lastfmKey ?: return
        if (t.id == lastNow) return
        lastNow = t.id
        val p = mutableMapOf("artist" to mainArtist(t.artist), "track" to t.title, "sk" to sk)
        if (t.album.isNotBlank()) p["album"] = t.album
        if (t.duration > 0) p["duration"] = t.duration.toString()
        runCatching { call("track.updateNowPlaying", p, post = true) }
    }

    private fun readQueue(): JSONArray = runCatching { JSONArray(queueFile.readText()) }.getOrDefault(JSONArray())

    private fun writeQueue(a: JSONArray) {
        val trimmed = JSONArray()
        val from = maxOf(0, a.length() - 500)
        for (i in from until a.length()) trimmed.put(a.get(i))
        runCatching { queueFile.writeText(trimmed.toString()) }
    }

    /** Трек закончился или переключён: если прослушан достаточно — в очередь и отправить */
    suspend fun scrobble(t: Track, listened: Int) {
        if (prefs.lastfmKey == null || !shouldScrobble(t.duration, listened)) return
        lock.withLock {
            val q = readQueue()
            q.put(
                JSONObject().put("artist", mainArtist(t.artist)).put("track", t.title).put("album", t.album)
                    .put("duration", t.duration).put("timestamp", System.currentTimeMillis() / 1000 - listened),
            )
            writeQueue(q)
        }
        lastNow = ""
        runCatching { flush() }
    }

    /** Отправляет накопленное пачками по 50; без сети — останется на потом */
    suspend fun flush() = lock.withLock {
        val sk = prefs.lastfmKey ?: return@withLock
        var q = readQueue()
        while (q.length() > 0) {
            val n = minOf(50, q.length())
            val p = mutableMapOf("sk" to sk)
            for (i in 0 until n) {
                val it = q.getJSONObject(i)
                p["artist[$i]"] = it.optString("artist")
                p["track[$i]"] = it.optString("track")
                p["timestamp[$i]"] = it.optLong("timestamp").toString()
                it.optString("album").takeIf { a -> a.isNotBlank() }?.let { a -> p["album[$i]"] = a }
                it.optInt("duration").takeIf { d -> d > 0 }?.let { d -> p["duration[$i]"] = d.toString() }
            }
            try {
                call("track.scrobble", p, post = true)
            } catch (e: Exception) {
                if (e is ApiException && e.code == 9) disconnect() // сессию отозвали на сайте
                break
            }
            val rest = JSONArray()
            for (i in n until q.length()) rest.put(q.get(i))
            q = rest
            writeQueue(q)
        }
        publish()
    }
}
