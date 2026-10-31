package org.nyao.music.data

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import java.io.File

/**
 * Шаблонная обложка «диск на цвете» (как в макетах) для треков без своей картинки — VK часто её не отдаёт.
 * Без картинки плеер, виджет и шторка могли держать обложку и название прошлого трека.
 * Картинка рисуется один раз в кэш и отдаётся как file:// — её понимают и Coil, и MediaSession.
 */
object TemplateCover {
    @Volatile var dir: File? = null

    // фон и цвет колец — пары из макетов «Продолжить слушать» (такие же на ПК: src/main/cover-art.js)
    private val PALETTE = listOf(
        0xFF17142A to 0xFFC6B8FF, 0xFF1E0E0E to 0xFFFF6A5C, 0xFF1E1A08 to 0xFFFFD60A, 0xFF1A0C0C to 0xFFFF8A7A,
        0xFF0E1A16 to 0xFF7CE0C3, 0xFF101420 to 0xFF8FB4FF, 0xFF1E1408 to 0xFFFFB86B, 0xFF1E0E16 to 0xFFFF8FB1,
    )

    fun index(key: String): Int {
        val h = java.security.MessageDigest.getInstance("SHA-1").digest(key.toByteArray())
        return (h[0].toInt() and 0xff) % PALETTE.size
    }

    /** file:// на PNG для трека или null, если папка ещё не задана */
    fun uri(key: String, size: Int = 400): String? {
        val base = dir ?: return null
        val folder = File(base, "template-covers").apply { mkdirs() }
        val i = index(key)
        // картинка зависит только от цвета — по одной на цвет
        val f = File(folder, "disc-$i-$size.png")
        if (!f.exists()) runCatching {
            val (bg, fg) = PALETTE[i]
            val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val c = Canvas(bmp)
            c.drawColor(bg.toInt())
            val k = size * 0.6f / 72f
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 3 * k; color = fg.toInt() }
            c.drawCircle(size / 2f, size / 2f, 26 * k, p)
            c.drawCircle(size / 2f, size / 2f, 12 * k, p)
            val tmp = File(folder, "${f.name}.tmp")
            tmp.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            tmp.renameTo(f)
        }
        return if (f.exists()) "file://${f.absolutePath}" else null
    }
}
