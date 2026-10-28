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

    /** v0.3.19 → ("0.3", 19); v0.8.89-dev → ("0.8", 89) */
    fun parseTag(tag: String?): Pair<String, Int>? {
        val m = Regex("^v?(\\d+\\.\\d+)\\.(\\d+)(?:-[a-z]+)?$").find(tag?.trim() ?: return null) ?: return null
        return m.groupValues[1] to m.groupValues[2].toInt()
    }

    /** Канал пререлиза из тега: v0.8.89-dev → "dev", обычный релиз → null */
    fun channelOf(tag: String?): String? {
        val t = tag?.trim() ?: return null
        return Regex("-([a-z]+)$").find(t)?.groupValues?.get(1)
    }

    /** Каналы обновлений — как в центре обновлений macOS: обычные релизы, бета (dev), ночные сборки */
    val CHANNELS = listOf("stable" to "Обычные релизы", "dev" to "Бета (dev)", "nightly" to "Ночные сборки")

    /** Зеркало релизов на сервере Nyao: из РФ качается быстрее, чем с GitHub */
    const val MIRROR = "https://api.music.withnyao.app/updates/latest"
    /** Прежний адрес зеркала — на случай, если новый домен где-то не открывается */
    private const val LEGACY_MIRROR = "https://api.nmusic.bixtl.cc/updates/latest"

    /** channel: stable | dev | nightly. Канал получает свой пререлиз, а если обычный релиз новее — его */
    private suspend fun latest(channel: String): JSONObject? {
        val q = if (channel == "stable") "" else "?channel=$channel"
        for (url in listOf(MIRROR, LEGACY_MIRROR)) runCatching {
            val (code, text) = Net.call(Request.Builder().url(url + q).header("User-Agent", "NyaoMusic-Android").build())
            if (code in 200..299) JSONObject(text).takeIf { it.has("tag_name") }?.let { return it }
        }
        if (channel != "stable") {
            val (code, text) = Net.call(
                Request.Builder().url("https://api.github.com/repos/$REPO/releases?per_page=30")
                    .header("Accept", "application/vnd.github+json").header("User-Agent", "NyaoMusic-Android").build(),
            )
            if (code in 200..299) {
                val list = org.json.JSONArray(text).objects().filter { !it.optBoolean("draft") }
                val own = list.filter { channelOf(it.optString("tag_name")) == channel }.maxByOrNull { parseTag(it.optString("tag_name"))?.second ?: 0 }
                val stable = list.firstOrNull { !it.optBoolean("prerelease") && channelOf(it.optString("tag_name")) == null && parseTag(it.optString("tag_name")) != null }
                val ownB = own?.let { parseTag(it.optString("tag_name"))?.second } ?: 0
                val stB = stable?.let { parseTag(it.optString("tag_name"))?.second } ?: 0
                (if (own != null && ownB > stB) own else stable)?.let { return it }
            }
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

    /** Канал из настроек; пусто — как у установленной сборки */
    fun channel(): String = runCatching { Repo.prefs.settings.value.updateChannel }.getOrNull()?.takeIf { it in CHANNELS.map { c -> c.first } }
        ?: org.nyao.music.BuildConfig.CHANNEL.takeIf { it in CHANNELS.map { c -> c.first } } ?: "stable"

    suspend fun check(currentBuild: Int, channel: String = channel()): UpdateInfo {
        val rel = latest(channel) ?: return UpdateInfo(false, null, 0, null, 0, null, "")
        val tag = parseTag(rel.str("tag_name"))
        val apk = rel.arr("assets").objects().firstOrNull { it.optString("name").endsWith(".apk") }
        val minBuild = rel.optInt("min_build", 0)
        return UpdateInfo(
            required = minBuild > 0 && currentBuild < minBuild && tag != null && tag.second >= minBuild && apk != null,
            available = tag != null && tag.second > currentBuild && apk != null,
            label = tag?.let { "${it.first} (${it.second})" + (channelOf(rel.str("tag_name"))?.let { c -> " $c" } ?: "") },
            build = tag?.second ?: 0,
            apkUrl = apk?.str("browser_download_url"),
            apkSize = apk?.optLong("size") ?: 0,
            pageUrl = rel.str("html_url"),
            notes = rel.optString("body"),
        )
    }
}
