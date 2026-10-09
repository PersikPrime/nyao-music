package org.nyao.music.playback

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.nyao.music.MainActivity
import org.nyao.music.R
import org.nyao.music.data.Repo

/** Сообщения от плеера для интерфейса (ошибки потока и т. п.) */
object PlaybackEvents {
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages
    fun emit(msg: String) {
        _messages.tryEmit(msg)
    }
}

/**
 * Фоновое воспроизведение: ExoPlayer + MediaSession (уведомление, шторка, гарнитура, Android Auto-кнопки).
 * В режиме «Моя волна» сервис сам догружает треки, даже когда приложение закрыто.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {

    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private var loadingMore = false
    private var lastId: String? = null
    private var lastPos = 0L
    private var retries = 0
    private var errorsInRow = 0

    override fun onCreate() {
        super.onCreate()
        Repo.init(this)

        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15_000)
            .setReadTimeoutMs(30_000)
        val chunked = DataSource.Factory { ChunkedDataSource(http.createDataSource()) }
        val resolving = ResolvingDataSource.Factory(chunked) { spec -> resolve(spec) }
        // Кэш сверху: если трек уже на диске, ссылка у сервиса даже не запрашивается
        val cached = CacheDataSource.Factory()
            .setCache(PlaybackCache.get(this))
            .setUpstreamDataSourceFactory(resolving)
            .setCacheKeyFactory { spec -> spec.uri.toString() }
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(cached))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(listener)

        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaSession.Builder(this, player)
            .setCallback(callback)
            .setSessionActivity(open)
            .build()

        val notifications = DefaultMediaNotificationProvider.Builder(this).build()
        notifications.setSmallIcon(R.drawable.ic_notification)
        setMediaNotificationProvider(notifications)

        scope.launch {
            while (isActive) {
                if (player.isPlaying) lastPos = player.currentPosition
                delay(1000)
            }
        }
    }

    /** nyao://… → настоящая ссылка сервиса + нужный User-Agent */
    private fun resolve(spec: DataSpec): DataSpec {
        if (spec.uri.scheme != "nyao") return spec
        val r = Repo.resolve(spec.uri)
        val headers = HashMap(spec.httpRequestHeaders)
        r.userAgent?.let { headers["User-Agent"] = it }
        return spec.buildUpon().setUri(Uri.parse(r.url)).setHttpRequestHeaders(headers).build()
    }

    private val callback = object : MediaSession.Callback {
        // Контроллер передаёт в сервис элементы без ссылки — собираем их заново по id трека
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> =
            Futures.immediateFuture(mediaItems.map { Repo.mediaItemById(it.mediaId) ?: it }.toMutableList())
    }

    private val listener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val prev = lastId?.let { Repo.track(it) }
            val wave = Repo.mode.value == Repo.Mode.WAVE
            if (wave && prev != null && prev.id != mediaItem?.mediaId) {
                val played = (lastPos / 1000).toInt()
                val type = if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) "trackFinished" else "skip"
                scope.launch(Dispatchers.IO) { Repo.wave.feedback(type, prev, played) }
            }
            lastId = mediaItem?.mediaId
            lastPos = 0
            retries = 0
            val cur = mediaItem?.mediaId?.let { Repo.track(it) }
            if (wave && cur != null) scope.launch(Dispatchers.IO) { Repo.wave.feedback("trackStarted", cur, 0) }
            maybeMore()
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_READY) errorsInRow = 0
            if (playbackState == Player.STATE_ENDED) maybeMore()
        }

        override fun onPlayerError(error: PlaybackException) = handleError(error)
    }

    private fun maybeMore() {
        if (Repo.mode.value != Repo.Mode.WAVE || loadingMore) return
        val left = player.mediaItemCount - player.currentMediaItemIndex - 1
        if (left > 2) return
        loadingMore = true
        scope.launch {
            try {
                val ids = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
                val more = withContext(Dispatchers.IO) { Repo.waveMore(ids) }
                if (Repo.mode.value == Repo.Mode.WAVE && more.isNotEmpty()) {
                    val wasEnded = player.playbackState == Player.STATE_ENDED
                    player.addMediaItems(more.map { Repo.mediaItem(it) })
                    if (wasEnded) {
                        player.seekToNextMediaItem()
                        player.prepare()
                        player.play()
                    }
                }
            } catch (e: Exception) {
                Log.w("Nyao", "волна: ${e.message}")
                PlaybackEvents.emit(e.message ?: "Не удалось догрузить волну")
            } finally {
                loadingMore = false
            }
        }
    }

    private fun handleError(error: PlaybackException) {
        val item = player.currentMediaItem ?: return
        val uri = item.localConfiguration?.uri
        val http = generateSequence(error.cause) { it.cause }
            .filterIsInstance<HttpDataSource.InvalidResponseCodeException>()
            .firstOrNull()
        Log.w("Nyao", "ошибка ${item.mediaId}: ${error.errorCodeName} ${http?.responseCode ?: ""} ${error.cause?.message}")
        if (uri != null && http != null) Repo.forgetStream(uri)
        // 403 от googlevideo — берём ссылку у другого клиента и продолжаем с того же места
        if (http != null && (http.responseCode == 403 || http.responseCode == 410) && retries < 3) {
            retries++
            val pos = player.currentPosition
            player.prepare()
            player.seekTo(pos)
            player.play()
            return
        }
        errorsInRow++
        val track = Repo.track(item.mediaId)
        val reason = generateSequence<Throwable>(error) { it.cause }.mapNotNull { it.message }.lastOrNull() ?: error.errorCodeName
        PlaybackEvents.emit("Не играет «${track?.title ?: item.mediaId}»: $reason")
        if (errorsInRow >= 3) {
            PlaybackEvents.emit("Три трека подряд не загрузились — остановил воспроизведение")
            errorsInRow = 0
            return
        }
        if (player.hasNextMediaItem()) {
            player.seekToNextMediaItem()
            player.prepare()
            player.play()
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = session?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}
