package org.nyao.music.data

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
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

        /** «Вышло недавно»: Сегодня, Вчера, 3 дня назад, 2 недели назад… */
        fun releaseAgo(ts: Long, now: Long = System.currentTimeMillis()): String {
            val d = ((now - ts) / 86_400_000L).toInt()
            fun pl(n: Int, one: String, few: String, many: String): String {
                val a = n % 10
                val b = n % 100
                return if (a == 1 && b != 11) one else if (a in 2..4 && (b < 10 || b >= 20)) few else many
            }
            return when {
                d <= 0 -> "Сегодня"
                d == 1 -> "Вчера"
                d < 7 -> "$d ${pl(d, "день", "дня", "дней")} назад"
                d < 30 -> (d / 7).let { "$it ${pl(it, "неделю", "недели", "недель")} назад" }
                else -> (d / 30).let { "$it ${pl(it, "месяц", "месяца", "месяцев")} назад" }
            }
        }

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
                artistId = t.arr("artists").objects().firstOrNull()?.opt("id")?.toString(),
                loud = t.optJSONObject("r128")?.let { r -> if (r.has("i")) r.optDouble("i").takeIf { !it.isNaN() } else null },
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

    // ---------- Радио по треку: станция track:ID (своя сессия, волну не трогает) ----------
    private var radioSession: String? = null

    suspend fun radioStart(trackId: String): List<Track> {
        val id = trackId.substringBefore(":")
        val s = obj("POST", "/rotor/session/new", json = JSONObject().put("seeds", JSONArray().put("track:$id")).put("includeTracksInResponse", true).put("includeWaveModel", false).put("interactive", true))
        radioSession = s.str("radioSessionId")
        return sequence(s)
    }

    suspend fun radioMore(queueIds: List<String>): List<Track> {
        val sid = radioSession ?: return emptyList()
        val ids = JSONArray()
        queueIds.filter { it.startsWith("ya:") }.takeLast(10).forEach { ids.put(it.removePrefix("ya:")) }
        return sequence(obj("POST", "/rotor/session/$sid/tracks", json = JSONObject().put("queue", ids)))
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

    /** Страница исполнителя: популярное и альбомы */
    suspend fun artist(id: String): ArtistPage {
        val r = obj("GET", "/artists/$id/brief-info")
        val a = r.obj("artist")
        val albums = (r.arr("albums").objects() + r.arr("alsoAlbums").objects()).map { al ->
            Playlist(
                id = "yaalbum:${al.opt("id")}",
                source = SOURCE_YA,
                title = al.optString("title"),
                count = al.optInt("trackCount"),
                cover = cover(al.str("coverUri"), 300),
                subtitle = listOfNotNull(al.optInt("year").takeIf { it > 0 }?.toString(), if (al.str("type") == "single") "сингл" else "альбом").joinToString(" · "),
            )
        }
        return ArtistPage(
            source = SOURCE_YA,
            id = id,
            name = a?.optString("name") ?: "Исполнитель",
            cover = cover(a?.obj("cover")?.str("uri") ?: a?.str("ogImage"), 600),
            listeners = r.obj("stats")?.optLong("lastMonthListeners")?.takeIf { it > 0 },
            popular = r.arr("popularTracks").objects().mapNotNull { mapTrack(it) },
            albums = albums,
        )
    }

    /**
     * Новые релизы любимых исполнителей (как на ПК): лайкнутые исполнители, а если их мало — самые частые в лайках;
     * у каждого — альбомы и синглы за последние ~4 месяца, новые сверху.
     */
    suspend fun newReleases(days: Int = 120, limit: Int = 18): List<Playlist> = kotlinx.coroutines.coroutineScope {
        val uid = uid()
        val ids = LinkedHashSet<String>()
        runCatching { arr("GET", "/users/$uid/likes/artists").objects().forEach { x -> (x.optJSONObject("artist") ?: x).opt("id")?.toString()?.let { ids += it } } }
        if (ids.size < 12) runCatching {
            likedTracks(300).mapNotNull { it.artistId }.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.forEach { ids += it.key }
        }
        val now = System.currentTimeMillis()
        val since = now - days * 86_400_000L
        val sem = kotlinx.coroutines.sync.Semaphore(6)
        val found = ids.take(40).map { id ->
            async {
                sem.acquire()
                try {
                    runCatching {
                        obj("GET", "/artists/$id/direct-albums", query = mapOf("page" to "0", "page-size" to "6", "sort-by" to "year")).arr("albums").objects().mapNotNull { al ->
                            val ts = al.str("releaseDate")?.let { runCatching { java.time.OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() } ?: return@mapNotNull null
                            if (ts < since || ts > now + 86_400_000L) return@mapNotNull null
                            ts to al
                        }
                    }.getOrDefault(emptyList())
                } finally {
                    sem.release()
                }
            }
        }.awaitAll().flatten()
        found.distinctBy { it.second.opt("id")?.toString() }.sortedByDescending { it.first }.take(limit).map { (ts, al) ->
            Playlist(
                id = "yaalbum:${al.opt("id")}",
                source = SOURCE_YA,
                title = al.optString("title") + (al.str("version")?.let { " ($it)" } ?: ""),
                count = al.optInt("trackCount"),
                cover = cover(al.str("coverUri"), 300),
                subtitle = al.arr("artists").objects().mapNotNull { it.str("name") }.joinToString(", "),
                note = (if (al.str("type") == "single") "Сингл" else "Альбом") + " · " + releaseAgo(ts, now),
            )
        }
    }

    /** Новый приватный плейлист с треками (перенос плейлистов). → id вида ya:uid:kind */
    suspend fun createPlaylist(title: String, tracks: List<Track>): String {
        val uid = uid()
        val pl = obj("POST", "/users/$uid/playlists/create", form = mapOf("title" to title.take(100), "visibility" to "private"))
        val kind = pl.opt("kind")?.toString() ?: throw ApiException("Яндекс не создал плейлист")
        var revision = pl.optInt("revision", 1)
        tracks.chunked(100).forEachIndexed { i, chunk ->
            val items = JSONArray()
            chunk.forEach { t -> items.put(JSONObject().put("id", t.srcId.substringBefore(':')).apply { t.albumId?.let { put("albumId", it) } }) }
            val diff = JSONArray().put(JSONObject().put("op", "insert").put("at", i * 100).put("tracks", items))
            val r = obj("POST", "/users/$uid/playlists/$kind/change-relative", form = mapOf("diff" to diff.toString(), "revision" to revision.toString()))
            revision = if (r.has("revision")) r.optInt("revision") else revision + 1
        }
        return "ya:$uid:$kind"
    }

    suspend fun albumTracks(id: String): List<Track> {
        val r = obj("GET", "/albums/${id.removePrefix("yaalbum:")}/with-tracks")
        val vols = r.arr("volumes")
        return (0 until (vols?.length() ?: 0)).flatMap { i -> vols!!.optJSONArray(i).objects().mapNotNull { mapTrack(it) } }
    }

    /** Подробности трека: год, жанр, лейбл, номер в альбоме, «18+» */
    suspend fun trackDetails(trackId: String): TrackDetails {
        val t = arr("GET", "/tracks/${trackId.substringBefore(":")}").objects().firstOrNull() ?: return TrackDetails()
        val al = t.arr("albums").objects().firstOrNull()
        val pos = al?.obj("trackPosition")
        return TrackDetails(
            year = al?.optInt("year")?.takeIf { it > 0 } ?: al?.str("releaseDate")?.take(4)?.toIntOrNull(),
            genre = al?.str("genre"),
            label = al?.arr("labels")?.let { a -> (0 until a.length()).mapNotNull { i -> (a.opt(i) as? JSONObject)?.str("name") ?: (a.opt(i) as? String) } }?.joinToString(", ")?.ifBlank { null },
            position = pos?.optInt("index")?.takeIf { it > 0 }?.let { i -> "$i" + (al?.optInt("trackCount")?.takeIf { it > 0 }?.let { " из $it" } ?: "") },
            explicit = t.str("contentWarning") == "explicit",
        )
    }

    // ---------- Медиатека ----------

    private suspend fun tracksByIds(ids: List<String>): List<Track> {
        val out = ArrayList<Track>()
        ids.chunked(200).forEach { chunk ->
            val res = arr("POST", "/tracks", form = mapOf("track-ids" to chunk.joinToString(","), "with-positions" to "false"))
            out += res.objects().mapNotNull { mapTrack(it) }
        }
        return out
    }

    suspend fun likedTracks(limit: Int = 10000): List<Track> {
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

    suspend fun searchArtists(text: String): List<SearchArtist> {
        val res = obj("GET", "/search", query = mapOf("text" to text, "type" to "artist", "page" to "0"))
        return res.path("artists")?.arr("results").objects().mapNotNull { a ->
            val id = a.opt("id")?.toString() ?: return@mapNotNull null
            SearchArtist(SOURCE_YA, id, a.optString("name"), cover(a.obj("cover")?.str("uri"), 200))
        }.take(10)
    }

    suspend fun searchAlbums(text: String): List<Playlist> {
        val res = obj("GET", "/search", query = mapOf("text" to text, "type" to "album", "page" to "0"))
        return res.path("albums")?.arr("results").objects().map { al ->
            Playlist(
                id = "yaalbum:${al.opt("id")}", source = SOURCE_YA,
                title = al.optString("title") + (al.str("version")?.let { " ($it)" } ?: ""),
                count = al.optInt("trackCount"), cover = cover(al.str("coverUri"), 300),
                subtitle = listOfNotNull(al.arr("artists").objects().mapNotNull { it.str("name") }.joinToString(", ").ifBlank { null }, al.optInt("year").takeIf { it > 0 }?.toString()).joinToString(" · "),
            )
        }.take(12)
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
