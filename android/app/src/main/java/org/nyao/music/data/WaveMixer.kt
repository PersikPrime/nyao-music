package org.nyao.music.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.nyao.music.spotify.SpotifyApi
import java.util.concurrent.atomic.AtomicInteger

/** One wave across all catalogs. Selection policy mirrors the desktop implementation. */
class WaveMixer(
    private val ya: YandexApi, private val yt: YtMusicApi, private val sc: ScApi,
    private val vk: VkApi, private val prefs: Prefs,
    private val recentProvider: suspend () -> Set<String> = { emptySet() },
    private val isDown: (String) -> Boolean = { false },
    private val favorites: () -> List<FavArtist> = { emptyList() },
    private val sp: SpotifyApi? = null,
    private val historyProvider: suspend () -> List<Track> = { emptyList() },
) {
    companion object {
        const val DAY = 86400000L
        // Radio still uses this helper; the wave uses WavePolicy session quotas.
        fun <T> interleave(base: List<T>, extra: List<T>, sharePercent: Int): Pair<List<T>, Int> {
            val share = sharePercent.coerceIn(0, 100) / 100.0
            if (base.isEmpty() || share >= 1) return extra to extra.size
            if (extra.isEmpty() || share <= 0) return base to 0
            val out = ArrayList<T>(); var credit = 0.0; var used = 0
            for (t in base) { out += t; credit += share / (1 - share); while (credit >= 1 && used < extra.size) { out += extra[used++]; credit-- } }
            return out to used
        }
    }
    private data class Session(val generation: Int, val policy: WavePolicy = WavePolicy(),
        val candidates: MutableList<WaveCandidate> = ArrayList(), var libraries: List<WaveCandidate> = emptyList(),
        var recent: Set<String> = emptySet(), val history: MutableList<Track> = ArrayList(),
        var loads: Int = 0, var hydrated: Boolean = false, val excludedIds: MutableSet<String> = HashSet(), val seedHistory: MutableList<Track> = ArrayList())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private val feedbackLock = Any()
    private val epoch = AtomicInteger()
    val generation: Int get() = epoch.get()
    @Volatile private var session: Session? = null
    private val libraryCache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, List<Track>>>()
    private val state: JSONObject = runCatching { JSONObject(prefs.waveProfile) }.getOrDefault(JSONObject())

    private suspend fun <T> bounded(fallback: T, work: suspend () -> T): T {
        val task = scope.async { try { work() } catch (e: CancellationException) { throw e } catch (_: Exception) { fallback } }
        return try { withTimeoutOrNull(8000) { task.await() } ?: fallback } finally { task.cancel() }
    }
    private fun sources(): List<String> = listOfNotNull(
        SOURCE_YA.takeIf { ya.loggedIn && !isDown(it) }, SOURCE_YT.takeIf { yt.loggedIn && !isDown(it) },
        SOURCE_SC.takeIf { sc.loggedIn && !isDown(it) }, SOURCE_VK.takeIf { vk.loggedIn && !isDown(it) },
        SOURCE_SP.takeIf { sp?.loggedIn == true && !sp.regionBlocked && !isDown(it) })
    private fun ensure(s: Session) { check(session === s && s.generation == epoch.get()) { "Настройки волны изменились — предыдущий подбор отменён" } }
    private fun save() { prefs.waveProfile = state.toString() }
    fun invalidateLikes() { libraryCache.clear(); session?.hydrated = false }
    private fun profileTracks(key: String): List<Track> = state.optJSONArray(key).objects().mapNotNull { trackFromJson(it) }

    suspend fun start(queueIds: List<String> = emptyList()): List<Track> {
        val generation = epoch.incrementAndGet()
        return lock.withLock {
            val s = Session(generation); s.excludedIds += queueIds; session = s
            synchronized(feedbackLock) { profileTracks("disliked").forEach { s.policy.block(it) } }
            s.recent = bounded(emptySet()) { recentProvider() }
            s.history += bounded(emptyList()) { historyProvider() }
            val now = System.currentTimeMillis()
            synchronized(feedbackLock) {
                state.optJSONArray("played").objects().filter { now - it.optLong("at") < (if (it.optBoolean("skipped")) 30 else 14) * DAY }
                    .mapNotNull { it.optJSONObject("track")?.let { t -> trackFromJson(t) } }.forEach { s.history += it }
            }
            ensure(s); batch(s, true)
        }
    }
    private suspend fun libraries(s: Session) {
        val now = System.currentTimeMillis()
        val lists = coroutineScope { sources().map { source -> async {
            var cached = libraryCache[source]
            if (cached == null || now - cached.first > 120000) {
                val tracks = bounded(emptyList()) { when (source) {
                    SOURCE_YA -> ya.likedTracks(300); SOURCE_YT -> yt.likedTracksForWave()
                    SOURCE_SC -> sc.likedTracks(300); SOURCE_VK -> vk.likedTracks(300)
                    else -> sp!!.likedTracks(300)
                } }
                ensure(s)
                if (tracks.isNotEmpty()) { cached = now to tracks; libraryCache[source] = cached!! }
            }
            val tracks = cached?.second ?: emptyList()
            synchronized(feedbackLock) {
                val libs = state.optJSONObject("libraries") ?: JSONObject().also { state.put("libraries", it) }
                val previous = libs.optJSONObject(source); val observed = JSONObject()
                val result = tracks.mapIndexed { index, track ->
                    val likedAt = track.likedAt.takeIf { it > 0 } ?: (previous?.optLong(track.id) ?: 0L).takeIf { it > 0 }
                        ?: (if (previous != null && !previous.has(track.id)) now else 0L)
                    observed.put(track.id, likedAt)
                    val t = track.copy(likedAt = likedAt)
                    WaveCandidate(t, true, WavePolicy.recentAffinity(t, index, tracks.size, now), 1.0 + (state.optJSONObject("taste")?.optDouble(WavePolicy.artistKey(t), 0.0) ?: 0.0) / 5)
                }
                if (tracks.isNotEmpty()) libs.put(source, observed)
                result
            }
        } }.awaitAll() }
        ensure(s); synchronized(feedbackLock) { save() }
        s.libraries = lists.flatten()
        s.history += s.libraries.filter { it.track.id in s.recent }.map { it.track }
        s.candidates.removeAll { it.liked }
        s.policy.selected += s.libraries.filter { it.track.id in s.excludedIds }.map { it.track }
        add(s, s.libraries)
    }
    private fun add(s: Session, candidates: List<WaveCandidate>) {
        ensure(s)
        for (c in candidates) {
            if (!c.track.available || c.track.id in s.excludedIds) continue
            val i = s.candidates.indexOfFirst { it.track.id == c.track.id }
            if (i < 0) s.candidates += c else if (c.liked) s.candidates[i] = c
        }
        s.candidates.removeAll { c -> s.policy.selected.any { WavePolicy.sameRecording(it, c.track) } }
        while (s.candidates.size > 1600) s.candidates.removeAt(0)
    }
    private suspend fun search(source: String, query: String): List<Track> = when (source) {
        SOURCE_YA -> ya.search(query); SOURCE_YT -> yt.search(query); SOURCE_SC -> sc.search(query)
        SOURCE_VK -> vk.search(query); else -> sp!!.search(query)
    }
    private suspend fun recommendations(s: Session, first: Boolean) {
        val settings = prefs.settings.value
        val seeds = s.libraries.filter { it.track.available }.sortedByDescending { it.recency }
        val availableSeeds = seeds.filter { c -> s.seedHistory.none { WavePolicy.sameRecording(it, c.track) } }
        val seed = Freshness.recencyPick(availableSeeds.ifEmpty { seeds }.take(100), 1, settings.waveFresh).firstOrNull()?.track
        if (seed != null) { s.seedHistory += seed; while (s.seedHistory.size > 5) s.seedHistory.removeAt(0) }
        val favoriteNames = favorites().map { WavePolicy.normal(it.name) }.toSet()
        val lists = coroutineScope { sources().map { source -> async {
            val tasks = ArrayList<kotlinx.coroutines.Deferred<List<Track>>>()
            fun task(load: suspend () -> List<Track>) { tasks += async { bounded(emptyList(), load) } }
            when (source) {
                SOURCE_YA -> task { if (first) ya.waveStart(settings.diversity, settings.mood) else ya.waveMore(s.policy.selected.map { it.id }, settings.diversity, settings.mood) }
                SOURCE_VK -> task { vk.recommendations() }
                SOURCE_YT -> if (seed?.source == source) task { yt.radio(seed.srcId) }
                SOURCE_SC -> if (seed?.source == source) task { sc.related(seed.srcId) }
            }
            if (seed?.source == SOURCE_YA && source == SOURCE_YA) task { ya.similarTracks(seed.srcId) }
            if (seed != null && WavePolicy.artistKey(seed).isNotEmpty()) task {
                search(source, seed.artist.split(Regex(",| feat\\.? ", RegexOption.IGNORE_CASE))[0]).filter { WavePolicy.artistKey(it) == WavePolicy.artistKey(seed) }
            }
            if (tasks.isEmpty() && source == SOURCE_YT) task { yt.home().flatMap { it.tracks } }
            tasks.awaitAll().flatten().map { track ->
                val liked = s.libraries.filter { WavePolicy.sameRecording(it.track, track) }
                val related = seed != null && WavePolicy.artistKey(track) == WavePolicy.artistKey(seed)
                val affinity = (if (related) 0.8 else 0.2) + (if (WavePolicy.artistKey(track) in favoriteNames) 0.2 else 0.0) + synchronized(feedbackLock) { (state.optJSONObject("taste")?.optDouble(WavePolicy.artistKey(track), 0.0) ?: 0.0) / 5 }
                WaveCandidate(track, liked.isNotEmpty(), liked.maxOfOrNull { it.recency } ?: 0.0, affinity,
                    if (related) "Исполнитель из твоих лайков: ${seed?.artist}" else "Рекомендация сервиса")
            }
        } }.awaitAll() }
        ensure(s); add(s, lists.flatten()); s.loads++
    }
    private suspend fun batch(s: Session, first: Boolean = false): List<Track> {
        ensure(s)
        if (!s.hydrated) { libraries(s); s.hydrated = true }
        if (first || s.candidates.count { !it.liked } < 12 || s.loads % 3 == 0) recommendations(s, first)
        ensure(s)
        fun select(): List<Track> {
            val connected = sources().toSet()
            s.candidates.removeAll { it.track.source !in connected }
            val settings = prefs.settings.value
            return synchronized(feedbackLock) { s.policy.select(s.candidates, settings.diversity, settings.waveFresh, settings.ytmShare, recentIds = s.recent, history = s.history) }
        }
        var result = select()
        if (result.isEmpty()) { recommendations(s, false); result = select() }
        if (result.isEmpty()) throw ApiException(if (sources().isEmpty()) "Войди хотя бы в один сервис для волны" else "Новых подходящих треков пока нет. Измени настройки волны или добавь лайки.")
        add(s, emptyList())
        if (first && ya.loggedIn) bounded(Unit) { ya.waveFeedback("radioStarted", null); Unit }
        return result
    }
    suspend fun more(queueIds: List<String>): List<Track> {
        if (session == null) return start(queueIds)
        return lock.withLock {
            val s = session ?: throw ApiException("Запусти волну ещё раз")
            s.excludedIds += queueIds
            s.candidates.removeAll { it.track.id in queueIds }
            batch(s)
        }
    }
    suspend fun feedback(type: String, track: Track?, played: Int) {
        track ?: return
        synchronized(feedbackLock) {
            if (type == "dislike") {
                val tracks = (listOf(track) + profileTracks("disliked").filterNot { WavePolicy.sameRecording(it, track) }).take(500)
                state.put("disliked", JSONArray().apply { tracks.forEach { put(trackToJson(it)) } })
                session?.policy?.block(track)
            }
            if (type in listOf("trackStarted", "trackFinished", "skip", "dislike")) {
                val item = JSONObject().put("track", trackToJson(track)).put("at", System.currentTimeMillis())
                    .put("skipped", type == "dislike" || (type == "skip" && played < 30))
                val old = state.optJSONArray("played").objects().filterNot { p -> p.optJSONObject("track")?.let { trackFromJson(it) }?.let { WavePolicy.sameRecording(it, track) } == true }
                state.put("played", JSONArray().put(item).apply { old.take(1499).forEach { put(it) } })
            }
            val artist = WavePolicy.artistKey(track)
            val delta = when { type == "dislike" -> -3.0; type == "like" -> 2.0; type == "skip" && played < 30 -> -1.0; type == "trackFinished" && played >= 30 -> 1.0; else -> 0.0 }
            if (artist.isNotEmpty() && delta != 0.0) {
                val taste = state.optJSONObject("taste") ?: JSONObject().also { state.put("taste", it) }
                taste.put(artist, (taste.optDouble(artist, 0.0) * 0.95 + delta).coerceIn(-5.0, 5.0))
                if (taste.length() > 1500) taste.remove(taste.keys().next())
            }
            if (type == "like") invalidateLikes()
            save()
        }
        if (track.isYa) bounded(Unit) { ya.waveFeedback(type, track, played); Unit }
    }
}
