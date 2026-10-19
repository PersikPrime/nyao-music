package org.nyao.music.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class Settings(
    val ytmShare: Int = 30,
    /** Свежесть волны: 0 — все лайки поровну, 100 — почти только недавние */
    val waveFresh: Int = 60,
    val diversity: String = "any",
    val mood: String? = null,
    val onboarded: Boolean = false,
    /** Вид приложения: "player" (своя музыка на первом плане) или "wave" (акцент на волну); null — ещё не выбран */
    val layout: String? = null,
    /** «Мне нравится» отдельно по сервисам */
    val splitLiked: Boolean = false,
    /** Вкладка «Волна» в панели в режиме «Плеер» */
    val waveTab: Boolean = false,
    /** Эквалайзер: 10 полос (31 Гц … 16 кГц), дБ от -12 до 12 — как на ПК */
    val eqOn: Boolean = false,
    val eqPreset: String = "flat",
    val eqGains: List<Int> = List(10) { 0 },
    /** Выравнивать громкость (по данным Яндекса и YouTube) */
    val normalize: Boolean = false,
    /** Плавные переходы между треками, секунд (0 — выкл) */
    val fade: Int = 0,
    /** Список доиграл — продолжать похожим (радио по последнему треку) */
    val continueSimilar: Boolean = true,
    /** Трек из поиска: "similar" — дальше похожее, "list" — остальные результаты */
    val searchPlay: String = "similar",
    /** Акцентный цвет: lavender | coral | mint | sun | cover */
    val accent: String = "lavender",
    /** Оформление: тема и то, что собрано поверх неё */
    val theme: String = "expressive",
    val buttons: String = "cookie",
    val grid: String = "carousels",
    val covers: String = "rounded",
    val navLabels: Boolean = true,
) {
    val isWaveLayout: Boolean get() = layout == "wave"
}

/**
 * Настройки и токены. Хранятся в личных SharedPreferences приложения
 * (к ним нет доступа у других приложений; резервное копирование выключено в манифесте).
 */
class Prefs(context: Context) {
    private val sp: SharedPreferences = context.getSharedPreferences("nyao", Context.MODE_PRIVATE)
    private val _settings = MutableStateFlow(read())
    val settings: StateFlow<Settings> = _settings

    private fun read() = Settings(
        ytmShare = sp.getInt("ytmShare", 30),
        waveFresh = sp.getInt("waveFresh", 60).coerceIn(0, 100),
        diversity = sp.getString("diversity", "any") ?: "any",
        mood = sp.getString("mood", null),
        onboarded = sp.getBoolean("onboarded", false),
        layout = sp.getString("layout", null),
        splitLiked = sp.getBoolean("splitLiked", false),
        waveTab = sp.getBoolean("waveTab", false),
        eqOn = sp.getBoolean("eqOn", false),
        eqPreset = sp.getString("eqPreset", "flat") ?: "flat",
        eqGains = (sp.getString("eqGains", null) ?: "").split(",").mapNotNull { it.trim().toIntOrNull() }
            .takeIf { it.size == 10 }?.map { it.coerceIn(-12, 12) } ?: List(10) { 0 },
        normalize = sp.getBoolean("normalize", false),
        fade = sp.getInt("fade", 0).coerceIn(0, 10),
        continueSimilar = sp.getBoolean("continueSimilar", true),
        searchPlay = sp.getString("searchPlay", "similar") ?: "similar",
        accent = sp.getString("accent", "lavender") ?: "lavender",
        theme = sp.getString("theme", "expressive") ?: "expressive",
        buttons = sp.getString("lookButtons", "cookie") ?: "cookie",
        grid = sp.getString("lookGrid", "carousels") ?: "carousels",
        covers = sp.getString("lookCovers", "rounded") ?: "rounded",
        navLabels = sp.getBoolean("lookNavLabels", true),
    )

    /** Вызывается, когда меняется то, что синхронизируется через аккаунт Nyao: "wave" или "prefs" */
    var onSyncChange: ((String) -> Unit)? = null

    fun update(block: SharedPreferences.Editor.() -> Unit) {
        val e = sp.edit()
        e.block()
        e.apply()
        _settings.value = read()
    }

