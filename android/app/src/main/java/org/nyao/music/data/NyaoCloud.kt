package org.nyao.music.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class CloudUser(val name: String, val username: String?, val picture: String?)
data class CloudDevice(val id: String, val device: String, val platform: String, val current: Boolean, val lastSeen: String)
/** Что играет на другом устройстве — для «Продолжить» */
data class RemoteNow(val deviceId: String, val device: String, val platform: String, val track: Track, val positionSec: Double, val playing: Boolean, val updatedAt: Long, val queue: HandoffQueue? = null)

/** Откуда играл трек на другом устройстве и что дальше — чтобы «Забрать сюда» и «Продолжить» брали весь список */
data class HandoffQueue(val tracks: List<Track>, val index: Int, val label: String, val mode: String)

/**
 * Аккаунт Nyao на своём сервере (api.nmusic.bixtl.cc): вход через Telegram, история, «сейчас играет».
 * Токены Яндекса, YouTube и SoundCloud сюда не попадают — они остаются только на телефоне.
 * Перенос src/main/cloud.js.
 */
class NyaoCloud(private val prefs: Prefs, private val dir: File) {
    companion object {
        const val BASE = "https://api.nmusic.bixtl.cc"
        private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()
        private const val HISTORY_MAX = 1500
        private const val DAY = 86_400_000L
    }

    /** Сервер сказал, что эта сборка устарела (426): здесь минимальная сборка, иначе 0 */
    private val _outdated = MutableStateFlow(0)
    val outdated: StateFlow<Int> = _outdated

    private val _user = MutableStateFlow(prefs.nyaoUser?.let { runCatching { parseUser(JSONObject(it)) }.getOrNull() })
    val user: StateFlow<CloudUser?> = _user
    val loggedIn: Boolean get() = prefs.nyaoToken != null

    private val fileLock = Mutex()
    private var remoteRecent: Set<String> = emptySet()
    private var remoteRecentAt = 0L
    private var lastNowKey = ""
    private var lastNowAt = 0L

    private fun parseUser(o: JSONObject) = CloudUser(o.optString("name", "Telegram"), o.str("username"), o.str("picture"))

    private suspend fun request(method: String, path: String, body: JSONObject? = null, long: Boolean = false): JSONObject {
        val b = Request.Builder().url(BASE + path).header("User-Agent", "NyaoMusic-Android")
            .header("X-Nyao-Build", org.nyao.music.BuildConfig.VERSION_CODE.toString())
        prefs.nyaoToken?.let { b.header("Authorization", "Bearer $it") }
        val rb = body?.toString()?.toRequestBody(JSON_TYPE)
        when (method) {
            "GET" -> b.get()
            "DELETE" -> b.delete(rb)
            else -> b.method(method, rb ?: "{}".toRequestBody(JSON_TYPE))
        }
        val (code, text) = if (long) Net.callLong(b.build()) else Net.call(b.build())
        val json = runCatching { JSONObject(text) }.getOrNull() ?: JSONObject()
        if (code == 426) _outdated.value = json.optInt("minBuild", 1).coerceAtLeast(1)
        if (code == 401 && prefs.nyaoToken != null) forget()
        if (code !in 200..299) throw ApiException(json.str("error") ?: "Сервер Nyao ответил $code", code)
        return json
    }

    /** Статус сервиса: техработы и сбои музыкальных сервисов (без входа) */
    suspend fun status(): SvcStatus {
        val o = request("GET", "/status")
        val m = o.optJSONObject("maintenance")
        return SvcStatus(
            maintenance = Maintenance(
                active = m?.optBoolean("active") == true,
                title = m?.optString("title").orEmpty(),
                text = m?.optString("text").orEmpty(),
                until = m?.optString("until").orEmpty(),
            ),
            outages = o.optJSONArray("outages").let { a -> (0 until (a?.length() ?: 0)).mapNotNull { a?.optString(it)?.takeIf { s -> s.isNotBlank() } } },
        )
    }

    private fun forget() {
        prefs.nyaoToken = null
        prefs.nyaoUser = null
        _user.value = null
    }

