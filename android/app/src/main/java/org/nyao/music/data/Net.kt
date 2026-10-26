package org.nyao.music.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
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

    private var cm: ConnectivityManager? = null
    private val _online = MutableStateFlow(true)
    /** Есть ли сейчас интернет. Меняется сразу, как система заметила: экраны могут перестроиться без запросов в сеть */
    val online: StateFlow<Boolean> = _online

    /** Пока система не спрошена (тесты, ранний старт), считаем, что интернет есть */
    val isOnline: Boolean get() = cm?.let { hasInternet(it) } ?: true

    fun init(context: Context) {
        if (cm != null) return
        val m = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        cm = m
        _online.value = hasInternet(m)
        runCatching {
            m.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { _online.value = true }
                override fun onLost(network: Network) { _online.value = hasInternet(m) }
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { _online.value = usable(caps) }
            })
        }
    }

    private fun usable(caps: NetworkCapabilities?): Boolean =
        caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

    private fun hasInternet(m: ConnectivityManager): Boolean = runCatching { usable(m.getNetworkCapabilities(m.activeNetwork)) }.getOrDefault(false)
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
