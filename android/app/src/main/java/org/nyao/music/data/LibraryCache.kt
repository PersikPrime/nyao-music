package org.nyao.music.data

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Списки медиатеки на диске: лайки, плейлисты и треки открытых плейлистов.
 * Без интернета медиатека открывается из этих файлов; с интернетом они обновляются после каждой удачной загрузки.
 * Это только списки (названия, обложки, ссылки) — сам звук лежит в Offline.
 */
class LibraryCache(dir: File) {
    private val root = File(dir, "library").apply { mkdirs() }
    private val likedFile = File(root, "liked.json")
    private val playlistsFile = File(root, "playlists.json")
    private fun playlistFile(id: String) = File(root, "pl-${sha1(id)}.json")

    fun liked(): List<Track>? = readTracks(likedFile)
    fun saveLiked(list: List<Track>) = writeTracks(likedFile, list)

    fun playlists(): List<Playlist>? = runCatching { JSONArray(playlistsFile.readText()).objects().mapNotNull { playlistFromJson(it) } }.getOrNull()
    fun savePlaylists(list: List<Playlist>) = write(playlistsFile, JSONArray().apply { list.forEach { put(playlistToJson(it)) } }.toString())

    fun playlistTracks(id: String): List<Track>? = readTracks(playlistFile(id))
    fun savePlaylistTracks(id: String, list: List<Track>) = writeTracks(playlistFile(id), list)

    fun clear() {
        root.listFiles()?.forEach { runCatching { it.delete() } }
    }

    private fun readTracks(f: File): List<Track>? = runCatching { JSONArray(f.readText()).objects().mapNotNull { trackFromJson(it) } }.getOrNull()
    private fun writeTracks(f: File, list: List<Track>) = write(f, JSONArray().apply { list.forEach { put(trackToJson(it)) } }.toString())

    /** Пишем во временный файл и подменяем — прерванная запись не портит прошлый список */
    private fun write(f: File, text: String) {
        runCatching {
            val tmp = File(f.path + ".tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(f)) {
                f.writeText(text)
                tmp.delete()
            }
        }
    }
}

fun playlistToJson(p: Playlist): JSONObject = JSONObject()
    .put("id", p.id).put("source", p.source).put("title", p.title).put("count", p.count)
    .put("cover", p.cover ?: JSONObject.NULL).put("subtitle", p.subtitle).put("note", p.note)

fun playlistFromJson(o: JSONObject): Playlist? {
    val id = o.optString("id")
    if (id.isEmpty()) return null
    return Playlist(id, o.optString("source"), o.optString("title"), o.optInt("count"), o.str("cover"), o.optString("subtitle"), o.optString("note"))
}

/**
 * Свежие списки по сервисам, где null — сервис не ответил: на его место встаёт то, что лежало в кэше
 * от этого сервиса. Сервис, который ответил (пусть и пустым списком), кэш не трогает — так выход из
 * аккаунта убирает его треки, а временный сбой не стирает их.
 */
fun <T> fillFromCache(fresh: List<List<T>?>, cached: List<T>?, sources: List<String>, sourceOf: (T) -> String): List<List<T>> =
    fresh.mapIndexed { i, list -> list ?: cached?.filter { sourceOf(it) == sources[i] } ?: emptyList() }
