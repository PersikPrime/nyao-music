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

    private val equalizer = NyaoEqualizer()
    // выравнивание громкости и плавные переходы: итоговая громкость плеера = norm × fade
    private var normVol = 1f
    private var fadeVol = 1f
    private var enhancer: android.media.audiofx.LoudnessEnhancer? = null
    private var enhancerSession = 0
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
        // Скачанное (без автоудаления) — самым верхним слоем, только чтение: такие треки играют без сети
        val offline = CacheDataSource.Factory()
            .setCache(Offline.cache(this))
            .setUpstreamDataSourceFactory(cached)
            .setCacheKeyFactory { spec -> spec.uri.toString() }
            .setCacheWriteDataSinkFactory(null)
            .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR)
        val routed = DataSource.Factory { RoutingDataSource(offline.createDataSource(), resolving.createDataSource()) }

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(routed))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(listener)
        // плавные переходы: каждые 200 мс считаем, насколько приглушить начало и конец трека
        scope.launch {
            while (isActive) {
                val fade = Repo.prefs.settings.value.fade
                val f = if (fade <= 0 || !player.isPlaying) 1f else {
                    val pos = player.currentPosition
                    val dur = player.duration
                    val inMs = minOf(2000L, fade * 1000L)
                    val fin = (pos.toFloat() / inMs).coerceIn(0f, 1f)
                    val fout = if (dur > 0 && player.repeatMode != Player.REPEAT_MODE_ONE) ((dur - pos).toFloat() / (fade * 1000L)).coerceIn(0f, 1f) else 1f
                    minOf(fin, fout)
                }
                if (f != fadeVol) {
                    fadeVol = f
                    applyVolume()
                }
                delay(200)
            }
        }
        // выравнивание громкости — при смене настройки
        scope.launch { Repo.prefs.settings.collect { applyNorm() } }
        // эквалайзер из настроек: следим за изменениями и за сменой звуковой сессии
        scope.launch {
            Repo.prefs.settings.collect { s -> equalizer.attach(player.audioSessionId, s.eqOn, s.eqGains) }
        }

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
            applyNorm()
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
            if (playbackState == Player.STATE_READY) {
                errorsInRow = 0
                applyNorm() // громкость YouTube известна только после получения ссылки
            }
            if (playbackState == Player.STATE_ENDED) maybeMore()
        }

        override fun onPlayerError(error: PlaybackException) = handleError(error)

        override fun onAudioSessionIdChanged(audioSessionId: Int) {
            val s = Repo.prefs.settings.value
            equalizer.attach(audioSessionId, s.eqOn, s.eqGains)
        }
    }

    private fun applyVolume() {
        player.volume = (normVol * fadeVol).coerceIn(0f, 1f)
    }

    /**
     * Выравнивание громкости: Яндекс даёт громкость трека в LUFS, YouTube — насколько трек громче своего эталона.
     * Цель -14 LUFS. Тише — громкостью плеера, громче (до +6 дБ) — системным LoudnessEnhancer.
     */
    private fun applyNorm() {
        val t = player.currentMediaItem?.mediaId?.let { Repo.track(it) }
        val db = if (!Repo.prefs.settings.value.normalize || t == null) 0.0 else {
            val raw = t.loud?.let { -14 - it } ?: if (t.source == org.nyao.music.data.SOURCE_YT) Repo.ytStreams.loudness(t.srcId)?.let { -it } else null
            (raw ?: 0.0).coerceIn(-12.0, 6.0)
        }
        normVol = if (db < 0) Math.pow(10.0, db / 20).toFloat() else 1f
        runCatching {
            val session = player.audioSessionId
            if (session != 0 && session != enhancerSession) {
                enhancer?.release()
                enhancer = android.media.audiofx.LoudnessEnhancer(session)
                enhancerSession = session
            }
            enhancer?.setTargetGain(if (db > 0) (db * 100).toInt() else 0)
            enhancer?.enabled = db > 0
        }
        applyVolume()
    }

    private fun maybeMore() {
        if ((Repo.mode.value != Repo.Mode.WAVE && Repo.mode.value != Repo.Mode.RADIO) || loadingMore) return
        val left = player.mediaItemCount - player.currentMediaItemIndex - 1
        if (left > 2) return
        loadingMore = true
        scope.launch {
            try {
                val ids = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
                val radio = Repo.mode.value == Repo.Mode.RADIO
                val more = withContext(Dispatchers.IO) { if (radio) Repo.radioMore(ids) else Repo.waveMore(ids) }
                if ((Repo.mode.value == Repo.Mode.WAVE || Repo.mode.value == Repo.Mode.RADIO) && more.isNotEmpty()) {
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
        val api = generateSequence<Throwable>(error) { it.cause }.filterIsInstance<org.nyao.music.data.ApiException>().firstOrNull()
        val code = http?.responseCode ?: api?.code ?: 0
        if (uri != null && (http != null || api != null)) Repo.forgetStream(uri)
        // 403 от googlevideo — берём ссылку у другого клиента; 404 от SoundCloud — берём трек заново.
        // Продолжаем с того же места.
        if ((code == 403 || code == 410 || code == 404) && retries < 4) {
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
        equalizer.release()
        runCatching { enhancer?.release() }
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}