    // ---------- Вход ----------

    /** Шаг 1: ссылка на Telegram, которую надо открыть в браузере, и id для опроса */
    suspend fun startLogin(device: String): Pair<String, String> {
        val r = request("POST", "/auth/start", JSONObject().put("device", device).put("platform", "android"))
        return r.getString("id") to r.getString("url")
    }

    /** Шаг 2: спрашиваем сервер, подтвердил ли пользователь вход. null — ещё ждём */
    suspend fun poll(id: String): CloudUser? {
        val r = request("GET", "/auth/poll?id=${java.net.URLEncoder.encode(id, "UTF-8")}")
        if (r.optString("status") != "done") return null
        prefs.nyaoToken = r.getString("token")
        val u = r.getJSONObject("user")
        prefs.nyaoUser = u.toString()
        return parseUser(u).also { _user.value = it }
    }

    suspend fun logout() {
        runCatching { if (loggedIn) request("POST", "/auth/logout") }
        forget()
    }

    suspend fun devices(): List<CloudDevice> {
        val r = request("GET", "/me")
        r.obj("user")?.let {
            prefs.nyaoUser = it.toString()
            _user.value = parseUser(it)
        }
        return r.arr("devices").objects().map {
            CloudDevice(it.optString("id"), it.optString("device"), it.optString("platform"), it.optBoolean("current"), it.optString("lastSeen"))
        }
    }

    suspend fun removeDevice(id: String) {
        request("DELETE", "/devices/$id")
    }

    // ---------- История ----------

    private val historyFile get() = File(dir, "history.json")
    private val outboxFile get() = File(dir, "cloud-outbox.json")

    private fun readArr(f: File): JSONArray = runCatching { JSONArray(f.readText()) }.getOrDefault(JSONArray())

    suspend fun recordPlay(t: Track, listenedSec: Int, skipped: Boolean) = fileLock.withLock {
        val play = JSONObject()
            .put("trackId", t.id).put("source", t.source).put("title", t.title).put("artist", t.artist)
            .put("cover", t.cover ?: JSONObject.NULL).put("duration", t.duration)
            .put("listened", listenedSec).put("skipped", skipped).put("playedAt", System.currentTimeMillis())
        val hist = readArr(historyFile)
        val next = JSONArray().put(play)
        for (i in 0 until minOf(hist.length(), HISTORY_MAX - 1)) next.put(hist.get(i))
        historyFile.writeText(next.toString())
        if (loggedIn) {
            val out = readArr(outboxFile).put(play)
            outboxFile.writeText(out.toString())
        }
    }

    suspend fun flush() {
        if (!loggedIn) return
        val out = fileLock.withLock { readArr(outboxFile) }
        if (out.length() == 0) return
        var i = 0
        while (i < out.length()) {
            val chunk = JSONArray()
            for (j in i until minOf(i + 200, out.length())) chunk.put(out.get(j))
            request("POST", "/history", JSONObject().put("plays", chunk))
            i += 200
        }
        fileLock.withLock {
            val now = readArr(outboxFile)
            val rest = JSONArray()
            for (j in out.length() until now.length()) rest.put(now.get(j))
            outboxFile.writeText(rest.toString())
        }
    }

    /** Недавно звучавшее на всех устройствах — волна это пропустит. Пропущенные треки помним дольше */
    suspend fun recentIds(days: Int = 3, skippedDays: Int = 14): Set<String> {
        val now = System.currentTimeMillis()
        val ids = HashSet<String>()
        val hist = fileLock.withLock { readArr(historyFile) }
        for (i in 0 until hist.length()) {
            val p = hist.optJSONObject(i) ?: continue
            val age = now - p.optLong("playedAt")
            if (age < days * DAY || (p.optBoolean("skipped") && age < skippedDays * DAY)) ids += p.optString("trackId")
        }
        if (loggedIn) {
            if (now - remoteRecentAt > 5 * 60_000L) {
                runCatching {
                    val r = request("GET", "/history?days=$skippedDays&limit=2000")
                    val set = HashSet<String>()
                    for (p in r.arr("plays").objects()) {
                        val at = runCatching { java.time.Instant.parse(p.optString("playedAt")).toEpochMilli() }.getOrDefault(0L)
                        if (now - at < days * DAY || p.optBoolean("skipped")) set += p.optString("trackId")
                    }
                    remoteRecent = set
                    remoteRecentAt = now
                }
            }
            ids += remoteRecent
        }
        return ids
    }

