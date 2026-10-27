package org.nyao.music.data

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.ConcurrentHashMap

/** Слово с временем (секунды): от начала до конца — для караоке */
data class LyricWord(val time: Double, val end: Double, val text: String)
/** Строка текста: time — секунды (null, если текст без синхронизации); words — пословное время, если размечено */
data class LyricLine(val time: Double?, val text: String, val words: List<LyricWord>? = null)
data class Lyrics(val synced: Boolean, val lines: List<LyricLine>, val source: String = "LRCLIB", val words: Boolean = false)

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

    private val wordLine = Regex("^\\[(\\d+):(\\d+(?:\\.\\d+)?)](.*)$")
    private val wordTag = Regex("<(\\d+):(\\d+(?:\\.\\d+)?)>")

    /**
     * Пословное время (Enhanced LRC из Nyao LyricLabs): «[00:12.30] <00:12.30>слово <00:12.85>слово <00:13.40>».
     * Конец слова — начало следующего; у последнего — конечная метка или оценка по длине (не позже следующей строки).
     */
    fun parseWordLrc(lrc: String): List<LyricLine> {
        class Raw(val time: Double, val text: String, val words: List<Pair<Double, String>>?, val end: Double?)
        val raws = ArrayList<Raw>()
        lrc.lines().forEach { line ->
            val m = wordLine.find(line.trim()) ?: return@forEach
            val time = m.groupValues[1].toInt() * 60 + m.groupValues[2].toDouble()
            val rest = m.groupValues[3]
            val tags = wordTag.findAll(rest).toList()
            if (tags.isEmpty()) { raws += Raw(time, rest.trim(), null, null); return@forEach }
            val words = ArrayList<Pair<Double, String>>()
            var end: Double? = null
            tags.forEachIndexed { i, t ->
                val at = t.groupValues[1].toInt() * 60 + t.groupValues[2].toDouble()
                val stop = if (i + 1 < tags.size) tags[i + 1].range.first else rest.length
                val w = rest.substring(t.range.last + 1, stop).trim()
                if (w.isNotEmpty()) words += at to w else if (i == tags.lastIndex) end = at
            }
            raws += if (words.isEmpty()) Raw(time, "", null, null) else Raw(time, words.joinToString(" ") { it.second }, words, end)
        }
        val sorted = raws.sortedBy { it.time }
        return sorted.mapIndexed { i, r ->
            val ws = r.words ?: return@mapIndexed LyricLine(r.time, r.text)
            val limit = sorted.drop(i + 1).firstOrNull { it.time > r.time }?.time ?: Double.MAX_VALUE
            LyricLine(r.time, r.text, ws.mapIndexed { j, (at, w) ->
                val end = if (j + 1 < ws.size) maxOf(at + 0.05, ws[j + 1].first) else {
                    val guess = at + (0.2 + w.length * 0.11).coerceIn(0.45, 2.5)
                    maxOf(at + 0.05, minOf(r.end?.takeIf { it > at } ?: guess, limit))
                }
                LyricWord(at, end, w)
            })
        }
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
        // расширение Nyao LyricLabs: время каждого слова — для караоке
        o.str("wordSyncedLyrics")?.let { w -> parseWordLrc(w).takeIf { l -> l.any { it.words != null } }?.let { return Lyrics(true, it, source, words = true) } }
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
        return coroutineScope {
            // Nyao LyricLabs спрашиваем сразу, параллельно с Яндексом: если там слова размечены (караоке), берём его
            val ownAsync = async { nyaoLyrics(track) }
            findWith(track) { ownAsync }
        }
    }

    private suspend fun findWith(track: Track, ownAsync: () -> kotlinx.coroutines.Deferred<Lyrics?>): Lyrics? {
        var fallback: Lyrics? = null
        // 1) Яндекс: сам трек или такой же, найденный в Яндексе
        if (Repo.ya.loggedIn && Repo.up(SOURCE_YA)) {
            val yaId = if (track.source == SOURCE_YA) track.srcId else runCatching { Match.find(track, 0.75) { q -> Repo.ya.search(q) }?.srcId }.getOrNull()
            if (yaId != null) {
                val lrc = runCatching { Repo.ya.lyrics(yaId, "LRC") }.getOrNull()
                val name = { p: String? -> if (p != null) "Яндекс Музыка · $p" else "Яндекс Музыка" }
                val lines = lrc?.let { parseLrc(it.first) }.orEmpty()
                if (lines.isNotEmpty()) {
                    val own = withTimeoutOrNull(2500) { ownAsync().await() }
                    if (own?.words == true) return own.also { cache[track.id] = it }
                    ownAsync().cancel()
                    return Lyrics(true, lines, name(lrc?.second)).also { cache[track.id] = it }
                }
                runCatching { Repo.ya.lyrics(yaId, "TEXT") }.getOrNull()?.let { fallback = plain(it.first, name(it.second)) }
            }
        }
        // 2) Nyao LyricLabs, 3) LRCLIB
        val own = ownAsync().await()
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
