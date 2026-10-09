package org.nyao.music.data

import okhttp3.FormBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Яндекс Музыка через неофициальное API (api.music.yandex.net) — перенос src/main/providers/yandex.js.
 * Если Яндекс что-то поменяет, править нужно здесь и там.
 */
class YandexApi(private val prefs: Prefs) {

    companion object {
        private const val API = "https://api.music.yandex.net"
        const val CLIENT_ID = "23cabbbdc6cd418abb4b39c32c41195d"
        const val OAUTH_URL = "https://oauth.yandex.ru/authorize?response_type=token&client_id=$CLIENT_ID"
        private const val SIGN_SALT = "XGRlBW9FXlekgbPrRHuSiA"
        private val MOODS = setOf("active", "fun", "calm", "sad")
        private val DIVERSITIES = setOf("favorite", "discover", "popular")

        fun cover(uri: String?, size: Int = 400): String? =
            uri?.takeIf { it.isNotBlank() }?.let { "https://" + it.replace("%%", "${size}x$size") }

        fun mapTrack(t: JSONObject?): Track? {
            if (t == null || !t.has("id")) return null
            val id = t.optString("id")
            val album = t.arr("albums").objects().firstOrNull()
            val artists = t.arr("artists").objects().mapNotNull { it.str("name") }
            val version = t.str("version")
            return Track(
                id = "ya:$id",
                source = SOURCE_YA,
                srcId = id,
                title = t.optString("title") + (if (version != null) " ($version)" else ""),
                artist = artists.joinToString(", ").ifEmpty { "Неизвестный исполнитель" },
                album = album?.str("title") ?: "",
                albumId = album?.let { if (it.has("id")) it.optString("id") else null },
                duration = (t.optLong("durationMs", 0) / 1000).toInt(),
                cover = cover(t.str("coverUri") ?: album?.str("coverUri") ?: t.str("ogImage")),
                available = t.optBoolean("available", true),
            )
        }
    }

    val loggedIn: Boolean get() = !prefs.yandexToken.isNullOrBlank()

    private var account: Account? = null
    private var waveSession: String? = null
    private var waveBatch: String? = null

    fun reset() {
        account = null
        waveSession = null
        waveBatch = null
    }

    // ---------- Запросы ----------