    fun setFresh(v: Int) = update { putInt("waveFresh", v.coerceIn(0, 100)) }.also { onSyncChange?.invoke("wave") }
    fun setShare(v: Int) = update { putInt("ytmShare", v.coerceIn(0, 100)) }.also { onSyncChange?.invoke("wave") }
    fun setDiversity(v: String) = update { putString("diversity", v) }.also { onSyncChange?.invoke("wave") }
    fun setMood(v: String?) = update { if (v == null) remove("mood") else putString("mood", v) }.also { onSyncChange?.invoke("wave") }
    fun setLayout(v: String) = update { putString("layout", if (v == "wave") "wave" else "player") }.also { onSyncChange?.invoke("prefs") }
    fun setSplitLiked(v: Boolean) = update { putBoolean("splitLiked", v) }.also { onSyncChange?.invoke("prefs") }
    fun setEq(on: Boolean, preset: String, gains: List<Int>) = update {
        putBoolean("eqOn", on)
        putString("eqPreset", preset)
        putString("eqGains", gains.joinToString(",") { it.coerceIn(-12, 12).toString() })
    }
    fun setNormalize(v: Boolean) = update { putBoolean("normalize", v) }
    fun setFade(v: Int) = update { putInt("fade", v.coerceIn(0, 10)) }
    fun setContinueSimilar(v: Boolean) = update { putBoolean("continueSimilar", v) }
    fun setSearchPlay(v: String) = update { putString("searchPlay", v) }
    fun setAccent(v: String) = update { putString("accent", v) }
    /** Готовая тема сбрасывает собранное поверх неё к своим значениям */
    fun setTheme(v: String) {
        val p = org.nyao.music.ui.theme.UiLook.preset(v)
        update {
            putString("theme", p.theme)
            putString("lookButtons", p.buttons)
            putString("lookGrid", p.grid)
            putString("lookCovers", p.covers)
            putBoolean("lookNavLabels", p.navLabels)
        }
    }
    fun setLookButtons(v: String) = update { putString("lookButtons", v) }
    fun setLookGrid(v: String) = update { putString("lookGrid", v) }
    fun setLookCovers(v: String) = update { putString("lookCovers", v) }
    fun setLookNavLabels(v: Boolean) = update { putBoolean("lookNavLabels", v) }
    fun setWaveTab(v: Boolean) = update { putBoolean("waveTab", v) }.also { onSyncChange?.invoke("prefs") }

    /** Когда ключ синхронизации («wave», «prefs», «mixes») последний раз менялся на этом устройстве */
    fun cloudStamp(key: String): Long = sp.getLong("cloudAt_$key", 0L)
    fun setCloudStamp(key: String, at: Long) = sp.edit().putLong("cloudAt_$key", at).apply()
    fun setOnboarded(v: Boolean) = update { putBoolean("onboarded", v) }

    var yandexToken: String?
        get() = sp.getString("yaToken", null)
        set(v) = sp.edit().apply { if (v == null) remove("yaToken") else putString("yaToken", v) }.apply()

    var ytCookie: String?
        get() = sp.getString("ytCookie", null)
        set(v) = sp.edit().apply { if (v == null) remove("ytCookie") else putString("ytCookie", v) }.apply()

    var scToken: String?
        get() = sp.getString("scToken", null)
        set(v) = sp.edit().apply { if (v == null) remove("scToken") else putString("scToken", v) }.apply()

    /** VK: id вошедшего пользователя и адрес сайта (vk.com или vk.ru). Сама сессия — cookie WebView */
    var vkUid: Long?
        get() = sp.getLong("vkUid", 0L).takeIf { it != 0L }
        set(v) = sp.edit().apply { if (v == null) remove("vkUid") else putLong("vkUid", v) }.apply()

    /** Когда сессию VK последний раз тихо продлевали (раз в 12 часов, см. Repo) */
    var vkRefreshedAt: Long
        get() = sp.getLong("vkRefreshedAt", 0L)
        set(v) = sp.edit().putLong("vkRefreshedAt", v).apply()

    var vkOrigin: String?
        get() = sp.getString("vkOrigin", null)
        set(v) = sp.edit().apply { if (v == null) remove("vkOrigin") else putString("vkOrigin", v) }.apply()

    /** Last.fm: имя и ключ сессии (выдаёт Last.fm после подтверждения; хранится только тут) */
    var lastfmName: String?
        get() = sp.getString("lastfmName", null)
        set(v) = sp.edit().apply { if (v == null) remove("lastfmName") else putString("lastfmName", v) }.apply()

    var lastfmKey: String?
        get() = sp.getString("lastfmKey", null)
        set(v) = sp.edit().apply { if (v == null) remove("lastfmKey") else putString("lastfmKey", v) }.apply()

    /** Аккаунт Nyao (свой сервер). Токены музыкальных сервисов на сервер не уходят */
    var nyaoToken: String?
        get() = sp.getString("nyaoToken", null)
        set(v) = sp.edit().apply { if (v == null) remove("nyaoToken") else putString("nyaoToken", v) }.apply()

    var nyaoUser: String?
        get() = sp.getString("nyaoUser", null)
        set(v) = sp.edit().apply { if (v == null) remove("nyaoUser") else putString("nyaoUser", v) }.apply()

    /** С каких треков начинались последние запуски волны — чтобы не начинать с одного и того же */
    var waveFirsts: List<String>
        get() = sp.getString("waveFirsts", "")!!.split(",").filter { it.isNotEmpty() }
        set(v) = sp.edit().putString("waveFirsts", v.joinToString(",")).apply()

    /** Любимые исполнители (JSON-массив FavArtist) */
    var favArtists: String
        get() = sp.getString("favArtists", "[]") ?: "[]"
        set(v) = sp.edit().putString("favArtists", v).apply()

    /** «Мои исполнители» из Яндекса уже подтянуты */
    var favImportedYa: Boolean
        get() = sp.getBoolean("favImportedYa", false)
        set(v) = sp.edit().putBoolean("favImportedYa", v).apply()

    /** Отложенные лайки SoundCloud: "id:1" (поставить) или "id:0" (снять) */
    var scPendingLikes: Set<String>
        get() = sp.getStringSet("scPending", emptySet()) ?: emptySet()
        set(v) = sp.edit().putStringSet("scPending", v).apply()
}
