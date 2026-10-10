package org.nyao.music.data

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import java.util.concurrent.ConcurrentHashMap

/** Всё, что знает приложение о сервисах: один объект на процесс. */
object Repo {
    lateinit var prefs: Prefs
        private set
    lateinit var ya: YandexApi
        private set
    lateinit var yt: YtMusicApi
        private set
    lateinit var ytStreams: YtStreams
        private set
    lateinit var sc: ScApi
        private set
    lateinit var wave: WaveMixer
        private set
    lateinit var cloud: NyaoCloud
        private set

    enum class Mode { LIST, WAVE }

    /** Что сейчас играет: «Моя волна» (сама подгружает треки) или обычный список */
    val mode = MutableStateFlow(Mode.LIST)
    val queueLabel = MutableStateFlow("")

    private val tracks = ConcurrentHashMap<String, Track>()
    private val yaStreamCache = ConcurrentHashMap<String, Pair<String, Long>>()

    private val _accounts = MutableStateFlow<Map<String, Account?>>(mapOf(SOURCE_YA to null, SOURCE_YT to null, SOURCE_SC to null))
    val accounts: StateFlow<Map<String, Account?>> = _accounts

    private val _liked = MutableStateFlow<Set<String>>(emptySet())
    val liked: StateFlow<Set<String>> = _liked

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = Prefs(context.applicationContext)
        ya = YandexApi(prefs)
        yt = YtMusicApi(prefs)
        ytStreams = YtStreams(yt)
        sc = ScApi(prefs)
        cloud = NyaoCloud(prefs, context.applicationContext.filesDir)
        wave = WaveMixer(ya, yt, sc, prefs) { cloud.recentIds() }
    }

    fun track(id: String): Track? = tracks[id]

    /** Трек пришёл с другого устройства — запоминаем, чтобы плеер нашёл его по id */
    fun rememberTrack(t: Track) {
        tracks[t.id] = t
    }

    // ---------- Аккаунты ----------

    suspend fun refreshAccounts() {
        val a = if (ya.loggedIn) runCatching { ya.account() }.getOrElse { Account("Яндекс (токен не принят)") } else null
        val b = if (yt.loggedIn) runCatching { yt.account() }.getOrElse { Account("YouTube Music") } else null
        val c = if (sc.loggedIn) runCatching { sc.account() }.getOrElse { Account("SoundCloud (токен не принят)") } else null
        _accounts.value = mapOf(SOURCE_YA to a, SOURCE_YT to b, SOURCE_SC to c)
    }

    suspend fun setScToken(token: String?) {
        prefs.scToken = token?.trim()?.takeIf { it.isNotEmpty() }
        sc.reset()
        refreshAccounts()
    }

    suspend fun setYandexToken(token: String?) {
        prefs.yandexToken = token?.trim()?.takeIf { it.isNotEmpty() }
        ya.reset()
        refreshAccounts()
    }

    suspend fun setYtCookie(cookie: String?) {
        prefs.ytCookie = cookie?.trim()?.takeIf { it.isNotEmpty() }
        yt.reset()
        refreshAccounts()
    }

    // ---------- Данные ----------

    private fun remember(list: List<Track>): List<Track> {
        list.forEach { tracks[it.id] = it }
        return list
    }

    suspend fun home(): HomeData = coroutineScope {
        val a = async { if (ya.loggedIn) runCatching { ya.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val b = async { if (yt.loggedIn) runCatching { yt.home() }.getOrDefault(emptyList()) else emptyList() }
        val sections = b.await()
        sections.forEach { remember(it.tracks) }
        HomeData(a.await().take(10), sections.take(6))
    }

    suspend fun likedTracks(): List<Track> = coroutineScope {
        val a = async { if (ya.loggedIn) runCatching { ya.likedTracks() }.getOrDefault(emptyList()) else emptyList() }
        val b = async { if (yt.loggedIn) runCatching { yt.likedTracks() }.getOrDefault(emptyList()) else emptyList() }
        val c = async { if (sc.loggedIn) runCatching { sc.likedTracks() }.getOrDefault(emptyList()) else emptyList() }
        val all = alternateAll(a.await(), b.await(), c.await())
        _liked.value = _liked.value + all.map { it.id }
        remember(all)
    }

    suspend fun playlists(): List<Playlist> = coroutineScope {
        val a = async { if (ya.loggedIn) runCatching { ya.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val b = async { if (yt.loggedIn) runCatching { yt.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val c = async { if (sc.loggedIn) runCatching { sc.playlists() }.getOrDefault(emptyList()) else emptyList() }
        a.await() + b.await() + c.await()
    }

    suspend fun playlistTracks(id: String): List<Track> = remember(
        when {
            id.startsWith("ya:") -> ya.playlistTracks(id)
            id.startsWith("sc:") -> sc.playlistTracks(id)
            else -> yt.playlistTracks(id)
        },
    )

    suspend fun search(q: String): SearchResult = coroutineScope {
        // Поиск YouTube Music работает и без входа
        val a = async { if (ya.loggedIn) runCatching { ya.search(q) }.getOrDefault(emptyList()) else emptyList() }
        val b = async { runCatching { yt.search(q) }.getOrDefault(emptyList()) }
        val c = async { runCatching { sc.search(q) }.getOrDefault(emptyList()) }
        SearchResult(remember(a.await()), remember(b.await()), remember(c.await()))
    }

    suspend fun waveStart(): List<Track> = remember(wave.start())
    suspend fun waveMore(queueIds: List<String>): List<Track> = remember(wave.more(queueIds))

    suspend fun like(track: Track, on: Boolean) {
        when (track.source) {
            SOURCE_YA -> ya.like(track, on)
            SOURCE_SC -> try {
                sc.like(track.srcId, on)
                flushScLikes()
            } catch (e: Exception) {
                // защита SoundCloud не пустила — в Nyao лайк ставим сразу, в SoundCloud дошлём позже
                prefs.scPendingLikes = prefs.scPendingLikes.filterNot { it.startsWith("${track.srcId}:") }.toSet() + "${track.srcId}:${if (on) 1 else 0}"
                org.nyao.music.playback.PlaybackEvents.emit("SoundCloud пока не принял лайк — отправлю позже сам")
            }
            else -> yt.like(track.srcId, on)
        }
        _liked.value = if (on) _liked.value + track.id else _liked.value - track.id
        if (on && mode.value == Mode.WAVE) wave.feedback("like", track, 0)
    }

    /** Досылает отложенные лайки SoundCloud */
    suspend fun flushScLikes() {
        if (!sc.loggedIn) return
        val list = prefs.scPendingLikes
        if (list.isEmpty()) return
        val left = LinkedHashSet<String>()
        for (item in list) {
            val (id, on) = item.split(":").let { it[0] to (it.getOrNull(1) == "1") }
            try {
                sc.like(id, on)
            } catch (_: Exception) {
                left += item
            }
        }
        prefs.scPendingLikes = left
        val sent = list.size - left.size
        if (sent > 0) org.nyao.music.playback.PlaybackEvents.emit("SoundCloud: отложенные лайки доставлены ($sent)")
    }

    // ---------- Воспроизведение ----------

    fun mediaItem(t: Track): MediaItem {
        tracks[t.id] = t
        val meta = MediaMetadata.Builder()
            .setTitle(t.title)
            .setArtist(t.artist)
            .setAlbumTitle(t.album)
            .setArtworkUri(t.cover?.let { Uri.parse(it) })
            .setIsPlayable(true)
            .build()
        return MediaItem.Builder()
            .setMediaId(t.id)
            .setUri("nyao://${t.source}/${Uri.encode(t.srcId)}")
            .setMediaMetadata(meta)
            // SoundCloud играет через HLS: тип нужно знать заранее, до получения ссылки
            .apply { if (t.source == SOURCE_SC) setMimeType(MimeTypes.APPLICATION_M3U8) }
            .build()
    }

    /** Пересобирает MediaItem по id (контроллер передаёт в сервис элементы без ссылки) */
    fun mediaItemById(id: String): MediaItem? = tracks[id]?.let { mediaItem(it) }

    data class Resolved(val url: String, val userAgent: String?, val contentLength: Long)

    /** nyao://ya/123 или nyao://yt/videoId → настоящая ссылка. Блокирующий: зовётся из потока загрузки. */
    fun resolve(uri: Uri): Resolved {
        val source = uri.host ?: throw ApiException("Плохая ссылка $uri")
        val id = uri.pathSegments.firstOrNull() ?: throw ApiException("Плохая ссылка $uri")
        return if (source == SOURCE_YA) {
            val cached = yaStreamCache[id]
            val url = if (cached != null && cached.second > System.currentTimeMillis()) cached.first
            else runBlocking { ya.streamUrl(id) }.also { yaStreamCache[id] = it to System.currentTimeMillis() + 50 * 60_000L }
            Resolved(url, null, -1)
        } else if (source == SOURCE_SC) {
            Resolved(sc.hlsUrl(id), ScApi.UA, -1)
        } else {
            val s = ytStreams.resolve(id)
            Resolved(s.url, s.userAgent, s.contentLength)
        }
    }

    fun forgetStream(uri: Uri) {
        val id = uri.pathSegments.firstOrNull() ?: return
        when (uri.host) {
            SOURCE_YA -> yaStreamCache.remove(id)
            SOURCE_SC -> Unit
            else -> ytStreams.invalidate(id)
        }
    }
}
