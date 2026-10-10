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
import org.nyao.music.data.RemoteNow
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

    // ---- аккаунт Nyao ----
    var cloudLogging by mutableStateOf(false)
    var others by mutableStateOf<List<RemoteNow>>(emptyList())
    private var loginJob: Job? = null

    /** Вход через Telegram: открываем браузер и опрашиваем сервер, пока пользователь не подтвердит */
    fun cloudLogin(context: android.content.Context) {
        if (cloudLogging) return
        cloudLogging = true
        loginJob = scope.launch {
            try {
                val device = listOf(android.os.Build.MANUFACTURER.replaceFirstChar { it.uppercase() }, android.os.Build.MODEL)
                    .distinct().joinToString(" ").take(60)
                val (id, url) = org.nyao.music.data.Repo.cloud.startLogin(device)
                context.startActivity(
                    android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
                        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
                )
                val until = System.currentTimeMillis() + 10 * 60_000L
                var user: org.nyao.music.data.CloudUser? = null
                while (user == null && System.currentTimeMillis() < until) {
                    kotlinx.coroutines.delay(2000)
                    user = try {
                        org.nyao.music.data.Repo.cloud.poll(id)
                    } catch (e: org.nyao.music.data.ApiException) {
                        if (e.code == 400 || e.code == 410) throw e
                        null
                    } catch (e: java.io.IOException) {
                        null // сеть моргнула — ждём дальше
                    }
                }
                if (user == null) throw org.nyao.music.data.ApiException("Время входа вышло — попробуй ещё раз")
                message("Привет, ${user.name}! Синхронизация включена")
                loadOthers()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                message(e.message ?: "Вход не удался")
            } finally {
                cloudLogging = false
            }
        }
    }

    fun cancelCloudLogin() {
        loginJob?.cancel()
        cloudLogging = false
    }

    fun cloudLogout() {
        scope.launch {
            org.nyao.music.data.Repo.cloud.logout()
            others = emptyList()
            message("Вышел из аккаунта Nyao")
        }
    }

    /** Что недавно играло на других устройствах (для карточки «Продолжить») */
    fun loadOthers() {
        if (!org.nyao.music.data.Repo.cloud.loggedIn) return
        scope.launch {
            others = try {
                val cur = PlayerConnection.current.value?.id
                org.nyao.music.data.Repo.cloud.others()
                    .filter { System.currentTimeMillis() - it.updatedAt < 12 * 3600_000L && it.track.id != cur }
                    .take(1)
            } catch (_: Exception) {
                emptyList()
            }
        }
    }

    fun resume(r: RemoteNow) {
        val pos = if (r.playing) r.positionSec + (System.currentTimeMillis() - r.updatedAt) / 1000.0 else r.positionSec
        val ms = if (r.track.duration > 0 && pos > r.track.duration - 5) 0L else (pos * 1000).toLong()
        PlayerConnection.resume(r.track, ms, "С устройства «${r.device}»")
        others = others - r
    }

    fun dismissOther(r: RemoteNow) {
        others = others - r
    }
}
