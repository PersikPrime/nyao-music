package org.nyao.music.data

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * SoundCloud через внутреннее API сайта (api-v2.soundcloud.com) — перенос providers/soundcloud.js.
 * client_id берётся из скриптов soundcloud.com, вход — OAuth-токен из cookie oauth_token.
 * Звук на Android всегда идёт через HLS — ExoPlayer умеет его сам, вместе с перемоткой.
 */
class ScApi(private val prefs: Prefs) {

    companion object {
        private const val API = "https://api-v2.soundcloud.com"
        /** Тот же User-Agent, что у окна входа: cookie защиты DataDome привязана к нему */
        const val LOGIN_UA = "Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0"
        const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

        fun bigArtwork(url: String?): String? = url?.replace(Regex("-(large|t\\d+x\\d+|small|tiny|badge|crop)\\."), "-t500x500.")

        fun mapTrack(t: JSONObject?): Track? {
            if (t == null || !t.has("id")) return null
            if (t.str("kind")?.let { it != "track" } == true) return null
            val user = t.obj("user")
            val id = t.opt("id").toString()
            val policy = t.str("policy")
            return Track(
                id = "sc:$id",
                source = SOURCE_SC,
                srcId = id,
                title = t.str("title") ?: "Без названия",
                artist = t.obj("publisher_metadata")?.str("artist") ?: user?.str("username") ?: "SoundCloud",
                duration = ((if (t.has("full_duration")) t.optLong("full_duration") else t.optLong("duration")) / 1000).toInt(),
                cover = bigArtwork(t.str("artwork_url") ?: user?.str("avatar_url")),
                // BLOCK — недоступен в стране, SNIP — только отрывок (нужен Go+)
                available = policy != "BLOCK" && policy != "SNIP" && t.optBoolean("streamable", true),
            )
        }
    }

    val loggedIn: Boolean get() = !prefs.scToken.isNullOrBlank()

    @Volatile private var clientId: String? = null
    private var account: Account? = null
    private val raw = ConcurrentHashMap<String, JSONObject>()

    fun reset() {
        account = null
    }

    private suspend fun getText(url: String): String {
        val (code, text) = Net.call(Request.Builder().url(url).header("User-Agent", UA).build())
        if (code !in 200..299) throw ApiException("SoundCloud: $code", code)
        return text
    }

    /** client_id из JS-бандлов soundcloud.com */
    private suspend fun clientId(force: Boolean = false): String {
        if (!force) clientId?.let { return it }
        val page = getText("https://soundcloud.com/")
        val scripts = Regex("<script[^>]+src=\"(https://a-v2\\.sndcdn\\.com/assets/[^\"]+\\.js)\"").findAll(page).map { it.groupValues[1] }.toList().reversed()
        for (src in scripts) {
            val js = runCatching { getText(src) }.getOrNull() ?: continue
            val m = Regex("client_id\\s*[:=]\\s*\"([A-Za-z0-9]{32})\"").find(js) ?: Regex("client_id=([A-Za-z0-9]{32})").find(js)
            if (m != null) return m.groupValues[1].also { clientId = it }
        }
        throw ApiException("SoundCloud: не удалось получить client_id")
    }

    private suspend fun request(method: String, path: String, query: Map<String, String> = emptyMap(), retry: Boolean = true): Any? {
        val base = if (path.startsWith("http")) path else API + path
        val url = base.toHttpUrl().newBuilder().apply {
            setQueryParameter("client_id", clientId())
            query.forEach { (k, v) -> setQueryParameter(k, v) }
        }.build()
        val body = if (method == "PUT" || method == "POST") ByteArray(0).toRequestBody(null) else null
        val rb = Request.Builder().url(url).method(method, body)
            .header("User-Agent", UA)
            .header("Accept", "application/json")
            .header("Origin", "https://soundcloud.com")
            .header("Referer", "https://soundcloud.com/")
        prefs.scToken?.let { rb.header("Authorization", "OAuth $it") }
        if (method != "GET") {
            // Запись (лайки) проверяет защита DataDome: отправляем cookie из окна входа и его же User-Agent
            runCatching { android.webkit.CookieManager.getInstance().getCookie("https://soundcloud.com") }.getOrNull()?.let { rb.header("Cookie", it) }
            rb.header("User-Agent", LOGIN_UA)
        }
        val (code, text) = Net.call(rb.build())
        if ((code == 401 || code == 403) && retry && !loggedIn) {
            clientId(force = true)
            return request(method, path, query, retry = false)
        }
        if (code == 403 && text.contains("captcha-delivery.com")) throw ApiException("SoundCloud просит пройти проверку (капчу)", 403)
        if (code !in 200..299) throw ApiException("SoundCloud $method ${url.encodedPath}: $code", code)
        val t = text.trim()
        if (t.isEmpty()) return null
        return if (t.startsWith("[")) JSONArray(t) else JSONObject(t)
    }

    private suspend fun obj(path: String, query: Map<String, String> = emptyMap()) = request("GET", path, query) as? JSONObject ?: JSONObject()

