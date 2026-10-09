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
)

/** Центр обновлений: смотрит последний релиз в github.com/PersikPrime/nyao-music */
object Updates {
    const val REPO = "PersikPrime/nyao-music"

    /** v0.3.19 → ("0.3", 19) */
    fun parseTag(tag: String?): Pair<String, Int>? {
        val m = Regex("^v?(\\d+\\.\\d+)\\.(\\d+)$").find(tag?.trim() ?: return null) ?: return null
        return m.groupValues[1] to m.groupValues[2].toInt()
    }

    suspend fun check(currentBuild: Int): UpdateInfo {
        val req = Request.Builder()
            .url("https://api.github.com/repos/$REPO/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "NyaoMusic-Android")
            .build()
        val (code, text) = Net.call(req)
        if (code == 404) return UpdateInfo(false, null, 0, null, 0, null, "")
        if (code !in 200..299) throw ApiException("GitHub ответил $code (репозиторий приватный или лимит запросов)", code)
        val rel = JSONObject(text)
        val tag = parseTag(rel.str("tag_name"))
        val apk = rel.arr("assets").objects().firstOrNull { it.optString("name").endsWith(".apk") }
        return UpdateInfo(
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
