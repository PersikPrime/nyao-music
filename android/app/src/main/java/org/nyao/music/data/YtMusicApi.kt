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
class YtMusicApi(private val prefs: Prefs, private val diagDir: java.io.File? = null) {

    companion object {
        const val ORIGIN = "https://music.youtube.com"
        private const val REMIX_VERSION = "1.20250219.01.00"
        const val DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        // Фильтр «Песни» в поиске (из ytmusicapi)
        private const val SONGS_PARAMS = "EgWKAQIIAWoMEA4QChADEAQQCRAF"
        private val TIME = Regex("^\\d{1,2}:\\d{2}(:\\d{2})?$")
        private val TYPE_WORDS = setOf("Песня", "Song", "Видео", "Video", "Трек", "Эпизод", "Episode")
        private val SHAPE_SKIP = setOf("trackingParams", "clickTrackingParams", "loggingDirectives", "responseContext", "frameworkUpdates")
        private val VIDEO_ID = Regex("^[\\w-]{11}$")

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

    // ---------- Отчёт о сбоях (без cookies: только стек и форма ответа) ----------

    val diagFile: java.io.File? get() = diagDir?.let { java.io.File(it, "yt-debug.log") }

    fun diag(op: String, e: Throwable?, meta: String = "", response: Any? = null) {
        val f = diagFile ?: return
        runCatching {
            if (f.length() > 1_000_000) f.delete()
            val sb = StringBuilder()
            sb.append(java.time.Instant.now()).append(" [").append(op).append("] v")
                .append(org.nyao.music.BuildConfig.VERSION_NAME).append(' ').append(meta).append('\n')
            if (e != null) sb.append("  ").append(e.toString()).append('\n')
                .append(e.stackTrace.take(6).joinToString("\n") { "    at $it" }).append('\n')
            if (response != null) sb.append("  shape: ").append(shape(response, 0).toString().take(40_000)).append('\n')
            f.appendText(sb.toString())
        }
    }

    /** Только имена полей и типы — никаких значений (имён, почты, токенов) */
    private fun shape(node: Any?, depth: Int): Any? = when (node) {
        is JSONObject -> if (depth >= 9) "{${node.length()}}" else JSONObject().also { o ->
            val keys = node.keys()
            while (keys.hasNext()) {
                val k = keys.next()
                if (k in SHAPE_SKIP) continue
                o.put(k, shape(node.opt(k), depth + 1))
            }
        }
        is JSONArray -> if (depth >= 9) "[${node.length()}]" else JSONArray().also { a ->
            for (i in 0 until minOf(2, node.length())) a.put(shape(node.opt(i), depth + 1))
            if (node.length() > 2) a.put("…+${node.length() - 2}")
        }
        null -> null
        else -> node.javaClass.simpleName
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
        val artistId = runs.firstNotNullOfOrNull { r2 -> browseId(r2)?.takeIf { it.startsWith("UC") } }
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
            albumId = albumRun?.let { browseId(it) },
            duration = parseDuration(durText),
            cover = thumb(r.obj("thumbnail")),
            artistId = artistId,
        )
    }

    private fun mapPanel(p: JSONObject): Track? {
        val videoId = p.str("videoId") ?: return null
        val runs = p.obj("longBylineText")?.arr("runs").objects()
        val artists = runs.filter { browseId(it)?.startsWith("UC") == true }.map { it.optString("text") }
        val artistId = runs.firstNotNullOfOrNull { r2 -> browseId(r2)?.takeIf { it.startsWith("UC") } }
        val albumRun = runs.firstOrNull { browseId(it)?.startsWith("MPRE") == true }
        val album = albumRun?.optString("text")
        return Track(
            id = "yt:$videoId",
            source = SOURCE_YT,
            srcId = videoId,
            title = runsText(p.obj("title")),
            artist = artists.joinToString(", ").ifEmpty { runs.firstOrNull()?.optString("text") ?: "" },
            album = album ?: "",
            albumId = albumRun?.let { browseId(it) },
            duration = parseDuration(runsText(p.obj("lengthText"))),
            cover = thumb(p.obj("thumbnail")),
            artistId = artistId,
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
        findAll(node, "musicResponsiveListItemRenderer").mapNotNull { runCatching { mapResponsive(it) }.getOrNull() }.forEach { out.putIfAbsent(it.id, it) }
        findAll(node, "playlistPanelVideoRenderer").mapNotNull { runCatching { mapPanel(it) }.getOrNull() }.forEach { out.putIfAbsent(it.id, it) }
        if (out.isEmpty()) guessTracks(node).forEach { out.putIfAbsent(it.id, it) }
        return out.values.toList()
    }

    private fun videoIds(node: Any?, out: MutableSet<String> = LinkedHashSet(), depth: Int = 0): MutableSet<String> {
        if (depth > 30) return out
        when (node) {
            is JSONObject -> {
                val keys = node.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    val v = node.opt(k)
                    if (k == "videoId" && v is String && VIDEO_ID.matches(v)) out += v else videoIds(v, out, depth + 1)
                }
            }
            is JSONArray -> for (i in 0 until node.length()) videoIds(node.opt(i), out, depth + 1)
        }
        return out
    }

