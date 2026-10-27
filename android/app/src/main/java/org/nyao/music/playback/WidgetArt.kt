package org.nyao.music.playback

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Картинки для виджетов: в RemoteViews нельзя скруглить, размыть или затемнить обложку,
 * поэтому всё это рисуется здесь заранее. Размеры небольшие — виджет обновляется через Binder (лимит ~1 МБ).
 */
object WidgetArt {
    /** Как затемнить обложку-фон (Expressive · обложка) */
    enum class Scrim { BOTTOM, LEFT, FULL }

    private val cache = object : LinkedHashMap<String, Bitmap>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Bitmap>?) = size > 12
    }

    private fun cached(key: String, make: () -> Bitmap?): Bitmap? = synchronized(cache) {
        cache[key] ?: make()?.also { cache[key] = it }
    }

    private fun id(b: Bitmap) = System.identityHashCode(b)

    /** Обложка с кругом/скруглением; aspect — ширина/высота (обложка во всю ширину виджета 2×2) */
    fun cover(src: Bitmap?, sizePx: Int, radiusFrac: Float, gray: Boolean = false, aspect: Float = 1f): Bitmap? {
        src ?: return null
        val w = if (aspect >= 1f) sizePx else (sizePx * aspect).roundToInt()
        val h = if (aspect >= 1f) (sizePx / aspect).roundToInt() else sizePx
        return cached("c${id(src)}:$w:$h:$radiusFrac:$gray") {
            val out = Bitmap.createBitmap(max(1, w), max(1, h), Bitmap.Config.ARGB_8888)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                shader = cropShader(src, w, h)
                if (gray) colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) })
            }
            val r = min(w, h) * radiusFrac
            Canvas(out).drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), r, r, paint)
            out
        }
    }

    /** Обложка во весь виджет с затемнением (Expressive · обложка) */
    fun artBackground(src: Bitmap?, wDp: Int, hDp: Int, radiusDp: Float, scrim: Scrim): Bitmap? {
        src ?: return null
        val (w, h, k) = fit(wDp, hDp, 320)
        return cached("a${id(src)}:$w:$h:$radiusDp:$scrim") {
            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(out)
            val rect = RectF(0f, 0f, w.toFloat(), h.toFloat())
            val r = radiusDp * k
            c.drawRoundRect(rect, r, r, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { shader = cropShader(src, w, h) })
            val shade = Paint(Paint.ANTI_ALIAS_FLAG)
            when (scrim) {
                Scrim.BOTTOM -> shade.shader = LinearGradient(0f, h * 0.3f, 0f, h.toFloat(), 0x00000000, 0xB8000000.toInt(), Shader.TileMode.CLAMP)
                Scrim.LEFT -> shade.shader = LinearGradient(0f, 0f, w.toFloat(), 0f, 0xC7000000.toInt(), 0x59000000, Shader.TileMode.CLAMP)
                Scrim.FULL -> shade.shader = LinearGradient(0f, 0f, 0f, h.toFloat(), 0x66000000, 0xD0000000.toInt(), Shader.TileMode.CLAMP)
            }
            c.drawRoundRect(rect, r, r, shade)
            out
        }
    }

    /** Размытая обложка под стеклом (Glass · размытая обложка): уменьшаем, размываем, растягиваем — и рамка-блик */
    fun blurBackground(src: Bitmap?, wDp: Int, hDp: Int, radiusDp: Float): Bitmap? {
        src ?: return null
        val (w, h, k) = fit(wDp, hDp, 300)
        return cached("b${id(src)}:$w:$h:$radiusDp") {
            val small = Bitmap.createScaledBitmap(src, 24, 24, true)
            val blurred = boxBlur(boxBlur(small, 3), 3)
            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(out)
            val rect = RectF(0f, 0f, w.toFloat(), h.toFloat())
            val r = radiusDp * k
            val sat = ColorMatrix().apply { setSaturation(1.3f) }
            c.drawRoundRect(rect, r, r, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
                shader = cropShader(blurred, w, h)
                colorFilter = ColorMatrixColorFilter(sat)
            })
            c.drawRoundRect(rect, r, r, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x61141220 })
            val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeWidth = max(1f, k)
                color = 0x47FFFFFF
            }
            val inset = stroke.strokeWidth / 2
            c.drawRoundRect(RectF(inset, inset, w - inset, h - inset), r - inset, r - inset, stroke)
            out
        }
    }

    /** Полоска прогресса: волной (Expressive) или прямой линией; wDp×hDp — размер места в виджете */
    fun progress(fraction: Float, wDp: Int, hDp: Int, color: Int, rest: Int, wavy: Boolean, lineDp: Float): Bitmap {
        val k = 2.5f
        val w = max(1, (wDp * k).roundToInt())
        val h = max(1, (hDp * k).roundToInt())
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val stroke = lineDp * k
        val cy = h / 2f
        val f = fraction.coerceIn(0f, 1f)
        val played = stroke / 2 + (w - stroke) * f
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = stroke
            strokeCap = Paint.Cap.ROUND
        }
        // остаток
        p.color = rest
        val restFrom = if (wavy) played + stroke * 2 else played
        if (restFrom < w - stroke / 2) c.drawLine(restFrom, cy, w - stroke / 2, cy, p)
        // сыгранное
        p.color = color
        if (wavy) {
            val amp = min(h / 2f - stroke / 2, 2.6f * k)
            val path = Path()
            var x = stroke / 2
            path.moveTo(x, cy + amp * sin(x / (4.2f * k)))
            while (x < played) {
                x = min(played, x + 1.5f * k)
                path.lineTo(x, cy + amp * sin(x / (4.2f * k)))
            }
            c.drawPath(path, p)
        } else if (f > 0f) {
            c.drawLine(stroke / 2, cy, played, cy, p)
        }
        return out
    }

    /** Размер картинки под место wDp×hDp, длинная сторона не больше maxPx; третье значение — пикселей на dp */
    private fun fit(wDp: Int, hDp: Int, maxPx: Int): Triple<Int, Int, Float> {
        val k = min(2f, maxPx.toFloat() / max(1, max(wDp, hDp)))
        return Triple(max(1, (wDp * k).roundToInt()), max(1, (hDp * k).roundToInt()), k)
    }

    /** Шейдер, который кладёт картинку «по центру с обрезкой» в w×h */
    private fun cropShader(src: Bitmap, w: Int, h: Int): BitmapShader {
        val shader = BitmapShader(src, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
        val scale = max(w.toFloat() / src.width, h.toFloat() / src.height)
        val m = Matrix()
        m.setScale(scale, scale)
        m.postTranslate((w - src.width * scale) / 2f, (h - src.height * scale) / 2f)
        shader.setLocalMatrix(m)
        return shader
    }

    /** Простое размытие «коробкой» по маленькой картинке (24×24 — доли миллисекунды) */
    private fun boxBlur(src: Bitmap, radius: Int): Bitmap {
        val w = src.width
        val h = src.height
        val px = IntArray(w * h)
        src.getPixels(px, 0, w, 0, 0, w, h)
        val tmp = IntArray(w * h)
        fun pass(from: IntArray, to: IntArray, horizontal: Boolean) {
            for (y in 0 until h) for (x in 0 until w) {
                var a = 0; var r = 0; var g = 0; var b = 0; var n = 0
                for (d in -radius..radius) {
                    val xx = if (horizontal) (x + d).coerceIn(0, w - 1) else x
                    val yy = if (horizontal) y else (y + d).coerceIn(0, h - 1)
                    val c = from[yy * w + xx]
                    a += c ushr 24; r += (c shr 16) and 255; g += (c shr 8) and 255; b += c and 255; n++
                }
                to[y * w + x] = ((a / n) shl 24) or ((r / n) shl 16) or ((g / n) shl 8) or (b / n)
            }
        }
        pass(px, tmp, true)
        pass(tmp, px, false)
        return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
    }
}
