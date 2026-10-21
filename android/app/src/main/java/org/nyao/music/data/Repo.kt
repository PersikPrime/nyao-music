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
    /** Сколько поиск и библиотека ждут Spotify: дольше — показываем остальные сервисы без него */
    private const val SP_WAIT = 6_000L
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
    /** Трек из поиска в режиме «дальше похожее»: продолжить радио, даже если общая настройка выключена */
    @Volatile var forceContinue = false

    private val tracks = ConcurrentHashMap<String, Track>()
    private val yaStreamCache = ConcurrentHashMap<String, Pair<String, Long>>()

    // ---------- Spotify без Premium: тот же трек из другого сервиса ----------
    private val _substitutes = MutableStateFlow<Map<String, Track>>(emptyMap())
    /** id трека Spotify → найденная копия, которая играет вместо него (для значка «SP → Я») */
    val substitutes: StateFlow<Map<String, Track>> = _substitutes

    /** Может ли Spotify сейчас играть сам: вход, Premium (если известен), регион, рабочий плеер */
    fun spotifyPlayable(): Boolean =
        sp.loggedIn && !sp.regionBlocked && org.nyao.music.spotify.Spotify.blocked == null && _accounts.value[SOURCE_SP]?.plus != false

    /** Копия трека Spotify в Яндексе или YouTube Music (там поток обычный, без HLS) */
    private fun substituteFor(spId: String): Track {
        _substitutes.value["$SOURCE_SP:$spId"]?.let { return it }
        val t = tracks["$SOURCE_SP:$spId"] ?: throw ApiException("Нет данных о треке Spotify", 404)
        val found = runBlocking {
            listOf(SOURCE_YA, SOURCE_YT).filter { usable(it) }.firstNotNullOfOrNull { s ->
                runCatching { Match.find(t) { q -> searchIn(s, q) } }.getOrNull()
            }
        } ?: throw ApiException("Не нашёл «${t.title}» в Яндексе и YouTube Music — без Premium Spotify сам не играет", 404)
        tracks[found.id] = found
        _substitutes.value = _substitutes.value + (t.id to found)
        return found
    }

    private val _accounts = MutableStateFlow<Map<String, Account?>>(mapOf(SOURCE_YA to null, SOURCE_YT to null, SOURCE_SC to null, SOURCE_VK to null, SOURCE_SP to null))
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
        org.nyao.music.spotify.Spotify.init(context.applicationContext)
        ya = YandexApi(prefs)
        yt = YtMusicApi(prefs, context.applicationContext.filesDir)
        ytStreams = YtStreams(yt)
        sc = ScApi(prefs).also { api -> api.onAccount = { uid, verifiedToken ->
            verifiedToken?.let { token ->
                val key = java.security.MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).hex()
                scLikes.rebind(key, "uid:$uid")
                prefs.scIdentity = "$key|$uid"
            }
        } }
        vk = VkApi(prefs).also { it.appContext = context.applicationContext }
        // сессия vk.com живёт, пока сайт сам обновляет cookie — продлеваем её тихо раз в 12 часов
        if (vk.loggedIn && System.currentTimeMillis() - prefs.vkRefreshedAt > 12 * 3600_000L) {
            bg.launch { runCatching { vk.refreshSession() } }
        }
        cloud = NyaoCloud(prefs, context.applicationContext.filesDir)
        mixStore = MixStore(context.applicationContext.filesDir)
        lastfm = LastFm(prefs, context.applicationContext.filesDir)
        org.nyao.music.playback.Offline.init(context)
        // изменения настроек волны, вида и миксов уезжают на другие устройства
        prefs.onSyncChange = { key -> bg.launch { runCatching { cloud.pushState(key, stateData(key)) } } }
        mixStore.onChange = { bg.launch { runCatching { cloud.pushState("mixes", mixStore.toJson()) } } }
        radio = Radio(ya, yt, sc, vk) { !up(it) }
        _favArtists.value = FavArtist.listFromJson(runCatching { org.json.JSONArray(prefs.favArtists) }.getOrNull())
        wave = WaveMixer(ya, yt, sc, vk, prefs, recentProvider = { cloud.recentIds() }, isDown = { !up(it) }, favorites = { _favArtists.value }, sp = sp, historyProvider = { cloud.waveHistory() })
    }

    fun track(id: String): Track? = tracks[id]

    // ---------- Любимые исполнители ----------

    private val _favArtists = MutableStateFlow<List<FavArtist>>(emptyList())
    val favArtists: StateFlow<List<FavArtist>> = _favArtists

    private fun saveFav(list: List<FavArtist>, push: Boolean = true) {
        _favArtists.value = list
        prefs.favArtists = FavArtist.listToJson(list).toString()
        if (push && cloud.loggedIn) bg.launch { runCatching { cloud.pushState("artists", FavArtist.listToJson(list)) } }
    }

    fun isFavArtist(source: String, id: String?): Boolean = _favArtists.value.any { it.matches(source, id) }

    /** Сердечко на странице исполнителя. В Яндексе — ещё и «Мои исполнители» */
    suspend fun likeArtist(source: String, id: String?, name: String, cover: String?, on: Boolean) {
        if (id.isNullOrBlank()) throw ApiException("У этого исполнителя нет ссылки в сервисе")
        val ref = "$source:$id"
        var list = _favArtists.value.filterNot { it.matches(source, id) }
        if (on) list = listOf(FavArtist(ref, ref.takeIf { source == SOURCE_YA }, ref.takeIf { source == SOURCE_YT }, name, cover, System.currentTimeMillis())) + list
        saveFav(list)
        if (source == SOURCE_YA && ya.loggedIn) bg.launch { runCatching { ya.likeArtist(id, on) } }
    }

    /** Один раз подтягиваем «Моих исполнителей» из Яндекса */
    suspend fun importYaArtists() {
        if (!ya.loggedIn || prefs.favImportedYa) return
        runCatching { ya.likedArtists() }.onSuccess { l ->
            val cur = _favArtists.value
            val add = l.filter { a -> cur.none { it.ref == a.ref || it.refYa == a.ref } }
            if (add.isNotEmpty()) saveFav(FavArtist.merge(cur, add))
            prefs.favImportedYa = true
        }
    }

    /** Все треки, которые приложение уже видело (медиатека, ленты, очередь) — для мгновенного поиска */
    fun knownTracks(): Collection<Track> = tracks.values

    // ---------- Синхронизация через аккаунт Nyao (тот же формат, что у десктопа) ----------

    private fun stateData(key: String): Any {
        val s = prefs.settings.value
        return when (key) {
            "wave" -> org.json.JSONObject().put("ytmShare", s.ytmShare).put("waveDiversity", s.diversity).put("waveMood", s.mood ?: org.json.JSONObject.NULL).put("waveFresh", s.waveFresh)
            "prefs" -> org.json.JSONObject().put("layout", s.layout ?: org.json.JSONObject.NULL).put("splitLiked", s.splitLiked).put("waveTab", s.waveTab)
            else -> mixStore.toJson()
        }
    }

    @Volatile private var spRecentAt = 0L

    /**
     * «Недавно прослушанное» Spotify (что слушал в самом Spotify, не в Nyao) → в итоги Nyao. Раз в 30 минут.
     * Свои прослушивания к этому моменту уже отправлены (flush), поэтому сервер их не задвоит
     */
    private suspend fun importSpotifyRecent() {
        if (!sp.loggedIn || sp.regionBlocked || System.currentTimeMillis() - spRecentAt < 30 * 60_000L) return
        spRecentAt = System.currentTimeMillis()
        val after = maxOf(prefs.spRecentAfter, System.currentTimeMillis() - 14 * 86_400_000L)
        val items = try {
            sp.recentlyPlayed(after)
        } catch (e: org.nyao.music.spotify.SpotifyException) {
            // вход до этой версии — без разрешения на историю; заработает после повторного входа в Spotify
            if (e.code == 401 || e.code == 403) return else throw e
        }
        if (items.isEmpty()) return
        cloud.importPlays(items)
        prefs.spRecentAfter = items.maxOf { it.second }
    }

    /** Сверка с сервером: настройки волны, вид приложения и миксы. Возвращает поменявшиеся ключи */
    suspend fun syncCloud(): List<String> {
        if (!cloud.loggedIn) return emptyList()
        runCatching { cloud.flush() }
        runCatching { importSpotifyRecent() }
        val handlers = mapOf(
            "wave" to NyaoCloud.StateHandler({ stateData("wave") }, { d ->
                val o = d as? org.json.JSONObject ?: return@StateHandler
                prefs.update {
                    if (o.has("ytmShare")) putInt("ytmShare", o.optInt("ytmShare", 30).coerceIn(0, 100))
                    o.str("waveDiversity")?.let { putString("diversity", it) }
                    if (o.has("waveMood")) { val m = o.str("waveMood"); if (m == null) remove("mood") else putString("mood", m) }
                    if (o.has("waveFresh")) putInt("waveFresh", o.optInt("waveFresh", 60).coerceIn(0, 100))
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
            "artists" to NyaoCloud.StateHandler(
                { FavArtist.listToJson(_favArtists.value) },
                { d -> (d as? org.json.JSONArray)?.let { saveFav(FavArtist.listFromJson(it), push = false) } },
                { local, remote -> FavArtist.listToJson(FavArtist.merge(FavArtist.listFromJson(local as? org.json.JSONArray), FavArtist.listFromJson(remote as? org.json.JSONArray))) },
            ),
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
        val e = if (sp.loggedIn) runCatching { sp.account() }.getOrElse { Account(if (sp.regionBlocked) "Spotify (нужен VPN)" else "Spotify (вход не принят)") } else null
        _accounts.value = mapOf(SOURCE_YA to a, SOURCE_YT to b, SOURCE_SC to c, SOURCE_VK to d, SOURCE_SP to e)
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

    /** Spotify через Web API (данные) — сам вход и плеер живут в [org.nyao.music.spotify.Spotify] */
    val sp: org.nyao.music.spotify.SpotifyApi get() = org.nyao.music.spotify.Spotify.api

    suspend fun spotifyLogout() {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) { org.nyao.music.spotify.Spotify.engine.release() }
        org.nyao.music.spotify.Spotify.auth.logout()
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

    private var releasesCache: Pair<Long, List<Playlist>>? = null

    /** Новые релизы любимых исполнителей (только Яндекс). Кэш на 6 часов */
    suspend fun newReleases(force: Boolean = false): List<Playlist> {
        if (!ya.loggedIn || up(SOURCE_YA).not()) return releasesCache?.second ?: emptyList()
        releasesCache?.let { (at, list) -> if (!force && System.currentTimeMillis() - at < 6 * 3600_000L) return list }
        val list = runCatching { ya.newReleases() }.getOrNull() ?: return releasesCache?.second ?: emptyList()
        releasesCache = System.currentTimeMillis() to list
        return list
    }

    suspend fun likedTracks(): List<Track> = coroutineScope {
        val a = async { if (ya.loggedIn) runCatching { ya.likedTracks() }.getOrDefault(emptyList()) else emptyList() }
        val b = async { if (yt.loggedIn) runCatching { yt.likedTracks() }.getOrDefault(emptyList()) else emptyList() }
        val c = async { if (sc.loggedIn) runCatching { sc.likedTracks() }.getOrDefault(emptyList()) else emptyList() }
        val d = async { if (vk.loggedIn) runCatching { vk.likedTracks() }.getOrDefault(emptyList()) else emptyList() }
        val e = async { if (sp.loggedIn && !sp.regionBlocked) (kotlinx.coroutines.withTimeoutOrNull(SP_WAIT) { runCatching { sp.likedTracks() }.getOrDefault(emptyList()) } ?: emptyList()) else emptyList() }
        val all = alternateAll(a.await(), b.await(), c.await(), d.await(), e.await())
        _liked.value = _liked.value + all.map { it.id }
        remember(all)
    }

    suspend fun playlists(): List<Playlist> = coroutineScope {
        val a = async { if (ya.loggedIn) runCatching { ya.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val b = async { if (yt.loggedIn) runCatching { yt.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val c = async { if (sc.loggedIn) runCatching { sc.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val d = async { if (vk.loggedIn) runCatching { vk.playlists() }.getOrDefault(emptyList()) else emptyList() }
        val e = async { if (sp.loggedIn && !sp.regionBlocked) (kotlinx.coroutines.withTimeoutOrNull(SP_WAIT) { runCatching { sp.playlists() }.getOrDefault(emptyList()) } ?: emptyList()) else emptyList() }
        listOfNotNull(org.nyao.music.playback.Offline.asPlaylist()) + a.await() + b.await() + c.await() + d.await() + e.await()
    }

    suspend fun playlistTracks(id: String): List<Track> = remember(
        when {
            // «Мне нравится» одного сервиса и свои миксы
            id == org.nyao.music.playback.Offline.PLAYLIST_ID -> org.nyao.music.playback.Offline.state.value.tracks
            id == "liked" -> likedTracks()
            id.startsWith("liked:") -> likedTracks().filter { it.source == id.removePrefix("liked:") }
            id.startsWith("mix:") -> mixStore.get(id)?.tracks ?: emptyList()
            id.startsWith("yaalbum:") -> ya.albumTracks(id)
            id.startsWith("artist:") -> artistTracks(id)
            id.startsWith("ya:") -> ya.playlistTracks(id)
            id.startsWith("sc:") -> sc.playlistTracks(id)
            id.startsWith("vk:") -> vk.playlistTracks(id)
            id.startsWith("sp:") -> sp.playlistTracks(id)
            else -> yt.playlistTracks(id)
        },
    )

    suspend fun search(q: String): SearchResult = coroutineScope {
        // Поиск YouTube Music работает и без входа
        val a = async { if (ya.loggedIn && up(SOURCE_YA)) runCatching { ya.search(q) }.getOrDefault(emptyList()) else emptyList() }
        val b = async { if (up(SOURCE_YT)) runCatching { yt.search(q) }.getOrDefault(emptyList()) else emptyList() }
        val c = async { if (up(SOURCE_SC)) runCatching { sc.search(q) }.getOrDefault(emptyList()) else emptyList() }
        val d = async { if (vk.loggedIn && up(SOURCE_VK)) runCatching { vk.search(q) }.getOrDefault(emptyList()) else emptyList() }
        val e = async { if (sp.loggedIn && !sp.regionBlocked) (kotlinx.coroutines.withTimeoutOrNull(SP_WAIT) { runCatching { sp.search(q) }.getOrDefault(emptyList()) } ?: emptyList()) else emptyList() }
        // исполнители и альбомы: Яндекс и YouTube Music
        val arYa = async { if (ya.loggedIn && up(SOURCE_YA)) runCatching { ya.searchArtists(q) }.getOrDefault(emptyList()) else emptyList() }
        val arYt = async { if (up(SOURCE_YT)) runCatching { yt.searchArtists(q) }.getOrDefault(emptyList()) else emptyList() }
        val alYa = async { if (ya.loggedIn && up(SOURCE_YA)) runCatching { ya.searchAlbums(q) }.getOrDefault(emptyList()) else emptyList() }
        val alYt = async { if (up(SOURCE_YT)) runCatching { yt.searchAlbums(q) }.getOrDefault(emptyList()) else emptyList() }
        val nq = Search.norm(q)
        val artists = alternateAll(arYa.await(), arYt.await()).distinctBy { Search.norm(it.name) }.sortedByDescending { Search.norm(it.name) == nq }.take(10)
        val albums = alternateAll(alYa.await(), alYt.await()).take(12)
        SearchResult(remember(a.await()), remember(b.await()), remember(c.await()), remember(d.await()), remember(e.await()), artists, albums)
    }

    /** «Все треки» исполнителя: id вида artist:<сервис>:<id>:<имя>. SoundCloud и VK — поиском по имени */
    private suspend fun artistTracks(key: String): List<Track> {
        val parts = key.split(":", limit = 4)
        val source = parts.getOrNull(1) ?: return emptyList()
        val id = parts.getOrNull(2)?.ifBlank { null }
        val name = parts.getOrNull(3) ?: ""
        val full = runCatching {
            when {
                source == SOURCE_YA && id != null && ya.loggedIn -> ya.artistTracks(id)
                source == SOURCE_YT && id != null -> yt.artistTracks(id)
                else -> null
            }
        }.getOrNull()
        if (!full.isNullOrEmpty()) return full
        val found = runCatching { searchIn(source, name) }.getOrDefault(emptyList())
        return found.filter { it.artist.contains(name, ignoreCase = true) }.ifEmpty { found }
    }

    /** Страница исполнителя: у Яндекса и YouTube — настоящая, у SoundCloud и VK — его треки из поиска */
    suspend fun artistPage(source: String, id: String?, name: String): ArtistPage {
        val page = runCatching {
            when {
                source == SOURCE_YA && id != null && ya.loggedIn -> ya.artist(id)
                source == SOURCE_YT && id != null -> yt.artist(id)
                else -> null
            }
        }.getOrNull()
        if (page != null) {
            remember(page.popular)
            return page
        }
        val main = name.substringBefore(",").trim()
        val found = when (source) {
            SOURCE_SC -> runCatching { sc.search(main) }.getOrDefault(emptyList())
            SOURCE_VK -> if (vk.loggedIn) runCatching { vk.search(main) }.getOrDefault(emptyList()) else emptyList()
            SOURCE_SP -> if (sp.loggedIn && !sp.regionBlocked) (kotlinx.coroutines.withTimeoutOrNull(SP_WAIT) { runCatching { sp.search(main) }.getOrDefault(emptyList()) } ?: emptyList()) else emptyList()
            SOURCE_YA -> if (ya.loggedIn) runCatching { ya.search(main) }.getOrDefault(emptyList()) else emptyList()
            else -> runCatching { yt.search(main) }.getOrDefault(emptyList())
        }
        val mine = found.filter { it.artist.contains(main, ignoreCase = true) }.ifEmpty { found }
        remember(mine)
        return ArtistPage(source, id, main, mine.firstOrNull()?.cover, null, mine, emptyList())
    }

    suspend fun trackDetails(t: Track): TrackDetails = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        runCatching {
            when (t.source) {
                SOURCE_YA -> if (ya.loggedIn) ya.trackDetails(t.srcId) else TrackDetails()
                SOURCE_SC -> sc.trackDetails(t.srcId)
                else -> TrackDetails()
            }
        }.getOrDefault(TrackDetails())
    }

    // ---------- «Слушать вместе» и перенос плейлистов ----------

    private fun usable(s: String) = up(s) && when (s) {
        SOURCE_YT, SOURCE_SC -> true
        SOURCE_YA -> ya.loggedIn
        SOURCE_VK -> vk.loggedIn
        SOURCE_SP -> sp.loggedIn
        else -> false
    }

    private suspend fun searchIn(source: String, q: String): List<Track> = when (source) {
        SOURCE_YA -> ya.search(q)
        SOURCE_YT -> yt.search(q)
        SOURCE_SC -> sc.search(q)
        SOURCE_VK -> vk.search(q)
        SOURCE_SP -> sp.search(q)
        else -> emptyList()
    }

    /** Трек из чужого сервиса → тот, что можно включить здесь (свой сервис или найденный похожий) */
    suspend fun playable(t: Track): Track? = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        if (usable(t.source)) {
            val direct = t.source != SOURCE_SP || runCatching { sp.account().plus == true }.getOrDefault(false)
            if (direct) return@withContext t.also { rememberTrack(it) }
        }
        for (s in listOf(SOURCE_YA, SOURCE_VK, SOURCE_YT, SOURCE_SC).filter { usable(it) }) {
            Match.find(t, minScore = 0.85) { q -> searchIn(s, q) }?.let { rememberTrack(it); return@withContext it }
        }
        null
    }

    data class TransferTarget(val id: String, val name: String, val ok: Boolean)
    data class TransferResult(val found: Int, val total: Int, val missing: List<Track>, val playlistId: String?)

    fun transferTargets(): List<TransferTarget> = listOf(
        TransferTarget("mix", "Nyao-микс", true),
        TransferTarget(SOURCE_YA, "Яндекс Музыка", ya.loggedIn && up(SOURCE_YA)),
        TransferTarget(SOURCE_YT, "YouTube Music", yt.loggedIn && up(SOURCE_YT)),
    )

    /** Перенос: каждый трек ищем в целевом сервисе и собираем новый плейлист (порядок сохраняется) */
    suspend fun transfer(tracks: List<Track>, title: String, target: String, onProgress: (done: Int, total: Int, found: Int) -> Unit): TransferResult = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val out = arrayOfNulls<Track>(tracks.size)
        val done = java.util.concurrent.atomic.AtomicInteger()
        val found = java.util.concurrent.atomic.AtomicInteger()
        val sem = kotlinx.coroutines.sync.Semaphore(4)
        tracks.mapIndexed { i, t ->
            async {
                sem.acquire()
                try {
                    out[i] = if (target == "mix" || t.source == target) t else Match.find(t) { q -> searchIn(target, q) }
                } finally {
                    sem.release()
                }
                if (out[i] != null) found.incrementAndGet()
                onProgress(done.incrementAndGet(), tracks.size, found.get())
            }
        }.forEach { it.await() }
        val matched = out.filterNotNull().distinctBy { it.id }
        val missing = tracks.filterIndexed { i, _ -> out[i] == null }
        val title2 = title.take(80).ifBlank { "Перенесённый плейлист" }
        val id = if (matched.isEmpty()) null else when (target) {
            "mix" -> mixStore.create(title2, matched).id
            SOURCE_YA -> ya.createPlaylist(title2, matched)
            else -> yt.createPlaylist(title2, matched.map { it.srcId })
        }
        TransferResult(matched.size, tracks.size, missing, id)
    }

    suspend fun radioStart(t: Track): List<Track> = remember(radio.start(t))
    suspend fun radioMore(queueIds: List<String>): List<Track> = remember(radio.more(queueIds))
    suspend fun waveStart(): List<Track> = remember(wave.start())
    suspend fun waveMore(queueIds: List<String>): List<Track> = remember(wave.more(queueIds))

    private val scLikes by lazy {
        PendingLikes(
            read = { prefs.scPendingLikes }, write = { prefs.scPendingLikes = it },
            account = { prefs.scToken?.let {
                val key = java.security.MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).hex()
                val identity = prefs.scIdentity?.split('|')
                if (identity?.getOrNull(0) == key) "uid:${identity?.getOrNull(1)}" else key
            } },
        )
    }

    suspend fun like(track: Track, on: Boolean) {
        wave.invalidateLikes()
        when (track.source) {
            SOURCE_YA -> ya.like(track, on)
            SOURCE_VK -> vk.like(track, on)
            SOURCE_SP -> sp.like(track.srcId, on)
            SOURCE_SC -> {
                scLikes.enqueue(track.srcId, on)
                val result = flushScLikes(interactive = true)
                if (result.left > 0) org.nyao.music.playback.PlaybackEvents.emit(
                    if ((result.error as? ApiException)?.code == 401) "SoundCloud ждёт повторного входа — лайк сохранён"
                    else "SoundCloud пока не принял изменение — оно сохранено"
                )
            }
            else -> yt.like(track.srcId, on)
        }
        _liked.value = if (on) _liked.value + track.id else _liked.value - track.id
        if (on && mode.value == Mode.WAVE) wave.feedback("like", track, 0)
    }

    /** Досылает отложенные лайки SoundCloud */
    suspend fun flushScLikes(interactive: Boolean = false): PendingLikes.Result {
        if (!sc.loggedIn) return PendingLikes.Result(0, 0)
        val token = prefs.scToken
        val result = scLikes.flush { item -> sc.like(item.id, item.on, interactive, expectedToken = token) }
        if (result.sent > 0) org.nyao.music.playback.PlaybackEvents.emit("SoundCloud: отправлено изменений — ${result.sent}")
        return result
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
            // Spotify: в ExoPlayer — тишина длиной с трек, звук даёт устройство Spotify (см. SpotifySync)
            .setUri(
                when {
                    // Spotify без Premium (или регион/плеер недоступен): играет найденная копия из другого сервиса
                    t.source == SOURCE_SP && !spotifyPlayable() -> "nyao://$SOURCE_SPX/${Uri.encode(t.srcId)}"
                    t.source == SOURCE_SP -> org.nyao.music.spotify.SilenceDataSource.uri(t.duration, t.srcId)
                    else -> "nyao://${t.source}/${Uri.encode(t.srcId)}"
                },
            )
            .setMediaMetadata(meta)
            // SoundCloud играет через HLS: тип нужно знать заранее, до получения ссылки
            // VK тоже отдаёт HLS (.m3u8, куски с AES-128 — ExoPlayer расшифровывает сам)
            .apply { if (t.source == SOURCE_SC || t.source == SOURCE_VK) setMimeType(MimeTypes.APPLICATION_M3U8) }
            .apply { if (t.source == SOURCE_SP && spotifyPlayable()) setMimeType(MimeTypes.AUDIO_WAV) }
            .build()
    }

    /** Пересобирает MediaItem по id (контроллер передаёт в сервис элементы без ссылки) */
    fun mediaItemById(id: String): MediaItem? = tracks[id]?.let { mediaItem(it) }

    data class Resolved(val url: String, val userAgent: String?, val contentLength: Long)

    /** nyao://ya/123 или nyao://yt/videoId → настоящая ссылка. Блокирующий: зовётся из потока загрузки. */
    fun resolve(uri: Uri): Resolved {
        val source = uri.host ?: throw ApiException("Плохая ссылка $uri")
        val id = uri.pathSegments.firstOrNull() ?: throw ApiException("Плохая ссылка $uri")
        if (source == SOURCE_SPX) {
            val sub = substituteFor(id)
            return resolve(Uri.parse("nyao://${sub.source}/${Uri.encode(sub.srcId)}"))
        }
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

    fun forgetStream(uri: Uri, blocked: Boolean = false) {
        val id = uri.pathSegments.firstOrNull() ?: return
        when (uri.host) {
            SOURCE_YA -> yaStreamCache.remove(id)
            SOURCE_SC -> sc.forget(id)
            SOURCE_VK -> vk.forget(id)
            SOURCE_SP -> {}
            SOURCE_SPX -> _substitutes.value["$SOURCE_SP:$id"]?.let { forgetStream(Uri.parse("nyao://${it.source}/${Uri.encode(it.srcId)}"), blocked) }
            else -> ytStreams.invalidate(id, blocked)
        }
    }
}
