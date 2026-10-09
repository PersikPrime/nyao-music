package org.nyao.music.playback

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import kotlin.math.min

/**
 * Читает файл кусками по [chunkSize] байт отдельными Range-запросами.
 * googlevideo режет скорость и обрывает «бесконечные» запросы, а куски по 4 МБ отдаёт сразу —
 * так же сделано в десктопной версии. Размер файла берём из параметра clen ссылки.
 */
@OptIn(UnstableApi::class)
class ChunkedDataSource(
    private val upstream: DataSource,
    private val chunkSize: Long = 4L * 1024 * 1024,
) : DataSource {

    private var spec: DataSpec? = null
    private var position = 0L
    private var end = C.LENGTH_UNSET.toLong()
    private var chunked = false

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        spec = dataSpec
        position = dataSpec.position
        val total = dataSpec.uri.getQueryParameter("clen")?.toLongOrNull() ?: -1L
        end = when {
            dataSpec.length != C.LENGTH_UNSET.toLong() -> dataSpec.position + dataSpec.length
            total > 0 -> total
            else -> C.LENGTH_UNSET.toLong()
        }
        chunked = end != C.LENGTH_UNSET.toLong() && dataSpec.uri.host?.endsWith("googlevideo.com") == true
        if (!chunked) return upstream.open(dataSpec)
        if (position >= end) return 0
        openChunk()
        return end - dataSpec.position
    }

    private fun openChunk() {
        val s = spec ?: return
        val len = min(chunkSize, end - position)
        upstream.open(s.subrange(position - s.position, len))
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (!chunked) return upstream.read(buffer, offset, length)
        if (position >= end) return C.RESULT_END_OF_INPUT
        var n = upstream.read(buffer, offset, length)
        if (n == C.RESULT_END_OF_INPUT) {
            // кусок кончился — открываем следующий
            upstream.close()
            openChunk()
            n = upstream.read(buffer, offset, length)
        }
        if (n > 0) position += n
        return n
    }

    override fun getUri(): Uri? = upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
        spec = null
        upstream.close()
    }
}
