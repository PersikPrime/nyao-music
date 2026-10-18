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
    private var starting: Job? = null
    private var focusHandled = true
    private val attrs = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build()

    private val engine get() = Spotify.engine

    fun start() {
        player.addListener(this)
        // ошибки устройства Spotify — человеку
        scope.launch {
            engine.errors.collect { (kind, msg) ->
                if (!isSp(player.currentMediaItem)) return@collect
                PlaybackEvents.emit(msg)
                if (kind == "account" || kind == "init" || kind == "auth") stopSp()
            }
        }
        // раз в полсекунды сверяем позицию и смотрим, не забрали ли Spotify на другое устройство
        scope.launch {
            while (isActive) {
                runCatching { tick() }.onFailure { Log.w(TAG, "sync: ${it.message}") }
                delay(500)
            }
        }
    }

    private fun isSp(item: MediaItem?) = item?.mediaId?.startsWith("$SOURCE_SP:") == true
    private fun idOf(item: MediaItem?) = item?.mediaId?.removePrefix("$SOURCE_SP:")

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        // новый заход на трек (повтор, тот же трек дважды подряд) — включаем в Spotify заново
        if (reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED && isSp(mediaItem) && loaded == idOf(mediaItem)) loaded = null
        reconcile()
    }
    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = reconcile()

    override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
        if (reason != Player.DISCONTINUITY_REASON_SEEK || !isSp(player.currentMediaItem)) return
        val id = idOf(player.currentMediaItem)
        if (id != loaded || !confirmed) return
        // перемотка, которую сделали мы сами при подстройке, повторно в Spotify не шлём
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
            if (confirmed) command { engine.resume() }
            return
        }
        if (!Spotify.loggedIn) {
            PlaybackEvents.emit("Чтобы играли треки Spotify, войди в Spotify в настройках")
            skip()
            return
        }
        loaded = id
        confirmed = false
        starting?.cancel()
        val from = player.currentPosition
        starting = scope.launch {
            try {
                lastCommand = SystemClock.elapsedRealtime()
                engine.playUris(listOf("spotify:track:$id"), from)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "play $id: ${e.message}")
                if (loaded != id) return@launch
                loaded = null
                PlaybackEvents.emit(e.message ?: "Spotify не включил трек")
                skip()
            }
        }
    }

    private fun tick() {
        val item = player.currentMediaItem
        if (!isSp(item)) return
        val id = idOf(item)!!
        if (loaded != id) return
        val snap = engine.playback.value
        val now = SystemClock.elapsedRealtime()
        if (snap != null && snap.isTrack(id)) {
            if (!confirmed && !snap.paused) confirmed = true
            if (!confirmed) return
            if (!snap.paused && !player.playWhenReady) {
                // Spotify успел стартовать уже после паузы в Nyao
                if (now - lastCommand > 1000) command { engine.pause() }
            } else if (!snap.paused) {
                // Spotify — источник правды о позиции: держим ExoPlayer рядом
                val d = snap.positionAt(now) - player.currentPosition
                if (abs(d) > 1500) player.seekTo(snap.positionAt(now))
            } else if (snap.paused && player.playWhenReady && now - lastCommand > 2500) {
                // поставили на паузу из самого Spotify (часы, другое устройство)
                val nearEnd = snap.duration > 0 && snap.duration - snap.position < 1500
                if (!nearEnd) player.pause()
            }
        } else if (confirmed && player.playWhenReady && now - lastCommand > 4000) {
            // Spotify забрали на другое устройство или включили там другой трек
            loaded = null
            confirmed = false
            player.pause()
            PlaybackEvents.emit("Spotify играет на другом устройстве — поставил Nyao на паузу")
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
        skip()
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
