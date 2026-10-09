package org.nyao.music.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * YouTube Music через внутреннее API сайта (InnerTube, клиент WEB_REMIX).
 * Вход — cookies music.youtube.com, подпись запросов — SAPISIDHASH, как делает сам сайт.
 * Ответы разбираются «поиском по дереву»: ищем нужные renderer'ы где угодно в ответе,
 * поэтому перестановки блоков на сайте разбор не ломают.
 */
class YtMusicApi(private val prefs: Prefs) {

    companion object {
        const val ORIGIN = "https://music.youtube.com"
        private const val REMIX_VERSION = "1.20250219.01.00"
        const val DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        // Фильтр «Песни» в поиске (из ytmusicapi)
        private const val SONGS_PARAMS = "EgWKAQIIAWoMEA4QChADEAQQCRAF"
        private val TIME = Regex("^\\d{1,2}:\\d{2}(:\\d{2})?$")
        private val TYPE_WORDS = setOf("Песня", "Song", "Видео", "Video", "Трек")

        /** Обложки YouTube приходят маленькими — просим 544×544 */
        fun bigThumb(url: String?): String? = url?.replace(Regex("=w\\d+-h\\d+"), "=w544-h544")
            ?.replace(Regex("/(default|mqdefault|hqdefault|sddefault)\\.jpg"), "/hqdefault.jpg")
    }

    @Volatile var visitorData: String? = null
    private var account: Account? = null

    val loggedIn: Boolean get() = sapisid() != null

    fun reset() {
        account = null
    }

    private fun cookie(): String? = prefs.ytCookie?.takeIf { it.isNotBlank() }

    private fun sapisid(): String? {
        val c = cookie() ?: return null
        val map = c.split(";").mapNotNull {
            val i = it.indexOf('=')
            if (i <= 0) null else it.substring(0, i).trim() to it.substring(i + 1).trim()
        }.toMap()
        return map["SAPISID"] ?: map["__Secure-3PAPISID"]
    }

    private fun context(): JSONObject {
        val client = JSONObject()
            .put("clientName", "WEB_REMIX")
            .put("clientVersion", REMIX_VERSION)
            .put("hl", "ru")
        visitorData?.let { client.put("visitorData", it) }
        return JSONObject().put("client", client)
    }

    suspend fun post(endpoint: String, body: JSONObject, auth: Boolean = loggedIn, query: String = ""): JSONObject {
        body.put("context", context())
        val rb = Request.Builder()
            .url("$ORIGIN/youtubei/v1/$endpoint?prettyPrint=false$query")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .header("User-Agent", DESKTOP_UA)
            .header("Origin", ORIGIN)
            .header("Referer", "$ORIGIN/")
            .header("X-Youtube-Client-Name", "67")
            .header("X-Youtube-Client-Version", REMIX_VERSION)
            .header("Accept-Language", "ru")
        visitorData?.let { rb.header("X-Goog-Visitor-Id", it) }
        val sid = sapisid()
        if (auth && sid != null) {
            val ts = System.currentTimeMillis() / 1000
            rb.header("Cookie", cookie()!!)
            rb.header("Authorization", "SAPISIDHASH ${ts}_${sha1("$ts $sid $ORIGIN")}")
            rb.header("X-Goog-AuthUser", "0")
            rb.header("X-Origin", ORIGIN)
        }
        val (code, text) = Net.call(rb.build())
        if (code !in 200..299) throw ApiException("YouTube Music $endpoint: $code ${text.take(200)}", code)
        val json = JSONObject(text)
        json.path("responseContext")?.str("visitorData")?.let { if (visitorData == null) visitorData = it }
        return json
    }

    /** visitorData нужен и для потоков: без него YouTube чаще просит «подтвердить, что вы не бот» */
    suspend fun ensureVisitor(): String? {
        if (visitorData == null) {
            try {
                post("guide", JSONObject(), auth = false)
            } catch (_: Exception) {
            }
        }
        return visitorData
    }

    // ---------- Разбор ответов ----------

