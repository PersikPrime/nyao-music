package org.nyao.music.playback

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * Выбирает путь загрузки по ссылке: SoundCloud (HLS с временными ссылками на куски) идёт мимо кэша,
 * всё остальное — через кэш на диске.
 */
@OptIn(UnstableApi::class)
class RoutingDataSource(private val cached: DataSource, private val direct: DataSource) : DataSource {
    private var current: DataSource? = null

    private fun isSoundCloud(uri: Uri): Boolean =
        uri.host == "sc" || uri.host?.endsWith("sndcdn.com") == true || uri.host?.endsWith("soundcloud.cloud") == true

    /** Куски и ключи VK: временные ссылки, идут мимо кэша и с cookie сессии VK */
    private fun isVk(uri: Uri): Boolean {
        val h = uri.host ?: return false
        return h == "vk" || h.endsWith("vkuseraudio.net") || h.endsWith("vkuseraudio.com") || h.endsWith("vk-cdn.net") ||
            h.endsWith("userapi.com") || h.endsWith("vk.com") || h.endsWith("vk.ru") || h.endsWith("vkuser.net")
    }

    override fun addTransferListener(transferListener: TransferListener) {
        cached.addTransferListener(transferListener)
        direct.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        // трек Spotify: в ExoPlayer — тишина той же длины, звук идёт из устройства Spotify
        if (dataSpec.uri.scheme == org.nyao.music.spotify.SilenceDataSource.SCHEME) {
            return org.nyao.music.spotify.SilenceDataSource().also { current = it }.open(dataSpec)
        }
        val vk = isVk(dataSpec.uri)
        val ds = if (vk || isSoundCloud(dataSpec.uri)) direct else cached
        current = ds
        if (!vk || dataSpec.uri.scheme == "nyao") return ds.open(dataSpec)
        val headers = HashMap(dataSpec.httpRequestHeaders)
        headers["User-Agent"] = org.nyao.music.data.VkApi.UA
        org.nyao.music.data.Repo.vk.base.let { headers["Referer"] = "$it/"; headers["Origin"] = it }
        org.nyao.music.data.Repo.vk.cookies(dataSpec.uri.scheme + "://" + dataSpec.uri.host)?.let { headers["Cookie"] = it }
        return ds.open(dataSpec.buildUpon().setHttpRequestHeaders(headers).build())
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = current?.read(buffer, offset, length) ?: -1

    override fun getUri(): Uri? = current?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = current?.responseHeaders ?: emptyMap()

    override fun close() {
        current?.close()
        current = null
    }
}
