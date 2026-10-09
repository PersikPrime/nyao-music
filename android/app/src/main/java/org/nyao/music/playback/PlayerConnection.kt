package org.nyao.music.playback

import android.content.ComponentName
import android.content.Context
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.nyao.music.data.Repo
import org.nyao.music.data.Track

/** Связь интерфейса с фоновым плеером через MediaController. */
object PlayerConnection {
    private var controller: MediaController? = null
    private var future: ListenableFuture<MediaController>? = null
    private val pending = ArrayList<(MediaController) -> Unit>()

    private val _current = MutableStateFlow<Track?>(null)
    val current: StateFlow<Track?> = _current
    private val _playing = MutableStateFlow(false)
    val playing: StateFlow<Boolean> = _playing
    private val _buffering = MutableStateFlow(false)
    val buffering: StateFlow<Boolean> = _buffering
    private val _queue = MutableStateFlow<List<Track>>(emptyList())
    val queue: StateFlow<List<Track>> = _queue
    private val _repeat = MutableStateFlow(Player.REPEAT_MODE_OFF)
    /** Player.REPEAT_MODE_OFF / ALL / ONE */
    val repeat: StateFlow<Int> = _repeat
    private val _shuffle = MutableStateFlow(false)
    val shuffle: StateFlow<Boolean> = _shuffle
    private val _upNext = MutableStateFlow<List<Pair<Int, Track>>>(emptyList())
    /** Что заиграет дальше — с учётом перемешивания: пары (индекс в очереди, трек) */
    val upNext: StateFlow<List<Pair<Int, Track>>> = _upNext
    private val _index = MutableStateFlow(-1)
    val index: StateFlow<Int> = _index

    fun connect(context: Context) {
        if (future != null) return
        val app = context.applicationContext
        val token = SessionToken(app, ComponentName(app, PlaybackService::class.java))
        val f = MediaController.Builder(app, token).buildAsync()
        future = f
        f.addListener({
            val c = runCatching { f.get() }.getOrNull() ?: run {
                future = null
                return@addListener
            }
            controller = c
            c.addListener(listener)
            sync()
            pending.forEach { it(c) }
            pending.clear()
        }, ContextCompat.getMainExecutor(app))
    }