    private fun findAll(node: Any?, key: String, out: MutableList<JSONObject> = ArrayList()): MutableList<JSONObject> {
        when (node) {
            is JSONObject -> {
                val keys = node.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val v = node.opt(k)
                    if (k == key && v is JSONObject) out += v else findAll(v, key, out)
                }
            }
            is JSONArray -> for (i in 0 until node.length()) findAll(node.opt(i), key, out)
        }
        return out
    }

    private fun firstString(node: Any?, key: String): String? {
        when (node) {
            is JSONObject -> {
                if (node.has(key) && node.opt(key) is String) return node.optString(key)
                val keys = node.keys()
                while (keys.hasNext()) firstString(node.opt(keys.next()), key)?.let { found -> return found }
            }
            is JSONArray -> for (i in 0 until node.length()) firstString(node.opt(i), key)?.let { found -> return found }
        }
        return null
    }

    private fun runsText(o: JSONObject?): String {
        if (o == null) return ""
        o.str("simpleText")?.let { return it }
        return o.arr("runs").objects().joinToString("") { it.optString("text") }
    }

    private fun browseId(run: JSONObject): String? = run.path("navigationEndpoint", "browseEndpoint")?.str("browseId")

    private fun thumb(o: JSONObject?): String? {
        if (o == null) return null
        val list = findAll(o, "thumbnail").flatMap { it.arr("thumbnails").objects() }
        val direct = o.arr("thumbnails").objects()
        val all = if (direct.isNotEmpty()) direct else list
        return bigThumb(all.maxByOrNull { it.optInt("width") }?.str("url"))
    }

    private fun mapResponsive(r: JSONObject): Track? {
        val cols = r.arr("flexColumns").objects().map { it.path("musicResponsiveListItemFlexColumnRenderer", "text") }
        if (cols.isEmpty()) return null
        val videoId = r.obj("playlistItemData")?.str("videoId")
            ?: r.path("overlay")?.let { firstString(it, "videoId") }
            ?: cols[0]?.let { firstString(it, "videoId") }
            ?: return null
        val title = runsText(cols[0])
        val runs = cols.drop(1).flatMap { it?.arr("runs").objects() }
        val artists = runs.filter { browseId(it)?.startsWith("UC") == true }.map { it.optString("text") }
        val albumRun = runs.firstOrNull { browseId(it)?.startsWith("MPRE") == true }
        val plain = runs.map { it.optString("text").trim() }
            .filter { it.isNotEmpty() && it != "•" && it !in TYPE_WORDS && !TIME.matches(it) && !it.contains("просмотр") && !it.contains("views") }
        val fixed = r.arr("fixedColumns").objects().firstOrNull()?.path("musicResponsiveListItemFixedColumnRenderer", "text")
        val durText = runsText(fixed).ifEmpty { runs.map { it.optString("text").trim() }.firstOrNull { TIME.matches(it) } ?: "" }
        return Track(
            id = "yt:$videoId",
            source = SOURCE_YT,
            srcId = videoId,
            title = title.ifEmpty { "Без названия" },
            artist = artists.joinToString(", ").ifEmpty { plain.firstOrNull() ?: "YouTube Music" },
            album = albumRun?.optString("text") ?: "",
            duration = parseDuration(durText),
            cover = thumb(r.obj("thumbnail")),
        )
    }

    private fun mapPanel(p: JSONObject): Track? {
        val videoId = p.str("videoId") ?: return null
        val runs = p.obj("longBylineText")?.arr("runs").objects()
        val artists = runs.filter { browseId(it)?.startsWith("UC") == true }.map { it.optString("text") }
        val album = runs.firstOrNull { browseId(it)?.startsWith("MPRE") == true }?.optString("text")
        return Track(
            id = "yt:$videoId",
            source = SOURCE_YT,
            srcId = videoId,
            title = runsText(p.obj("title")),
            artist = artists.joinToString(", ").ifEmpty { runs.firstOrNull()?.optString("text") ?: "" },
            album = album ?: "",
            duration = parseDuration(runsText(p.obj("lengthText"))),
            cover = thumb(p.obj("thumbnail")),
        )
    }

    private fun mapTwoRow(i: JSONObject): Any? {
        val title = runsText(i.obj("title"))
        val sub = runsText(i.obj("subtitle"))
        val cover = thumb(i.obj("thumbnailRenderer"))
        val nav = i.obj("navigationEndpoint")
        val watchId = nav?.obj("watchEndpoint")?.str("videoId")
        if (watchId != null) {
            val artist = i.obj("subtitle")?.arr("runs").objects().firstOrNull { browseId(it)?.startsWith("UC") == true }?.optString("text")
            return Track("yt:$watchId", SOURCE_YT, watchId, title, artist ?: sub, cover = cover)
        }
        val bid = nav?.obj("browseEndpoint")?.str("browseId") ?: return null
        if (bid.startsWith("UC")) return null // исполнители — пока не показываем
        return Playlist(id = "yt:$bid", source = SOURCE_YT, title = title, cover = cover, subtitle = sub)
    }

    private fun tracksIn(node: Any?): List<Track> {
        val out = LinkedHashMap<String, Track>()
        findAll(node, "musicResponsiveListItemRenderer").mapNotNull { mapResponsive(it) }.forEach { out.putIfAbsent(it.id, it) }
        return out.values.toList()
    }

    // ---------- Методы ----------

    suspend fun account(): Account {
        account?.let { return it }
        val name = try {
            val r = post("account/account_menu", JSONObject())
            findAll(r, "accountName").firstOrNull()?.let { runsText(it) }
        } catch (_: Exception) {
            null
        }
        return Account(name ?: "YouTube Music").also { account = it }
    }

    suspend fun search(q: String): List<Track> {
        val r = post("search", JSONObject().put("query", q).put("params", SONGS_PARAMS))
        return tracksIn(r)
    }

    suspend fun home(): List<HomeSection> {
        val r = post("browse", JSONObject().put("browseId", "FEmusic_home"))
        return findAll(r, "musicCarouselShelfRenderer").mapNotNull { shelf ->
            val title = runsText(shelf.path("header", "musicCarouselShelfBasicHeaderRenderer")?.obj("title"))
            val items = shelf.arr("contents").objects()
            val tracks = items.mapNotNull { it.obj("musicResponsiveListItemRenderer")?.let(::mapResponsive) }.toMutableList()
            val lists = ArrayList<Playlist>()
            items.mapNotNull { it.obj("musicTwoRowItemRenderer")?.let(::mapTwoRow) }.forEach {
                when (it) {
                    is Track -> tracks += it
                    is Playlist -> lists += it
                }
            }
            if (title.isEmpty() || (tracks.isEmpty() && lists.isEmpty())) null else HomeSection(title, tracks, lists)
        }
    }

    /** Треки плейлиста/альбома с подгрузкой продолжений */
    suspend fun browseTracks(browseId: String, limit: Int = 300): List<Track> {
        val out = LinkedHashMap<String, Track>()
        var r = post("browse", JSONObject().put("browseId", browseId))
        var pages = 0
        while (true) {
            tracksIn(r).forEach { out.putIfAbsent(it.id, it) }
            if (out.size >= limit || ++pages > 12) break
            val token = findAll(r, "continuationCommand").firstOrNull()?.str("token")
            val legacy = findAll(r, "nextContinuationData").firstOrNull()?.str("continuation")
            r = when {
                token != null -> post("browse", JSONObject().put("continuation", token))
                legacy != null -> post("browse", JSONObject(), query = "&ctoken=$legacy&continuation=$legacy&type=next")
                else -> break
            }
        }
        return out.values.take(limit)
    }

    suspend fun likedTracks(): List<Track> = browseTracks("VLLM")

    suspend fun playlistTracks(id: String): List<Track> {
        val raw = id.removePrefix("yt:")
        val browse = if (raw.startsWith("PL") || raw.startsWith("RD") || raw.startsWith("OLAK") || raw == "LM") "VL$raw" else raw
        return browseTracks(browse)
    }

    suspend fun playlists(): List<Playlist> {
        val r = post("browse", JSONObject().put("browseId", "FEmusic_liked_playlists"))
        return findAll(r, "musicTwoRowItemRenderer").mapNotNull { mapTwoRow(it) as? Playlist }
            .filter { it.id != "yt:VLLM" }
            .let { listOf(Playlist("yt:VLLM", SOURCE_YT, "Понравившиеся", subtitle = "YouTube Music")) + it }
    }

    /** «Радио» по треку — основа подмешивания YT в волну */
    suspend fun radio(videoId: String): List<Track> {
        val r = post(
            "next",
            JSONObject()
                .put("videoId", videoId)
                .put("playlistId", "RDAMVM$videoId")
                .put("isAudioOnly", true)
                .put("tunerSettingValue", "AUTOMIX_SETTING_NORMAL"),
        )
        val out = LinkedHashMap<String, Track>()
        findAll(r, "playlistPanelVideoRenderer").mapNotNull { mapPanel(it) }.forEach { out.putIfAbsent(it.id, it) }
        return out.values.filter { it.srcId != videoId }
    }

    suspend fun like(videoId: String, on: Boolean) {
        if (!loggedIn) throw ApiException("Войди в YouTube Music, чтобы ставить лайки")
        post(if (on) "like/like" else "like/removelike", JSONObject().put("target", JSONObject().put("videoId", videoId)))
    }

    /** Пул YT-треков для волны: радио по случайным лайкам (как wavePool в десктопе) */
    suspend fun wavePool(diversity: String, exclude: Set<String>, size: Int = 25): List<Track> {
        val liked = try {
            likedTracks()
        } catch (_: Exception) {
            emptyList()
        }
        val likedIds = liked.map { it.id }.toSet()
        val seeds = liked.shuffled().take(3).toMutableList()
        if (seeds.isEmpty()) {
            val h = try {
                home()
            } catch (_: Exception) {
                emptyList()
            }
            seeds += h.flatMap { it.tracks }.shuffled().take(3)
        }
        val pool = LinkedHashMap<String, Track>()
        for (seed in seeds) {
            try {
                radio(seed.srcId).forEach { t ->
                    if (t.id in exclude) return@forEach
                    if (diversity == "discover" && t.id in likedIds) return@forEach
                    pool.putIfAbsent(t.id, t)
                }
            } catch (_: Exception) {
            }
            if (pool.size >= size) break
        }
        if (diversity == "favorite") {
            liked.filter { it.id !in exclude }.shuffled().take((size + 2) / 3).forEach { pool.putIfAbsent(it.id, it) }
        }
        return pool.values.shuffled().take(size)
    }
}
