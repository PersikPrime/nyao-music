package org.nyao.music.ui.screens

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.launch
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.YandexApi

private const val YT_LOGIN =
    "https://accounts.google.com/ServiceLogin?service=youtube&hl=ru&continue=https%3A%2F%2Fmusic.youtube.com%2F"

// Google не пускает во встроенный браузер с «обычным» отпечатком WebView — представляемся Firefox
private const val FIREFOX_UA = "Mozilla/5.0 (Android 14; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0"

/**
 * Вход через страницу сервиса во встроенном окне.
 * Яндекс: ловим access_token из адреса после редиректа. YouTube: после входа забираем cookies music.youtube.com.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LoginScreen(source: String, onClose: (Boolean) -> Unit) {
    val ya = source == SOURCE_YA
    val isSc = source == org.nyao.music.data.SOURCE_SC
    val isVk = source == org.nyao.music.data.SOURCE_VK
    val scope = rememberCoroutineScope()
    var web by remember { mutableStateOf<WebView?>(null) }
    val close by rememberUpdatedState(onClose)
    var loading by remember { mutableStateOf(true) }
    var done by remember { mutableStateOf(false) }

    fun check(url: String?): Boolean {
        if (url == null || done) return false
        if (ya) {
            val fragment = Uri.parse(url).fragment ?: return false
            if (!fragment.contains("access_token=")) return false
            val token = fragment.split("&").firstOrNull { it.startsWith("access_token=") }?.substringAfter("=") ?: return false
            done = true
            scope.launch {
                Repo.setYandexToken(Uri.decode(token))
                close(true)
            }
            return true
        }
        if (isSc) {
            // SoundCloud после входа кладёт OAuth-токен в cookie oauth_token
            val cookie = CookieManager.getInstance().getCookie("https://soundcloud.com") ?: return false
            val token = cookie.split(";").map { it.trim() }.firstOrNull { it.startsWith("oauth_token=") }?.substringAfter("=") ?: return false
            done = true
            CookieManager.getInstance().flush()
            scope.launch {
                Repo.setScToken(Uri.decode(token))
                close(true)
            }
            return false
        }
        if (url.startsWith("https://music.youtube.com")) {
            val cookie = CookieManager.getInstance().getCookie("https://music.youtube.com") ?: return false
            if (!cookie.contains("SAPISID")) return false
            done = true
            CookieManager.getInstance().flush()
            scope.launch {
                Repo.setYtCookie(cookie)
                close(true)
            }
        }
        return false
    }

    // VK: после входа в глобальном объекте страницы vk лежит id пользователя — так не зависим от имён cookie
    fun checkVk() {
        val w = web ?: return
        if (done) return
        w.evaluateJavascript("JSON.stringify({ uid: (window.vk && Number(window.vk.id)) || 0, origin: location.origin })") { res ->
            if (done || res == null || res == "null") return@evaluateJavascript
            val o = runCatching { org.json.JSONObject(org.json.JSONTokener(res).nextValue() as String) }.getOrNull() ?: return@evaluateJavascript
            val uid = o.optLong("uid")
            if (uid <= 0) return@evaluateJavascript
            val origin = o.optString("origin").let {
                if (Regex("^https://([a-z0-9-]+\\.)?vk\\.(com|ru)$").matches(it)) it.replace(Regex("//(m|new)\\."), "//") else "https://vk.com"
            }
            done = true
            CookieManager.getInstance().flush()
            scope.launch {
                Repo.setVk(uid, origin)
                close(true)
            }
        }
    }

    if (isVk) androidx.compose.runtime.LaunchedEffect(Unit) {
        while (!done) {
            kotlinx.coroutines.delay(1500)
            checkVk()
        }
    }

    // Вход SoundCloud — одностраничный, поэтому cookie проверяем ещё и по таймеру
    if (isSc) androidx.compose.runtime.LaunchedEffect(Unit) {
        while (!done) {
            kotlinx.coroutines.delay(1000)
            check("https://soundcloud.com/")
        }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { close(false) }) { Icon(Icons.Rounded.Close, "Закрыть") }
            Text(
                if (ya) "Вход в Яндекс Музыку" else if (isSc) "Вход в SoundCloud" else if (isVk) "Вход во VK" else "Вход в YouTube Music",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f),
            )
            if (loading) CircularProgressIndicator(Modifier.padding(end = 16.dp).size(20.dp), strokeWidth = 2.dp)
        }
        AndroidView(
            modifier = Modifier.weight(1f).fillMaxWidth(),
            factory = { ctx ->
                WebView(ctx).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.useWideViewPort = true
                    settings.loadWithOverviewMode = true
                    settings.textZoom = 100
                    layoutParams = android.view.ViewGroup.LayoutParams(-1, -1)
                    web = this
                    if (!ya) {
                        // VK: десктопная версия сайта (в мобильной нет window.vk.id), тот же UA, что у запросов VkApi
                        settings.userAgentString = if (isVk) org.nyao.music.data.VkApi.UA else FIREFOX_UA
                        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
                            WebSettingsCompat.setRequestedWithHeaderOriginAllowList(settings, emptySet())
                        }
                    }
                    CookieManager.getInstance().setAcceptCookie(true)
                    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                            if (isVk) false else check(request?.url?.toString())

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            loading = true
                            if (!isVk) check(url)
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            loading = false
                            if (isVk) checkVk() else check(url)
                        }
                    }
                    loadUrl(if (ya) YandexApi.OAUTH_URL else if (isSc) "https://soundcloud.com/signin" else if (isVk) "https://vk.com/login" else YT_LOGIN)
                }
            },
            onRelease = {
                web = null
                it.destroy()
            },
        )
    }
}