    private fun remember(list: List<JSONObject>): List<Track> {
        list.forEach { raw[it.opt("id").toString()] = it }
        return list.mapNotNull { mapTrack(it) }
    }

    suspend fun account(): Account {
        account?.let { return it }
        val me = obj("/me")
        return Account(me.str("username") ?: "SoundCloud", uid = me.opt("id")?.toString()).also { account = it }
    }

    private suspend fun uid(): String = account().uid ?: throw ApiException("SoundCloud не вернул id пользователя")

    /** Добирает треки, у которых пришёл только id */
    private suspend fun fullTracks(items: List<JSONObject>): List<JSONObject> {
        val full = HashMap<String, JSONObject>()
        items.filter { it.has("title") }.forEach { full[it.opt("id").toString()] = it }
        val missing = items.filter { !it.has("title") }.map { it.opt("id").toString() }
        missing.chunked(50).forEach { chunk ->
            (request("GET", "/tracks", mapOf("ids" to chunk.joinToString(","))) as? JSONArray).objects().forEach { full[it.opt("id").toString()] = it }
        }
        return items.mapNotNull { full[it.opt("id").toString()] }
    }

    suspend fun likedTracks(limit: Int = 300): List<Track> {
        val out = ArrayList<JSONObject>()
        var res = obj("/users/${uid()}/track_likes", mapOf("limit" to "200"))
        for (page in 0 until 5) {
            res.arr("collection").objects().mapNotNullTo(out) { it.obj("track") }
            val next = res.str("next_href")
            if (out.size >= limit || next == null) break
            res = obj(next)
        }
        return remember(out.take(limit))
    }

    suspend fun playlists(): List<Playlist> =
        obj("/users/${uid()}/playlists", mapOf("limit" to "50")).arr("collection").objects().map { p ->
            Playlist(
                id = "sc:${p.opt("id")}",
                source = SOURCE_SC,
                title = p.optString("title"),
                count = p.optInt("track_count"),
                cover = bigArtwork(p.str("artwork_url") ?: p.arr("tracks").objects().firstOrNull()?.str("artwork_url")),
            )
        }

    suspend fun playlistTracks(id: String): List<Track> {
        val p = obj("/playlists/${id.removePrefix("sc:")}")
        return remember(fullTracks(p.arr("tracks").objects()))
    }

    suspend fun search(q: String): List<Track> = remember(obj("/search/tracks", mapOf("q" to q, "limit" to "30")).arr("collection").objects())

    suspend fun related(srcId: String): List<Track> = remember(obj("/tracks/$srcId/related", mapOf("limit" to "30")).arr("collection").objects())

    suspend fun like(srcId: String, on: Boolean) {
        request(if (on) "PUT" else "DELETE", "/users/${uid()}/track_likes/$srcId")
    }

    /** Пул для «Моей волны»: «похожие» на случайные лайки */
    suspend fun wavePool(diversity: String, exclude: Set<String>, size: Int = 20): List<Track> {
        val liked = runCatching { likedTracks(200) }.getOrDefault(emptyList()).filter { it.available }
        val likedIds = liked.map { it.id }.toSet()
        val pool = LinkedHashMap<String, Track>()
        for (seed in liked.shuffled().take(3)) {
            runCatching { related(seed.srcId) }.getOrDefault(emptyList()).forEach { t ->
                if (!t.available || t.id in exclude) return@forEach
                if (diversity == "discover" && t.id in likedIds) return@forEach
                pool.putIfAbsent(t.id, t)
            }
            if (pool.size >= size) break
        }
        if (diversity == "favorite") liked.filter { it.id !in exclude }.shuffled().take((size + 2) / 3).forEach { pool.putIfAbsent(it.id, it) }
        return pool.values.shuffled().take(size)
    }

    /** Ссылка на HLS-плейлист трека (mp3-куски, если есть, иначе AAC). Блокирующий — из потока загрузки. */
    fun hlsUrl(srcId: String): String = kotlinx.coroutines.runBlocking {
        val t = raw[srcId] ?: (request("GET", "/tracks", mapOf("ids" to srcId)) as? JSONArray).objects().firstOrNull()?.also { raw[srcId] = it }
            ?: throw ApiException("SoundCloud не нашёл трек")
        val list = t.obj("media")?.arr("transcodings").objects().filter {
            val f = it.obj("format")
            f?.optString("protocol") == "hls" && !it.optBoolean("snipped", false)
        }
        val best = list.firstOrNull { it.obj("format")?.optString("mime_type")?.contains("mpeg") == true } ?: list.firstOrNull()
            ?: throw ApiException(if (t.str("policy") == "SNIP") "Трек только для SoundCloud Go+" else "У трека нет доступного потока")
        val q = t.str("track_authorization")?.let { mapOf("track_authorization" to it) } ?: emptyMap()
        (request("GET", best.optString("url"), q) as? JSONObject)?.str("url") ?: throw ApiException("SoundCloud не отдал ссылку")
    }
}
