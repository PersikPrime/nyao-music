package org.nyao.music.spotify

import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.nyao.music.data.SOURCE_SP
import org.nyao.music.playback.PlaybackEvents
import kotlin.math.abs

/**
 * Связка ExoPlayer ↔ устройство Spotify.
 *
 * В очереди ExoPlayer трек Spotify — это тишина той же длины ([SilenceDataSource]).
 * Здесь всё, что делает ExoPlayer (переход, пауза, перемотка), повторяется на устройстве Spotify,
 * а позиция ExoPlayer подстраивается под настоящую позицию Spotify.
 */
@OptIn(UnstableApi::class)
class SpotifySync(private val player: ExoPlayer, private val scope: CoroutineScope) : Player.Listener {
    /** id трека, который Spotify сейчас должен играть */
    private var loaded: String? = null
    /** Spotify уже сообщил, что играет наш трек */
    private var confirmed = false
    private var lastCommand = 0L
    private var pendingSince = 0L
    private var starting: Job? = null
    private var focusHandled = true
    /** Треки, отданные Spotify одним списком: текущий и идущие следом треки Spotify — он подгружает их заранее */
    private var spList: List<String> = emptyList()
    /** С какой позиции просили начать: пока Spotify не заиграл, ползунок Nyao стоит на ней */
    private var startPos = 0L
    private var modesSet = false
    /** Трек доиграл сам: ждём, пока Spotify перейдёт к следующему по списку сам, без лишней команды */
    private var autoWaitUntil = 0L
    private var lastReason = -1
    private val attrs = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()

    private val engine get() = Spotify.engine

    fun start() {
        player.addListener(this)
        // плеер Spotify запускаем заранее — первый трек не ждёт загрузки SDK
        if (Spotify.loggedIn && !Spotify.api.regionBlocked) scope.launch { runCatching { engine.awaitReady(60_000) } }
        // ошибки устройства Spotify — человеку
        scope.launch {
            engine.errors.collect { (kind, msg) ->
                if (!isSp(player.currentMediaItem)) return@collect
                PlaybackEvents.emit(msg)
                if (kind in setOf("account", "init", "auth", "engine", "playback")) stopSp()
            }
        }
        // раз в полсекунды сверяем позицию и следим, чтобы Spotify не играл, когда не должен
        scope.launch {
            while (isActive) {
                runCatching { tick() }.onFailure { Log.w(TAG, "sync: ${it.message}") }
                delay(500)
            }
        }
    }

    private fun isSp(item: MediaItem?) = item?.mediaId?.startsWith("$SOURCE_SP:") == true
    private fun idOf(item: MediaItem?) = item?.mediaId?.removePrefix("$SOURCE_SP:")