    /** Недавно слушал: уникальные треки из своей истории, без пропущенных */
    suspend fun recent(limit: Int = 12): List<Track> {
        val hist = fileLock.withLock { readArr(historyFile) }
        val seen = HashSet<String>()
        val out = ArrayList<Track>()
        for (i in 0 until hist.length()) {
            val p = hist.optJSONObject(i) ?: continue
            if (p.optBoolean("skipped") || !seen.add(p.optString("trackId"))) continue
            playToTrack(p)?.let { out += it }
            if (out.size >= limit) break
        }
        return out
    }

    /**
     * Самое прослушиваемое за days дней: сервер (все устройства) + своё неотправленное,
     * без сервера — своя история. Пропущенное не считается. → пары (трек, сколько раз)
     */
    suspend fun top(days: Int = 30): List<Pair<Track, Int>> {
        val since = System.currentTimeMillis() - days * DAY
        val plays = ArrayList<JSONObject>()
        var fromServer = false
        if (loggedIn) {
            runCatching {
                val r = request("GET", "/history?days=${minOf(365, days)}&limit=2000")
                r.arr("plays").objects().forEach { plays += it }
                val out = fileLock.withLock { readArr(outboxFile) }
                for (i in 0 until out.length()) out.optJSONObject(i)?.let { if (it.optLong("playedAt") >= since) plays += it }
                fromServer = true
            }
        }
        if (!fromServer) {
            val hist = fileLock.withLock { readArr(historyFile) }
            for (i in 0 until hist.length()) hist.optJSONObject(i)?.let { if (it.optLong("playedAt") >= since) plays += it }
        }
        val counts = LinkedHashMap<String, Pair<JSONObject, Int>>()
        for (p in plays) {
            if (p.optBoolean("skipped")) continue
            val id = p.optString("trackId")
            if (id.isEmpty()) continue
            val cur = counts[id]
            counts[id] = (cur?.first ?: p) to ((cur?.second ?: 0) + 1)
        }
        return counts.values.sortedByDescending { it.second }.mapNotNull { (p, n) -> playToTrack(p)?.let { it to n } }
    }

    private fun playToTrack(p: JSONObject): Track? {
        val id = p.optString("trackId")
        val i = id.indexOf(':')
        if (i <= 0) return null
        return Track(id = id, source = p.str("source") ?: id.substring(0, i), srcId = id.substring(i + 1), title = p.optString("title"), artist = p.optString("artist"), duration = p.optInt("duration"), cover = p.str("cover"))
    }

    // ---------- Синхронизация настроек и миксов ----------

    class StateHandler(val get: () -> Any, val set: (Any) -> Unit, val merge: ((Any, Any) -> Any)? = null)

    suspend fun pushState(key: String, data: Any) {
        val at = System.currentTimeMillis()
        prefs.setCloudStamp(key, at)
        if (!loggedIn) return
        request("PUT", "/state/$key", JSONObject().put("data", data).put("updatedAt", at))
    }

    /** Сверка с сервером: где свежее, оттуда и берём. Возвращает ключи, которые поменялись здесь */
    suspend fun syncState(handlers: Map<String, StateHandler>): List<String> {
        if (!loggedIn) return emptyList()
        val remote = request("GET", "/state")
        val changed = ArrayList<String>()
        for ((key, h) in handlers) {
            val r = remote.optJSONObject(key)
            val rAt = r?.optLong("updatedAt") ?: 0L
            val rData = r?.opt("data")
            val localAt = prefs.cloudStamp(key)
            when {
                r != null && rData != null && localAt == 0L && h.merge != null -> {
                    val merged = h.merge.invoke(h.get(), rData)
                    h.set(merged)
                    pushState(key, merged)
                    changed += key
                }
                r != null && rData != null && rAt > localAt -> {
                    h.set(rData)
                    prefs.setCloudStamp(key, rAt)
                    changed += key
                }
                localAt > 0 && (r == null || localAt > rAt) ->
                    request("PUT", "/state/$key", JSONObject().put("data", h.get()).put("updatedAt", localAt))
                r == null && localAt == 0L -> pushState(key, h.get())
            }
        }
        return changed
    }

