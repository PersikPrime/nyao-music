package org.nyao.music.data

import java.text.Normalizer
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln

/** Pure counterpart of src/main/wave-policy.js; providers never own final queue order. */
data class WaveCandidate(val track: Track, val liked: Boolean = false, val recency: Double = 0.0, val affinity: Double = 0.0, val reason: String = "По твоим интересам")

class WavePolicy(private val random: () -> Double = { Math.random() }) {
    companion object {
        private val normalized = java.util.concurrent.ConcurrentHashMap<String, String>()
        fun normal(s: String): String {
            normalized[s]?.let { return it }
            if (normalized.size > 10000) normalized.clear()
            val value = Normalizer.normalize(s, Normalizer.Form.NFKD).lowercase(java.util.Locale.ROOT)
            .replace('ё', 'е').replace(Regex("\\p{M}"), "")
            .replace(Regex("\\b(official\\s*(music\\s*)?(video|audio)|lyrics?\\s*(video)?|hd|hq)\\b"), " ")
            .replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim().replace(Regex("\\s+"), " ")
            normalized[s] = value
            return value
        }
        private val artists = java.util.Collections.synchronizedMap(java.util.WeakHashMap<Track, String>())
        private val titles = java.util.Collections.synchronizedMap(java.util.WeakHashMap<Track, String>())
        private val artistSplit = Regex(",|\\s+feat\\.?\\s+|\\s+ft\\.?\\s+", RegexOption.IGNORE_CASE)
        fun artistKey(t: Track): String {
            artists[t]?.let { return it }
            val key = normal(t.artist.split(artistSplit)[0]); artists[t] = key; return key
        }
        fun titleKey(t: Track): String {
            titles[t]?.let { return it }
            val a = artistKey(t); val title = normal(t.title)
            val key = if (a.isNotEmpty() && title.startsWith("$a ")) title.removePrefix("$a ") else title
            titles[t] = key; return key
        }
        fun sameRecording(a: Track, b: Track): Boolean = a.id == b.id ||
            (!a.isrc.isNullOrBlank() && a.isrc == b.isrc) ||
            (artistKey(a).isNotEmpty() && titleKey(a).isNotEmpty() && artistKey(a) == artistKey(b) && titleKey(a) == titleKey(b) &&
                a.duration > 0 && b.duration > 0 && abs(a.duration - b.duration) <= 5)
        fun recentAffinity(track: Track, index: Int, size: Int, now: Long = System.currentTimeMillis()): Double =
            if (track.likedAt > 0 && track.likedAt <= now) exp(-(now - track.likedAt).toDouble() / (30 * 86400000.0))
            else exp(-index.toDouble() / maxOf(5.0, minOf(30.0, size * 0.1)))
        fun targets(diversity: String, fresh: Int): Map<String, Double> {
            val f = fresh.coerceIn(0, 100) / 100.0
            if (diversity == "discover") return mapOf("recent" to 0.0, "library" to 0.0, "related" to 1.0)
            if (diversity == "popular") return mapOf("recent" to 0.1 * f, "library" to 0.1, "related" to 0.9 - 0.1 * f)
            val liked = if (diversity == "favorite") 0.9 else 0.55
            val recent = liked * f * (if (diversity == "favorite") 7.0 / 9 else 0.8)
            return mapOf("recent" to recent, "library" to liked - recent, "related" to 1 - liked)
        }
    }
    private class TrackIndex(tracks: List<Track>) {
        private val ids = HashSet<String>(); private val isrc = HashSet<String>()
        private val keys = HashMap<String, MutableList<Track>>()
        private fun key(t: Track) = artistKey(t) + "|" + titleKey(t)
        init { tracks.forEach { add(it) } }
        fun add(t: Track) { ids += t.id; t.isrc?.let { isrc += it }; keys.getOrPut(key(t)) { ArrayList() }.add(t) }
        fun has(t: Track): Boolean = t.id in ids || (!t.isrc.isNullOrBlank() && t.isrc in isrc) || keys[key(t)]?.any { sameRecording(it, t) } == true
    }
    val selected = ArrayList<Track>()
    val kinds = mutableMapOf("recent" to 0, "library" to 0, "related" to 0)
    val sources = HashMap<String, Int>()
    var total = 0; private set
    private val blocked = ArrayList<Track>()
    fun block(track: Track) { blocked += track }

