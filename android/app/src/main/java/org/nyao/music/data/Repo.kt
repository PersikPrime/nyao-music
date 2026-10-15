package org.nyao.music.data

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
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
    lateinit var vk: VkApi
        private set
    lateinit var wave: WaveMixer
        private set
    lateinit var cloud: NyaoCloud
        private set
    lateinit var mixStore: MixStore
        private set
    lateinit var lastfm: LastFm
        private set
    lateinit var radio: Radio
        private set
    private val bg = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.IO)

    enum class Mode { LIST, WAVE, RADIO }

    /** Что сейчас играет: «Моя волна» (сама подгружает треки) или обычный список */
    val mode = MutableStateFlow(Mode.LIST)
    val queueLabel = MutableStateFlow("")

    private val tracks = ConcurrentHashMap<String, Track>()
    private val yaStreamCache = ConcurrentHashMap<String, Pair<String, Long>>()

    private val _accounts = MutableStateFlow<Map<String, Account?>>(mapOf(SOURCE_YA to null, SOURCE_YT to null, SOURCE_SC to null, SOURCE_VK to null))
    val accounts: StateFlow<Map<String, Account?>> = _accounts

    /** Техработы и сбои сервисов — опрашивается раз в 2 минуты из NyaoRoot */
    val status = MutableStateFlow(SvcStatus())
    fun up(source: String) = source !in status.value.outages

    suspend fun refreshStatus(): SvcStatus? {
        val s = runCatching { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cloud.status() } }.getOrNull() ?: return null
        status.value = s
        return s
    }

    private val _liked = MutableStateFlow<Set<String>>(emptySet())
    val liked: StateFlow<Set<String>> = _liked

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = Prefs(context.applicationContext)
        ya = YandexApi(prefs)
        yt = YtMusicApi(prefs)
        ytStreams = YtStreams(yt)
        sc = ScApi(prefs)
        vk = VkApi(prefs)
        cloud = NyaoCloud(prefs, context.applicationContext.filesDir)
        mixStore = MixStore(context.applicationContext.filesDir)
        lastfm = LastFm(prefs, context.applicationContext.filesDir)
        org.nyao.music.playback.Offline.init(context)
        // изменения настроек волны, вида и миксов уезжают на другие устройства
        prefs.onSyncChange = { key -> bg.launch { runCatching { cloud.pushState(key, stateData(key)) } } }
        mixStore.onChange = { bg.launch { runCatching { cloud.pushState("mixes", mixStore.toJson()) } } }
        radio = Radio(ya, yt, sc, vk) { !up(it) }
        wave = WaveMixer(ya, yt, sc, vk, prefs, recentProvider = { cloud.recentIds() }, isDown = { !up(it) })
    }

    fun track(id: String): Track? = tracks[id]

    // ---------- Синхронизация через аккаунт Nyao (тот же формат, что у десктопа) ----------

    private fun stateData(key: String): Any {
        val s = prefs.settings.value
        return when (key) {
            "wave" -> org.json.JSONObject().put("ytmShare", s.ytmShare).put("waveDiversity", s.diversity).put("waveMood", s.mood ?: org.json.JSONObject.NULL)
            "prefs" -> org.json.JSONObject().put("layout", s.layout ?: org.json.JSONObject.NULL).put("splitLiked", s.splitLiked).put("waveTab", s.waveTab)
            else -> mixStore.toJson()
        }
    }

    /** Сверка с сервером: настройки волны, вид приложения и миксы. Возвращает поменявшиеся ключи */
    suspend fun syncCloud(): List<String> {
        if (!cloud.loggedIn) return emptyList()
        runCatching { cloud.flush() }
        val handlers = mapOf(
            "wave" to NyaoCloud.StateHandler({ stateData("wave") }, { d ->
                val o = d as? org.json.JSONObject ?: return@StateHandler
                prefs.update {
                    if (o.has("ytmShare")) putInt("ytmShare", o.optInt("ytmShare", 30).coerceIn(0, 100))
                    o.str("waveDiversity")?.let { putString("diversity", it) }
                    if (o.has("waveMood")) { val m = o.str("waveMood"); if (m == null) remove("mood") else putString("mood", m) }
                }
            }),
            "prefs" to NyaoCloud.StateHandler({ stateData("prefs") }, { d ->
                val o = d as? org.json.JSONObject ?: return@StateHandler
                prefs.update {
                    o.str("layout")?.let { putString("layout", if (it == "wave") "wave" else "player") }
                    if (o.has("splitLiked")) putBoolean("splitLiked", o.optBoolean("splitLiked"))
                    if (o.has("waveTab")) putBoolean("waveTab", o.optBoolean("waveTab"))
                }
            }),
            "mixes" to NyaoCloud.StateHandler(
                { mixStore.toJson() },
                { d -> (d as? org.json.JSONArray)?.let { mixStore.set(mixStore.fromJson(it), push = false) } },
                { local, remote ->
                    val l = (local as? org.json.JSONArray)?.let { mixStore.fromJson(it) } ?: emptyList()
                    val r = (remote as? org.json.JSONArray)?.let { mixStore.fromJson(it) } ?: emptyList()
                    mixStore.toJson(mixStore.merge(l, r))
                },
            ),
        )
        return cloud.syncState(handlers)
    }

    /** Трек пришёл с другого устройства — запоминаем, чтобы плеер нашёл его по id */
    fun rememberTrack(t: Track) {
        tracks[t.id] = t
    }

    // ---------- Аккаунты ----------

    suspend fun refreshAccounts() {
        val a = if (ya.loggedIn) runCatching { ya.account() }.getOrElse { Account("Яндекс (токен не принят)") } else null
        val b = if (yt.loggedIn) runCatching { yt.account() }.getOrElse { Account("YouTube Music") } else null
        val c = if (sc.loggedIn) runCatching { sc.account() }.getOrElse { Account("SoundCloud (токен не принят)") } else null
        val d = if (vk.loggedIn) vk.account() else null
        _accounts.value = mapOf(SOURCE_YA to a, SOURCE_YT to b, SOURCE_SC to c, SOURCE_VK to d)
    }

    /** Удаляет cookie только указанных сайтов (выход из одного сервиса не выкидывает из остальных) */
    fun clearCookies(vararg urls: String) = runCatching {
        android.webkit.CookieManager.getInstance().apply {
            urls.forEach { u ->
                getCookie(u)?.split(";")?.map { it.substringBefore("=").trim() }?.filter { it.isNotEmpty() }?.forEach { name ->
                    setCookie(u, "$name=; Max-Age=0")
                    setCookie(u, "$name=; Max-Age=0; Domain=" + Uri.parse(u).host?.split(".")?.takeLast(2)?.joinToString(".", prefix = "."))
                }
            }
            flush()
        }
    }

    /** Вход во VK: uid и адрес сайта из окна входа (cookie сессии уже в WebView). null — выход */
    suspend fun setVk(uid: Long?, origin: String?) {
        prefs.vkUid = uid
        prefs.vkOrigin = origin
        vk.reset()
        if (uid == null) clearCookies("https://vk.com", "https://vk.ru", "https://m.vk.com", "https://login.vk.com", "https://id.vk.com", "https://login.vk.ru", "https://id.vk.ru")
        refreshAccounts()
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
        val d = async { if (vk.loggedIn) runCatching { vk.likedTracks() }.getOrDefault(emptyList()) else emptyList() }
        val all = alternateAll(a.await(), b.await(), c.await(), d.await())
        _liked.value = _liked.value + all.map { it.id }
        remember(all)
    }

    suspend fun playlists(): List<Playlist> = coroutineScope {
        val a = async { if (ya.loggedIn) runCatching { ya.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val b = async { if (yt.loggedIn) runCatching { yt.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val c = async { if (sc.loggedIn) runCatching { sc.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val d = async { if (vk.loggedIn) runCatching { vk.playlists() }.getOrDefault(emptyList()) else emptyList() }
        listOfNotNull(org.nyao.music.playback.Offline.asPlaylist()) + a.await() + b.await() + c.await() + d.await()
    }

    suspend fun playlistTracks(id: String): List<Track> = remember(
        when {
            // «Мне нравится» одного сервиса и свои миксы
            id == org.nyao.music.playback.Offline.PLAYLIST_ID -> org.nyao.music.playback.Offline.state.value.tracks
            id == "liked" -> likedTracks()
            id.startsWith("liked:") -> likedTracks().filter { it.source == id.removePrefix("liked:") }
            id.startsWith("mix:") -> mixStore.get(id)?.tracks ?: emptyList()
            id.startsWith("ya:") -> ya.playlistTracks(id)
            id.startsWith("sc:") -> sc.playlistTracks(id)
            id.startsWith("vk:") -> vk.playlistTracks(id)
            else -> yt.playlistTracks(id)
        },
    )

    suspend fun search(q: String): SearchResult = coroutineScope {
        // Поиск YouTube Music работает и без входа
        val a = async { if (ya.loggedIn && up(SOURCE_YA)) runCatching { ya.search(q) }.getOrDefault(emptyList()) else emptyList() }
        val b = async { if (up(SOURCE_YT)) runCatching { yt.search(q) }.getOrDefault(emptyList()) else emptyList() }
        val c = async { if (up(SOURCE_SC)) runCatching { sc.search(q) }.getOrDefault(emptyList()) else emptyList() }
        val d = async { if (vk.loggedIn && up(SOURCE_VK)) runCatching { vk.search(q) }.getOrDefault(emptyList()) else emptyList() }
        SearchResult(remember(a.await()), remember(b.await()), remember(c.await()), remember(d.await()))
    }

    suspend fun radioStart(t: Track): List<Track> = remember(radio.start(t))
    suspend fun radioMore(queueIds: List<String>): List<Track> = remember(radio.more(queueIds))
    suspend fun waveStart(): List<Track> = remember(wave.start())
    suspend fun waveMore(queueIds: List<String>): List<Track> = remember(wave.more(queueIds))

    suspend fun like(track: Track, on: Boolean) {
        when (track.source) {
            SOURCE_YA -> ya.like(track, on)
            SOURCE_VK -> vk.like(track, on)
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
            // VK тоже отдаёт HLS (.m3u8, куски с AES-128 — ExoPlayer расшифровывает сам)
            .apply { if (t.source == SOURCE_SC || t.source == SOURCE_VK) setMimeType(MimeTypes.APPLICATION_M3U8) }
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
        } else if (source == SOURCE_VK) {
            Resolved(vk.streamUrl(id), VkApi.UA, -1)
        } else {
            val s = ytStreams.resolve(id)
            Resolved(s.url, s.userAgent, s.contentLength)
        }
    }

    fun forgetStream(uri: Uri) {
        val id = uri.pathSegments.firstOrNull() ?: return
        when (uri.host) {
            SOURCE_YA -> yaStreamCache.remove(id)
            SOURCE_SC -> sc.forget(id)
            SOURCE_VK -> vk.forget(id)
            else -> ytStreams.invalidate(id)
        }
    }
}
