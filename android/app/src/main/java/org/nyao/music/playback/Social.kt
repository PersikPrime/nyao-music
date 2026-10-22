package org.nyao.music.playback

import android.content.Context
import android.media.AudioManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.nyao.music.data.ApiException
import org.nyao.music.data.Repo
import org.nyao.music.data.Room
import org.nyao.music.data.RoomState
import org.nyao.music.data.Track
import org.nyao.music.data.objects
import org.nyao.music.data.obj

/**
 * Живые события с сервера Nyao (перенос src/main/live.js): команды Nyao Connect, «сейчас играет» на других
 * устройствах, «Слушать вместе». Опрос идёт, пока открыто приложение или работает плеер.
 */
object Live {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _events = MutableSharedFlow<JSONObject>(extraBufferCapacity = 64)
    val events: SharedFlow<JSONObject> = _events
    private val holders = HashSet<String>()
    /** Приложение на экране: всплывашки друзей показываем внутри, иначе — уведомлением */
    val uiVisible: Boolean get() = synchronized(this) { "ui" in holders }
    private var job: Job? = null
    private var cursor = 0L
    private lateinit var app: Context

    @Synchronized
    fun hold(context: Context, who: String) {
        app = context.applicationContext
        holders += who
        if (job?.isActive != true) job = scope.launch { loop() }
    }

    @Synchronized
    fun release(who: String) {
        holders -= who
        if (holders.isEmpty()) {
            job?.cancel()
            job = null
        }
    }

    private suspend fun loop() {
        var fails = 0
        while (scope.isActive) {
            if (!Repo.cloud.loggedIn) {
                cursor = 0
                delay(10_000)
                continue
            }
            try {
                val (c, list) = Repo.cloud.events(cursor)
                cursor = c
                fails = 0
                for (e in list) {
                    runCatching { if (e.optString("type") == "cmd") withContext(Dispatchers.Main) { command(e) } }
                    _events.tryEmit(e)
                    when (e.optString("type")) {
                        "room", "room-closed" -> runCatching { Together.onEvent(e) }
                        "react" -> Together.onReact(e)
                        "social" -> withContext(Dispatchers.Main) { runCatching { Friends.onEvent(e) } }
                    }
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                fails++
                delay(if ((e as? ApiException)?.code == 426) 600_000L else minOf(30_000L, 2000L * fails))
            }
        }
    }

    /** Громкость музыки на телефоне (0…1) — её показывает пульт на других устройствах */
    fun volume(): Double? = runCatching {
        val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    }.getOrNull()

    private fun setVolume(v: Double) {
        runCatching {
            val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            am.setStreamVolume(AudioManager.STREAM_MUSIC, (v * am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).toInt(), 0)
        }
    }

    /** Команда с другого устройства */
    private fun command(e: JSONObject) {
        val a = e.optJSONObject("args") ?: JSONObject()
        val from = e.obj("from")?.optString("device")?.ifBlank { null } ?: "другого устройства"
        when (e.optString("cmd")) {
            "toggle" -> PlayerConnection.toggle()
            "play" -> if (!PlayerConnection.playing.value) PlayerConnection.toggle()
            "pause" -> PlayerConnection.pauseIfPlaying()
            "next" -> PlayerConnection.next()
            "prev" -> PlayerConnection.prev()
            "seek" -> PlayerConnection.seekTo((a.optDouble("position", 0.0) * 1000).toLong())
            "volume" -> setVolume(a.optDouble("volume", 0.5))
            "like" -> PlayerConnection.current.value?.let { t -> scope.launch { runCatching { Repo.like(t, t.id !in Repo.liked.value) } } }
            "playTracks" -> {
                val tracks = a.optJSONArray("tracks").objects().mapNotNull { Repo.cloud.parseTrack(it) }
                if (tracks.isNotEmpty()) {
                    if (Together.room.value?.isHost == false) Together.leave(silent = true)
                    PlayerConnection.playListAt(tracks, a.optInt("index"), a.optString("title").ifBlank { "С «$from»" }, (a.optDouble("position", 0.0) * 1000).toLong(), a.optBoolean("play", true))
                    PlaybackEvents.emit("Музыка перенесена с «$from»")
                }
            }
        }
        scope.launch {
            delay(500)
            PlayerConnection.pushNow(force = true)
        }
    }
}

/** «Слушать вместе»: комната, синхронизация гостя с хостом, реакции */
object Together {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val _room = MutableStateFlow<Room?>(null)
    val room: StateFlow<Room?> = _room
    private val _reactions = MutableSharedFlow<Pair<String, String>>(extraBufferCapacity = 16)
    val reactions: SharedFlow<Pair<String, String>> = _reactions
    private var hostTrackId: String? = null
    private var busy = false
    private var lastBeat = 0L
    private var beat: Job? = null

    val REACTIONS = listOf("🔥", "❤️", "😂", "😮", "👏", "🎶")
    /** Сайт и ссылки «Поделиться» */
    const val WEB_BASE = "https://music.withnyao.app"
    const val JOIN_BASE = "$WEB_BASE/share/room/"
    fun profileLink(nick: String) = "$WEB_BASE/share/u/${android.net.Uri.encode(nick)}"
    /** Ссылка на трек: откроется в Nyao (или найдёт копию в другом сервисе) */
    fun trackLink(t: org.nyao.music.data.Track): String = android.net.Uri.parse("$WEB_BASE/share/track/${t.id}").buildUpon()
        .apply { if (t.title.isNotBlank()) appendQueryParameter("t", t.title.take(200)) }
        .apply { if (t.artist.isNotBlank()) appendQueryParameter("a", t.artist.take(200)) }
        .apply { if (t.duration > 0) appendQueryParameter("d", t.duration.toString()) }
        .build().toString()