    fun select(candidates: List<WaveCandidate>, diversity: String = "any", fresh: Int = 60, share: Int = 30,
        size: Int = 8, recentIds: Set<String> = emptySet(), history: List<Track> = emptyList()): List<Track> {
        val out = ArrayList<Track>(); val targets = targets(diversity, fresh)
        val selectedIndex = TrackIndex(selected); val blockedIndex = TrackIndex(blocked); val heardIndex = TrackIndex(history)
        val likedIndex = TrackIndex(candidates.filter { it.liked }.map { it.track })
        repeat(size) {
            var options = candidates.filter { c -> c.track.available && !selectedIndex.has(c.track) &&
                !blockedIndex.has(c.track) && !(diversity == "discover" && likedIndex.has(c.track)) }
            if (options.isEmpty()) return out

            val groups = ArrayList<MutableList<WaveCandidate>>()
            val byKey = HashMap<String, MutableList<MutableList<WaveCandidate>>>()
            val byIsrc = HashMap<String, MutableList<WaveCandidate>>()
            for (c in options) {
                val key = artistKey(c.track) + "|" + titleKey(c.track)
                var group = c.track.isrc?.let { byIsrc[it] } ?: byKey[key]?.firstOrNull { sameRecording(it[0].track, c.track) }
                if (group == null) { group = ArrayList(); groups.add(group); byKey.getOrPut(key) { ArrayList() }.add(group) }
                group.add(c); c.track.isrc?.let { byIsrc[it] = group }
            }
            fun kindOf(group: List<WaveCandidate>): String = if (group.any { it.liked }) (if (group.maxOf { it.recency } >= 0.5) "recent" else "library") else "related"
            fun cooled(group: List<WaveCandidate>): Boolean = group.none { c -> c.track.id in recentIds || heardIndex.has(c.track) }
            val freshKinds = groups.filter { cooled(it) }.map { kindOf(it) }.toSet()
            val cooledGroups = groups.filter { cooled(it) || kindOf(it) !in freshKinds }
            val recentArtists = selected.takeLast(3).map { artistKey(it) }.filter { it.isNotEmpty() }
            val choices = cooledGroups.filter { artistKey(it[0].track) !in recentArtists }.ifEmpty { cooledGroups }
            val available = choices.flatten().map { it.track.source }.distinct()
            val extras = available.filter { it != SOURCE_YA }
            fun weight(source: String): Double = if (SOURCE_YA in available && extras.isNotEmpty()) {
                if (source == SOURCE_YA) 1 - share / 100.0 else share / 100.0 / extras.size
            } else 1.0 / available.size
            val availableKinds = choices.map { group -> if (group.any { it.liked }) (if (group.maxOf { it.recency } >= 0.5) "recent" else "library") else "related" }
            val effective = targets.toMutableMap()
            if ("recent" !in availableKinds) { effective["library"] = effective.getValue("library") + effective.getValue("recent"); effective["recent"] = 0.0 }
            if ("library" !in availableKinds) { effective["recent"] = effective.getValue("recent") + effective.getValue("library"); effective["library"] = 0.0 }
            if ("related" !in availableKinds) {
                val sum = effective.getValue("recent") + effective.getValue("library")
                if (sum > 0) { effective["recent"] = effective.getValue("recent") / sum; effective["library"] = effective.getValue("library") / sum }
                effective["related"] = 0.0
            }
            var best: WaveCandidate? = null; var bestKind = "related"; var bestScore = Double.NEGATIVE_INFINITY
            for (group in choices) {
                val liked = group.any { it.liked }; val recency = group.maxOf { it.recency }
                val kind = if (liked) (if (recency >= 0.5) "recent" else "library") else "related"
                val deficit = effective.getValue(kind) * (total + 1) - kinds.getValue(kind)
                for (c in group) {
                    val sourceDeficit = weight(c.track.source) * (total + 1) - (sources[c.track.source] ?: 0)
                    val noise = -ln(-ln(random().coerceIn(1e-8, 1 - 1e-8)))
                    val score = 5 * deficit + 1.5 * sourceDeficit + (if (kind == "recent") recency * fresh / 100 else 0.0) + c.affinity * 0.7 + noise * 0.35
                    if (score > bestScore) { best = c; bestKind = kind; bestScore = score }
                }
            }
            val chosen = best ?: return out
            val reason = when (bestKind) { "recent" -> "Недавний лайк"; "library" -> "Из любимого"; else -> chosen.reason }
            val track = chosen.track.copy(waveReason = reason)
            out += track; selected += track; selectedIndex.add(track); total++
            kinds[bestKind] = kinds.getValue(bestKind) + 1
            sources[track.source] = (sources[track.source] ?: 0) + 1
        }
        return out
    }
}
