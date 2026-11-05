package org.nyao.music.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.Request
import org.json.JSONObject

/**
 * Яндекс Радио (radio.yandex.ru): прямой эфир обычных радиостанций. Перенос src/main/live-radio.js.
 * Публичный API сайта — вход и токены не нужны. Эфир — HLS: ExoPlayer играет его сам,
 * ссылку даём через nyao://live/<станция>/<поток> (см. Repo.resolve), она подписана на время.
 */
object YandexRadio {
    private const val API = "https://radio.api.music.yandex.ru/radio/v1/"
    private const val REGION = "213"

    data class Stream(val slug: String, val name: String)
    data class Station(
        val slug: String, val name: String, val desc: String, val logo: String, val bg: Long,
        val genres: List<String>, val listeners: Int, val streams: List<Stream>, val stream: String,
    )
    data class Genre(val slug: String, val name: String)
    data class OnAir(val title: String, val artist: String, val cover: String?, val yaId: String?, val at: Long)

    private var cached: Pair<Long, List<Station>>? = null
    private var genresCache: List<Genre>? = null

    /** Что сейчас звучит в эфире и что звучало (новые первыми) — обновляет экран эфира */
    private val _recent = MutableStateFlow<List<OnAir>>(emptyList())
    val recent: StateFlow<List<OnAir>> = _recent

    fun image(u: String?, size: String = "400x400"): String? {
        if (u.isNullOrBlank()) return null
        val s = u.replace("%%", size)
        return if (s.startsWith("http")) s else "https://$s"
    }

    fun yaTrackId(url: String?): String? = url?.let { Regex("/track/(\\d+)").find(it)?.groupValues?.get(1) }

    private fun color(hex: String?): Long = runCatching { 0xFF000000 or hex!!.removePrefix("#").toLong(16) }.getOrDefault(0xFF222226)

    private fun get(path: String): JSONObject {
        val sep = if (path.contains('?')) '&' else '?'
        val req = Request.Builder().url("$API$path${sep}userRegion=$REGION")
            .header("Origin", "https://radio.yandex.ru").header("Referer", "https://radio.yandex.ru/").build()
        val (code, body) = Net.execute(req)
        if (code !in 200..299) throw ApiException("Яндекс Радио: HTTP $code", code)
        return JSONObject(body)
    }

    fun parseStation(o: JSONObject): Station {
        val c = o.obj("cardInfo") ?: JSONObject()
        val streams = o.arr("streams").objects().map { Stream(it.optString("slug"), it.str("compactName") ?: it.str("name") ?: "") }
        return Station(
            slug = o.optString("slug"),
            name = o.optString("name"),
            desc = c.str("shortDescription") ?: c.str("ultraShortDescription") ?: "",
            logo = image(c.str("logo")) ?: "",
            bg = color(c.str("logoBackgroundColor") ?: c.str("themeColor")),
            genres = o.arr("genres").objects().map { it.optString("slug") },
            listeners = o.obj("listeners")?.optInt("count") ?: 0,
            streams = streams,
            stream = o.str("userDefaultStreamSlug") ?: streams.firstOrNull()?.slug ?: "",
        )
    }

    /** Все станции (страниц ~7), популярные первыми; кеш полчаса. Блокирующий — из фонового потока */
    @Synchronized
    fun stations(): List<Station> {
        cached?.let { if (System.currentTimeMillis() - it.first < 30 * 60_000) return it.second }
        val out = ArrayList<Station>()
        var cont: String? = null
        for (page in 0 until 20) {
            val j = get("stations" + (cont?.let { "?continueFrom=" + android.net.Uri.encode(it) } ?: ""))
            j.arr("stations").objects().forEach { out += parseStation(it) }
            cont = j.str("continueFrom")
            if (!j.optBoolean("hasNext") || cont == null) break
        }
        val sorted = out.sortedByDescending { it.listeners }
        cached = System.currentTimeMillis() to sorted
        return sorted
    }

    fun genres(): List<Genre> = genresCache ?: get("genres").arr("genres").objects()
        .map { Genre(it.optString("slug"), it.optString("name")) }.also { genresCache = it }

    fun streamUrl(station: String, stream: String): String =
        get("stations/${android.net.Uri.encode(station)}/streams/${android.net.Uri.encode(stream)}/url").str("url")
            ?: throw ApiException("Станция не отдала ссылку на эфир")

    fun parseOnAir(o: JSONObject): OnAir? {
        val t = o.obj("track") ?: return null
        val title = t.str("title") ?: return null
        return OnAir(
            title = title,
            artist = t.str("artist") ?: "",
            cover = image(t.str("yandexCover") ?: t.str("externalCover")),
            yaId = yaTrackId(t.str("yaMusicUrl")) ?: t.str("trackId")?.substringBefore(':'),
            at = o.optLong("timestamp") * 1000,
        )
    }

    /** «Недавно звучало» для станции; у разговорных станций — пусто. Обновляет [recent] */
    fun refreshRecent(station: String, stream: String): List<OnAir> {
        val list = get("stations/${android.net.Uri.encode(station)}/streams/${android.net.Uri.encode(stream)}/recently-played")
            .arr("tracks").objects().mapNotNull { parseOnAir(it) }
        _recent.value = list
        return list
    }

    fun clearRecent() { _recent.value = emptyList() }

    /** Сейчас звучит: свежий трек (до 8 минут) из «недавно звучало» */
    fun nowOf(list: List<OnAir>): OnAir? = list.firstOrNull()?.takeIf { it.at == 0L || System.currentTimeMillis() - it.at < 8 * 60_000 }

    /** Станция → «трек» очереди: ExoPlayer листает станции, как треки */
    fun track(st: Station, stream: String = st.stream): Track {
        val sub = st.streams.firstOrNull { it.slug == stream }
        return Track(
            id = "$SOURCE_LIVE:${st.slug}/$stream", source = SOURCE_LIVE, srcId = "${st.slug}/$stream",
            title = st.name, artist = st.desc.ifBlank { "Прямой эфир" },
            album = sub?.name?.takeIf { it.isNotBlank() }?.let { "Эфир · $it" } ?: "Прямой эфир",
            cover = st.logo.ifBlank { null },
        )
    }

    /** Станция по «треку» эфира */
    fun stationOf(t: Track?): Station? {
        if (t == null || t.source != SOURCE_LIVE) return null
        val slug = t.srcId.substringBefore('/')
        return cached?.second?.firstOrNull { it.slug == slug }
    }

    fun streamOf(t: Track): String = t.srcId.substringAfter('/')
}
