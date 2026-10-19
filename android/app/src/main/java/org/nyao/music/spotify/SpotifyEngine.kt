package org.nyao.music.spotify

import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.MainThread
import androidx.webkit.WebViewAssetLoader
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Устройство Spotify Connect внутри Nyao на официальном Web Playback SDK
 * (движок из spotify-web-playback-engine, переведён на org.json).
 *
 * SDK есть только на JavaScript, поэтому движок держит невидимый WebView с assets/spotify_player.html
 * и говорит с плеером через JS-мост. Звук играет сам SDK (Widevine системного WebView),
 * поэтому прослушивания засчитываются в Spotify как обычные.
 */
class SpotifyEngine(context: Context, private val auth: SpotifyAuth, private val api: SpotifyApi) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    sealed interface Status {
        data object Idle : Status
        data object Loading : Status
        data object Connecting : Status
        data class Ready(val deviceId: String) : Status
        data class NotReady(val deviceId: String) : Status
        data class Failed(val kind: String, val message: String) : Status
    }

    /** Нужная Nyao часть player_state_changed */
    data class Snapshot(
        val uri: String?,
        val linked: String?,
        val paused: Boolean,
        val position: Long,
        val duration: Long,
        val at: Long,
    ) {
        fun positionAt(now: Long): Long {
            if (paused) return position
            val p = position + (now - at)
            return if (duration > 0) p.coerceAtMost(duration) else p
        }

        fun isTrack(id: String): Boolean = uri == "spotify:track:$id" || linked == "spotify:track:$id"
    }

    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status

    private val _playback = MutableStateFlow<Snapshot?>(null)
    val playback: StateFlow<Snapshot?> = _playback

    /** Ошибки SDK и «автовоспроизведение заблокировано» */
    private val _errors = MutableSharedFlow<Pair<String, String>>(extraBufferCapacity = 16)
    val errors: SharedFlow<Pair<String, String>> = _errors

    private var webView: WebView? = null
    private val callSeq = AtomicInteger(0)
    private val pendingCalls = ConcurrentHashMap<Int, CompletableDeferred<String>>()

    val started: Boolean get() = webView != null

    /** Журнал движка для «Что-то не работает?»: события SDK, ошибки страницы, диагностика (без токенов) */
    private val log = ArrayDeque<String>()
    fun debugText(): String = synchronized(log) { log.joinToString("\n") }
    private fun note(s: String) = synchronized(log) {
        log.addLast(java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date()) + " " + s.take(400))
        while (log.size > 80) log.removeFirst()
    }

    @MainThread
    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    fun start() {
        if (webView != null) return
        _status.value = Status.Loading
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_DOMAIN)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(appContext))
            .build()
        webView = WebView(appContext).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // иначе Chromium не даст звуку стартовать без касания экрана
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            // Spotify официально поддерживает обычные браузеры, а WebView помечает себя «; wv».
            // Представляемся тем же Chrome той же версии, без пометки WebView; Widevine — настоящий, системный.
            settings.userAgentString = chromeUserAgent(settings.userAgentString)
            addJavascriptInterface(Bridge(), "AndroidBridge")
            webViewClient = object : WebViewClient() {
                // страница отдаётся с https://appassets.androidplatform.net: EME работает только в secure context
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assetLoader.shouldInterceptRequest(request.url)

                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) fail("engine", "Страница плеера не загрузилась: ${error.description}")
                }
            }
            webChromeClient = object : WebChromeClient() {
                // SDK использует Widevine через EME — разрешаем protected media только своей странице
                override fun onPermissionRequest(request: PermissionRequest) {
                    val wanted = PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID
                    // наша страница и фрейм официального SDK (sdk.scdn.co) — именно в нём SDK запускает Widevine
                    val ok = request.origin.host in DRM_HOSTS && wanted in request.resources
                    note("разрешение ${request.resources.joinToString()} от ${request.origin.host}: ${if (ok) "дано" else "нет"}")
                    if (ok) request.grant(arrayOf(wanted)) else request.deny()
                }

                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.d(TAG, "JS: ${message.message()}")
                    if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR || message.messageLevel() == ConsoleMessage.MessageLevel.WARNING) note("console: ${message.message()}")
                    return true
                }
            }
            loadUrl("https://$ASSET_DOMAIN/assets/spotify_player.html")
        }
    }

    @MainThread
    fun release() {
        webView?.let { wv ->
            wv.evaluateJavascript("window.__engine && window.__engine.call(0, 'disconnect', '[]')", null)
            wv.stopLoading()
            wv.removeJavascriptInterface("AndroidBridge")
            wv.destroy()
        }
        webView = null
        pendingCalls.values.forEach { it.completeExceptionally(IllegalStateException("Плеер Spotify остановлен")) }
        pendingCalls.clear()
        _status.value = Status.Idle
        _playback.value = null
    }

    /** Ждёт ready и возвращает device_id; запускает движок, если он ещё не запущен */
    suspend fun awaitReady(timeoutMs: Long = 30_000): String {
        withContext(Dispatchers.Main.immediate) {
            val s = _status.value
            if (s is Status.Failed) release()
            start()
        }
        return withTimeout(timeoutMs) {
            val ready = _status.first { it is Status.Ready || it is Status.Failed }
            if (ready is Status.Failed) throw SpotifyException(ready.message)
            (ready as Status.Ready).deviceId
        }
    }

    suspend fun pause() { call("pause") }
    suspend fun resume() { call("resume") }
    suspend fun nextTrack() { call("nextTrack") }
    suspend fun seek(positionMs: Long) { call("seek", positionMs.coerceAtLeast(0)) }
    suspend fun setVolume(volume: Double) { call("setVolume", volume.coerceIn(0.0, 1.0)) }
    suspend fun activateElement() { call("activateElement") }

    /** Включить треки на устройстве Nyao */
    suspend fun playUris(uris: List<String>, positionMs: Long = 0) = api.playUris(awaitReady(), uris, positionMs)

    /** Забрать сюда то, что играет в Spotify на другом устройстве */
    suspend fun transferHere(play: Boolean = true) = api.transferPlayback(awaitReady(), play)

    private suspend fun call(method: String, vararg args: Any): String {
        val id = callSeq.incrementAndGet()
        val deferred = CompletableDeferred<String>()
        pendingCalls[id] = deferred
        val argsJson = JSONObject.quote(JSONArray(args.toList()).toString())
        val sent = withContext(Dispatchers.Main.immediate) {
            val wv = webView ?: return@withContext false
            wv.evaluateJavascript("window.__engine.call($id, '$method', $argsJson)", null)
            true
        }
        if (!sent) {
            pendingCalls.remove(id)
            throw IllegalStateException("Плеер Spotify не запущен")
        }
        return withTimeout(15_000) { deferred.await() }
    }

    private fun evaluate(script: String) {
        scope.launch { webView?.evaluateJavascript(script, null) }
    }

    private fun fail(kind: String, message: String) {
        Log.w(TAG, "$kind: $message")
        note("ошибка $kind: $message")
        _status.value = Status.Failed(kind, message)
        _errors.tryEmit(kind to message)
    }

    private fun handleEvent(type: String, payload: Any?) {
        val o = payload as? JSONObject
        val message = o?.optString("message").orEmpty()
        if (type != "player_state_changed") note("событие $type" + (if (message.isNotEmpty()) ": $message" else ""))
        when (type) {
            "diag" -> note("браузер: ${o?.optString("ua")} · secure=${o?.optBoolean("secure")} · EME=${o?.optBoolean("eme")} · Widevine=${o?.optString("widevine")} · SW_SECURE_CRYPTO=${o?.optString("widevineSw")}")
            "sdk_ready" -> {
                _status.value = Status.Connecting
                evaluate("window.__engine.init(${JSONObject.quote(PLAYER_NAME)}, 1.0)")
            }
            "connect_result" -> if (o?.optBoolean("ok") != true) fail("engine", "Плеер Spotify не подключился")
            "ready" -> _status.value = Status.Ready(o!!.getString("device_id"))
            "not_ready" -> _status.value = Status.NotReady(o!!.getString("device_id"))
            "player_state_changed" -> _playback.value = o?.let {
                Snapshot(
                    uri = it.optString("uri").ifEmpty { null },
                    linked = it.optString("linked").ifEmpty { null },
                    paused = it.optBoolean("paused", true),
                    position = it.optLong("position"),
                    duration = it.optLong("duration"),
                    at = SystemClock.elapsedRealtime(),
                )
            }
            "autoplay_failed" -> _errors.tryEmit("autoplay" to "Android не дал звуку стартовать сам — нажми «играть»")
            "initialization_error" -> fail("init", "В WebView нет Widevine — обнови Android System WebView ($message)")
            "authentication_error" -> fail("auth", "Spotify не принял вход — войди заново ($message)")
            "account_error" -> fail("account", "Для плеера Spotify нужен Premium")
            // ошибка одного трека не ломает плеер
            "playback_error" -> _errors.tryEmit("playback" to "Spotify не смог включить трек ($message)")
            "page_error" -> _errors.tryEmit("page" to message)
            else -> Log.d(TAG, "Неизвестное событие $type")
        }
    }

    /** Вызывается из JS на фоновом потоке JavaBridge */
    private inner class Bridge {
        @JavascriptInterface
        fun onEvent(type: String, payloadJson: String) {
            scope.launch {
                runCatching {
                    val p = if (payloadJson == "null") null else org.json.JSONTokener(payloadJson).nextValue()
                    handleEvent(type, p)
                }.onFailure { Log.e(TAG, "Не удалось обработать $type", it) }
            }
        }

        @JavascriptInterface
        fun requestToken(requestId: Int) {
            scope.launch {
                val token = try {
                    auth.accessToken()
                } catch (e: Exception) {
                    fail("auth", e.message ?: "Нужно войти в Spotify")
                    "" // SDK ответит authentication_error
                }
                evaluate("window.__engine.resolveToken($requestId, ${JSONObject.quote(token)})")
            }
        }

        @JavascriptInterface
        fun onCallResult(callId: Int, ok: Boolean, payload: String) {
            val d = pendingCalls.remove(callId) ?: return
            if (ok) d.complete(payload) else d.completeExceptionally(SpotifyException(payload))
        }
    }

    private companion object {
        /** «…; wv) … Version/4.0 Chrome/…» → обычный Chrome для Android той же версии */
        fun chromeUserAgent(ua: String): String = ua.replace("; wv)", ")").replace(Regex(" Version/\\d+(\\.\\d+)*"), "")

        const val TAG = "NyaoSpotify"
        val DRM_HOSTS = setOf(WebViewAssetLoader.DEFAULT_DOMAIN, "sdk.scdn.co")
        const val PLAYER_NAME = "Nyao Music"
        const val ASSET_DOMAIN = WebViewAssetLoader.DEFAULT_DOMAIN
    }
}
