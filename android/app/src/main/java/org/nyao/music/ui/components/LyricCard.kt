package org.nyao.music.ui.components

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.nyao.music.R
import org.nyao.music.data.Track
import java.io.File
import kotlin.math.max

/**
 * Карточка со строками текста песни (как на ПК, src/renderer/lyric-card.js): 1–4 строки, обложка, трек,
 * волны Nyao и ссылка. Рисуется в Bitmap 1080×1920 и уходит в системное «Поделиться».
 */
object LyricCard {
    const val MAX_LINES = 4

    /** Выбор строк подряд, не больше четырёх: рядом — расширить, край — убрать, другое место — заново */
    fun toggle(sel: List<Int>, i: Int, max: Int = MAX_LINES): List<Int> {
        val s = sel.sorted()
        if (s.isEmpty()) return listOf(i)
        val lo = s.first()
        val hi = s.last()
        return when {
            i == lo -> s.drop(1)
            i == hi -> s.dropLast(1)
            i in (lo + 1) until hi -> listOf(i)
            (i == lo - 1 || i == hi + 1) && s.size < max -> (s + i).sorted()
            else -> listOf(i)
        }
    }

    private fun font(ctx: Context, res: Int, weight: Int): Typeface {
        val base = runCatching { ResourcesCompat.getFont(ctx, res) }.getOrNull() ?: Typeface.DEFAULT
        return if (android.os.Build.VERSION.SDK_INT >= 28) Typeface.create(base, weight, false) else Typeface.create(base, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun layout(text: CharSequence, paint: TextPaint, width: Int, spacing: Float = 1.12f, maxLines: Int = Int.MAX_VALUE): StaticLayout =
        StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setLineSpacing(0f, spacing)
            .setIncludePad(false)
            .setMaxLines(maxLines)
            .setEllipsize(TextUtils.TruncateAt.END)
            .build()

    /** Средний насыщенный цвет обложки (почти чёрное и белое почти не влияет) */
    private fun averageColor(b: Bitmap?): Triple<Int, Int, Int> {
        b ?: return Triple(92, 72, 160)
        val s = Bitmap.createScaledBitmap(b, 24, 24, true)
        var r = 0.0; var g = 0.0; var bl = 0.0; var n = 0.0
        for (y in 0 until 24) for (x in 0 until 24) {
            val c = s.getPixel(x, y)
            val R = (c shr 16) and 255; val G = (c shr 8) and 255; val B = c and 255
            val mx = maxOf(R, G, B); val mn = minOf(R, G, B)
            val w = if (mx < 24 || mn > 232) 0.15 else 1 + (mx - mn) / 128.0
            r += R * w; g += G * w; bl += B * w; n += w
        }
        return Triple((r / n).toInt(), (g / n).toInt(), (bl / n).toInt())
    }

    fun render(ctx: Context, track: Track, lines: List<String>, cover: Bitmap?, link: String?): Bitmap {
        val W = 1080
        val H = 1920
        val out = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val pad = 96f
        val (r, g, b) = averageColor(cover)
        fun mix(k: Float, base: Int) = android.graphics.Color.rgb((r * k + base * (1 - k)).toInt(), (g * k + base * (1 - k)).toInt(), (b * k + base * (1 - k)).toInt())
        // фон: цвет обложки сверху, свечение, тёмный низ
        c.drawRect(0f, 0f, W.toFloat(), H.toFloat(), Paint().apply { shader = LinearGradient(0f, 0f, 0f, H.toFloat(), mix(0.62f, 18), mix(0.16f, 10), Shader.TileMode.CLAMP) })
        c.drawRect(0f, 0f, W.toFloat(), H.toFloat(), Paint().apply {
            shader = RadialGradient(W * 0.25f, H * 0.12f, W * 0.9f, android.graphics.Color.argb(70, r, g, b), 0, Shader.TileMode.CLAMP)
        })
        // шапка: обложка и трек
        val art = 220f
        val top = 150f
        val rect = RectF(pad, top, pad + art, top + art)
        if (cover != null) {
            val sh = BitmapShader(cover, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
            val k = max(art / cover.width, art / cover.height)
            sh.setLocalMatrix(Matrix().apply { setScale(k, k); postTranslate(pad + (art - cover.width * k) / 2, top + (art - cover.height * k) / 2) })
            c.drawRoundRect(rect, art * 0.16f, art * 0.16f, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { shader = sh })
        } else {
            c.drawRoundRect(rect, art * 0.16f, art * 0.16f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x1FFFFFFF })
        }
        val onest = font(ctx, R.font.onest, 700)
        val onestMid = font(ctx, R.font.onest, 500)
        val unb = font(ctx, R.font.unbounded, 700)
        val tx = pad + art + 40
        val tw = (W - tx - pad).toInt()
        val title = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = onest; textSize = 46f; color = android.graphics.Color.WHITE }
        val sub = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = onestMid; textSize = 36f; color = 0xB8FFFFFF.toInt() }
        c.drawText(TextUtils.ellipsize(track.title, title, tw.toFloat(), TextUtils.TruncateAt.END).toString(), tx, top + art / 2 - 6, title)
        c.drawText(TextUtils.ellipsize(track.artist, sub, tw.toFloat(), TextUtils.TruncateAt.END).toString(), tx, top + art / 2 + 46, sub)

        // строки песни — самый крупный размер, при котором всё влезает
        val footer = 220f
        val boxTop = top + art + 120
        val boxW = (W - pad * 2).toInt()
        val boxH = H - boxTop - footer - 80
        val lp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = unb; color = android.graphics.Color.WHITE }
        var size = 92f
        var layouts: List<StaticLayout> = emptyList()
        while (true) {
            lp.textSize = size
            layouts = lines.map { layout(it, lp, boxW, 1.12f) }
            val h = layouts.sumOf { it.height } + (layouts.size - 1) * size * 0.55f
            val widest = layouts.all { l -> (0 until l.lineCount).all { l.getLineWidth(it) <= boxW + 1 } }
            if ((h <= boxH && widest) || size <= 40f) break
            size -= 4f
        }
        val total = layouts.sumOf { it.height } + (layouts.size - 1) * size * 0.55f
        var y = boxTop + max(0f, (boxH - total) / 2)
        // кавычка-акцент
        c.drawText("“", pad - 8, y + size * 0.6f, TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = unb; textSize = size * 2.2f; color = 0x38FFFFFF })
        y += size * 0.35f
        layouts.forEach { l ->
            c.save()
            c.translate(pad, y)
            l.draw(c)
            c.restore()
            y += l.height + size * 0.55f
        }

        // подвал: волны, Nyao Music, ссылка
        val fy = H - footer + 60
        drawWaves(c, pad - 6, fy - 44, 88f)
        c.drawText("Nyao Music", pad + 100, fy + 2, TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = unb; textSize = 38f; color = android.graphics.Color.WHITE })
        if (!link.isNullOrBlank()) {
            val lk = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { typeface = onestMid; textSize = 28f; color = 0x99FFFFFF.toInt() }
            val shown = link.removePrefix("https://").substringBefore('?')
            c.drawText(TextUtils.ellipsize(shown, lk, W - pad * 2 - 100, TextUtils.TruncateAt.END).toString(), pad + 100, fy + 48, lk)
        }
        return out
    }

    /** Волны Nyao: три линии, как в логотипе (путь 24×24 из макетов) */
    private fun drawWaves(c: Canvas, x: Float, y: Float, s: Float) {
        val k = s / 24f
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2.4f * k; strokeCap = Paint.Cap.ROUND }
        listOf(0xFFFFD60A.toInt() to 10.6f, 0xFFF0574A.toInt() to 13.4f, 0xFFD8CEFF.toInt() to 12f).forEach { (color, cy) ->
            val path = Path()
            path.moveTo(x + 3 * k, y + cy * k)
            path.rCubicTo(3 * k, -5 * k, 6 * k, -5 * k, 9 * k, 0f)
            path.rCubicTo(3 * k, 5 * k, 6 * k, 5 * k, 9 * k, 0f)
            p.color = color
            c.drawPath(path, p)
        }
    }

    /** Нарисовать карточку и открыть системное «Поделиться» (картинка + ссылка на трек) */
    suspend fun share(ctx: Context, track: Track, lines: List<String>) {
        val link = org.nyao.music.playback.Together.trackLink(track)
        val file = withContext(Dispatchers.IO) {
            val cover = track.cover?.let { url ->
                runCatching {
                    val req = coil3.request.ImageRequest.Builder(ctx).data(url).size(720).allowHardware(false).build()
                    (coil3.SingletonImageLoader.get(ctx).execute(req) as? coil3.request.SuccessResult)?.image?.toBitmap()
                }.getOrNull()
            }
            val bmp = render(ctx, track, lines, cover, link)
            val dir = File(ctx.cacheDir, "cards").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            File(dir, "nyao-${System.currentTimeMillis()}.png").also { f -> f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        }
        val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType("image/png")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .putExtra(Intent.EXTRA_TEXT, "${track.artist} — ${track.title}\n$link")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ctx.startActivity(Intent.createChooser(send, "Поделиться строками").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
