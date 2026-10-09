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
class WaveMixer(private val ya: YandexApi, private val yt: YtMusicApi, private val prefs: Prefs) {

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
    private var refill: Job? = null

    private suspend fun refillPool() {
        if (!yt.loggedIn) return
        val s = prefs.settings.value
        val exclude = lock.withLock { HashSet(seen) }
        val tracks = try {
            yt.wavePool(s.diversity, exclude)
        } catch (_: Exception) {
            emptyList()
        }
        lock.withLock { tracks.forEach { t -> if (t.id !in seen && pool.none { it.id == t.id }) pool += t } }
    }

    private fun refillInBackground() {
        if (refill?.isActive == true) return
        refill = scope.launch { refillPool() }
    }

    private suspend fun batch(yaCall: suspend () -> List<Track>): List<Track> {
        val s = prefs.settings.value
        val useYt = yt.loggedIn && s.ytmShare > 0
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
            val fresh = base.filter { it.id !in seen }
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
        val s = prefs.settings.value
        val tracks = batch { ya.waveStart(s.diversity, s.mood) }
        if (ya.loggedIn) ya.waveFeedback("radioStarted", null)
        return tracks
    }

    suspend fun more(queueIds: List<String>): List<Track> {
        val s = prefs.settings.value
        return batch { ya.waveMore(queueIds, s.diversity, s.mood) }
    }

    suspend fun feedback(type: String, track: Track?, played: Int) {
        if (track != null && track.isYa) ya.waveFeedback(type, track, played)
    }
}
