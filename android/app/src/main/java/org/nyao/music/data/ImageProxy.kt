package org.nyao.music.data

import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Картинки, которые в РФ без VPN часто не грузятся (аватарки Telegram, обложки YouTube, SoundCloud, CDN VK):
 * если прямая загрузка не удалась, берём ту же картинку через сервер Nyao (/img?u=…, он кэширует).
 * Хосты — те же, что пропускает сервер (server/src/img-proxy.js) и ПК (src/renderer/covers.js).
 */
object ImageProxy {
    const val BASE = "https://api.music.withnyao.app/img?u="
    private val HOSTS = Regex("(^|\\.)(t\\.me|telegram\\.org|telesco\\.pe|cdn-telegram\\.org|ytimg\\.com|ggpht\\.com|googleusercontent\\.com|sndcdn\\.com|userapi\\.com|vk\\.me|vkuser\\.net|vk-cdn\\.net|scdn\\.co|spotifycdn\\.com|mzstatic\\.com)$", RegexOption.IGNORE_CASE)

    fun proxyable(url: String): Boolean = url.startsWith("https://") && runCatching { HOSTS.containsMatchIn(java.net.URI(url).host ?: "") }.getOrDefault(false)

    fun proxied(url: String): String = BASE + java.net.URLEncoder.encode(url, "UTF-8")

    private class Fallback : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val req = chain.request()
            val url = req.url.toString()
            if (!proxyable(url)) return chain.proceed(req)
            // прямая попытка — недолго: если CDN режут, соединение просто висит
            val direct = try {
                chain.withConnectTimeout(5, TimeUnit.SECONDS).withReadTimeout(8, TimeUnit.SECONDS).proceed(req)
            } catch (e: IOException) {
                null
            }
            if (direct != null && direct.isSuccessful) return direct
            direct?.close()
            return chain.proceed(req.newBuilder().url(proxied(url)).build())
        }
    }

    /** Клиент для картинок (Coil) */
    val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .addInterceptor(Fallback())
            .build()
    }
}
