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

    override fun addTransferListener(transferListener: TransferListener) {
        cached.addTransferListener(transferListener)
        direct.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        val ds = if (isSoundCloud(dataSpec.uri)) direct else cached
        current = ds
        return ds.open(dataSpec)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = current?.read(buffer, offset, length) ?: -1

    override fun getUri(): Uri? = current?.uri

    override fun getResponseHeaders(): Map<String, List<String>> = current?.responseHeaders ?: emptyMap()

    override fun close() {
        current?.close()
        current = null
    }
}
