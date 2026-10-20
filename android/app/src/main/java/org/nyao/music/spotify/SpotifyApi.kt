package org.nyao.music.spotify

import org.nyao.music.data.Diagnostics

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.nyao.music.data.Account
import org.nyao.music.data.Net
import org.nyao.music.data.Playlist
import org.nyao.music.data.SOURCE_SP
import org.nyao.music.data.Track
import org.nyao.music.data.arr
import org.nyao.music.data.obj
import org.nyao.music.data.objects
import org.nyao.music.data.str

/**
 * Официальный Spotify Web API: профиль, поиск, «Любимые треки», плейлисты, лайки
 * и управление воспроизведением на устройстве Nyao (перенос, включить треки).
 */
class SpotifyApi(private val auth: SpotifyAuth) {
    val loggedIn: Boolean get() = auth.loggedIn.value

    /** Последние ошибки — для «Что-то не работает?» в настройках (без токенов) */
    /**
     * Spotify отвечает 403 «unavailable in this country», когда запрос идёт из страны, где он не работает
     * (например, без VPN). Тогда на 5 минут перестаём к нему ходить, чтобы не тормозить поиск и библиотеку.
     */
    @Volatile private var blockedUntil = 0L
    val regionBlocked: Boolean get() = System.currentTimeMillis() < blockedUntil

    /** Свои таймауты короче общих: медленный Spotify не должен держать остальной Nyao */
    private val http = Net.client.newBuilder()
        .connectTimeout(6, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
        .callTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .build()

    private val log = ArrayDeque<String>()
    fun debugText(): String = synchronized(log) { log.joinToString("\n") }
    private fun note(s: String) = synchronized(log) {
        log.addLast(java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date()) + " " + Diagnostics.safe(s))
        while (log.size > 60) log.removeFirst()
    }

    // ---------- Данные ----------

    suspend fun account(): Account {
        val me = JSONObject(request("GET", "me"))
        val name = me.str("display_name") ?: me.str("id") ?: "Spotify"
        return Account(name, me.str("product")?.let { it == "premium" }, me.str("id"))
    }

    suspend fun search(q: String): List<Track> {
        val text = try {
            request("GET", "search", mapOf("q" to q, "type" to "track", "limit" to "20"))
        } catch (e: SpotifyException) {
            // в режиме разработки Spotify может ограничить размер выдачи
            if (e.code == 400) request("GET", "search", mapOf("q" to q, "type" to "track", "limit" to "10")) else throw e
        }
        return JSONObject(text).obj("tracks")?.arr("items").objects().mapNotNull { track(it) }
    }

    /** «Любимые треки» — до 1000 последних */
    suspend fun likedTracks(limit: Int = 1000): List<Track> = pages("me/tracks", (limit + 49) / 50).take(limit).mapNotNull { item ->
        track(item.obj("track") ?: item.obj("item"))?.copy(likedAt = runCatching { java.time.Instant.parse(item.optString("added_at")).toEpochMilli() }.getOrDefault(0L))
    }

    suspend fun playlists(): List<Playlist> = pages("me/playlists", 6).map { p ->
        val id = p.optString("id")
        val total = p.obj("tracks")?.optInt("total") ?: p.obj("items")?.optInt("total") ?: 0
        Playlist(
            "sp:$id", SOURCE_SP, p.optString("name"), total,
            p.arr("images").objects().firstOrNull()?.str("url"),
            p.obj("owner")?.str("display_name")?.let { "Spotify · $it" } ?: "Spotify",
        )
    }

    suspend fun playlistTracks(id: String): List<Track> {
        val pid = id.removePrefix("sp:")
        // у новых приложений путь …/items, у старых — …/tracks
        val items = try {
            pages("playlists/$pid/items", 20)
        } catch (e: SpotifyException) {
            if (e.code == 404 || e.code == 403 || e.code == 400) pages("playlists/$pid/tracks", 20) else throw e
        }
        return items.mapNotNull { track(it.obj("item") ?: it.obj("track")) }
    }

    suspend fun like(id: String, on: Boolean) {
        val method = if (on) "PUT" else "DELETE"
        try {
            request(method, "me/tracks", mapOf("ids" to id))
        } catch (e: SpotifyException) {
            if (e.code == 404 || e.code == 410) request(method, "me/library", mapOf("uris" to "spotify:track:$id")) else throw e
        }
    }

    // ---------- Воспроизведение на устройстве Nyao ----------

    suspend fun transferPlayback(deviceId: String, play: Boolean) {
        val body = JSONObject().put("device_ids", JSONArray().put(deviceId)).put("play", play)
        request("PUT", "me/player", body = body)
    }