    fun parseCode(input: String): String? {
        val m = Regex("(?:join|share/room)/([A-Za-z0-9]{6})\\b").find(input) // nyao://join/…, …/share/room/…
        val code = (m?.groupValues?.get(1) ?: input.replace(Regex("[^A-Za-z0-9]"), "")).uppercase()
        return code.takeIf { Regex("^[A-Z0-9]{6}$").matches(it) }
    }

    suspend fun refresh() {
        val r = runCatching { withContext(Dispatchers.IO) { Repo.cloud.roomCurrent() } }.getOrNull()
        if (r?.code != _room.value?.code) hostTrackId = null
        _room.value = r
        if (r != null && !r.isHost) apply(r.state)
        startBeat()
    }

    suspend fun create(): Room {
        val r = withContext(Dispatchers.IO) { Repo.cloud.roomCreate() }
        _room.value = r
        hostTrackId = null
        push(now = true)
        startBeat()
        return r
    }

    suspend fun join(input: String): Room {
        val code = parseCode(input) ?: throw ApiException("Код комнаты — 6 букв и цифр")
        val r = withContext(Dispatchers.IO) { Repo.cloud.roomJoin(code) }
        _room.value = r
        hostTrackId = null
        if (!r.isHost) apply(r.state)
        startBeat()
        return r
    }

    fun leave(silent: Boolean = false) {
        val r = _room.value ?: return
        _room.value = null
        hostTrackId = null
        scope.launch(Dispatchers.IO) { Repo.cloud.roomLeave(r.code) }
        if (!silent) PlaybackEvents.emit(if (r.isHost) "Комната закрыта" else "Ты вышел из комнаты")
    }

    fun react(emoji: String) {
        val r = _room.value ?: return
        scope.launch(Dispatchers.IO) { runCatching { Repo.cloud.roomReact(r.code, emoji) }.onFailure { PlaybackEvents.emit(it.message ?: "Не получилось") } }
    }

    /** Хост: сообщаем комнате, что играет */
    fun push(now: Boolean = false) {
        val r = _room.value ?: return
        if (!r.isHost) return
        scope.launch {
            if (!now) delay(300)
            lastBeat = System.currentTimeMillis()
            val t = PlayerConnection.current.value
            val pos = PlayerConnection.positionMs() / 1000.0
            val playing = PlayerConnection.playing.value
            withContext(Dispatchers.IO) {
                runCatching { Repo.cloud.roomState(r.code, t, pos, playing) }.onFailure {
                    if ((it as? ApiException)?.code == 403) _room.value = null
                }
            }
        }
    }

    private fun startBeat() {
        if (beat?.isActive == true) return
        beat = scope.launch {
            while (true) {
                delay(5000)
                val r = _room.value ?: break
                if (r.isHost && PlayerConnection.playing.value && System.currentTimeMillis() - lastBeat > 15_000) push(now = true)
            }
        }
    }

    fun onEvent(e: JSONObject) {
        scope.launch {
            when (e.optString("type")) {
                "room-closed" -> if (_room.value?.code == e.optString("code")) {
                    _room.value = null
                    PlaybackEvents.emit("Хост закрыл комнату")
                }
                "room" -> {
                    val cur = _room.value ?: return@launch
                    val r = Repo.cloud.parseRoom(e.optJSONObject("room"), cur.isHost) ?: return@launch
                    if (r.code != cur.code) return@launch
                    _room.value = r
                    e.optString("joined").ifBlank { null }?.let { PlaybackEvents.emit("$it в комнате") }
                    e.optString("left").ifBlank { null }?.let { PlaybackEvents.emit("$it вышел") }
                    if (!r.isHost) apply(r.state)
                }
            }
        }
    }

    fun onReact(e: JSONObject) {
        _reactions.tryEmit(e.optString("emoji") to e.optString("name"))
    }

    /** Гость: тот же трек (или найденный в своих сервисах), то же место */
    private suspend fun apply(st: RoomState?) {
        if (busy) return
        val r = _room.value ?: return
        if (r.isHost) return
        val t = st?.track
        if (t == null) {
            PlayerConnection.pauseIfPlaying()
            return
        }
        if (hostTrackId != t.id) {
            busy = true
            val started = System.currentTimeMillis()
            try {
                val mine = Repo.playable(t)
                hostTrackId = t.id
                if (mine == null) {
                    PlayerConnection.pauseIfPlaying()
                    PlaybackEvents.emit("«${t.title}» нет в твоих сервисах — ждём следующий трек")
                    return
                }
                val pos = st.positionSec + if (st.playing) (System.currentTimeMillis() - started) / 1000.0 else 0.0
                PlayerConnection.playListAt(listOf(mine), 0, "Вместе с ${r.hostName}", (pos * 1000).toLong(), st.playing)
            } finally {
                busy = false
            }
            return
        }
        val drift = kotlin.math.abs(PlayerConnection.positionMs() / 1000.0 - st.positionSec)
        if (drift > 4) PlayerConnection.seekTo((st.positionSec * 1000).toLong())
        if (st.playing != PlayerConnection.playing.value) PlayerConnection.toggle()
    }
}

/** Варианты слов для «Итогов» */
fun plural(n: Int, one: String, few: String, many: String): String {
    val a = kotlin.math.abs(n) % 10
    val b = kotlin.math.abs(n) % 100
    return if (a == 1 && b != 11) one else if (a in 2..4 && (b < 10 || b >= 20)) few else many
}
