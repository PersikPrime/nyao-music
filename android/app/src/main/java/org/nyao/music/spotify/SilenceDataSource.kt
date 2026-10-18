package org.nyao.music.spotify

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener

/**
 * Тишина длиной с трек Spotify (WAV, 8 кГц, моно, 16 бит), собирается на лету без файлов.
 *
 * Трек Spotify звучит из Web Playback SDK, а в ExoPlayer на его месте стоит эта тишина той же длины.
 * Так очередь, уведомление, шторка, гарнитура, перемотка и переходы работают как у остальных сервисов,
 * а [SpotifySync] повторяет действия ExoPlayer на устройстве Spotify.
 *
 * Ссылка: nyaosilence://sp/<длительность в мс>/<id трека>
 */
@OptIn(UnstableApi::class)
class SilenceDataSource : DataSource {
    private var uri: Uri? = null
    private var pos = 0L
    private var end = 0L
    private var header = ByteArray(0)

    override fun addTransferListener(transferListener: TransferListener) {}

    override fun open(dataSpec: DataSpec): Long {
        uri = dataSpec.uri
        val ms = dataSpec.uri.pathSegments.firstOrNull()?.toLongOrNull()?.takeIf { it > 0 } ?: DEFAULT_MS
        val dataLen = ms * BYTES_PER_SEC / 1000 / 2 * 2
        header = header(dataLen)
        val total = header.size + dataLen
        pos = dataSpec.position.coerceIn(0L, total)
        end = if (dataSpec.length != C.LENGTH_UNSET.toLong()) minOf(total, pos + dataSpec.length) else total
        return end - pos
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (pos >= end) return C.RESULT_END_OF_INPUT
        val n = minOf(length.toLong(), end - pos).toInt()
        for (i in 0 until n) {
            val p = pos + i
            buffer[offset + i] = if (p < header.size) header[p.toInt()] else 0.toByte()
        }
        pos += n
        return n
    }

    override fun getUri(): Uri? = uri

    override fun close() {
        uri = null
    }

    companion object {
        const val SCHEME = "nyaosilence"
        private const val RATE = 8000
        private const val BYTES_PER_SEC = RATE * 2L
        private const val DEFAULT_MS = 10 * 60_000L

        fun uri(durationSec: Int, id: String): String =
            "$SCHEME://sp/${(if (durationSec > 0) durationSec * 1000L else DEFAULT_MS)}/${Uri.encode(id)}"

        private fun header(dataLen: Long): ByteArray {
            val b = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            b.put("RIFF".toByteArray()); b.putInt((36 + dataLen).toInt())
            b.put("WAVE".toByteArray())
            b.put("fmt ".toByteArray()); b.putInt(16)
            b.putShort(1) // PCM
            b.putShort(1) // моно
            b.putInt(RATE)
            b.putInt(BYTES_PER_SEC.toInt())
            b.putShort(2) // байт на кадр
            b.putShort(16) // бит
            b.put("data".toByteArray()); b.putInt(dataLen.toInt())
            return b.array()
        }
    }
}
