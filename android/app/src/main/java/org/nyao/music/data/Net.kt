package org.nyao.music.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

object Net {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    /** Для «длинного» опроса живых событий: сервер держит запрос до 25 секунд */
    val longClient: OkHttpClient by lazy { client.newBuilder().readTimeout(45, TimeUnit.SECONDS).build() }

    suspend fun callLong(req: Request): Pair<Int, String> = withContext(Dispatchers.IO) {
        longClient.newCall(req).execute().use { res -> res.code to (res.body?.string() ?: "") }
    }

    /** Блокирующий запрос — только из фоновых потоков. */
    fun execute(req: Request): Pair<Int, String> =
        client.newCall(req).execute().use { res -> res.code to (res.body?.string() ?: "") }

    suspend fun call(req: Request): Pair<Int, String> = withContext(Dispatchers.IO) { execute(req) }

    // ---- Есть ли интернет ----
    // Система считает сеть рабочей, только если открылся её проверочный сервер (у Android — Google).
    // На «белых списках» Google закрыт, а Яндекс и VK открыты: тогда система говорит «без интернета»,
    // хотя музыка работает. Поэтому при неподтверждённой сети проверяем сами — открываются ли Яндекс или VK.

    private var cm: ConnectivityManager? = null
    private val _online = MutableStateFlow(true)
    /** Есть ли сейчас интернет. Меняется сразу, как система заметила: экраны могут перестроиться без запросов в сеть */
    val online: StateFlow<Boolean> = _online

    /** Пока система не спрошена (тесты, ранний старт), считаем, что интернет есть */
    val isOnline: Boolean get() = if (cm == null) true else _online.value

    private val probeScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + Dispatchers.IO)
    private var probing: kotlinx.coroutines.Job? = null
    private val probeClient: OkHttpClient by lazy {
        client.newBuilder().connectTimeout(4, TimeUnit.SECONDS).readTimeout(4, TimeUnit.SECONDS).callTimeout(6, TimeUnit.SECONDS).build()
    }
    /** Любой ответ этих серверов (даже 404) значит, что до сервиса достучались */
    private val PROBES = listOf("https://api.music.yandex.net/", "https://api.vk.com/", "https://music.yandex.ru/")
    /** Адрес каждого сервиса — на белых списках проверяем все: что открыто, а что нет */
    private val SERVICES = linkedMapOf(
        SOURCE_YA to "https://api.music.yandex.net/", SOURCE_VK to "https://api.vk.com/", SOURCE_YT to "https://music.youtube.com/",
        SOURCE_SC to "https://api-v2.soundcloud.com/", SOURCE_SP to "https://api.spotify.com/",
    )
    private val _blocked = MutableStateFlow<Set<String>>(emptySet())
    /**
     * Сервисы, до которых сейчас не достучаться, хотя интернет есть (белые списки: Яндекс и VK открыты, остальное — нет).
     * Пусто, когда сеть обычная или её нет совсем. Волна и поиск такие сервисы пропускают, на главной — плашка.
     */
    val blocked: StateFlow<Set<String>> = _blocked

    fun init(context: Context) {
        if (cm != null) return
        val m = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        cm = m
        update(runCatching { m.getNetworkCapabilities(m.activeNetwork) }.getOrNull())
        runCatching {
            m.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { update(runCatching { m.getNetworkCapabilities(network) }.getOrNull()) }
                override fun onLost(network: Network) { update(runCatching { m.getNetworkCapabilities(m.activeNetwork) }.getOrNull()) }
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { update(caps) }
            })
        }
    }

    private fun update(caps: NetworkCapabilities?) {
        val hasNet = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        val validated = hasNet && caps!!.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        if (validated || !hasNet) {
            probing?.cancel(); probing = null
            _online.value = validated
            _blocked.value = emptySet()
            return
        }
        // сеть есть, но система её не подтвердила — проверяем сами и повторяем, пока так
        if (probing?.isActive == true) return
        probing = probeScope.launch {
            while (true) {
                val open = services()
                val on = open.isNotEmpty() || reachable()
                _online.value = on
                _blocked.value = if (on) SERVICES.keys - open else emptySet()
                kotlinx.coroutines.delay(30_000)
            }
        }
    }

    private fun open(url: String): Boolean =
        runCatching { probeClient.newCall(Request.Builder().url(url).head().build()).execute().use { true } }.getOrDefault(false)

    private fun reachable(): Boolean = PROBES.any { open(it) }

    /** Какие сервисы открываются — все сразу, параллельно */
    private suspend fun services(): Set<String> = kotlinx.coroutines.coroutineScope {
        SERVICES.map { (id, url) -> async { id.takeIf { open(url) } } }.map { it.await() }.filterNotNull().toSet()
    }
}

class ApiException(message: String, val code: Int = 0) : IOException(message)

fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }
fun md5(s: String): String = MessageDigest.getInstance("MD5").digest(s.toByteArray()).hex()
fun sha1(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).hex()

// ---- Удобства для org.json ----
fun JSONObject.obj(key: String): JSONObject? = optJSONObject(key)
fun JSONObject.arr(key: String): JSONArray? = optJSONArray(key)
fun JSONObject.str(key: String): String? = if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotEmpty() } else null
fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optJSONObject(it) }
}

/** Достаёт вложенный объект по цепочке ключей: o.path("a", "b", "c") */
fun JSONObject?.path(vararg keys: String): JSONObject? {
    var cur: JSONObject? = this
    for (k in keys) cur = cur?.optJSONObject(k) ?: return null
    return cur
}