    private suspend fun raw(
        method: String,
        path: String,
        json: JSONObject? = null,
        form: Map<String, String>? = null,
        query: Map<String, String>? = null,
    ): String {
        val base = if (path.startsWith("http")) path else API + path
        val url = base.toHttpUrl().newBuilder().apply { query?.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        val body: RequestBody? = when {
            json != null -> json.toString().toRequestBody("application/json".toMediaType())
            form != null -> FormBody.Builder().apply { form.forEach { (k, v) -> add(k, v) } }.build()
            method == "POST" -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        val req = Request.Builder().url(url).method(method, body)
            .header("X-Yandex-Music-Client", "YandexMusicAndroid/24023621")
            .header("User-Agent", "Yandex-Music-API")
            .header("Accept-Language", "ru")
            .apply { prefs.yandexToken?.let { header("Authorization", "OAuth $it") } }
            .build()
        val (code, text) = Net.call(req)
        if (code !in 200..299) throw ApiException("Яндекс $method $path: $code ${text.take(200)}", code)
        return text
    }

    /** Ответ API без обёртки {"result": …}: JSONObject, JSONArray или null */
    private suspend fun request(
        method: String,
        path: String,
        json: JSONObject? = null,
        form: Map<String, String>? = null,
        query: Map<String, String>? = null,
    ): Any? {
        val text = raw(method, path, json, form, query).trim()
        if (text.isEmpty()) return null
        if (text.startsWith("[")) return JSONArray(text)
        val o = JSONObject(text)
        return if (o.has("result")) o.opt("result") else o
    }

    private suspend fun obj(method: String, path: String, json: JSONObject? = null, form: Map<String, String>? = null, query: Map<String, String>? = null): JSONObject =
        request(method, path, json, form, query) as? JSONObject ?: JSONObject()

    private suspend fun arr(method: String, path: String, json: JSONObject? = null, form: Map<String, String>? = null, query: Map<String, String>? = null): JSONArray =
        request(method, path, json, form, query) as? JSONArray ?: JSONArray()

    // ---------- Аккаунт ----------

    suspend fun account(): Account {
        account?.let { return it }
        val st = obj("GET", "/account/status")
        val acc = st.obj("account") ?: JSONObject()
        val a = Account(
            name = acc.str("displayName") ?: acc.str("fullName") ?: acc.str("login") ?: "Яндекс",
            plus = st.obj("plus")?.optBoolean("hasPlus", false),
            uid = acc.opt("uid")?.toString(),
        )
        account = a
        return a
    }

    private suspend fun uid(): String = account().uid ?: throw ApiException("Яндекс не вернул id пользователя")

    // ---------- Моя волна ----------

    private fun seeds(diversity: String?, mood: String?): JSONArray {
        val s = JSONArray().put("user:onyourwave")
        if (diversity != null && diversity in DIVERSITIES) s.put("settingDiversity:$diversity")
        if (mood != null && mood in MOODS) s.put("settingMoodEnergy:$mood")
        return s
    }

    private fun sequence(o: JSONObject): List<Track> = o.arr("sequence").objects().mapNotNull { mapTrack(it.obj("track")) }

    suspend fun waveStart(diversity: String?, mood: String?): List<Track> {
        fun body(seeds: JSONArray) = JSONObject()
            .put("seeds", seeds)
            .put("includeTracksInResponse", true)
            .put("includeWaveModel", false)
            .put("interactive", true)
        val first = seeds(diversity, mood)
        val session = try {
            obj("POST", "/rotor/session/new", json = body(first))
        } catch (e: ApiException) {
            if (first.length() > 1) obj("POST", "/rotor/session/new", json = body(JSONArray().put("user:onyourwave")))
            else return waveLegacy()
        }
        waveSession = session.str("radioSessionId")
        waveBatch = session.str("batchId")
        return sequence(session)
    }

    suspend fun waveMore(queueIds: List<String>, diversity: String?, mood: String?): List<Track> {
        val sid = waveSession ?: return waveStart(diversity, mood)
        val ids = JSONArray()
        queueIds.filter { it.startsWith("ya:") }.takeLast(10).forEach { ids.put(it.removePrefix("ya:")) }
        return try {
            val res = obj("POST", "/rotor/session/$sid/tracks", json = JSONObject().put("queue", ids))
            res.str("batchId")?.let { waveBatch = it }
            sequence(res)
        } catch (e: ApiException) {
            waveSession = null
            waveStart(diversity, mood)
        }
    }

    private suspend fun waveLegacy(): List<Track> {
        waveSession = null
        return sequence(obj("GET", "/rotor/station/user:onyourwave/tracks", query = mapOf("settings2" to "true")))
    }

    /** type: radioStarted | trackStarted | trackFinished | skip | like | dislike */
    suspend fun waveFeedback(type: String, track: Track?, playedSeconds: Int = 0) {
        val sid = waveSession ?: return
        if (type != "radioStarted" && (track == null || !track.isYa)) return
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val event = JSONObject()
            .put("type", type)
            .put("timestamp", fmt.format(Date()))
            .put("from", "mobile-radio-user-onyourwave")
        if (type != "radioStarted" && track != null) {
            event.put("trackId", if (track.albumId != null) "${track.srcId}:${track.albumId}" else track.srcId)
        }
        if (type == "trackFinished" || type == "skip" || type == "dislike") event.put("totalPlayedSeconds", playedSeconds)
        try {
            raw("POST", "/rotor/session/$sid/feedback", json = JSONObject().put("event", event).put("batchId", waveBatch ?: ""))
        } catch (_: Exception) {
            // фидбек не критичен
        }
    }

    // ---------- Медиатека ----------

    private suspend fun tracksByIds(ids: List<String>): List<Track> {
        val out = ArrayList<Track>()
        ids.chunked(100).forEach { chunk ->
            val res = arr("POST", "/tracks", form = mapOf("track-ids" to chunk.joinToString(","), "with-positions" to "false"))
            out += res.objects().mapNotNull { mapTrack(it) }
        }
        return out
    }

    suspend fun likedTracks(limit: Int = 300): List<Track> {
        val res = obj("GET", "/users/${uid()}/likes/tracks")
        val ids = res.path("library")?.arr("tracks").objects().take(limit).map {
            val id = it.optString("id")
            val album = it.str("albumId")
            if (album != null) "$id:$album" else id
        }
        return tracksByIds(ids)
    }

    private fun mapPlaylist(p: JSONObject): Playlist {
        val c = p.obj("cover")
        val coverUri = c?.str("uri") ?: c?.arr("itemsUri")?.optString(0)?.takeIf { it.isNotEmpty() } ?: p.str("ogImage")
        val owner = p.obj("owner")?.opt("uid")?.toString() ?: p.opt("uid")?.toString() ?: ""
        return Playlist(
            id = "ya:$owner:${p.opt("kind")}",
            source = SOURCE_YA,
            title = p.optString("title"),
            count = p.optInt("trackCount", 0),
            cover = cover(coverUri, 300),
        )
    }

    suspend fun playlists(): List<Playlist> {
        val own = arr("GET", "/users/${uid()}/playlists/list").objects().map { mapPlaylist(it) }
        val personal = try {
            obj("GET", "/landing3", query = mapOf("blocks" to "personalplaylists"))
                .arr("blocks").objects()
                .flatMap { it.arr("entities").objects() }
                .mapNotNull { it.path("data", "data") }
                .map { mapPlaylist(it) }
        } catch (_: Exception) {
            emptyList()
        }
        return personal + own
    }

    suspend fun playlistTracks(playlistId: String): List<Track> {
        val parts = playlistId.split(":")
        val res = obj("GET", "/users/${parts[1]}/playlists/${parts[2]}", query = mapOf("rich-tracks" to "true"))
        val items = res.arr("tracks").objects()
        val withData = items.mapNotNull { mapTrack(it.obj("track")) }
        if (withData.isNotEmpty()) return withData
        return tracksByIds(items.map { i ->
            val album = i.str("albumId")
            if (album != null) "${i.optString("id")}:$album" else i.optString("id")
        })
    }

    suspend fun search(text: String): List<Track> {
        val res = obj("GET", "/search", query = mapOf("text" to text, "type" to "track", "page" to "0", "nocorrect" to "false"))
        return res.path("tracks")?.arr("results").objects().mapNotNull { mapTrack(it) }
    }

    suspend fun like(track: Track, on: Boolean) {
        val action = if (on) "add-multiple" else "remove"
        raw("POST", "/users/${uid()}/likes/tracks/$action", form = mapOf("track-ids" to track.srcId))
    }

    // ---------- Поток ----------

    /** Прямая ссылка на mp3. Живёт около часа. */
    suspend fun streamUrl(srcId: String): String {
        val infos = arr("GET", "/tracks/$srcId/download-info").objects()
        val best = infos.filter { it.optString("codec") == "mp3" }.maxByOrNull { it.optInt("bitrateInKbps") }
            ?: infos.firstOrNull()
            ?: throw ApiException("Яндекс не отдал ссылку на трек (нет подписки или трек недоступен)")
        val xml = raw("GET", best.optString("downloadInfoUrl"))
        fun tag(name: String) = Regex("<$name>([^<]*)</$name>").find(xml)?.groupValues?.get(1)
        val host = tag("host")
        val path = tag("path")
        val ts = tag("ts")
        val s = tag("s")
        if (host == null || path == null || ts == null || s == null) throw ApiException("Не удалось разобрать download-info Яндекса")
        val sign = md5(SIGN_SALT + path.substring(1) + s)
        return "https://$host/get-mp3/$sign/$ts$path"
    }
}
