package org.nyao.music.data

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/** Строка текста: time — секунды (null, если текст без синхронизации) */
data class LyricLine(val time: Double?, val text: String)
data class Lyrics(val synced: Boolean, val lines: List<LyricLine>)

/** Тексты из открытой базы LRCLIB — как lyrics.js на ПК */
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

    private fun from(o: JSONObject?): Lyrics? {
        if (o == null) return null
        o.str("syncedLyrics")?.let { s -> parseLrc(s).takeIf { it.isNotEmpty() }?.let { return Lyrics(true, it) } }
        o.str("plainLyrics")?.let { p -> return Lyrics(false, p.lines().map { LyricLine(null, it) }) }
        return null
    }

    suspend fun find(track: Track): Lyrics? {
        cache[track.id]?.let { return it }
        if (track.id in missing) return null
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
        if (result != null) cache[track.id] = result else missing += track.id
        return result
    }
}
