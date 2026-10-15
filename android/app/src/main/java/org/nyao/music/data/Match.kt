package org.nyao.music.data

/**
 * Поиск «того же трека» в другом сервисе — для «Слушать вместе» и переноса плейлистов.
 * Перенос src/main/match.js: сравниваем очищенные названия, исполнителей и длительность.
 */
object Match {
    private val BRACKETS = Regex("[(\\[{][^)\\]}]*(feat|ft\\.|prod|remaster|official|lyric|video|audio|explicit|версия|version|live|edit)[^)\\]}]*[)\\]}]")
    private val DASH_TAIL = Regex("\\s[-–—]\\s.*(remaster|version|edit|mix).*$")
    private val FEAT_TAIL = Regex("\\b(feat|ft)\\.?\\s.*$")
    private val NOISE = Regex("\\b(remaster(ed)?( \\d{4})?|\\d{4} remaster(ed)?|official( music)? (video|audio)|lyrics?( video)?|audio|hd|hq|mv|clip|explicit|radio edit|original mix)\\b")
    private val NON_WORD = Regex("[^\\p{L}\\p{N}]+")
    private val ARTIST_SPLIT = Regex(",|&|\\s+(?:feat|ft)\\.?\\s+|\\s+x\\s+|\\s+и\\s+|\\s+and\\s+", RegexOption.IGNORE_CASE)

    fun norm(s: String?): String = (s ?: "").lowercase().replace('ё', 'е')
        .replace(BRACKETS, " ").replace(DASH_TAIL, " ").replace(FEAT_TAIL, " ").replace(NOISE, " ")
        .replace(NON_WORD, " ").trim().replace(Regex("\\s+"), " ")

    fun artists(a: String?): List<String> = (a ?: "").split(ARTIST_SPLIT).map { norm(it) }.filter { it.isNotEmpty() }

    private fun tokens(s: String?): Set<String> = norm(s).split(' ').filter { it.isNotEmpty() }.toSet()

    private fun jaccard(a: Set<String>, b: Set<String>): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        val n = a.count { it in b }
        return n.toDouble() / (a.size + b.size - n)
    }

    fun similarity(src: Track, cand: Track): Double {
        val st = norm(src.title)
        val ct = norm(cand.title)
        var title = if (st.isNotEmpty() && st == ct) 1.0 else jaccard(tokens(src.title), tokens(cand.title))
        val sa = artists(src.artist)
        val ca = artists(cand.artist)
        var artist = if (sa.any { it in ca }) 1.0 else jaccard(sa.joinToString(" ").split(' ').toSet(), ca.joinToString(" ").split(' ').toSet())
        val first = sa.firstOrNull()
        if (artist < 1 && first != null && " $ct ".contains(" $first ")) {
            // YouTube: «Исполнитель - Название» целиком в названии ролика
            artist = maxOf(artist, 0.8)
            val drop = first.split(' ').toSet()
            title = maxOf(title, jaccard(tokens(src.title), tokens(cand.title).filter { it !in drop }.toSet()))
        }
        var score = title * 0.6 + artist * 0.4
        if (src.duration > 0 && cand.duration > 0) {
            val d = kotlin.math.abs(src.duration - cand.duration)
            if (d <= 3) score += 0.08 else if (d > 20) score -= minOf(0.3, d / 200.0)
        }
        if (!cand.available) score -= 0.4
        return score.coerceIn(0.0, 1.0)
    }

    fun query(t: Track): String = "${artists(t.artist).firstOrNull() ?: ""} ${norm(t.title)}".trim()

    /** Лучшее совпадение через search(query); null — если ничего достаточно похожего */
    suspend fun find(t: Track, minScore: Double = 0.62, search: suspend (String) -> List<Track>): Track? {
        val queries = mutableListOf(query(t))
        if (norm(t.title) != t.title.lowercase()) queries += "${t.artist} ${t.title}"
        var best: Pair<Track, Double>? = null
        for (q in queries) {
            val list = runCatching { search(q) }.getOrDefault(emptyList())
            for (c in list.take(15)) {
                val s = similarity(t, c)
                if (best == null || s > best.second) best = c to s
            }
            if ((best?.second ?: 0.0) >= 0.85) break
        }
        return best?.takeIf { it.second >= minScore }?.first
    }
}
