package org.nyao.music.data

import android.util.Log
import kotlinx.coroutines.sync.withLock
import okhttp3.FormBody
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.util.concurrent.ConcurrentHashMap

/**
 * VK Музыка (бета) — перенос src/main/providers/vk.js.
 * Внутренние запросы сайта vk.com (al_audio.php) от имени сессии, в которую вошли во встроенном окне VK:
 * cookie берём из CookieManager WebView. Пароль к нам не попадает; токены живут только на телефоне.
 *
 * • трек — массив полей (id, owner_id, url, title, performer, duration, …, hashes, cover);
 * • ссылку на звук даёт act=reload_audio, она «замаскирована» — снимаем маску тем же алгоритмом, что yt-dlp;
 * • звук — HLS (.m3u8), куски с AES-128 ExoPlayer расшифровывает сам.
 */
class VkApi(private val prefs: Prefs) {

    companion object {
        /** Тот же User-Agent, что у окна входа: сессия VK к нему привязана */
        const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"
        private const val TAG = "NyaoVK"
        private const val B64 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/="

        // индексы полей трека (AUDIO_ITEM_INDEX_* из скриптов vk.com)
        private const val I_ID = 0
        private const val I_OWNER = 1
        private const val I_URL = 2
        private const val I_TITLE = 3
        private const val I_PERFORMER = 4
        private const val I_DURATION = 5
        private const val I_HASHES = 13
        private const val I_COVER = 14

        fun vkDecode(enc: String): String {
            val sb = StringBuilder()
            var e = 0
            var n = 0
            for (c in enc) {
                val r = B64.indexOf(c)
                if (r < 0) continue
                val cond = n % 4
                e = if (cond != 0) 64 * e + r else r
                n++
                if (cond != 0) sb.append((255 and (e shr ((-2 * n) and 6))).toChar())
            }
            return sb.toString()
        }

        /** Снимает маску со ссылки (перенос _unmask_url из yt-dlp) */
        fun unmaskUrl(maskUrl: String, uid: Long): String {
            if (!maskUrl.contains("audio_api_unavailable")) return maskUrl
            val extra = maskUrl.substringAfter("?extra=").split("#")
            val parts = vkDecode(extra.getOrElse(1) { "" }).split(11.toChar())
            val base = parts.getOrElse(1) { "0" }
            val chars = vkDecode(extra[0]).toCharArray()
            val len = chars.size
            if (len == 0) return maskUrl
            val indexes = IntArray(len)
            // как в JS: число приводится к int32 перед «^»
            var index = (base.toLongOrNull() ?: 0L).toInt() xor uid.toInt()
            for (n in len - 1 downTo 0) {
                index = (((len * (n + 1)) xor (index + n)) % len + len) % len
                indexes[n] = index
            }
            for (n in 1 until len) {
                val c = chars[n]
                val j = indexes[len - 1 - n]
                chars[n] = chars[j]
                chars[j] = c
            }
            return String(chars)
        }

        private fun unescapeHtml(s: String?): String = (s ?: "")
            .replace("&quot;", "\"").replace("&#039;", "'").replace("&#39;", "'")
            .replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
            .replace(Regex("<[^>]+>"), "")

        /** Ответы vk.com часто в windows-1251: берём кодировку из заголовка, иначе пробуем UTF-8 и откатываемся */
        fun decode(bytes: ByteArray, contentType: String?): String {
            val cs = contentType?.let { Regex("charset=([\\w-]+)", RegexOption.IGNORE_CASE).find(it)?.groupValues?.get(1) }
            if (cs != null && !cs.replace("-", "").equals("utf8", true)) {
                runCatching { return String(bytes, Charset.forName(cs)) }
            }
            return try {
                Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString()
            } catch (_: CharacterCodingException) {
                String(bytes, Charset.forName("windows-1251"))
            }
        }

        private fun isNum(v: Any?): Boolean = v != null && Regex("^-?\\d+$").matches(v.toString())

        fun isAudioItem(a: Any?): Boolean =
            a is JSONArray && a.length() > I_HASHES && isNum(a.opt(I_ID)) && isNum(a.opt(I_OWNER)) &&
                a.opt(I_TITLE) is String && a.opt(I_PERFORMER) is String

        fun mapAudio(a: JSONArray): Track {
            val owner = a.opt(I_OWNER).toString()
            val id = a.opt(I_ID).toString()
            var covers = a.optString(I_COVER).split(",").filter { it.startsWith("http") }
            if (covers.isEmpty()) {
                // обложка могла переехать в другое поле — ищем любую ссылку на картинку
                val any = (0 until a.length()).map { a.opt(it) }.filterIsInstance<String>()
                    .firstOrNull { Regex("^https://[^\\s\"]+\\.(jpe?g|png|webp)", RegexOption.IGNORE_CASE).containsMatchIn(it) }
                if (any != null) covers = any.split(",").filter { it.startsWith("http") }
            }
            return Track(
                id = "vk:${owner}_$id",
                source = SOURCE_VK,
                srcId = "${owner}_$id",
                title = unescapeHtml(a.optString(I_TITLE)).ifBlank { "Без названия" },
                artist = unescapeHtml(a.optString(I_PERFORMER)).ifBlank { "VK" },
                duration = a.optInt(I_DURATION),
                cover = covers.lastOrNull(),
            )
        }

        /** Достаёт все треки из ответа VK, где бы они ни лежали: массивы, объекты, JSON строкой, HTML с data-audio */
        fun collect(node: Any?, out: MutableList<JSONArray> = ArrayList(), depth: Int = 0): MutableList<JSONArray> {
            if (depth > 12 || node == null || node == JSONObject.NULL) return out
            when {
                isAudioItem(node) -> out += node as JSONArray
                node is JSONArray -> for (i in 0 until node.length()) collect(node.opt(i), out, depth + 1)
                node is JSONObject -> node.keys().forEach { collect(node.opt(it), out, depth + 1) }
                node is String -> {
                    val t = node.trimStart()
                    if (node.length > 20 && (t.startsWith("{") || t.startsWith("["))) {
                        val parsed = runCatching { JSONTokener(node).nextValue() }.getOrNull()
                        if (parsed != null) collect(parsed, out, depth + 1) else htmlAudios(node, out, depth)
                    } else htmlAudios(node, out, depth)
                }
            }
            return out
        }

        private fun htmlAudios(html: String, out: MutableList<JSONArray>, depth: Int) {
            if (!html.contains("data-audio=")) return
            Regex("data-audio=\"([^\"]+)\"").findAll(html).forEach { m ->
                runCatching { collect(JSONArray(unescapeHtml(m.groupValues[1])), out, depth + 1) }
            }
        }

        private fun findPlaylist(node: Any?, depth: Int = 0): JSONObject? {
            if (depth > 8) return null
            return when (node) {
                is JSONObject -> if (node.optJSONArray("list") != null) node else node.keys().asSequence().firstNotNullOfOrNull { findPlaylist(node.opt(it), depth + 1) }
                is JSONArray -> (0 until node.length()).firstNotNullOfOrNull { findPlaylist(node.opt(it), depth + 1) }
                else -> null
            }
        }

        /** Трек из api.vk.com → такой же массив, как на сайте */
        fun apiAudioToItem(o: JSONObject): JSONArray {
            val a = JSONArray()
            for (i in 0..I_COVER) a.put("")
            val th = o.optJSONObject("album")?.optJSONObject("thumb")
            a.put(I_ID, o.opt("id"))
            a.put(I_OWNER, o.opt("owner_id"))
            a.put(I_URL, o.optString("url"))
            a.put(I_TITLE, o.optString("title"))
            a.put(I_PERFORMER, o.optString("artist"))
            a.put(I_DURATION, o.optInt("duration"))
            a.put(I_COVER, th?.let { it.str("photo_1200") ?: it.str("photo_600") ?: it.str("photo_300") ?: it.str("photo_270") } ?: "")
            return a
        }
    }

