package org.nyao.music.data

import kotlinx.coroutines.Dispatchers
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

    /** Блокирующий запрос — только из фоновых потоков. */
    fun execute(req: Request): Pair<Int, String> =
        client.newCall(req).execute().use { res -> res.code to (res.body?.string() ?: "") }

    suspend fun call(req: Request): Pair<Int, String> = withContext(Dispatchers.IO) { execute(req) }
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
