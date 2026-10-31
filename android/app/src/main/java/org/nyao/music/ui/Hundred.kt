package org.nyao.music.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameMillis
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.flow.MutableStateFlow
import kotlin.math.max
import kotlin.math.sin

/**
 * Пасхалка сотой сборки: волны, из которых складывается «100». То же на ПК: src/renderer/hundred.js
 * Один раз при первом запуске 0.8 (100), по пяти нажатиям на версию в «О приложении» и на каждый сотый трек
 * (трек засчитывается, если его слушали 30 секунд). Счётчик — только на этом устройстве.
 */
object Hundred {
    data class Scene(val title: String, val text: String)

    val scene = MutableStateFlow<Scene?>(null)
    private var prefs: android.content.SharedPreferences? = null

    fun init(context: Context) {
        if (prefs == null) prefs = context.applicationContext.getSharedPreferences("hundred", Context.MODE_PRIVATE)
    }

    val plays: Int get() = prefs?.getInt("plays", 0) ?: 0

    fun show(text: String = "Nyao Music 0.8 (100). Спасибо, что слушаешь с нами.", title: String = "Сотая сборка") {
        scene.value = Scene(title, text)
    }

    /** Трек дослушан хотя бы до 30 секунд. Возвращает текст уведомления на «юбилейном» треке (кроме сотого — там сцена). */
    fun countPlay(): String? {
        val p = prefs ?: return null
        val n = p.getInt("plays", 0) + 1
        p.edit().putInt("plays", n).apply()
        if (n % 100 != 0) return null
        if (n == 100) {
            show("Ровно сто треков в Nyao Music. Дальше — больше.", "Сотый трек!")
            return null
        }
        return "Это твой ${"%,d".format(java.util.Locale("ru"), n)}-й трек в Nyao Music 🎉"
    }

    fun maybeFirstRun(build: Int) {
        val p = prefs ?: return
        if (build < 100 || p.getInt("seen", 0) > 0) return
        p.edit().putInt("seen", build).apply()
        show()
    }

    private var taps = 0
    private var lastTap = 0L
    fun tapVersion() {
        val now = System.currentTimeMillis()
        if (now - lastTap > 1500) taps = 0
        lastTap = now
        if (++taps < 5) return
        taps = 0
        val n = plays
        show(if (n > 0) "Nyao Music 0.8 (100). С тобой уже ${"%,d".format(java.util.Locale("ru"), n)} ${tracksWord(n)}. Спасибо, что слушаешь." else "Nyao Music 0.8 (100). Спасибо, что слушаешь с нами.")
    }

    private fun tracksWord(n: Int): String {
        val a = n % 10
        val b = n % 100
        return when {
            a == 1 && b != 11 -> "трек"
            a in 2..4 && (b < 12 || b > 14) -> "трека"
            else -> "треков"
        }
    }
}

private val WAVE_COLORS = listOf(0xFFC6B8FF, 0xFF7CE0C3, 0xFFFFB86B, 0xFFFF8FB1, 0xFF8FB4FF, 0xFFFFD60A).map { Color(it) }

/** Маска текста на маленькой сетке, размытая, чтобы волны поднимались плавно */
private class TextMask(text: String, val w: Int, val h: Int) {
    private val a = FloatArray(w * h)

    init {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ALPHA_8)
        val c = android.graphics.Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
            textSize = h * 0.8f
        }
        while (paint.measureText(text) > w * 0.86f && paint.textSize > 8f) paint.textSize -= 2f
        val fm = paint.fontMetrics
        c.drawText(text, w / 2f, h / 2f - (fm.ascent + fm.descent) / 2f, paint)
        val raw = ByteArray(w * h)
        bmp.copyPixelsToBuffer(java.nio.ByteBuffer.wrap(raw))
        bmp.recycle()
        val src = FloatArray(w * h) { (raw[it].toInt() and 0xFF) / 255f }
        // два прохода коробочного размытия по каждой оси
        val r = max(1, h / 60)
        val tmp = FloatArray(w * h)
        repeat(2) {
            for (y in 0 until h) for (x in 0 until w) {
                var s = 0f; var n = 0
                for (k in -r..r) { val xx = x + k; if (xx in 0 until w) { s += src[y * w + xx]; n++ } }
                tmp[y * w + x] = s / n
            }
            for (y in 0 until h) for (x in 0 until w) {
                var s = 0f; var n = 0
                for (k in -r..r) { val yy = y + k; if (yy in 0 until h) { s += tmp[yy * w + x]; n++ } }
                src[y * w + x] = s / n
            }
        }
        src.copyInto(a)
    }

    /** u, v — доли 0..1 */
    fun at(u: Float, v: Float): Float {
        val x = (u * (w - 1)).toInt().coerceIn(0, w - 1)
        val y = (v * (h - 1)).toInt().coerceIn(0, h - 1)
        return a[y * w + x]
    }
}

@Composable
fun HundredHost() {
    val scene by Hundred.scene.collectAsState()
    val s = scene ?: return
    Dialog(onDismissRequest = { Hundred.scene.value = null }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        HundredScene(s) { Hundred.scene.value = null }
    }
}

@Composable
private fun HundredScene(s: Hundred.Scene, onClose: () -> Unit) {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) { progress.animateTo(1f, tween(2400, easing = FastOutSlowInEasing)) }
    val time = remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        val start = withFrameMillis { it }
        while (true) withFrameMillis { time.longValue = it - start }
    }
    BoxWithConstraints(
        Modifier.fillMaxSize()
            .background(Brush.radialGradient(listOf(Color(0xFF17142A), Color(0xFF050507))))
            .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClose),
    ) {
        val landscape = maxWidth > maxHeight
        val mask = remember(landscape) { if (landscape) TextMask("100", 240, 110) else TextMask("100", 180, 120) }
        Canvas(Modifier.fillMaxSize()) {
            val t = time.longValue / 1000f
            val e = progress.value
            val top = size.height * 0.08f
            val span = size.height * (if (landscape) 0.6f else 0.5f)
            val lines = max(22, (span / 13.dp.toPx()).toInt())
            val step = span / lines
            val sw = 2.dp.toPx()
            for (i in 0 until lines) {
                val y0 = top + i * step
                val path = Path()
                var x = 0f
                val dx = 4.dp.toPx()
                while (x <= size.width + dx) {
                    val m = mask.at(x / size.width, (y0 - top) / span)
                    val calm = sin(x * 0.012f / density * 2.5f + t * 1.6f + i * 0.5f) * 4.dp.toPx() * (1 - e * 0.6f)
                    val y = y0 + calm - m * step * 1.9f * e
                    if (x == 0f) path.moveTo(x, y) else path.lineTo(x, y)
                    x += dx
                }
                drawPath(path, WAVE_COLORS[i % WAVE_COLORS.size].copy(alpha = 0.35f + 0.6f * e), style = Stroke(sw))
            }
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(start = 24.dp, end = 24.dp, bottom = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(s.title, color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, style = MaterialTheme.typography.headlineMedium)
            Text(s.text, color = Color(0xFFC9C9CE), textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
            Button(onClick = onClose, modifier = Modifier.padding(top = 8.dp)) { Text("Слушать дальше") }
        }
    }
}
