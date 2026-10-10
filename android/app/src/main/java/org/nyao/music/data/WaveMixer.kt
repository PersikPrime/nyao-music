package org.nyao.music.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Общая «Моя волна»: основа — поток Яндекса, в него подмешиваются треки YouTube Music.
 * Доля YT — ytmShare в процентах. Если вошли только в один сервис — волна из него одного.
 * Перенос src/main/wave.js.
 */
class WaveMixer(
    private val ya: YandexApi,
    private val yt: YtMusicApi,
    private val sc: ScApi,
    private val prefs: Prefs,
    /** id треков, звучавших недавно на всех устройствах — волна их пропускает */
    private val recentProvider: suspend () -> Set<String> = { emptySet() },
) {

    companion object {
        /** Чередование: на каждый трек основы — share/(1-share) треков extra */
        fun <T> interleave(base: List<T>, extra: List<T>, sharePercent: Int): Pair<List<T>, Int> {
            val share = sharePercent.coerceIn(0, 100) / 100.0
            if (base.isEmpty() || share >= 1.0) return extra to extra.size
            if (share <= 0.0 || extra.isEmpty()) return base to 0
            val perBase = share / (1 - share)
            val out = ArrayList<T>()
            var credit = 0.0
            var used = 0
            for (t in base) {
                out += t
                credit += perBase
                while (credit >= 1 && used < extra.size) {
                    out += extra[used++]
                    credit -= 1
                }
            }
            return out to used
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val lock = Mutex()
    private val pool = ArrayList<Track>()
    private val seen = HashSet<String>()
    @Volatile private var recent: Set<String> = emptySet()
    private var refill: Job? = null

    /** Есть ли что подмешивать: YouTube Music и/или SoundCloud */
    private val hasExtras: Boolean get() = yt.loggedIn || sc.loggedIn

    private suspend fun refillPool() {
        if (!hasExtras) return
        val s = prefs.settings.value
        val exclude = lock.withLock { HashSet(seen).apply { addAll(recent) } }
        val a = if (yt.loggedIn) runCatching { yt.wavePool(s.diversity, exclude) }.getOrDefault(emptyList()) else emptyList()
        val b = if (sc.loggedIn) runCatching { sc.wavePool(s.diversity, exclude) }.getOrDefault(emptyList()) else emptyList()
        val tracks = alternateAll(a, b)
        lock.withLock { tracks.forEach { t -> if (t.id !in exclude && t.id !in seen && pool.none { it.id == t.id }) pool += t } }
    }

    private fun refillInBackground() {
        if (refill?.isActive == true) return
        refill = scope.launch { refillPool() }
    }

    private suspend fun batch(yaCall: suspend () -> List<Track>): List<Track> {
        val s = prefs.settings.value
        val useYt = hasExtras && s.ytmShare > 0
        if (useYt && lock.withLock { pool.size } < 6) {
            refill?.join()
            if (lock.withLock { pool.size } < 6) refillPool()
        }
        var base: List<Track> = emptyList()
        if (ya.loggedIn && s.ytmShare < 100) {
            base = try {
                yaCall()
            } catch (e: Exception) {
                if (!useYt) throw e
                emptyList()
            }
        }
        val result = lock.withLock {
            // недавно звучавшее пропускаем; если пропустили всё — лучше пара повторов, чем тишина
            val fresh = base.filter { it.id !in seen && it.id !in recent }.ifEmpty { base.filter { it.id !in seen }.take(2) }
            fresh.forEach { seen += it.id }
            val extraSource = if (!useYt) emptyList() else if (fresh.isEmpty()) pool.take(6) else pool.toList()
            val (out, used) = interleave(fresh, extraSource, if (fresh.isEmpty()) 100 else s.ytmShare)
            val usedTracks = extraSource.take(used)
            pool.removeAll(usedTracks.toSet())
            usedTracks.forEach { seen += it.id }
            out
        }
        if (useYt) refillInBackground()
        if (result.isEmpty()) throw ApiException("Волна пустая: войди хотя бы в один сервис в настройках")
        return result
    }

    suspend fun start(): List<Track> {
        lock.withLock {
            pool.clear()
            seen.clear()
        }
        recent = runCatching { recentProvider() }.getOrDefault(emptySet())
        val s = prefs.settings.value
        val tracks = freshStart(batch { ya.waveStart(s.diversity, s.mood) })
        if (ya.loggedIn) ya.waveFeedback("radioStarted", null)
        return tracks
    }

    /** Начало волны каждый раз новое: перемешиваем первые треки и не начинаем с того же, что в прошлые разы */
    private fun freshStart(tracks: List<Track>): List<Track> {
        if (tracks.size < 2) return tracks
        val n = minOf(5, tracks.size)
        val out = (tracks.take(n).shuffled() + tracks.drop(n)).toMutableList()
        val firsts = prefs.waveFirsts
        val i = out.indexOfFirst { it.id !in firsts }
        if (i > 0) out.add(0, out.removeAt(i))
        prefs.waveFirsts = (listOf(out[0].id) + firsts.filter { it != out[0].id }).take(15)
        return out
    }

    suspend fun more(queueIds: List<String>): List<Track> {
        val s = prefs.settings.value
        return batch { ya.waveMore(queueIds, s.diversity, s.mood) }
    }

    suspend fun feedback(type: String, track: Track?, played: Int) {
        if (track != null && track.isYa) ya.waveFeedback(type, track, played)
    }
}