    /** Текущий трек и идущие за ним подряд треки Spotify (с учётом перемешивания), до 20 */
    private fun upcomingSp(): List<String> {
        val out = ArrayList<String>()
        val tl = player.currentTimeline
        var i = player.currentMediaItemIndex
        while (i != C.INDEX_UNSET && i in 0 until player.mediaItemCount && out.size < 20) {
            val item = player.getMediaItemAt(i)
            if (!isSp(item)) break
            out += idOf(item)!!
            i = if (tl.isEmpty) C.INDEX_UNSET else tl.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, player.shuffleModeEnabled)
        }
        return out
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        // новый заход на тот же трек (повтор, дважды подряд) — включаем в Spotify заново
        if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED && isSp(mediaItem) && loaded == idOf(mediaItem)) loaded = null
        lastReason = reason
        reconcile()
        lastReason = -1
    }
    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = reconcile()

    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
        if (reason != Player.DISCONTINUITY_REASON_SEEK || !isSp(player.currentMediaItem)) return
        val id = idOf(player.currentMediaItem)
        if (id != loaded) return
        if (!confirmed) {
            // перемотали, пока Spotify ещё грузится — начнём сразу с нового места
            startPos = newPosition.positionMs
            return
        }
        // свою подстройку под позицию Spotify повторно в Spotify не шлём
        val snap = engine.playback.value
        if (snap != null && snap.isTrack(id!!) && abs(snap.positionAt(SystemClock.elapsedRealtime()) - newPosition.positionMs) < 1200) return
        command { engine.seek(newPosition.positionMs) }
    }

    private fun reconcile() {
        val item = player.currentMediaItem
        if (!isSp(item)) {
            setFocusHandling(true)
            if (loaded != null) {
                loaded = null
                starting?.cancel()
                command { engine.pause() }
            }
            return
        }
        // звук идёт из WebView: если ExoPlayer будет следить за аудиофокусом, он сам себя поставит на паузу
        setFocusHandling(false)
        val id = idOf(item)!!
        if (!player.playWhenReady) {
            if (loaded == id && confirmed) command { engine.pause() }
            return
        }
        if (loaded == id) {
            if (confirmed) command { engine.resume() } else pendingSince = SystemClock.elapsedRealtime()
            return
        }
        if (!Spotify.loggedIn) {
            PlaybackEvents.emit("Чтобы играли треки Spotify, войди в Spotify в настройках")
            stopSp()
            return
        }
        val prev = loaded
        val snap = engine.playback.value
        // Spotify сам уже перешёл на этот трек по общему списку (предыдущий доиграл)
        if (prev != null && id in spList && snap != null && snap.isTrack(id) && !snap.paused) {
            loaded = id
            confirmed = true
            return
        }
        // следующий по списку: Spotify его уже подгрузил, переход почти мгновенный
        val pi = prev?.let { spList.indexOf(it) } ?: -1
        if (prev != null && confirmed && pi >= 0 && spList.getOrNull(pi + 1) == id && player.currentPosition < 1500) {
            loaded = id
            confirmed = false
            pendingSince = SystemClock.elapsedRealtime()
            startPos = 0
            if (lastReason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                // предыдущий доиграл: Spotify перейдёт сам через мгновение, команда «дальше» пропустила бы лишний трек
                autoWaitUntil = SystemClock.elapsedRealtime() + 3000
            } else {
                command { engine.nextTrack() }
            }
            return
        }
        autoWaitUntil = 0
        loaded = id
        confirmed = false
        pendingSince = SystemClock.elapsedRealtime()
        starting?.cancel()
        val from = player.currentPosition
        startPos = from
        spList = upcomingSp().ifEmpty { listOf(id) }
        val uris = spList.map { "spotify:track:$it" }
        starting = scope.launch {
            try {
                lastCommand = SystemClock.elapsedRealtime()
                engine.playUris(uris, startPos)
                // пока шёл запрос, трек успели пропустить — Spotify не должен заиграть поверх
                if (loaded != id) runCatching { engine.pause() }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "play $id: ${e.message}")
                if (loaded != id) return@launch
                loaded = null
                PlaybackEvents.emit(e.message ?: "Spotify не включил трек")
                stopSp()
            }
        }
    }

    private fun tick() {
        val item = player.currentMediaItem
        val snap = engine.playback.value
        val now = SystemClock.elapsedRealtime()
        val id = loaded
        if (!isSp(item) || id == null || id != idOf(item)) {
            // в Nyao сейчас не трек Spotify, а Spotify играет (например, догрузился уже пропущенный) — глушим
            if (engine.started && snap != null && !snap.paused && now - lastCommand > 800) command { engine.pause() }
            return
        }
        if (!confirmed && player.playWhenReady && now - pendingSince > 45_000) {
            PlaybackEvents.emit("Spotify не подтвердил запуск — нажми «играть», чтобы повторить")
            stopSp()
            return
        }
        if (snap != null && snap.isTrack(id)) {
            if (!confirmed && !snap.paused) {
                confirmed = true
                ensureModes()
            }
            if (!confirmed) {
                holdStart()
                return
            }
            if (!snap.paused && !player.playWhenReady) {
                // Spotify успел стартовать уже после паузы в Nyao
                if (now - lastCommand > 1000) command { engine.pause() }
            } else if (!snap.paused) {
                // Spotify — источник правды о позиции. Сверяем только по свежему состоянию:
                // после перемотки он сообщает новое место не сразу, и старое утащило бы ползунок назад
                if (snap.at > lastCommand) {
                    val d = snap.positionAt(now) - player.currentPosition
                    if (abs(d) > 1500) player.seekTo(snap.positionAt(now))
                }
            } else if (player.playWhenReady && now - lastCommand > 2500 && snap.at > lastCommand) {
                // поставили на паузу из самого Spotify (часы, другое устройство)
                val nearEnd = snap.duration > 0 && snap.duration - snap.position < 1500
                if (!nearEnd) player.pause()
            }
        } else if (!confirmed) {
            holdStart()
            // Spotify так и не перешёл сам — включаем трек явно
            if (autoWaitUntil in 1 until now) {
                autoWaitUntil = 0
                loaded = null
                reconcile()
            }
        } else if (player.playWhenReady && now - lastCommand > 4000) {
            // Spotify перешёл к следующему треку списка на секунду раньше Nyao — это не «другое устройство»
            val next = spList.getOrNull(spList.indexOf(id) + 1)
            if (snap != null && next != null && snap.isTrack(next)) return
            loaded = null
            confirmed = false
            player.pause()
            PlaybackEvents.emit("Spotify играет на другом устройстве — поставил Nyao на паузу")
        }
    }

    /** Пока Spotify грузит трек, ползунок Nyao не убегает вперёд */
    private fun holdStart() {
        if (player.playWhenReady && player.currentPosition - startPos > 800) player.seekTo(startPos)
    }

    /** Перемешивание и повтор ведёт Nyao — у самого Spotify выключаем, иначе он перемешает наш список */
    private fun ensureModes() {
        if (modesSet) return
        modesSet = true
        scope.launch {
            runCatching {
                val dev = engine.awaitReady()
                Spotify.api.setShuffle(dev, false)
                Spotify.api.setRepeat(dev, "off")
            }
        }
    }

    private fun command(block: suspend () -> Unit) {
        lastCommand = SystemClock.elapsedRealtime()
        scope.launch { runCatching { block() }.onFailure { Log.w(TAG, "command: ${it.message}") } }
    }

    private fun skip() {
        if (player.hasNextMediaItem()) player.seekToNextMediaItem() else player.pause()
    }

    private fun stopSp() {
        loaded = null
        confirmed = false
        starting?.cancel()
        player.pause()
        command { engine.pause() }
    }

    private fun setFocusHandling(on: Boolean) {
        if (focusHandled == on) return
        focusHandled = on
        player.setAudioAttributes(attrs, on)
    }

    fun release() {
        player.removeListener(this)
        starting?.cancel()
        // свой scope сервиса сейчас отменят — паузу шлём отдельно
        if (loaded != null && engine.started) CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch { runCatching { engine.pause() } }
    }

    private companion object {
        const val TAG = "NyaoSpotify"
    }
}
