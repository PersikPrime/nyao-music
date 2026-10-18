package org.nyao.music.spotify

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.edit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.Request
import org.json.JSONObject
import org.nyao.music.data.Net
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Вход в Spotify: OAuth 2.0 Authorization Code + PKCE (по движку из spotify-web-playback-engine).
 * Client ID у каждого пользователя свой — приложение из его Spotify Developer Dashboard.
 * Client Secret не нужен. Токены лежат только на этом телефоне, в отдельном файле настроек.
 */
class SpotifyAuth(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("nyao_spotify", Context.MODE_PRIVATE)
    private val refreshMutex = Mutex()

    private val _loggedIn = MutableStateFlow(prefs.getString(KEY_REFRESH, null) != null)
    val loggedIn: StateFlow<Boolean> = _loggedIn

    /** Client ID из Spotify Developer Dashboard (32 hex-символа) */
    var clientId: String
        get() = prefs.getString(KEY_CLIENT, "").orEmpty()
        set(v) {
            val id = v.trim()
            if (id == clientId) return
            // токены выданы другому приложению — с новым Client ID они не годятся
            prefs.edit { clear(); putString(KEY_CLIENT, id) }
            _loggedIn.value = false
        }

    val hasClientId: Boolean get() = CLIENT_RE.matches(clientId)

    /** Открывает страницу входа Spotify. Ответ придёт в MainActivity через nyao://spotify-callback */
    fun login(activity: Context) {
        require(hasClientId) { "Сначала впиши Client ID" }
        val verifier = randomUrlSafe(64)
        val state = randomUrlSafe(16)
        // на диск: пока человек в браузере, процесс могут убить
        prefs.edit { putString(KEY_VERIFIER, verifier); putString(KEY_STATE, state) }
        val uri = Uri.parse(AUTHORIZE_URL).buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("redirect_uri", REDIRECT_URI)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", challengeOf(verifier))
            .appendQueryParameter("scope", SCOPES.joinToString(" "))
            .appendQueryParameter("state", state)
            .build()
        CustomTabsIntent.Builder().build().launchUrl(activity, uri)
    }

    fun isRedirect(uri: Uri?): Boolean = uri != null && uri.scheme == "nyao" && uri.host == "spotify-callback"

    /** Меняет code на токены */
    suspend fun handleRedirect(uri: Uri) {
        uri.getQueryParameter("error")?.let { throw SpotifyException(if (it == "access_denied") "Вход отменён" else "Spotify: $it") }
        val code = uri.getQueryParameter("code") ?: throw SpotifyException("Spotify не прислал код входа")
        val expected = prefs.getString(KEY_STATE, null)
        if (expected == null || expected != uri.getQueryParameter("state")) throw SpotifyException("Ответ входа не совпал — попробуй ещё раз")
        val verifier = prefs.getString(KEY_VERIFIER, null) ?: throw SpotifyException("Вход устарел — попробуй ещё раз")
        val t = requestToken(
            FormBody.Builder()
                .add("grant_type", "authorization_code")
                .add("code", code)
                .add("redirect_uri", REDIRECT_URI)
                .add("client_id", clientId)
                .add("code_verifier", verifier)
                .build(),
        )
        prefs.edit { remove(KEY_VERIFIER); remove(KEY_STATE) }
        save(t)
    }

    /** Действующий access token; обновляет, если до конца меньше минуты */
    suspend fun accessToken(force: Boolean = false): String = refreshMutex.withLock {
        val access = prefs.getString(KEY_ACCESS, null)
        val expiresAt = prefs.getLong(KEY_EXPIRES, 0L)
        if (!force && access != null && System.currentTimeMillis() < expiresAt - 60_000) return access
        val refresh = prefs.getString(KEY_REFRESH, null) ?: throw SpotifyException("Нужно войти в Spotify")
        val t = requestToken(
            FormBody.Builder()
                .add("grant_type", "refresh_token")
                .add("refresh_token", refresh)
                .add("client_id", clientId)
                .build(),
        )
        save(t)
        t.getString("access_token")
    }

    fun logout() {
        val id = clientId
        prefs.edit { clear(); putString(KEY_CLIENT, id) }
        _loggedIn.value = false
    }

    private suspend fun requestToken(body: FormBody): JSONObject = withContext(Dispatchers.IO) {
        val (code, text) = Net.execute(Request.Builder().url(TOKEN_URL).post(body).build())
        if (code !in 200..299) {
            // invalid_grant — доступ отозван, нужен новый вход
            if (code == 400 && text.contains("invalid_grant")) logout()
            throw SpotifyException("Spotify не выдал доступ ($code): " + text.take(200))
        }
        JSONObject(text)
    }

    private fun save(t: JSONObject) {
        prefs.edit {
            putString(KEY_ACCESS, t.getString("access_token"))
            putLong(KEY_EXPIRES, System.currentTimeMillis() + t.optLong("expires_in", 3600) * 1000L)
            // при обновлении Spotify может не прислать новый refresh_token — тогда остаётся старый
            t.optString("refresh_token").takeIf { it.isNotEmpty() }?.let { putString(KEY_REFRESH, it) }
        }
        _loggedIn.value = true
    }

    companion object {
        const val REDIRECT_URI = "nyao://spotify-callback"
        private const val AUTHORIZE_URL = "https://accounts.spotify.com/authorize"
        private const val TOKEN_URL = "https://accounts.spotify.com/api/token"
        private val CLIENT_RE = Regex("^[0-9a-fA-F]{32}$")

        /** streaming + user-read-email/private — для Web Playback SDK, остальное — для Web API */
        val SCOPES = listOf(
            "streaming",
            "user-read-email",
            "user-read-private",
            "user-read-playback-state",
            "user-modify-playback-state",
            "user-library-read",
            "user-library-modify",
            "playlist-read-private",
            "playlist-read-collaborative",
        )

        private const val KEY_CLIENT = "client_id"
        private const val KEY_ACCESS = "access_token"
        private const val KEY_REFRESH = "refresh_token"
        private const val KEY_EXPIRES = "expires_at"
        private const val KEY_VERIFIER = "pkce_verifier"
        private const val KEY_STATE = "pkce_state"

        private fun randomUrlSafe(bytes: Int): String {
            val buf = ByteArray(bytes).also { SecureRandom().nextBytes(it) }
            return Base64.encodeToString(buf, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        }

        private fun challengeOf(verifier: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
            return Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        }
    }
}

class SpotifyException(message: String, val code: Int = 0) : java.io.IOException(message)
