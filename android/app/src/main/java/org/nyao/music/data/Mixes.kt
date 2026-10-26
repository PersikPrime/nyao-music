package org.nyao.music.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** «Мой микс»: свой плейлист из треков любых сервисов. Тот же формат, что у десктопа (mixes.json) */
data class Mix(val id: String, val title: String, val tracks: List<Track>) {
    fun asPlaylist() = Playlist(id, "mix", title, tracks.size, tracks.firstOrNull { it.cover != null }?.cover, "Мой микс")
}

fun trackToJson(t: Track): JSONObject = JSONObject()
    .put("id", t.id).put("source", t.source).put("srcId", t.srcId).put("title", t.title).put("artist", t.artist)
    .put("likedAt", t.likedAt).put("isrc", t.isrc ?: JSONObject.NULL).put("waveReason", t.waveReason ?: JSONObject.NULL)
    .put("album", t.album).put("albumId", t.albumId ?: JSONObject.NULL).put("duration", t.duration).put("cover", t.cover ?: JSONObject.NULL)

fun trackFromJson(o: JSONObject): Track? {
    val id = o.optString("id")
    if (id.isEmpty()) return null
    val i = id.indexOf(':')
    return Track(
        id = id,
        source = o.str("source") ?: id.substring(0, maxOf(0, i)),
        srcId = o.str("srcId") ?: id.substring(i + 1),
        title = o.optString("title"),
        artist = o.optString("artist"),
        album = o.optString("album"),
        albumId = o.str("albumId"),
        duration = o.optInt("duration"),
        cover = o.str("cover"),
        likedAt = o.optLong("likedAt"),
        isrc = o.str("isrc"),
        waveReason = o.str("waveReason"),
    )
}

/** Хранилище миксов в файле; изменения уезжают на другие устройства через аккаунт Nyao */
class MixStore(dir: File) {
    private val file = File(dir, "mixes.json")
    private val _mixes = MutableStateFlow(read())
    val mixes: StateFlow<List<Mix>> = _mixes

    /** Вызывается после каждого изменения (Repo отправляет миксы на сервер) */
    var onChange: (() -> Unit)? = null

    private fun read(): List<Mix> = runCatching { fromJson(JSONArray(file.readText())) }.getOrDefault(emptyList())

    fun toJson(list: List<Mix> = _mixes.value): JSONArray = JSONArray().apply {
        list.forEach { m ->
            put(JSONObject().put("id", m.id).put("title", m.title).put("tracks", JSONArray().apply { m.tracks.forEach { put(trackToJson(it)) } }))
        }
    }

    fun fromJson(arr: JSONArray): List<Mix> = arr.objects().mapNotNull { o ->
        val id = o.optString("id").takeIf { it.startsWith("mix:") } ?: return@mapNotNull null
        Mix(id, o.optString("title", "Микс"), o.arr("tracks").objects().mapNotNull { trackFromJson(it) })
    }

    /** push = false — изменение пришло с сервера, назад не отправляем */
    fun set(list: List<Mix>, push: Boolean = true) {
        _mixes.value = list
        file.writeText(toJson(list).toString())
        if (push) onChange?.invoke()
    }

    fun create(title: String, tracks: List<Track>): Mix {
        val m = Mix("mix:${UUID.randomUUID()}", title.take(80).ifBlank { "Новый микс" }, tracks.distinctBy { it.id })
        set(listOf(m) + _mixes.value)
        return m
    }

    fun get(id: String): Mix? = _mixes.value.firstOrNull { it.id == id }

    fun delete(id: String) = set(_mixes.value.filterNot { it.id == id })

    fun add(id: String, t: Track) = set(_mixes.value.map { if (it.id == id && it.tracks.none { x -> x.id == t.id }) it.copy(tracks = it.tracks + t) else it })

    /** Первый вход на этом устройстве: объединяем свои и серверные миксы по id, треки — без дублей */
    fun merge(local: List<Mix>, remote: List<Mix>): List<Mix> {
        val byId = LinkedHashMap<String, Mix>()
        remote.forEach { byId[it.id] = it }
        local.forEach { m ->
            val r = byId[m.id]
            byId[m.id] = if (r == null) m else r.copy(tracks = r.tracks + m.tracks.filter { t -> r.tracks.none { it.id == t.id } })
        }
        return byId.values.toList()
    }
}