    private fun withController(block: (MediaController) -> Unit) {
        val c = controller
        if (c != null) block(c) else pending += block
    }

    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) = sync()
    }

    private fun sync() {
        val c = controller ?: return
        _queue.value = (0 until c.mediaItemCount).mapNotNull { Repo.track(c.getMediaItemAt(it).mediaId) }
        _index.value = c.currentMediaItemIndex
        _current.value = c.currentMediaItem?.mediaId?.let { Repo.track(it) }
        _playing.value = c.isPlaying
        _buffering.value = c.playbackState == Player.STATE_BUFFERING
        _repeat.value = c.repeatMode
        val tl = c.currentTimeline
        val next = ArrayList<Pair<Int, Track>>()
        var i = c.currentMediaItemIndex
        if (!tl.isEmpty && i >= 0) {
            while (next.size < 50) {
                i = tl.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, c.shuffleModeEnabled)
                if (i == C.INDEX_UNSET) break
                Repo.track(c.getMediaItemAt(i).mediaId)?.let { next += i to it }
            }
        }
        _upNext.value = next
        _shuffle.value = c.shuffleModeEnabled
    }

    // ---------- Таймер сна ----------
    private val _sleep = MutableStateFlow(false)
    val sleep: StateFlow<Boolean> = _sleep
    private var sleepJob: Job? = null
    private val mainScope = CoroutineScope(Dispatchers.Main)

    /** Включает/выключает паузу через [minutes] минут */
    fun toggleSleep(minutes: Int = 30) {
        sleepJob?.cancel()
        if (_sleep.value) {
            _sleep.value = false
            return
        }
        _sleep.value = true
        sleepJob = mainScope.launch {
            delay(minutes * 60_000L)
            withController { it.pause() }
            _sleep.value = false
        }
    }

    // ---------- Положение ----------

    fun positionMs(): Long = controller?.currentPosition ?: 0L

    fun durationMs(): Long {
        val d = controller?.duration ?: 0L
        return if (d > 0) d else (_current.value?.duration ?: 0) * 1000L
    }

    // ---------- Команды ----------

    fun playList(list: List<Track>, start: Int, label: String) {
        val playable = list.filter { it.available }
        if (playable.isEmpty()) return
        val startIndex = playable.indexOf(list.getOrNull(start)).coerceAtLeast(0)
        Repo.mode.value = Repo.Mode.LIST
        Repo.queueLabel.value = label
        withController { c ->
            c.setMediaItems(playable.map { Repo.mediaItem(it) }, startIndex, 0L)
            c.prepare()
            c.play()
        }
    }

    suspend fun startWave() {
        val tracks = withContext(Dispatchers.IO) { Repo.waveStart() }
        Repo.mode.value = Repo.Mode.WAVE
        Repo.queueLabel.value = "Моя волна"
        withController { c ->
            c.shuffleModeEnabled = false
            if (c.repeatMode == Player.REPEAT_MODE_ALL) c.repeatMode = Player.REPEAT_MODE_OFF
            c.setMediaItems(tracks.map { Repo.mediaItem(it) }, 0, 0L)
            c.prepare()
            c.play()
        }
    }

    /** Настройки волны поменялись — заменяем всё, что после текущего трека */
    suspend fun refreshWave() {
        if (Repo.mode.value != Repo.Mode.WAVE) return
        val tracks = withContext(Dispatchers.IO) { Repo.waveStart() }
        withController { c ->
            val i = c.currentMediaItemIndex
            if (c.mediaItemCount > i + 1) c.removeMediaItems(i + 1, c.mediaItemCount)
            c.addMediaItems(tracks.map { Repo.mediaItem(it) })
        }
    }

    fun toggle() = withController { c ->
        if (c.isPlaying) c.pause() else {
            if (c.playbackState == Player.STATE_IDLE) c.prepare()
            c.play()
        }
    }

    /** Выкл → повтор плейлиста → повтор трека. В волне плейлист бесконечный, поэтому там только выкл ↔ трек */
    fun cycleRepeat() = withController { c ->
        val wave = Repo.mode.value == Repo.Mode.WAVE
        c.repeatMode = when (c.repeatMode) {
            Player.REPEAT_MODE_OFF -> if (wave) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_ALL
            Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
            else -> Player.REPEAT_MODE_OFF
        }
    }

    fun toggleShuffle() = withController { it.shuffleModeEnabled = !it.shuffleModeEnabled }

    fun next() = withController { it.seekToNextMediaItem() }

    fun prev() = withController { c ->
        if (c.currentPosition > 3000 || !c.hasPreviousMediaItem()) c.seekTo(0) else c.seekToPreviousMediaItem()
    }

    fun seekTo(ms: Long) = withController { it.seekTo(ms) }

    fun playAt(index: Int) = withController { c ->
        c.seekTo(index, 0L)
        c.play()
    }

    fun playNext(t: Track) = withController { c ->
        val at = if (c.mediaItemCount == 0) 0 else c.currentMediaItemIndex + 1
        c.addMediaItem(at, Repo.mediaItem(t))
        if (c.mediaItemCount == 1) {
            c.prepare()
            c.play()
        }
    }

    /** «Не нравится»: в волне — сигнал Яндексу, и сразу следующий трек */
    suspend fun dislike() {
        val t = _current.value ?: return
        val played = (positionMs() / 1000).toInt()
        next()
        if (Repo.mode.value == Repo.Mode.WAVE) withContext(Dispatchers.IO) { Repo.wave.feedback("dislike", t, played) }
    }
}