    // ---------- «Сейчас играет» ----------

    /** Смену трека и паузу шлём сразу, остальное — не чаще раза в 20 секунд */
    suspend fun setNow(t: Track?, positionSec: Double, playing: Boolean, volume: Double? = null, force: Boolean = false, queue: HandoffQueue? = null) {
        if (!loggedIn) return
        val key = "${t?.id ?: "-"}|$playing"
        val now = System.currentTimeMillis()
        if (!force && queue == null && key == lastNowKey && now - lastNowAt < 20_000) return
        lastNowKey = key
        lastNowAt = now
        val body = JSONObject().put("position", positionSec).put("playing", playing).put("context", Repo.mode.value.name.lowercase())
        if (volume != null) body.put("volume", volume)
        if (t != null) body.put("track", trackJson(t))
        if (queue != null) body.put(
            "queue",
            JSONObject().put("tracks", JSONArray().apply { queue.tracks.take(100).forEach { put(trackJson(it)) } })
                .put("index", queue.index).put("label", queue.label).put("mode", queue.mode),
        )
        request("PUT", "/now", body)
    }

    // ---------- Живые события, Nyao Connect, «Слушать вместе», итоги ----------

    /** Длинный опрос: ждёт до 25 секунд, пока для этого устройства что-то появится */
    suspend fun events(cursor: Long): Pair<Long, List<JSONObject>> {
        val r = request("GET", "/events?cursor=$cursor", long = true)
        return r.optLong("cursor", cursor) to r.arr("events").objects()
    }

    suspend fun connectDevices(): List<ConnectDevice> = request("GET", "/connect/devices").arr("devices").objects().map { parseDevice(it) }

    fun parseQueue(q: JSONObject?): HandoffQueue? {
        q ?: return null
        val tracks = q.arr("tracks").objects().mapNotNull { parseTrack(it) }
        if (tracks.isEmpty()) return null
        return HandoffQueue(tracks, q.optInt("index").coerceIn(0, tracks.lastIndex), q.optString("label"), q.optString("mode", "list"))
    }

    fun parseDevice(d: JSONObject) = ConnectDevice(
        deviceId = d.optString("deviceId"), device = d.optString("device"), platform = d.optString("platform"),
        current = d.optBoolean("current"), online = d.optBoolean("online", true),
        track = d.obj("track")?.let { parseTrack(it) }, positionSec = d.optDouble("position", 0.0), playing = d.optBoolean("playing"),
        updatedAt = d.optLong("updatedAt", System.currentTimeMillis()), volume = if (d.has("volume") && !d.isNull("volume")) d.optDouble("volume") else null,
        lastSeen = d.str("lastSeen"),
        queue = parseQueue(d.obj("queue")),
    )

    suspend fun connectCmd(deviceId: String, cmd: String, args: JSONObject = JSONObject()) {
        request("POST", "/connect/$deviceId/cmd", JSONObject().put("cmd", cmd).put("args", args))
    }

    fun trackJson(t: Track): JSONObject = JSONObject().put("id", t.id).put("source", t.source).put("srcId", t.srcId).put("title", t.title).put("artist", t.artist)
        .put("album", t.album).put("albumId", t.albumId ?: JSONObject.NULL).put("duration", t.duration).put("cover", t.cover ?: JSONObject.NULL)

    fun parseTrack(t: JSONObject): Track? {
        val track = Track(
            id = t.optString("id"), source = t.optString("source"), srcId = t.optString("srcId"),
            title = t.optString("title"), artist = t.optString("artist"), album = t.optString("album"),
            albumId = t.str("albumId"), duration = t.optInt("duration"), cover = t.str("cover"),
        )
        return if (track.id.isEmpty() || track.srcId.isEmpty()) null else track
    }

