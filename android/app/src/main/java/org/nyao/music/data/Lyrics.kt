package org.nyao.music.data

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** Строка текста: time — секунды (null, если текст без синхронизации) */
data class LyricLine(val time: Double?, val text: String)
data class Lyrics(val synced: Boolean, val lines: List<LyricLine>, val source: String = "LRCLIB")

/** Тексты песен — как lyrics.js на ПК: Яндекс Музыка (лицензированные) → LRCLIB → YouTube Music; с таймингами лучше */
object LyricsApi {
    private val cache = ConcurrentHashMap<String, Lyrics>()
    private val missing = ConcurrentHashMap.newKeySet<String>()
    private val stamp = Regex("\\[(\\d+):(\\d+(?:\\.\\d+)?)]")

    fun parseLrc(lrc: String): List<LyricLine> {
        val out = ArrayList<LyricLine>()
        lrc.lines().forEach { raw ->
            val stamps = stamp.findAll(raw).toList()
            if (stamps.isEmpty()) return@forEach
            val text = raw.replace(Regex("\\[[^]]*]"), "").trim()
            stamps.forEach { m -> out += LyricLine(m.groupValues[1].toInt() * 60 + m.groupValues[2].toDouble(), text) }
        }
        return out.sortedBy { it.time }
    }

    private fun cleanTitle(t: String) = t
        .replace(Regex("\\s*[(\\[][^)\\]]*(official|video|audio|lyric|ost|mv|клип)[^)\\]]*[)\\]]", RegexOption.IGNORE_CASE), "")
        .replace(Regex("\\s+-\\s+.*(ost|soundtrack).*$", RegexOption.IGNORE_CASE), "")
        .trim()

    private suspend fun get(url: String): String? {
        val (code, text) = Net.call(Request.Builder().url(url).header("User-Agent", "NyaoMusic/0.2 (Android)").build())
        return if (code in 200..299) text else null
    }

    private fun from(o: JSONObject?, source: String = "LRCLIB"): Lyrics? {
        if (o == null) return null
        o.str("syncedLyrics")?.let { s -> parseLrc(s).takeIf { it.isNotEmpty() }?.let { return Lyrics(true, it, source) } }
        o.str("plainLyrics")?.let { p -> return Lyrics(false, p.lines().map { LyricLine(null, it) }, source) }
        return null
    }

    /** Свой сервис текстов (lyrics.withnyao.app): проверенные специалистами, API как у LRCLIB, только точное совпадение */
    private const val NYAO_LYRICS_API = "https://api.corrode5-15.withnyao.app"

    private suspend fun nyaoLyrics(track: Track): Lyrics? = try {
        val url = "$NYAO_LYRICS_API/api/get".toHttpUrl().newBuilder()
            .addQueryParameter("track_name", cleanTitle(track.title))
            .addQueryParameter("artist_name", track.artist.split(",").first().trim())
            .apply { if (track.duration > 0) addQueryParameter("duration", track.duration.toString()) }
            // id трека Яндекса — точное совпадение без путаницы одинаковых названий
            .apply { if (track.source == SOURCE_YA && track.srcId.all { it.isDigit() }) addQueryParameter("ya_id", track.srcId) }
            // ISRC (у треков Spotify) — та же запись в любом сервисе
            .apply { track.isrc?.let { addQueryParameter("isrc", it) } }
            .build().toString()
        from(get(url)?.let { JSONObject(it) }, "Nyao LyricLabs")
    } catch (_: Exception) {
        null
    }

    private fun plain(text: String, source: String) = Lyrics(false, text.lines().map { LyricLine(null, it.trim()) }, source)

    suspend fun find(track: Track): Lyrics? {
        cache[track.id]?.let { return it }
        if (track.id in missing) return null
        var fallback: Lyrics? = null
        // 1) Яндекс: сам трек или такой же, найденный в Яндексе
        if (Repo.ya.loggedIn && Repo.up(SOURCE_YA)) {
            val yaId = if (track.source == SOURCE_YA) track.srcId else runCatching { Match.find(track, 0.75) { q -> Repo.ya.search(q) }?.srcId }.getOrNull()
            if (yaId != null) {
                val lrc = runCatching { Repo.ya.lyrics(yaId, "LRC") }.getOrNull()
                val name = { p: String? -> if (p != null) "Яндекс Музыка · $p" else "Яндекс Музыка" }
                val lines = lrc?.let { parseLrc(it.first) }.orEmpty()
                if (lines.isNotEmpty()) return Lyrics(true, lines, name(lrc?.second)).also { cache[track.id] = it }
                runCatching { Repo.ya.lyrics(yaId, "TEXT") }.getOrNull()?.let { fallback = plain(it.first, name(it.second)) }
            }
        }
        // 2) Nyao LyricLabs, 3) LRCLIB
        val own = nyaoLyrics(track)
        if (own != null && own.synced) return own.also { cache[track.id] = it }
        if (fallback == null) fallback = own
        val lr = lrclib(track)
        if (lr != null && lr.synced) return lr.also { cache[track.id] = it }
        if (fallback == null) fallback = lr
        // 3) YouTube Music — без таймингов
        if (fallback == null && track.source == SOURCE_YT) runCatching { Repo.yt.lyrics(track.srcId) }.getOrNull()?.let { fallback = plain(it, "YouTube Music") }
        val res = fallback
        if (res != null) cache[track.id] = res else missing += track.id
        return res
    }

    private suspend fun lrclib(track: Track): Lyrics? {
        val artist = track.artist.split(",").first().trim()
        val title = cleanTitle(track.title)
        val result = try {
            val getUrl = "https://lrclib.net/api/get".toHttpUrl().newBuilder()
                .addQueryParameter("track_name", title)
                .addQueryParameter("artist_name", artist)
                .apply { if (track.duration > 0) addQueryParameter("duration", track.duration.toString()) }
                .build().toString()
            from(get(getUrl)?.let { JSONObject(it) }) ?: run {
                val searchUrl = "https://lrclib.net/api/search".toHttpUrl().newBuilder().addQueryParameter("q", "$artist $title").build().toString()
                val list = get(searchUrl)?.let { JSONArray(it) }.objects()
                from(list.firstOrNull { it.str("syncedLyrics") != null } ?: list.firstOrNull())
            }
        } catch (_: Exception) {
            null
        }
        return result
    }
}
