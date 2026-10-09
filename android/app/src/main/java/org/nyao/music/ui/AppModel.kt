package org.nyao.music.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.nyao.music.data.HomeData
import org.nyao.music.data.Playlist
import org.nyao.music.data.Repo
import org.nyao.music.data.SearchResult
import org.nyao.music.data.Track
import org.nyao.music.playback.PlaybackEvents
import org.nyao.music.playback.PlayerConnection

sealed interface Route {
    data object Home : Route
    data object Wave : Route
    data object Search : Route
    data object Library : Route
    data object Settings : Route
    data class PlaylistPage(val playlist: Playlist) : Route
}

/** Состояние экранов: живёт, пока живёт окно, чтобы вкладки не грузились заново при каждом переходе. */
class AppModel(private val scope: CoroutineScope) {

    // ---- навигация ----
    val stack = mutableStateListOf<Route>(Route.Home)
    val route: Route get() = stack.last()
    var nowPlayingOpen by mutableStateOf(false)
    var loginFor by mutableStateOf<String?>(null)

    fun go(r: Route) {
        if (r is Route.PlaylistPage) stack.add(r)
        else {
            // вкладки верхнего уровня не копятся в истории
            stack.clear()
            stack.add(r)
        }
    }

    fun back(): Boolean {
        if (loginFor != null) {
            loginFor = null
            return true
        }
        if (nowPlayingOpen) {
            nowPlayingOpen = false
            return true
        }
        if (stack.size > 1) {
            stack.removeAt(stack.lastIndex)
            return true
        }
        if (route != Route.Home) {
            go(Route.Home)
            return true
        }
        return false
    }

    // ---- данные ----
    var home by mutableStateOf<HomeData?>(null)
    var homeLoading by mutableStateOf(false)
    var liked by mutableStateOf<List<Track>?>(null)
    var playlists by mutableStateOf<List<Playlist>?>(null)
    var playlistTracks by mutableStateOf<Map<String, List<Track>>>(emptyMap())

    var searchQuery by mutableStateOf("")
    var search by mutableStateOf<SearchResult?>(null)
    var searching by mutableStateOf(false)
    private var searchJob: Job? = null

    var waveStarting by mutableStateOf(false)

    fun message(text: String) = PlaybackEvents.emit(text)

    fun loadHome(force: Boolean = false) {
        if (homeLoading || (home != null && !force)) return
        homeLoading = true
        scope.launch {
            try {
                home = Repo.home()
            } catch (e: Exception) {
                message(e.message ?: "Не удалось загрузить главную")
            } finally {
                homeLoading = false
            }
        }
    }

    fun loadLiked(force: Boolean = false) {
        if (liked != null && !force) return
        scope.launch {
            liked = try {
                Repo.likedTracks()
            } catch (e: Exception) {
                message(e.message ?: "Не удалось загрузить «Мне нравится»")
                emptyList()
            }
        }
    }

    fun loadPlaylists(force: Boolean = false) {
        if (playlists != null && !force) return
        scope.launch {
            playlists = try {
                Repo.playlists()
            } catch (e: Exception) {
                message(e.message ?: "Не удалось загрузить плейлисты")
                emptyList()
            }
        }
    }

    fun loadPlaylist(id: String) {
        if (playlistTracks.containsKey(id)) return
        scope.launch {
            val list = try {
                Repo.playlistTracks(id)
            } catch (e: Exception) {
                message(e.message ?: "Не удалось открыть плейлист")
                emptyList()
            }
            playlistTracks = playlistTracks + (id to list)
        }
    }

    fun runSearch(q: String) {
        val query = q.trim()
        if (query.isEmpty()) return
        searchJob?.cancel()
        searching = true
        search = null
        searchJob = scope.launch {
            try {
                search = Repo.search(query)
            } catch (e: Exception) {
                message(e.message ?: "Поиск не удался")
            } finally {
                searching = false
            }
        }
    }

    /** После входа/выхода всё перезагружаем */
    fun accountsChanged() {
        home = null
        liked = null
        playlists = null
        playlistTracks = emptyMap()
        scope.launch {
            Repo.refreshAccounts()
            loadHome(force = true)
        }
    }

    fun like(track: Track, on: Boolean) {
        scope.launch {
            try {
                Repo.like(track, on)
                message(if (on) "Добавлено в «Мне нравится»" else "Убрано из «Мне нравится»")
            } catch (e: Exception) {
                message(e.message ?: "Не получилось")
            }
        }
    }

    fun startWave() {
        if (waveStarting) return
        waveStarting = true
        scope.launch {
            try {
                PlayerConnection.startWave()
            } catch (e: Exception) {
                message(e.message ?: "Волна не запустилась")
            } finally {
                waveStarting = false
            }
        }
    }

    /** Кнопка волны: если волна уже играет — пауза/продолжить, иначе запуск */
    fun waveButton() {
        if (Repo.mode.value == Repo.Mode.WAVE && PlayerConnection.current.value != null) PlayerConnection.toggle()
        else startWave()
    }

    fun refreshWave() {
        scope.launch {
            try {
                PlayerConnection.refreshWave()
            } catch (e: Exception) {
                message(e.message ?: "Не удалось перенастроить волну")
            }
        }
    }

    fun dislike() {
        scope.launch { PlayerConnection.dislike() }
    }
}
