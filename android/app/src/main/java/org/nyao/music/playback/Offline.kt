package org.nyao.music.playback

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.CacheWriter
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.nyao.music.data.Playlist
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_SC
import org.nyao.music.data.SOURCE_VK
import org.nyao.music.data.Track
import org.nyao.music.data.objects
import org.nyao.music.data.trackFromJson
import org.nyao.music.data.trackToJson
import java.io.File

/**
 * Скачанное для прослушивания без интернета.
 * Файлы лежат в отдельном кэше без автоудаления (filesDir/offline), ключ — та же ссылка nyao://сервис/id,
 * что и у плеера, поэтому плеер находит скачанное сам и в сеть не ходит.
 * SoundCloud и VK отдают звук кусками по временным ссылкам (HLS) — их пока скачать нельзя.
 */
@OptIn(UnstableApi::class)
object Offline {
    const val PLAYLIST_ID = "offline"

    data class State(
        /** Скачанные треки, новые сверху */
        val tracks: List<Track> = emptyList(),
        /** Плейлисты, скачанные целиком: id → название */
        val playlists: Map<String, String> = emptyMap(),
        /** Что сейчас качается: id плейлиста → (готово, всего) */
        val progress: Map<String, Pair<Int, Int>> = emptyMap(),
    ) {
        /** Считается один раз на состояние — его читают все значки «скачано» в списках */
        val ids: Set<String> by lazy { tracks.mapTo(HashSet()) { it.id } }
    }

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    @Volatile private var cache: SimpleCache? = null
    private lateinit var file: File
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val jobs = HashMap<String, Job>()

    fun canDownload(t: Track): Boolean = t.source != SOURCE_SC && t.source != SOURCE_VK && t.source != org.nyao.music.data.SOURCE_SP && t.available

    fun init(context: Context) {
        if (cache != null) return
        synchronized(this) {
            if (cache != null) return
            val app = context.applicationContext
            file = File(app.filesDir, "offline.json")
            cache = SimpleCache(File(app.filesDir, "offline"), NoOpCacheEvictor(), PlaybackCache.database(app))
            _state.value = read()
        }
    }

    fun cache(context: Context): SimpleCache {
        init(context)
        return cache!!
    }

    fun sizeBytes(context: Context): Long = cache(context).cacheSpace

    private fun read(): State = runCatching {
        val o = JSONObject(file.readText())
        val pl = o.optJSONObject("playlists")
        State(
            tracks = o.optJSONArray("tracks").objects().mapNotNull { trackFromJson(it) },
            playlists = pl?.keys()?.asSequence()?.associateWith { pl.optString(it) } ?: emptyMap(),
        )
    }.getOrDefault(State())

    private fun save(s: State) {
        _state.value = s
        runCatching {
            file.writeText(
                JSONObject()
                    .put("tracks", JSONArray().apply { s.tracks.forEach { put(trackToJson(it)) } })
                    .put("playlists", JSONObject().apply { s.playlists.forEach { (k, v) -> put(k, v) } })
                    .toString(),
            )
        }
    }

    @Synchronized
    private fun update(block: (State) -> State) = save(block(_state.value))

    fun asPlaylist(): Playlist? {
        val s = _state.value
        if (s.tracks.isEmpty()) return null
        return Playlist(PLAYLIST_ID, "mix", "Скачанное", s.tracks.size, s.tracks.firstOrNull { it.cover != null }?.cover, "Без интернета")
    }

    private fun uri(t: Track): Uri = Uri.parse("nyao://${t.source}/${Uri.encode(t.srcId)}")

    /** Источник для загрузки: nyao:// → настоящая ссылка сервиса (как в плеере) */
    private fun upstream(): DataSource.Factory {
        val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true).setConnectTimeoutMs(15_000).setReadTimeoutMs(30_000)
        val chunked = DataSource.Factory { ChunkedDataSource(http.createDataSource()) }
        return ResolvingDataSource.Factory(chunked) { spec ->
            if (spec.uri.scheme != "nyao") spec
            else {
                val r = Repo.resolve(spec.uri)
                val headers = HashMap(spec.httpRequestHeaders)
                r.userAgent?.let { headers["User-Agent"] = it }
                spec.buildUpon().setUri(Uri.parse(r.url)).setHttpRequestHeaders(headers).build()
            }
        }
    }

    /** Скачивает треки плейлиста. Уже скачанные пропускаются; SoundCloud и VK — тоже (их нельзя) */
    fun download(context: Context, playlistId: String, title: String, tracks: List<Track>) {
        init(context)
        if (jobs[playlistId]?.isActive == true) return
        val list = tracks.filter { canDownload(it) }.distinctBy { it.id }
        update { it.copy(playlists = it.playlists + (playlistId to title), progress = it.progress + (playlistId to (0 to list.size))) }
        jobs[playlistId] = scope.launch {
            val c = cache!!
            val ds = CacheDataSource.Factory()
                .setCache(c)
                .setUpstreamDataSourceFactory(upstream())
                .setCacheKeyFactory { spec -> spec.uri.toString() }
                .createDataSource()
            var done = 0
            var failed = 0
            for (t in list) {
                if (!isActive) break
                if (t.id !in _state.value.ids || !isFullyCached(t)) {
                    val ok = runCatching {
                        Repo.rememberTrack(t)
                        CacheWriter(ds, DataSpec(uri(t)), null, null).cache()
                    }.onFailure { Log.w("Nyao", "офлайн ${t.id}: ${it.message}") }.isSuccess
                    if (ok) update { s -> s.copy(tracks = listOf(t) + s.tracks.filter { it.id != t.id }) } else failed++
                }
                done++
                update { it.copy(progress = it.progress + (playlistId to (done to list.size))) }
            }
            update { it.copy(progress = it.progress - playlistId) }
            val skipped = tracks.size - list.size
            PlaybackEvents.emit(
                "«$title»: скачано ${done - failed} из ${list.size}" +
                    (if (failed > 0) ", $failed не получилось (попробуй ещё раз)" else "") +
                    (if (skipped > 0) ". SoundCloud и VK скачать пока нельзя ($skipped)" else ""),
            )
        }
    }

    fun cancel(playlistId: String) {
        jobs.remove(playlistId)?.cancel()
        update { it.copy(progress = it.progress - playlistId) }
    }

    private fun isFullyCached(t: Track): Boolean {
        val c = cache ?: return false
        val key = uri(t).toString()
        val len = androidx.media3.datasource.cache.ContentMetadata.getContentLength(c.getContentMetadata(key))
        return len > 0 && c.isCached(key, 0, len)
    }

    /** Удаляет скачанное плейлиста (треки, которые есть в других скачанных плейлистах, тоже — проще и честнее) */
    fun remove(playlistId: String, tracks: List<Track>) {
        cancel(playlistId)
        val ids = tracks.mapTo(HashSet()) { it.id }
        scope.launch {
            val c = cache ?: return@launch
            tracks.forEach { runCatching { c.removeResource(uri(it).toString()) } }
            update { s -> s.copy(tracks = s.tracks.filter { it.id !in ids }, playlists = s.playlists - playlistId) }
        }
    }

    fun removeAll() {
        jobs.values.forEach { it.cancel() }
        jobs.clear()
        scope.launch {
            val c = cache ?: return@launch
            c.keys.toList().forEach { runCatching { c.removeResource(it) } }
            save(State())
        }
    }
}
