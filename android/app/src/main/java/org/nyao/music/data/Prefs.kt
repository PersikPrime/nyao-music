package org.nyao.music.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class Settings(
    val ytmShare: Int = 30,
    val diversity: String = "favorite",
    val mood: String? = null,
    val onboarded: Boolean = false,
)

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
        diversity = sp.getString("diversity", "favorite") ?: "favorite",
        mood = sp.getString("mood", null),
        onboarded = sp.getBoolean("onboarded", false),
    )

    fun update(block: SharedPreferences.Editor.() -> Unit) {
        val e = sp.edit()
        e.block()
        e.apply()
        _settings.value = read()
    }

    fun setShare(v: Int) = update { putInt("ytmShare", v.coerceIn(0, 100)) }
    fun setDiversity(v: String) = update { putString("diversity", v) }
    fun setMood(v: String?) = update { if (v == null) remove("mood") else putString("mood", v) }
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
}
