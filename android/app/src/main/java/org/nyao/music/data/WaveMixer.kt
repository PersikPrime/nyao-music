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
    private val vk: VkApi,
    private val prefs: Prefs,
    /** id треков, звучавших недавно на всех устройствах — волна их пропускает */
    private val recentProvider: suspend () -> Set<String> = { emptySet() },
    /** Сервис временно лежит (статус с сервера Nyao) — пропускаем его */
    private val isDown: (String) -> Boolean = { false },
    /** Любимые исполнители (сердечко на странице исполнителя) */
    private val favorites: () -> List<FavArtist> = { emptyList() },
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
    /** Подмес: треки любимых исполнителей и похожее на свежие лайки — чтобы волна была про «сейчас» */
    private val boost = ArrayList<Track>()
    private var boosting: Job? = null
    private val likedCache = HashMap<String, List<Track>>()

    /** Есть ли что подмешивать: YouTube Music и/или SoundCloud */
    private val ytOn get() = yt.loggedIn && !isDown(SOURCE_YT)
    private val scOn get() = sc.loggedIn && !isDown(SOURCE_SC)
    private val vkOn get() = vk.loggedIn && !isDown(SOURCE_VK)
    private val yaOn get() = ya.loggedIn && !isDown(SOURCE_YA)
    private val hasExtras: Boolean get() = ytOn || scOn || vkOn

    private suspend fun refillPool() {
        if (!hasExtras) return
        val s = prefs.settings.value
        val exclude = lock.withLock { HashSet(seen).apply { addAll(recent) } }
        val a = if (ytOn) runCatching { yt.wavePool(s.diversity, exclude, fresh = s.waveFresh) }.getOrDefault(emptyList()) else emptyList()
        val b = if (scOn) runCatching { sc.wavePool(s.diversity, exclude, fresh = s.waveFresh) }.getOrDefault(emptyList()) else emptyList()
        val c = if (vkOn) runCatching { vk.wavePool(s.diversity, exclude, fresh = s.waveFresh) }.getOrDefault(emptyList()) else emptyList()
        // сервис дал только недавно звучавшее — лучше пара повторов, чем пропасть из волны
        val lists = listOf(a, b, c).map { l -> l.filter { it.id !in exclude }.ifEmpty { l.filter { it.id !in seen }.take(2) } }
        val tracks = alternateAll(*lists.toTypedArray())
        lock.withLock { tracks.forEach { t -> if (t.id !in seen && pool.none { it.id == t.id }) pool += t } }
    }

    private suspend fun likedOf(id: String, load: suspend () -> List<Track>): List<Track> =
        lock.withLock { likedCache[id] } ?: runCatching { load() }.getOrDefault(emptyList()).also { l -> lock.withLock { likedCache[id] = l } }

    private suspend fun artistTop(ref: String): List<Track> {
        val id = ref.substringAfter(':')
        return when {
            ref.startsWith("ya:") && yaOn -> ya.artistTracks(id).take(30)
            ref.startsWith("yt:") && ytOn -> yt.artist(id).popular
            else -> emptyList()
        }
    }

    /** Подмес: 1) любимые исполнители; 2) свежий лайк и похожее на него (Яндекс и YouTube Music) */
    private suspend fun refillBoost() {
        val s = prefs.settings.value
        val exclude = lock.withLock { HashSet(seen).apply { addAll(recent) } }
        fun ok(t: Track) = t.available && t.id !in exclude
        val found = ArrayList<Track>()
        for (a in Freshness.recencyPick(favorites(), 2, 40)) {
            found += runCatching { artistTop(a.refYa ?: a.refYt ?: a.ref) }.getOrDefault(emptyList()).take(25).filter { ok(it) }.shuffled().take(3)
        }
        if (s.waveFresh > 0) {
            if (yaOn) {
                val liked = likedOf(SOURCE_YA) { ya.likedTracks(80) }
                for (seed in Freshness.recencyPick(liked, 1, s.waveFresh)) {
                    if (ok(seed) && s.waveFresh >= 50) found += seed
                    found += runCatching { ya.similarTracks(seed.srcId) }.getOrDefault(emptyList()).filter { ok(it) }.shuffled().take(3)
                }
            }
            if (ytOn) {
                val liked = likedOf(SOURCE_YT) { yt.likedTracksForWave() }
                for (seed in Freshness.recencyPick(liked, 1, s.waveFresh)) {
                    if (ok(seed) && s.waveFresh >= 50) found += seed
                    found += runCatching { yt.radio(seed.srcId) }.getOrDefault(emptyList()).filter { ok(it) }.shuffled().take(3)
                }
            }
        }
        lock.withLock { found.shuffled().forEach { t -> if (t.id !in seen && boost.none { it.id == t.id }) boost += t } }
    }

    private fun boostInBackground() {
        if (boosting?.isActive == true) return
        boosting = scope.launch { runCatching { refillBoost() } }
    }

    /** Подмешать подмес в готовую пачку (под замком) */
    private fun withBoost(out: List<Track>): List<Track> {
        val s = prefs.settings.value
        val share = Freshness.boostShare(s.waveFresh, favorites().size)
        if (boost.isEmpty() || share <= 0 || out.isEmpty()) return out
        val ids = out.map { it.id }.toSet()
        val src = boost.filter { it.id !in seen && it.id !in ids }
        val (mixed, used) = interleave(out, src, share)
        val usedTracks = src.take(used)
        boost.removeAll(usedTracks.toSet())
        usedTracks.forEach { seen += it.id; remember(it.id) }
        return mixed
    }

    private fun refillInBackground() {
        if (refill?.isActive == true) return
        refill = scope.launch { refillPool() }
    }

    /**
     * Из пачки Яндекса берём новое. Ступени, чтобы волна не обрывалась:
     * 1) не звучало ни в этом запуске, ни недавно; 2) недавно звучало, но не в этом запуске;
     * 3) повтор из этого запуска, но не из последних 30 треков.
     */
    private fun pickFresh(base: List<Track>, strict: Boolean): List<Track> {
        val a = base.filter { it.id !in seen && it.id !in recent }
        if (a.isNotEmpty() || strict) return a
        val b = base.filter { it.id !in seen }
        if (b.isNotEmpty()) return b.take(4)
        val last = lastPlayed.toSet()
        return base.filter { it.id !in last }.take(3)
    }

    private suspend fun batch(yaCall: suspend () -> List<Track>, retryCall: suspend () -> List<Track> = yaCall): List<Track> {
        val s = prefs.settings.value
        val useYt = hasExtras && s.ytmShare > 0
        if (useYt && lock.withLock { pool.size } < 6) {
            refill?.join()
            if (lock.withLock { pool.size } < 6) refillPool()
        }
        var fresh: List<Track> = emptyList()
        var gotAny = false
        var lastList: List<Track> = emptyList()
        if (yaOn && s.ytmShare < 100) {
            // Яндекс прислал только уже звучавшее — просим следующую пачку, а не сдаёмся
            // Яндекс охотно повторяет знакомое — просим новые пачки дольше, прежде чем согласиться на повтор
            for (attempt in 0 until 6) {
                val base = try {
                    if (attempt == 0) yaCall() else retryCall()
                } catch (e: Exception) {
                    if (!useYt && attempt == 0) throw e
                    break
                }
                if (base.isNotEmpty()) {
                    gotAny = true
                    lastList = (lastList + base).distinctBy { it.id }
                }
                fresh = lock.withLock { pickFresh(base, strict = attempt < 4) }
                if (fresh.isNotEmpty()) break
            }
            // новых пачек не дали — лучше повтор из того, что есть, чем тишина
            if (fresh.isEmpty() && lastList.isNotEmpty()) fresh = lock.withLock { pickFresh(lastList, strict = false) }
        }
        val result = lock.withLock {
            fresh.forEach { seen += it.id; remember(it.id) }
            val extraSource = if (!useYt) emptyList() else if (fresh.isEmpty()) pool.take(6) else pool.toList()
            val (out, used) = interleave(fresh, extraSource, if (fresh.isEmpty()) 100 else s.ytmShare)
            val usedTracks = extraSource.take(used)
            pool.removeAll(usedTracks.toSet())
            usedTracks.forEach { seen += it.id; remember(it.id) }
            withBoost(out)
        }
        if (useYt) refillInBackground()
        if (lock.withLock { boost.size } < 4) boostInBackground()
        if (result.isEmpty()) throw ApiException(
            if (yaOn || hasExtras) (if (gotAny) "Сервисы прислали только уже сыгранное — нажми ещё раз, попробую снова" else "Сервисы не прислали треков — проверь интернет и попробуй ещё раз")
            else "Волна пустая: войди хотя бы в один сервис в настройках",
        )
        return result
    }

    /** Последние сыгранные — их не повторяем даже в крайнем случае */
    private val lastPlayed = ArrayDeque<String>()

    private fun remember(id: String) {
        lastPlayed.addLast(id)
        while (lastPlayed.size > 30) lastPlayed.removeFirst()
    }

    suspend fun start(): List<Track> {
        lock.withLock {
            pool.clear()
            seen.clear()
            lastPlayed.clear()
            boost.clear()
            likedCache.clear()
        }
        recent = runCatching { recentProvider() }.getOrDefault(emptySet())
        // подмес готовим, но ждём не дольше пары секунд — первый трек важнее
        boostInBackground()
        kotlinx.coroutines.withTimeoutOrNull(2500) { boosting?.join() }
        val s = prefs.settings.value
        val tracks = freshStart(batch({ ya.waveStart(s.diversity, s.mood) }, { ya.waveMore(seen.toList(), s.diversity, s.mood) }))
        if (ya.loggedIn) ya.waveFeedback("radioStarted", null)
        return tracks
    }

    /** Начало волны каждый раз новое: перемешиваем первые треки и не начинаем с того же, что в прошлые разы */
    private fun freshStart(tracks: List<Track>): List<Track> {
        if (tracks.size < 2) return tracks
        val n = minOf(12, tracks.size)
        val out = (tracks.take(n).shuffled() + tracks.drop(n)).toMutableList()
        val firsts = prefs.waveFirsts
        val i = out.indexOfFirst { it.id !in firsts }
        if (i > 0) out.add(0, out.removeAt(i))
        prefs.waveFirsts = (listOf(out[0].id) + firsts.filter { it != out[0].id }).take(40)
        return out
    }

    suspend fun more(queueIds: List<String>): List<Track> {
        val s = prefs.settings.value
        // волна восстановлена после перезапуска (start не вызывался) — всё равно не повторяем недавнее
        if (recent.isEmpty()) {
            recent = runCatching { recentProvider() }.getOrDefault(emptySet())
            lock.withLock { queueIds.forEach { seen += it } }
        }
        return batch({ ya.waveMore(queueIds, s.diversity, s.mood) }, { ya.waveMore(queueIds + seen.toList().takeLast(10), s.diversity, s.mood) })
    }

    suspend fun feedback(type: String, track: Track?, played: Int) {
        if (track != null && track.isYa) ya.waveFeedback(type, track, played)
    }
}