    fun parseRoom(o: JSONObject?, isHost: Boolean? = null): Room? {
        o ?: return null
        val st = o.obj("state")
        return Room(
            code = o.optString("code"),
            hostName = o.obj("host")?.optString("name") ?: "Хост",
            hostPicture = o.obj("host")?.str("picture"),
            members = o.arr("members").objects().map { it.optString("name") },
            isHost = isHost ?: o.optBoolean("isHost"),
            state = st?.let { RoomState(it.obj("track")?.let { t -> parseTrack(t) }, it.optDouble("position", 0.0), it.optBoolean("playing")) },
        )
    }

    suspend fun roomCurrent(): Room? = if (!loggedIn) null else parseRoom(request("GET", "/rooms/current").obj("room"))
    suspend fun roomCreate(): Room = parseRoom(request("POST", "/rooms").obj("room"))!!
    suspend fun roomJoin(code: String): Room = parseRoom(request("POST", "/rooms/$code/join").obj("room"))!!
    suspend fun roomLeave(code: String) {
        runCatching { request("POST", "/rooms/$code/leave") }
    }
    suspend fun roomState(code: String, t: Track?, positionSec: Double, playing: Boolean) {
        val body = JSONObject().put("position", positionSec).put("playing", playing).put("track", t?.let { trackJson(it) } ?: JSONObject.NULL)
        request("PUT", "/rooms/$code/state", body)
    }
    suspend fun roomReact(code: String, emoji: String) {
        request("POST", "/rooms/$code/react", JSONObject().put("emoji", emoji))
    }

    suspend fun stats(period: String): JSONObject {
        val tz = java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
        return request("GET", "/stats?period=$period&tz=$tz")
    }

    suspend fun others(): List<RemoteNow> {
        if (!loggedIn) return emptyList()
        return request("GET", "/now").arr("devices").objects().mapNotNull { d ->
            val t = d.obj("track") ?: return@mapNotNull null
            val track = Track(
                id = t.optString("id"), source = t.optString("source"), srcId = t.optString("srcId"),
                title = t.optString("title"), artist = t.optString("artist"), album = t.optString("album"),
                albumId = t.str("albumId"), duration = t.optInt("duration"), cover = t.str("cover"),
            )
            if (track.id.isEmpty() || track.srcId.isEmpty()) return@mapNotNull null
            RemoteNow(d.optString("deviceId"), d.optString("device"), d.optString("platform"), track, d.optDouble("position", 0.0), d.optBoolean("playing"), d.optLong("updatedAt"), parseQueue(d.obj("queue")))
        }
    }
}

/** Устройство для Nyao Connect */
data class ConnectDevice(
    val deviceId: String, val device: String, val platform: String, val current: Boolean, val online: Boolean,
    val track: Track?, val positionSec: Double, val playing: Boolean, val updatedAt: Long, val volume: Double?, val lastSeen: String?,
    val queue: HandoffQueue? = null,
) {
    /** Где сейчас трек: позиция + сколько прошло с последнего сообщения */
    fun livePosition(now: Long = System.currentTimeMillis()): Double {
        val p = positionSec + if (playing) (now - updatedAt) / 1000.0 else 0.0
        val d = track?.duration ?: 0
        return if (d > 0) minOf(p, d.toDouble()) else p
    }
}

data class RoomState(val track: Track?, val positionSec: Double, val playing: Boolean)
data class Room(val code: String, val hostName: String, val hostPicture: String?, val members: List<String>, val isHost: Boolean, val state: RoomState?)

data class Maintenance(val active: Boolean = false, val title: String = "", val text: String = "", val until: String = "")

/** Статус с сервера Nyao: техработы (заглушка) и какие сервисы сейчас лежат (их пропускаем) */
data class SvcStatus(val maintenance: Maintenance = Maintenance(), val outages: List<String> = emptyList())
