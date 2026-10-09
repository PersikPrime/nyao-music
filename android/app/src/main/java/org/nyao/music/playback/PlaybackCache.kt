package org.nyao.music.playback

import android.content.Context
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import java.io.File

/**
 * Кэш прослушанного: до 1 ГБ последних треков на диске.
 * Ключ — ссылка nyao://сервис/id, а не временная ссылка сервиса, поэтому повторное
 * прослушивание идёт с диска и работает без сети.
 */
@OptIn(UnstableApi::class)
object PlaybackCache {
    const val MAX_BYTES = 1024L * 1024 * 1024
    @Volatile private var cache: SimpleCache? = null

    fun get(context: Context): SimpleCache = cache ?: synchronized(this) {
        cache ?: SimpleCache(
            File(context.applicationContext.cacheDir, "audio"),
            LeastRecentlyUsedCacheEvictor(MAX_BYTES),
            StandaloneDatabaseProvider(context.applicationContext),
        ).also { cache = it }
    }

    fun sizeBytes(context: Context): Long = get(context).cacheSpace

    /** Удаляет всё скачанное (кэш остаётся рабочим) */
    fun clear(context: Context) {
        val c = get(context)
        c.keys.toList().forEach { c.removeResource(it) }
    }
}