    suspend fun playUris(deviceId: String, uris: List<String>, positionMs: Long = 0) {
        val body = JSONObject().put("uris", JSONArray(uris)).put("position_ms", positionMs.coerceAtLeast(0))
        request("PUT", "me/player/play", mapOf("device_id" to deviceId), body)
    }

    suspend fun setRepeat(deviceId: String, state: String) =
        request("PUT", "me/player/repeat", mapOf("state" to state, "device_id" to deviceId))

    suspend fun setShuffle(deviceId: String, on: Boolean) =
        request("PUT", "me/player/shuffle", mapOf("state" to on.toString(), "device_id" to deviceId))

    // ---------- Внутреннее ----------

    private suspend fun pages(path: String, maxPages: Int): List<JSONObject> {
        val out = ArrayList<JSONObject>()
        var offset = 0
        repeat(maxPages) {
            val page = JSONObject(request("GET", path, mapOf("limit" to "50", "offset" to offset.toString())))
            val items = page.arr("items").objects()
            out += items
            if (items.size < 50 || page.isNull("next")) return out
            offset += items.size
        }
        return out
    }

    private fun track(o: JSONObject?): Track? {
        o ?: return null
        if (o.optString("type", "track") != "track") return null // подкасты и эпизоды — мимо
        val id = o.str("id") ?: return null
        val album = o.obj("album")
        val artists = o.arr("artists").objects()
        return Track(
            id = "$SOURCE_SP:$id",
            source = SOURCE_SP,
            srcId = id,
            title = o.optString("name"),
            artist = artists.mapNotNull { it.str("name") }.joinToString(", "),
            album = album?.str("name") ?: "",
            albumId = album?.str("id"),
            duration = (o.optLong("duration_ms") / 1000).toInt(),
            cover = album?.arr("images").objects().firstOrNull()?.str("url"),
            available = o.optBoolean("is_playable", true) && !o.optBoolean("is_local", false),
            artistId = artists.firstOrNull()?.str("id"),
            isrc = o.obj("external_ids")?.str("isrc"),
        )
    }

    private suspend fun request(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
    ): String = withContext(Dispatchers.IO) {
        if (regionBlocked) throw SpotifyException(REGION_MSG, 451)
        var attempt = 0
        while (true) {
            attempt++
            val url = "$BASE/$path".toHttpUrl().newBuilder().apply { query.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
            val token = auth.accessToken(force = attempt == 2)
            val rb = if (method == "GET") null else (body?.toString() ?: "").toRequestBody(JSON)
            val req = Request.Builder().url(url).header("Authorization", "Bearer $token").method(method, rb).build()
            // отменяемый запрос: если поиск перестал ждать Spotify, соединение закрывается сразу
            val res = http.newCall(req).await()
            val (code, text, retry) = res.use { Triple(it.code, it.body?.string().orEmpty(), it.header("Retry-After")?.toLongOrNull()) }
            when {
                code in 200..299 -> return@withContext text
                // токен истёк раньше срока — один раз берём новый
                code == 401 && attempt == 1 -> continue
                // слишком часто — ждём, сколько просит Spotify (но не дольше 5 секунд)
                code == 429 && attempt <= 2 -> { kotlinx.coroutines.delay(((retry ?: 1) * 1000).coerceAtMost(5000)); continue }
                else -> {
                    val msg = runCatching { JSONObject(text).obj("error")?.str("message") }.getOrNull() ?: text.take(160)
                    note("$method /$path → $code $msg")
                    if (code == 403 && msg.contains("unavailable in this country", true)) {
                        blockedUntil = System.currentTimeMillis() + 5 * 60_000L
                        throw SpotifyException(REGION_MSG, 451)
                    }
                    throw SpotifyException(explain(code, msg), code)
                }
            }
        }
        ""
    }

    private suspend fun okhttp3.Call.await(): okhttp3.Response = kotlinx.coroutines.suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(object : okhttp3.Callback {
            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                if (cont.isActive) cont.resumeWith(Result.success(response)) else response.close()
            }

            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                if (cont.isActive) cont.resumeWith(Result.failure(e))
            }
        })
    }

    private fun explain(code: Int, msg: String): String = when (code) {
        401 -> "Spotify: вход устарел, войди заново"
        403 -> if (msg.contains("premium", true)) "Spotify: нужен Premium" else "Spotify не пустил ($msg). Проверь, что ты добавлен в User Management своего приложения"
        404 -> "Spotify: не найдено ($msg)"
        429 -> "Spotify просит подождать — слишком много запросов"
        else -> "Spotify $code: $msg"
    }

    private companion object {
        const val BASE = "https://api.spotify.com/v1"
        const val REGION_MSG = "Spotify недоступен из этой страны — без VPN он не отвечает"
        val JSON = "application/json".toMediaType()
    }
}
