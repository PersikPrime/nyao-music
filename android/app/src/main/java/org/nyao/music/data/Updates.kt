package org.nyao.music.data

import okhttp3.Request
import org.json.JSONObject

/** Свежий релиз на GitHub: номер сборки и ссылка на APK */
data class UpdateInfo(
    val available: Boolean,
    val label: String?,
    val build: Int,
    val apkUrl: String?,
    val apkSize: Long,
    val pageUrl: String?,
    val notes: String,
    /** Сервер Nyao требует обновиться: эта сборка ниже минимальной */
    val required: Boolean = false,
)

/** Центр обновлений: последний релиз — с зеркала на сервере Nyao или с github.com/PersikPrime/nyao-music */
object Updates {
    const val REPO = "PersikPrime/nyao-music"

    /** v0.3.19 → ("0.3", 19) */
    fun parseTag(tag: String?): Pair<String, Int>? {
        val m = Regex("^v?(\\d+\\.\\d+)\\.(\\d+)$").find(tag?.trim() ?: return null) ?: return null
        return m.groupValues[1] to m.groupValues[2].toInt()
    }

    /** Зеркало релизов на сервере Nyao: из РФ качается быстрее, чем с GitHub */
    const val MIRROR = "https://api.music.withnyao.app/updates/latest"
    /** Прежний адрес зеркала — на случай, если новый домен где-то не открывается */
    private const val LEGACY_MIRROR = "https://api.nmusic.bixtl.cc/updates/latest"

    private suspend fun latest(): JSONObject? {
        for (url in listOf(MIRROR, LEGACY_MIRROR)) runCatching {
            val (code, text) = Net.call(Request.Builder().url(url).header("User-Agent", "NyaoMusic-Android").build())
            if (code in 200..299) JSONObject(text).takeIf { it.has("tag_name") }?.let { return it }
        }
        val req = Request.Builder()
            .url("https://api.github.com/repos/$REPO/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "NyaoMusic-Android")
            .build()
        val (code, text) = Net.call(req)
        if (code == 404) return null
        if (code !in 200..299) throw ApiException("GitHub ответил $code (репозиторий приватный или лимит запросов)", code)
        return JSONObject(text)
    }

    suspend fun check(currentBuild: Int): UpdateInfo {
        val rel = latest() ?: return UpdateInfo(false, null, 0, null, 0, null, "")
        val tag = parseTag(rel.str("tag_name"))
        val apk = rel.arr("assets").objects().firstOrNull { it.optString("name").endsWith(".apk") }
        val minBuild = rel.optInt("min_build", 0)
        return UpdateInfo(
            required = minBuild > 0 && currentBuild < minBuild && tag != null && tag.second >= minBuild && apk != null,
            available = tag != null && tag.second > currentBuild && apk != null,
            label = tag?.let { "${it.first} (${it.second})" },
            build = tag?.second ?: 0,
            apkUrl = apk?.str("browser_download_url"),
            apkSize = apk?.optLong("size") ?: 0,
            pageUrl = rel.str("html_url"),
            notes = rel.optString("body"),
        )
    }
}
