package org.nyao.music.data

/** Поиск: «умное» ранжирование (перенос src/renderer/search.js) */
object Search {
    private val NON_WORD = Regex("[^\\p{L}\\p{N}]+")
    private val SPLIT = Regex(",|&|\\s+(?:feat|ft)\\.?\\s+", RegexOption.IGNORE_CASE)

    fun norm(s: String?): String = (s ?: "").lowercase().replace('ё', 'е').replace(NON_WORD, " ").trim()

    data class Arranged(val tracks: List<Track>, val best: SearchArtist?, val artists: List<SearchArtist>, val albums: List<Playlist>)

    /** filter — "all" или сервис. Если запрос — имя исполнителя, его собственные треки идут первыми */
    fun arrange(res: SearchResult, filter: String, q: String): Arranged {
        var tracks = when (filter) {
            SOURCE_YA -> res.ya
            SOURCE_YT -> res.yt
            SOURCE_SC -> res.sc
            SOURCE_VK -> res.vk
            SOURCE_SP -> res.sp
            else -> alternateAll(res.sp, res.ya, res.yt, res.sc, res.vk)
        }
        val artists = if (filter == "all") res.artists else res.artists.filter { it.source == filter }
        val albums = if (filter == "all") res.albums else res.albums.filter { it.source == filter }
        val nq = norm(q)
        val best = if (nq.isEmpty()) null else artists.firstOrNull { norm(it.name) == nq }
        if (best != null) {
            val name = norm(best.name)
            val (own, rest) = tracks.partition { t -> t.artist.split(SPLIT).map { norm(it) }.contains(name) }
            tracks = own + rest
        }
        return Arranged(tracks, best, artists.filter { it != best }, albums)
    }
}