    val uid: Long? get() = prefs.vkUid
    val loggedIn: Boolean get() = uid != null
    val base: String get() = prefs.vkOrigin ?: "https://vk.com"

    private val raw = ConcurrentHashMap<String, JSONArray>()
    private val works = ConcurrentHashMap<String, String>()
    @Volatile private var token: Pair<String, Long>? = null

    /** Последние сбои — показываются в настройках («Что-то не работает?») */
    val debugLog = ArrayDeque<String>()

    private fun debug(msg: String) {
        Log.w(TAG, msg)
        synchronized(debugLog) {
            debugLog.addLast("${java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.ROOT).format(java.util.Date())} ${msg.take(1500)}")
            while (debugLog.size > 40) debugLog.removeFirst()
        }
    }

    fun debugText(): String = synchronized(debugLog) { debugLog.joinToString("\n\n") }

    fun reset() {
        raw.clear()
        works.clear()
        token = null
    }

    /** Нужен для тихого продления сессии (невидимый WebView). Задаёт Repo.init */
    @Volatile var appContext: android.content.Context? = null
    private val refreshLock = kotlinx.coroutines.sync.Mutex()
    @Volatile private var lastRefresh = 0L

    /**
     * Тихое продление сессии: vk.com сам обновляет свои cookie, когда открыт его сайт.
     * Открываем его в невидимом WebView (те же cookie, что после входа), ждём загрузку и сохраняем cookie на диск.
     * Ни пароля, ни cookie мы никуда не отправляем — всё остаётся в WebView этого телефона.
     * true — сессия жива (VK не отправил на страницу входа).
     */
    suspend fun refreshSession(force: Boolean = false): Boolean = refreshLock.withLock {
        val ctx = appContext ?: return false
        if (!force && System.currentTimeMillis() - lastRefresh < 60_000) return true
        val result = kotlinx.coroutines.withTimeoutOrNull(25_000) {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                kotlinx.coroutines.suspendCancellableCoroutine<Boolean> { cont ->
                    val wv = android.webkit.WebView(ctx)
                    wv.settings.javaScriptEnabled = true
                    wv.settings.domStorageEnabled = true
                    wv.settings.userAgentString = UA
                    android.webkit.CookieManager.getInstance().setAcceptCookie(true)
                    var done = false
                    fun finish(ok: Boolean) {
                        if (done) return
                        done = true
                        android.webkit.CookieManager.getInstance().flush()
                        wv.stopLoading()
                        wv.destroy()
                        if (cont.isActive) cont.resumeWith(Result.success(ok))
                    }
                    wv.webViewClient = object : android.webkit.WebViewClient() {
                        override fun onPageFinished(view: android.webkit.WebView, url: String) {
                            val login = url.contains("login") || url.contains("/join") || url.contains("id.vk.")
                            // даём скриптам VK пару секунд обновить cookie
                            view.postDelayed({ finish(!login) }, if (login) 0 else 3000)
                        }
                    }
                    cont.invokeOnCancellation { android.os.Handler(android.os.Looper.getMainLooper()).post { finish(false) } }
                    wv.loadUrl("$base/audios${uid ?: ""}")
                }
            }
        } ?: false
        lastRefresh = System.currentTimeMillis()
        debug(if (result) "сессия VK продлена" else "продлить сессию VK не удалось")
        if (result) prefs.vkRefreshedAt = System.currentTimeMillis()
        result
    }

    fun cookies(url: String = base): String? = runCatching { android.webkit.CookieManager.getInstance().getCookie(url) }.getOrNull()

    private fun send(req: Request.Builder): Pair<Int, String> {
        val r = req.header("User-Agent", UA).apply { cookies()?.let { header("Cookie", it) } }.build()
        return Net.client.newCall(r).execute().use { res ->
            val bytes = res.body?.bytes() ?: ByteArray(0)
            res.code to decode(bytes, res.header("Content-Type"))
        }
    }

    private suspend fun post(act: String, params: Map<String, Any?>): Any? = try {
        postOnce(act, params)
    } catch (e: SessionExpired) {
        // VK говорит «не вошёл»: сначала пробуем тихо продлить сессию и повторить, и только потом просим войти заново
        if (refreshSession(force = true)) {
            try {
                postOnce(act, params)
            } catch (e2: SessionExpired) {
                prefs.vkUid = null
                throw ApiException("Сессия VK закончилась — войди заново", 401)
            }
        } else {
            prefs.vkUid = null
            throw ApiException("Сессия VK закончилась — войди заново", 401)
        }
    }

    private class SessionExpired : java.io.IOException("VK: нет сессии")

    private suspend fun postOnce(act: String, params: Map<String, Any?>): Any? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val me = uid ?: throw ApiException("Нужен вход во VK")
        val form = FormBody.Builder().add("al", "1").add("act", act)
        params.forEach { (k, v) -> form.add(k, v?.toString() ?: "") }
        val (code, text) = send(
            Request.Builder().url("$base/al_audio.php?act=$act").post(form.build())
                .header("X-Requested-With", "XMLHttpRequest")
                .header("Origin", base)
                .header("Referer", "$base/audios$me"),
        )
        val json = runCatching { JSONObject(text.replaceFirst(Regex("^\\s*<!--"), "")) }.getOrElse {
            debug("$act $params → HTTP $code, не JSON:\n${text.take(1500)}")
            throw ApiException("VK ответил не тем, что ждали (HTTP $code)", code)
        }
        val payload = json.optJSONArray("payload") ?: run {
            debug("$act → нет payload:\n${text.take(1500)}")
            throw ApiException("VK изменил формат ответа")
        }
        when (payload.opt(0)?.toString()) {
            "3" -> throw SessionExpired()
            "8" -> throw ApiException("VK: " + unescapeHtml(payload.optJSONArray(1)?.optString(0) ?: "ошибка").trim('"'))
        }
        payload.opt(1)
    }

    private fun remember(list: List<JSONArray>): List<Track> {
        val seen = HashSet<String>()
        return list.mapNotNull { a ->
            val t = mapAudio(a)
            if (!seen.add(t.id)) return@mapNotNull null
            raw[t.srcId] = a
            t
        }
    }

    suspend fun account(): Account = Account("VK id$uid", uid = uid?.toString())

    /** «Моя музыка» */
    suspend fun likedTracks(limit: Int = 5000): List<Track> {
        val me = uid ?: throw ApiException("Нужен вход во VK")
        return loadPlaylist(me.toString(), "-1", "", limit)
    }

    /** Треки плейлиста (playlist_id -1 — «Моя музыка») */
    private suspend fun loadPlaylist(owner: String, playlistId: String, hash: String, limit: Int = 5000): List<Track> {
        val out = ArrayList<JSONArray>()
        var offset = 0
        for (page in 0 until 60) {
            if (out.size >= limit) break
            val data = post("load_section", mapOf("owner_id" to owner, "playlist_id" to playlistId, "offset" to offset, "type" to "playlist", "access_hash" to hash, "is_loading_all" to 1))
            val pl = findPlaylist(data)
            val items = collect(pl?.optJSONArray("list") ?: data)
            if (items.isEmpty()) {
                if (page == 0) debug("load_section: треков не нашлось:\n${data.toString().take(2000)}")
                break
            }
            out += items
            if (pl == null || !pl.optBoolean("hasMore")) break
            offset = pl.optInt("nextOffset").takeIf { it > 0 } ?: (offset + items.size)
        }
        return remember(out.take(limit))
    }

    /** Свои плейлисты VK: id вида vk:владелец_плейлист_ключ */
    suspend fun playlists(): List<Playlist> {
        val me = uid ?: return emptyList()
        data class P(val owner: String, val id: String, val hash: String, val title: String, val count: Int, val cover: String?)
        val viaApi: suspend () -> List<P> = {
            val r = api("audio.getPlaylists", mapOf("owner_id" to me.toString(), "count" to "100"))
            (r as? JSONObject)?.optJSONArray("items").objects().map { p ->
                val th = p.optJSONArray("thumbs")?.optJSONObject(0) ?: p.optJSONObject("photo")
                P(p.opt("owner_id").toString(), p.opt("id").toString(), p.optString("access_key"), p.optString("title"), p.optInt("count"), th?.let { it.str("photo_600") ?: it.str("photo_300") ?: it.str("photo_270") })
            }
        }
        val viaMobile: suspend () -> List<P> = {
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                val (_, html) = send(Request.Builder().url(base.replace("://", "://m.") + "/audio?act=audio_playlists$me").header("X-Requested-With", "XMLHttpRequest"))
                val seen = HashSet<String>()
                Regex("act=audio_playlist(-?\\d+)_(\\d+)(?:&(?:amp;)?access_hash=([0-9a-f]+))?[^>]*>([\\s\\S]{0,1500}?)</a>").findAll(html).mapNotNull { m ->
                    if (!seen.add(m.groupValues[1] + "_" + m.groupValues[2])) return@mapNotNull null
                    val inner = m.groupValues[4]
                    val title = Regex("class=\"[^\"]*(?:Title|title)[^\"]*\"[^>]*>([^<]+)<").find(inner)?.groupValues?.get(1)?.trim().orEmpty()
                    val cover = Regex("url\\((?:&quot;|'|\")?(https:[^)'\"&]+)").find(inner)?.groupValues?.get(1)
                    P(m.groupValues[1], m.groupValues[2], m.groupValues[3], title, 0, cover)
                }.toList()
            }
        }
        for ((name, fn) in listOf("api" to viaApi, "m.vk" to viaMobile)) {
            try {
                val list = fn()
                if (list.isNotEmpty()) return list.map { p -> Playlist("vk:${p.owner}_${p.id}_${p.hash}", SOURCE_VK, unescapeHtml(p.title).ifBlank { "Плейлист" }, p.count, p.cover, "VK Музыка") }
            } catch (e: Exception) {
                debug("playlists / $name: ${e.message}")
            }
        }
        return emptyList()
    }

    suspend fun playlistTracks(id: String): List<Track> {
        val m = Regex("^vk:(-?\\d+)_(-?\\d+)_?(\\w*)$").find(id) ?: throw ApiException("Странный плейлист VK")
        return loadPlaylist(m.groupValues[1], m.groupValues[2], m.groupValues[3])
    }

    private suspend fun section(name: String, extra: Map<String, Any?> = emptyMap()): List<Track> {
        val data = post("section", mapOf("owner_id" to uid, "section" to name, "claim" to 0, "is_layer" to 0) + extra)
        val items = collect(data)
        if (items.isEmpty()) debug("section $name $extra: треков не нашлось:\n${data.toString().take(2000)}")
        return remember(items)
    }

    /** Токен api.vk.com, который vk.com выдаёт своей веб-версии. Только в памяти */
    private fun webToken(): String {
        token?.let { if (it.second > System.currentTimeMillis()) return it.first }
        val host = if (base.contains("vk.ru")) "https://login.vk.ru" else "https://login.vk.com"
        val (code, text) = send(
            Request.Builder().url("$host/?act=web_token")
                .post(FormBody.Builder().add("version", "1").add("app_id", "6287487").build())
                .header("Origin", base).header("Referer", "$base/"),
        )
        val j = runCatching { JSONObject(text) }.getOrElse { throw ApiException("web_token: HTTP $code, не JSON: ${text.take(300)}") }
        val data = j.optJSONObject("data")
        val t = data?.str("access_token") ?: throw ApiException("web_token: нет токена: ${text.take(300)}")
        val exp = data.optLong("expires")
        token = t to (if (exp > 1_000_000_000L) exp * 1000 - 60_000 else System.currentTimeMillis() + 30 * 60_000)
        return t
    }

    private suspend fun api(method: String, params: Map<String, String>): Any? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val t = webToken()
        val host = if (base.contains("vk.ru")) "https://api.vk.ru" else "https://api.vk.com"
        val form = FormBody.Builder().add("access_token", t)
        params.forEach { (k, v) -> form.add(k, v) }
        val (_, text) = send(Request.Builder().url("$host/method/$method?v=5.199&client_id=6287487").post(form.build()).header("Origin", base).header("Referer", "$base/"))
        val j = JSONObject(text)
        j.optJSONObject("error")?.let { e ->
            if (e.optInt("error_code") == 5) token = null
            throw ApiException("$method: ${e.optInt("error_code")} ${e.optString("error_msg")}")
        }
        j.opt("response")
    }

    private fun apiTracks(resp: Any?): List<Track> {
        val items = when (resp) {
            is JSONObject -> resp.optJSONArray("items") ?: resp.optJSONArray("audios")
            is JSONArray -> resp
            else -> null
        }
        return remember(items.objects().filter { it.has("owner_id") && it.has("id") }.map { apiAudioToItem(it) })
    }

    /** Мобильная версия отдаёт треки прямо в HTML (data-audio) */
    private suspend fun mobile(path: String): List<Track> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val mBase = base.replace("://", "://m.")
        val (code, text) = send(Request.Builder().url("$mBase$path").header("X-Requested-With", "XMLHttpRequest"))
        val items = collect(text.replaceFirst(Regex("^\\s*<!--"), ""))
        if (items.isEmpty()) debug("m$path: треков не нашлось (HTTP $code):\n${text.take(1200)}")
        remember(items)
    }

    /** Пробует способы по очереди (сначала тот, что сработал в прошлый раз), пока какой-то не вернёт треки */
    private class Try(val name: String, val fn: suspend () -> List<Track>)

    private suspend fun firstOf(what: String, tries: List<Try>): List<Track> {
        val w = works[what]
        val ordered = if (w == null) tries else tries.filter { it.name == w } + tries.filter { it.name != w }
        for (t in ordered) {
            val name = t.name
            try {
                val list = t.fn()
                if (list.isNotEmpty()) {
                    if (works[what] != name) debug("$what: сработал способ «$name» (${list.size} треков)")
                    works[what] = name
                    return list
                }
            } catch (e: Exception) {
                debug("$what / $name: ${e.message}")
                if (!loggedIn) throw e
            }
        }
        return emptyList()
    }

    suspend fun search(q: String): List<Track> = firstOf(
        "search",
        listOf(
            Try("section") { section("search", mapOf("q" to q)) },
            Try("api audio.search") { apiTracks(api("audio.search", mapOf("q" to q, "count" to "100", "auto_complete" to "1", "sort" to "2"))) },
            Try("m.vk") { mobile("/audio?act=search&q=" + java.net.URLEncoder.encode(q, "UTF-8")) },
        ),
    )

    suspend fun recommendations(): List<Track> = firstOf(
        "recoms",
        listOf(
            Try("section recoms") { section("recoms") },
            Try("api audio.getRecommendations") { apiTracks(api("audio.getRecommendations", mapOf("count" to "100", "shuffle" to "1"))) },
            Try("section explore") { section("explore") },
        ),
    )

    private fun hashes(srcId: String): List<String> = raw[srcId]?.optString(I_HASHES)?.split("/") ?: emptyList()

    suspend fun like(track: Track, on: Boolean) {
        val (owner, id) = track.srcId.split("_").let { it[0] to it.getOrElse(1) { "" } }
        val h = hashes(track.srcId)
        if (on) {
            val hash = h.getOrNull(0)?.takeIf { it.isNotEmpty() } ?: throw ApiException("VK не дал ключ для лайка этого трека")
            post("add", mapOf("group_id" to 0, "audio_owner_id" to owner, "audio_id" to id, "hash" to hash, "from" to "search"))
        } else {
            val hash = h.getOrNull(3)?.takeIf { it.isNotEmpty() } ?: throw ApiException("VK не дал ключ для удаления этого трека")
            post("delete_audio", mapOf("oid" to owner, "aid" to id, "hash" to hash, "restore" to 1))
        }
    }

    /** Пул для «Моей волны»: рекомендации VK + свои треки; VK не пропадает из волны, даже если всё недавно звучало */
    suspend fun wavePool(diversity: String, exclude: Set<String>, size: Int = 20, fresh: Int = 60): List<Track> {
        val pool = LinkedHashMap<String, Track>()
        runCatching { recommendations() }.getOrDefault(emptyList()).forEach { if (it.id !in exclude) pool[it.id] = it }
        val liked = runCatching { likedTracks(200) }.onFailure { debug("wavePool liked: ${it.message}") }.getOrDefault(emptyList()).let { Freshness.recencyPick(it, it.size, fresh) }
        if (diversity != "discover" || pool.isEmpty()) {
            liked.filter { it.id !in exclude }.take(if (pool.isEmpty()) size else (size + 2) / 3).forEach { pool.putIfAbsent(it.id, it) }
        }
        if (pool.isEmpty()) liked.take(3).forEach { pool[it.id] = it }
        return pool.values.shuffled().take(size)
    }

    /** Ссылка на звук: reload_audio → снять маску. Блокирующий — из потока загрузки */
    fun streamUrl(srcId: String): String = kotlinx.coroutines.runBlocking {
        val me = uid ?: throw ApiException("Нужен вход во VK")
        var url = raw[srcId]?.optString(I_URL)?.takeIf { it.isNotEmpty() }
        if (url == null) {
            val h = hashes(srcId)
            val full = if (h.size > 5) "${srcId}_${h[2]}_${h[5]}" else srcId
            var found: JSONArray? = null
            try {
                val data = post("reload_audio", mapOf("ids" to full))
                val all = collect(data)
                found = all.firstOrNull { "${it.opt(I_OWNER)}_${it.opt(I_ID)}" == srcId } ?: all.firstOrNull()
                if (found?.optString(I_URL).isNullOrEmpty()) debug("reload_audio $full: ссылки нет:\n${data.toString().take(1500)}")
            } catch (e: Exception) {
                debug("reload_audio $full: ${e.message}")
            }
            if (found?.optString(I_URL).isNullOrEmpty()) {
                // трек пришёл из api.vk.com без хешей — спрашиваем ссылку там же
                try {
                    val r = api("audio.getById", mapOf("audios" to srcId))
                    val o = (r as? JSONArray)?.optJSONObject(0) ?: (r as? JSONObject)?.optJSONArray("items")?.optJSONObject(0)
                    if (o?.str("url") != null) found = apiAudioToItem(o)
                } catch (e: Exception) {
                    debug("audio.getById $srcId: ${e.message}")
                }
            }
            val f = found?.takeIf { it.optString(I_URL).isNotEmpty() }
                ?: throw ApiException("VK не дал ссылку на трек (возможно, он недоступен в твоей стране или нужна подписка)")
            raw[srcId] = f
            url = f.optString(I_URL)
        }
        unmaskUrl(url!!, me)
    }

    /** Ссылка протухла — в следующий раз попросим новую */
    fun forget(srcId: String) {
        raw[srcId]?.let { a -> raw[srcId] = JSONArray(a.toString()).apply { put(I_URL, "") } }
    }
}