    private fun texts(node: Any?, out: MutableList<String> = ArrayList(), depth: Int = 0): MutableList<String> {
        if (depth > 14 || out.size > 8) return out
        when (node) {
            is JSONObject -> {
                when {
                    node.has("runs") && node.opt("runs") is JSONArray -> { out += runsText(node); return out }
                    node.opt("simpleText") is String -> { out += node.optString("simpleText"); return out }
                    node.opt("content") is String -> { out += node.optString("content"); return out }
                }
                val keys = node.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    if (Regex("accessibility|menu|overlay|badge|tooltip|label$", RegexOption.IGNORE_CASE).containsMatchIn(k)) continue
                    texts(node.opt(k), out, depth + 1)
                }
            }
            is JSONArray -> for (i in 0 until node.length()) texts(node.opt(i), out, depth + 1)
        }
        return out
    }

    private fun anyThumb(node: Any?): String? {
        val all = ArrayList<JSONObject>()
        fun walk(n: Any?, d: Int) {
            if (d > 12) return
            when (n) {
                is JSONObject -> {
                    val u = n.str("url")
                    if (u != null && (u.contains("ytimg") || u.contains("ggpht") || u.contains("googleusercontent"))) all += n
                    val keys = n.keys()
                    while (keys.hasNext()) walk(n.opt(keys.next()), d + 1)
                }
                is JSONArray -> for (i in 0 until n.length()) walk(n.opt(i), d + 1)
            }
        }
        walk(node, 0)
        return bigThumb(all.maxByOrNull { it.optInt("width") }?.str("url")?.let { if (it.startsWith("//")) "https:$it" else it })
    }

    /** Последний шанс для незнакомой разметки (*ViewModel): элемент списка с одним videoId — это трек */
    private fun guessTracks(root: Any?): List<Track> {
        val out = ArrayList<Track>()
        val seen = HashSet<String>()
        fun walk(node: Any?, depth: Int) {
            if (depth > 40) return
            when (node) {
                is JSONArray -> {
                    val els = (0 until node.length()).map { node.opt(it) }
                    if (els.isNotEmpty() && els.all { it is JSONObject }) {
                        for (el in els) {
                            val ids = videoIds(el)
                            if (ids.size == 1) {
                                val id = ids.first()
                                if (id in seen) continue
                                val ts = texts(el).map { it.trim() }.filter { it.isNotEmpty() && it != "•" }
                                if (ts.isEmpty()) continue
                                seen += id
                                val sub = ts.drop(1).filterNot { TIME.matches(it) }.firstOrNull().orEmpty()
                                val parts = sub.split(Regex("\\s*•\\s*")).filter { it.isNotEmpty() && !TIME.matches(it) && it !in TYPE_WORDS && !it.contains("просмотр") && !it.contains("views") }
                                out += Track(
                                    id = "yt:$id", source = SOURCE_YT, srcId = id, title = ts[0],
                                    artist = parts.getOrNull(0) ?: "YouTube Music", album = parts.getOrNull(1) ?: "",
                                    duration = parseDuration(ts.firstOrNull { TIME.matches(it) } ?: ""), cover = anyThumb(el),
                                )
                                continue
                            }
                            walk(el, depth + 1)
                        }
                        return
                    }
                    els.forEach { walk(it, depth + 1) }
                }
                is JSONObject -> {
                    val keys = node.keys()
                    while (keys.hasNext()) walk(node.opt(keys.next()), depth + 1)
                }
            }
        }
        walk(root, 0)
        return out
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

    /** Исполнители и альбомы в поиске (фильтры «Исполнители»/«Альбомы» YouTube Music) */
    suspend fun searchArtists(q: String): List<SearchArtist> {
        val r = post("search", JSONObject().put("query", q).put("params", "EgWKAQIgAWoMEA4QChADEAQQCRAF"))
        return findAll(r, "musicResponsiveListItemRenderer").mapNotNull { it ->
            val bid = it.path("navigationEndpoint", "browseEndpoint")?.str("browseId") ?: return@mapNotNull null
            if (!bid.startsWith("UC")) return@mapNotNull null
            val name = runsText(it.arr("flexColumns").objects().firstOrNull()?.path("musicResponsiveListItemFlexColumnRenderer", "text"))
            SearchArtist(SOURCE_YT, bid, name, thumb(it.obj("thumbnail")))
        }.distinctBy { it.id }.take(10)
    }

    suspend fun searchAlbums(q: String): List<Playlist> {
        val r = post("search", JSONObject().put("query", q).put("params", "EgWKAQIYAWoMEA4QChADEAQQCRAF"))
        return findAll(r, "musicResponsiveListItemRenderer").mapNotNull { it ->
            val bid = it.path("navigationEndpoint", "browseEndpoint")?.str("browseId") ?: return@mapNotNull null
            if (!bid.startsWith("MPRE")) return@mapNotNull null
            val cols = it.arr("flexColumns").objects().map { c -> c.path("musicResponsiveListItemFlexColumnRenderer", "text") }
            Playlist("yt:$bid", SOURCE_YT, runsText(cols.firstOrNull()), cover = thumb(it.obj("thumbnail")), subtitle = runsText(cols.getOrNull(1)))
        }.distinctBy { it.id }.take(12)
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
    suspend fun browseTracks(browseId: String, limit: Int = 5000): List<Track> {
        val first = try {
            browsePages(browseId, limit, auth = loggedIn)
        } catch (e: Exception) {
            diag("browse", e, browseId)
            if (!loggedIn || browseId == "VLLM") throw e
            emptyList()
        }
        if (first.isNotEmpty() || !loggedIn || browseId == "VLLM") return first
        // У аккаунта пусто или ошибка — публичный плейлист открываем без входа
        return try {
            browsePages(browseId, limit, auth = false).also { if (it.isNotEmpty()) diag("browse:anon-ok", null, "$browseId ${it.size}") }
        } catch (e: Exception) {
            diag("browse:anon", e, browseId)
            emptyList()
        }
    }

    private suspend fun browsePages(browseId: String, limit: Int, auth: Boolean): List<Track> {
        val out = LinkedHashMap<String, Track>()
        var r = post("browse", JSONObject().put("browseId", browseId), auth = auth)
        var pages = 0
        while (true) {
            val got = tracksIn(r)
            if (got.isEmpty() && pages == 0) diag("browse:empty", null, "$browseId auth=$auth", r)
            got.forEach { out.putIfAbsent(it.id, it) }
            if (out.size >= limit || ++pages > 60) break
            val token = findAll(r, "continuationCommand").firstOrNull()?.str("token")
            val legacy = findAll(r, "nextContinuationData").firstOrNull()?.str("continuation")
            r = try {
                when {
                    token != null -> post("browse", JSONObject().put("continuation", token), auth = auth)
                    legacy != null -> post("browse", JSONObject(), auth = auth, query = "&ctoken=$legacy&continuation=$legacy&type=next")
                    else -> break
                }
            } catch (e: Exception) {
                diag("browse:cont", e, "$browseId got=${out.size}")
                break
            }
        }
        return out.values.take(limit)
    }

    suspend fun likedTracks(): List<Track> = browseTracks("VLLM")
    /** Начало лайков (новые сверху) — для подмеса волны хватает 300 */
    suspend fun likedTracksForWave(): List<Track> = browseTracks("VLLM", 300)

    suspend fun playlistTracks(id: String): List<Track> {
        val raw = id.removePrefix("yt:")
        val browse = if (raw.startsWith("PL") || raw.startsWith("RD") || raw.startsWith("OLAK") || raw.startsWith("FL") || raw.startsWith("UU") || raw == "LM") "VL$raw" else raw
        return browseTracks(browse)
    }

    suspend fun playlists(): List<Playlist> {
        val r = try {
            post("browse", JSONObject().put("browseId", "FEmusic_liked_playlists"))
        } catch (e: Exception) {
            diag("library", e); throw e
        }
        return findAll(r, "musicTwoRowItemRenderer").mapNotNull { runCatching { mapTwoRow(it) }.getOrNull() as? Playlist }
            .also { if (it.isEmpty()) diag("library:empty", null, "", r) }
            .filter { it.id != "yt:VLLM" }
            .let { listOf(Playlist("yt:VLLM", SOURCE_YT, "Понравившиеся", subtitle = "YouTube Music")) + it }
    }

    /** Страница исполнителя YouTube Music: песни и альбомы */
    suspend fun artist(channelId: String): ArtistPage {
        val r = post("browse", JSONObject().put("browseId", channelId))
        val header = findAll(r, "musicImmersiveHeaderRenderer").firstOrNull() ?: findAll(r, "musicVisualHeaderRenderer").firstOrNull()
        val name = header?.let { runsText(it.obj("title")) }?.ifBlank { null } ?: "Исполнитель"
        val cover = header?.let { thumb(it.obj("thumbnail")) }
        val songs = tracksIn(findAll(r, "musicShelfRenderer").firstOrNull()).map { if (it.cover == null) it.copy(cover = cover) else it }
        val albums = findAll(r, "musicTwoRowItemRenderer").mapNotNull { mapTwoRow(it) as? Playlist }
            .filter { it.id.startsWith("yt:MPRE") }
            .distinctBy { it.id }
        return ArtistPage(SOURCE_YT, channelId, name, cover, null, songs, albums)
    }

    /** Текст из YouTube Music (обычно без таймингов, от LyricFind): вкладка «Текст» у трека */
    suspend fun lyrics(videoId: String): String? {
        val next = post("next", JSONObject().put("videoId", videoId).put("isAudioOnly", true))
        val bid = findAll(next, "browseEndpoint").mapNotNull { it.str("browseId") }.firstOrNull { it.startsWith("MPLY") } ?: return null
        val r = post("browse", JSONObject().put("browseId", bid))
        val shelf = findAll(r, "musicDescriptionShelfRenderer").firstOrNull() ?: return null
        return runsText(shelf.obj("description")).ifBlank { null }
    }

    /** Все треки исполнителя: раздел «Песни» → его полный плейлист (кнопка «Показать все») */
    suspend fun artistTracks(channelId: String): List<Track> {
        val r = post("browse", JSONObject().put("browseId", channelId))
        val shelf = findAll(r, "musicShelfRenderer").firstOrNull() ?: return emptyList()
        val bid = shelf.path("bottomEndpoint", "browseEndpoint")?.str("browseId")
            ?: shelf.obj("title")?.arr("runs").objects().firstNotNullOfOrNull { browseId(it) }
        return if (bid != null && (bid.startsWith("VL") || bid.startsWith("PL") || bid.startsWith("OLAK"))) browseTracks(if (bid.startsWith("VL")) bid else "VL$bid") else tracksIn(shelf)
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

    /** Новый приватный плейлист (перенос плейлистов), как делает веб-версия. → id вида yt:PL… */
    suspend fun createPlaylist(title: String, videoIds: List<String>): String {
        if (!loggedIn) throw ApiException("Войди в YouTube Music, чтобы создавать плейлисты")
        val r = post("playlist/create", JSONObject().put("title", title.take(150)).put("privacyStatus", "PRIVATE").put("videoIds", JSONArray(videoIds.take(100))))
        val id = r.str("playlistId") ?: throw ApiException("YouTube Music не создал плейлист")
        videoIds.drop(100).chunked(100).forEach { chunk ->
            val actions = JSONArray()
            chunk.forEach { v -> actions.put(JSONObject().put("action", "ACTION_ADD_VIDEO").put("addedVideoId", v).put("dedupeOption", "DEDUPE_OPTION_SKIP")) }
            post("browse/edit_playlist", JSONObject().put("playlistId", id).put("actions", actions))
        }
        return "yt:$id"
    }

    suspend fun like(videoId: String, on: Boolean) {
        if (!loggedIn) throw ApiException("Войди в YouTube Music, чтобы ставить лайки")
        post(if (on) "like/like" else "like/removelike", JSONObject().put("target", JSONObject().put("videoId", videoId)))
    }

    /** Пул YT-треков для волны: радио по случайным лайкам (как wavePool в десктопе) */
    suspend fun wavePool(diversity: String, exclude: Set<String>, size: Int = 25, fresh: Int = 60): List<Track> {
        val liked = try {
            browseTracks("VLLM", 300) // для подбора волны хватает части лайков
        } catch (_: Exception) {
            emptyList()
        }
        val likedIds = liked.map { it.id }.toSet()
        // сиды из свежих лайков чаще, чем из старых (лайки идут от новых к старым)
        val seeds = Freshness.recencyPick(liked, 3, fresh).toMutableList()
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
            Freshness.recencyPick(liked.filter { it.id !in exclude }, (size + 2) / 3, fresh).forEach { pool.putIfAbsent(it.id, it) }
        }
        return pool.values.shuffled().take(size)
    }
}
