package org.nyao.music.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import org.nyao.music.ui.theme.NyaoColors
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

private const val TAU = (2 * PI).toFloat()

/**
 * Полярная фигура Material Expressive.
 * squircle = 0 — «печенька» (круг с [lobes] волнами глубиной [depth]), 1 — скруглённый квадрат (суперэллипс).
 * Промежуточные значения дают плавный морфинг между ними.
 */
class PolarShape(
    private val lobes: Int = 9,
    private val depth: Float = 0.07f,
    private val rotation: Float = 0f,
    private val squircle: Float = 0f,
) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val cx = size.width / 2f
        val cy = size.height / 2f
        val half = min(cx, cy)
        val rCookie = half / (1f + depth)
        val rSquare = half * 0.97f
        val p = 5f
        val path = Path()
        val steps = 180
        for (i in 0..steps) {
            val t = i.toFloat() / steps * TAU
            val c = cos(t)
            val s = sin(t)
            val cookie = rCookie * (1f + depth * cos(lobes * (t + rotation)))
            val sq = rSquare / (abs(c).pow(p) + abs(s).pow(p)).pow(1f / p)
            val r = cookie + (sq - cookie) * squircle
            val x = cx + r * c
            val y = cy + r * s
            if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        path.close()
        return Outline.Generic(path)
    }
}

/** «Капля» — форма для «Грустного» настроения */
object DropShape : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val cx = size.width / 2f
        val r = min(size.width, size.height) * 0.45f
        val cy = size.height / 2f + r * 0.03f
        val p = Path()
        p.moveTo(cx, cy - r)
        p.cubicTo(cx + r * 0.9f, cy - r * 0.1f, cx + r, cy + r * 0.95f, cx, cy + r * 0.95f)
        p.cubicTo(cx - r, cy + r * 0.95f, cx - r * 0.9f, cy - r * 0.1f, cx, cy - r)
        p.close()
        return Outline.Generic(p)
    }
}

/** Кнопка «играть»: печенька, которая вращается во время игры и становится скруглённым квадратом на паузе */
@Composable
fun rememberPlayShape(playing: Boolean, lobes: Int = 9, depth: Float = 0.075f): Shape {
    val sq by animateFloatAsState(if (playing) 0f else 1f, spring(dampingRatio = 0.6f, stiffness = 260f), label = "morph")
    val spin = rememberInfiniteTransition(label = "spin")
    val rot by spin.animateFloat(0f, TAU, infiniteRepeatable(tween(16000, easing = LinearEasing)), label = "rot")
    return PolarShape(lobes, depth, if (playing) rot / lobes else 0f, sq)
}

/** Совместимость со старым кодом */
@Composable
fun rememberMorphShape(active: Boolean, lobes: Int = 9, maxDepth: Float = 0.07f): Shape = rememberPlayShape(active, lobes, maxDepth)

/** Форма элемента сгруппированного списка: крайние сильно скруглены, средние — чуть-чуть */
fun groupShape(index: Int, count: Int, big: Dp = 24.dp, small: Dp = 6.dp): Shape = when {
    count <= 1 -> RoundedCornerShape(big)
    index == 0 -> RoundedCornerShape(big, big, small, small)
    index == count - 1 -> RoundedCornerShape(small, small, big, big)
    else -> RoundedCornerShape(small)
}

/** Пучок линий «волны»: жёлтый (Яндекс) → лавандовый → красный (YouTube) */
@Composable
fun FlowLines(
    modifier: Modifier = Modifier,
    lines: Int = 12,
    animate: Boolean = true,
    amplitude: Float = 0.16f,
    spread: Float = 0.18f,
    center: Float = 0.6f,
    middle: Color = NyaoColors.OnPrimary,
) {
    val t = rememberInfiniteTransition(label = "flow")
    val phase by t.animateFloat(0f, TAU, infiniteRepeatable(tween(9000, easing = LinearEasing)), label = "flowPhase")
    val ph = if (animate) phase else 0f
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val brush = Brush.horizontalGradient(listOf(NyaoColors.Ya, middle, NyaoColors.Yt))
        for (i in 0 until lines) {
            val tt = i / (lines - 1f) - 0.5f
            val p = Path()
            var k = 0
            while (k <= 60) {
                val u = k / 60f
                val y = h * center + h * amplitude * sin(u * TAU + 0.6f + ph) + tt * h * spread * cos(u * TAU * 1.2f + 1f + ph * 0.7f)
                if (k == 0) p.moveTo(0f, y) else p.lineTo(u * w, y)
                k++
            }
            val a = (0.25f + 0.6f * (1f - abs(tt) * 1.6f)).coerceIn(0.1f, 1f)
            drawPath(p, brush, alpha = a, style = Stroke(1.4.dp.toPx()))
        }
    }
}

/**
 * Волнистый прогресс: пройденная часть — синусоида, остаток — ровная линия, ползунок — вертикальная палочка.
 * На паузе волна выпрямляется. Тап и перетаскивание — перемотка.
 */
@Composable
fun WavyProgress(
    progress: Float,
    playing: Boolean,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier,
    color: Color = NyaoColors.Lavender,
    trackColor: Color = Color.White.copy(alpha = 0.18f),
    height: Dp = 28.dp,
) {
    var drag by remember { mutableStateOf<Float?>(null) }
    val seek by rememberUpdatedState(onSeek)
    val amp by animateFloatAsState(if (playing && drag == null) 1f else 0f, tween(500), label = "amp")
    val anim = rememberInfiniteTransition(label = "wave")
    val phase by anim.animateFloat(0f, TAU, infiniteRepeatable(tween(1600, easing = LinearEasing), RepeatMode.Restart), label = "phase")
    val shown = (drag ?: progress).coerceIn(0f, 1f)
    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .pointerInput(Unit) { detectTapGestures { o -> seek((o.x / size.width).coerceIn(0f, 1f)) } }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { o -> drag = (o.x / size.width).coerceIn(0f, 1f) },
                    onDragEnd = { drag?.let { seek(it) }; drag = null },
                    onDragCancel = { drag = null },
                    onHorizontalDrag = { change, _ -> drag = (change.position.x / size.width).coerceIn(0f, 1f) },
                )
            },
    ) {
        val mid = size.height / 2f
        val stroke = 4.dp.toPx()
        val edge = stroke / 2f
        val x = edge + (size.width - stroke) * shown
        val gap = 7.dp.toPx()
        val a = 5.dp.toPx() * amp
        if (x + gap < size.width - edge) drawLine(trackColor, Offset(x + gap, mid), Offset(size.width - edge, mid), stroke, StrokeCap.Round)
        if (x - gap > edge) {
            val p = Path()
            var px = edge
            p.moveTo(px, mid)
            while (px <= x - gap) {
                p.lineTo(px, mid + a * sin(px / 6.dp.toPx() - phase))
                px += 2f
            }
            drawPath(p, color, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        drawLine(color, Offset(x, mid - size.height * 0.42f), Offset(x, mid + size.height * 0.42f), 5.dp.toPx(), StrokeCap.Round)
    }
}

/** Живой логотип Nyao: три волны */
@Composable
fun NyaoWaves(modifier: Modifier = Modifier, animate: Boolean = true, strokeDp: Float = 10f, alpha: Float = 1f) {
    val t = rememberInfiniteTransition(label = "logo")
    val phase by t.animateFloat(0f, TAU, infiniteRepeatable(tween(4200, easing = LinearEasing)), label = "logoPhase")
    val ph = if (animate) phase else 0f
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        val amp = h * 0.16f
        val stroke = strokeDp.dp.toPx()
        val left = stroke
        val right = w - stroke
        fun wave(yOffset: Float, shift: Float): Path {
            val p = Path()
            var x = left
            while (x <= right) {
                val k = (x - left) / (right - left)
                val y = h / 2f + yOffset - amp * sin(k * TAU + ph + shift)
                if (x == left) p.moveTo(x, y) else p.lineTo(x, y)
                x += 2f
            }
            return p
        }
        val st = Stroke(stroke, cap = StrokeCap.Round)
        drawPath(wave(-h * 0.07f, 0f), NyaoColors.Ya.copy(alpha = alpha), style = st)
        drawPath(wave(h * 0.07f, 0.35f), NyaoColors.Yt.copy(alpha = alpha), style = st)
        drawPath(wave(0f, 0.18f), NyaoColors.Lavender.copy(alpha = alpha), style = st)
    }
}

/**
 * Группа соединённых кнопок (button group) из макета: выбранная шире и полностью скруглена,
 * соседние — с маленькими внутренними углами.
 */
@Composable
fun ConnectedGroup(
    items: List<String>,
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 52.dp,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEachIndexed { i, label ->
            val on = i == selected
            val w by animateFloatAsState(if (on) 1.35f else 1f, spring(dampingRatio = 0.7f), label = "w")
            val big = height / 2
            val small = 8.dp
            val shape = when {
                on -> RoundedCornerShape(big)
                i == 0 -> RoundedCornerShape(big, small, small, big)
                i == items.lastIndex -> RoundedCornerShape(small, big, big, small)
                else -> RoundedCornerShape(small)
            }
            Box(
                Modifier
                    .weight(w)
                    .height(height)
                    .bouncy().clip(shape)
                    .background(if (on) NyaoColors.Lavender else NyaoColors.Tonal)
                    .clickable { onSelect(i) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (on) NyaoColors.OnLavender else NyaoColors.Text,
                    maxLines = 1,
                    softWrap = false,
                    overflow = TextOverflow.Clip,
                )
            }
        }
    }
}

/** Баланс источников: слева жёлтая часть (Яндекс), справа красная (YouTube), между ними ползунок */
@Composable
fun BalanceBar(share: Int, onChange: (Int) -> Unit, onFinish: (Int) -> Unit, modifier: Modifier = Modifier) {
    val change by rememberUpdatedState(onChange)
    val finish by rememberUpdatedState(onFinish)
    var live by remember { mutableStateOf<Int?>(null) }
    val s = live ?: share
    fun toShare(x: Float, w: Int): Int = (((1f - x / w) * 100f) / 5f).roundToInt().coerceIn(0, 20) * 5
    Canvas(
        modifier
            .fillMaxWidth()
            .height(48.dp)
            .pointerInput(Unit) {
                detectTapGestures { o -> toShare(o.x, size.width).let { change(it); finish(it) } }
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { o -> live = toShare(o.x, size.width).also { change(it) } },
                    onDragEnd = { live?.let { finish(it) }; live = null },
                    onDragCancel = { live = null },
                    onHorizontalDrag = { c, _ -> live = toShare(c.position.x, size.width).also { change(it) } },
                )
            },
    ) {
        val w = size.width
        val hx = w * (100 - s) / 100f
        val bar = 16.dp.toPx()
        val top = (size.height - bar) / 2f
        val gap = 6.dp.toPx()
        fun rounded(left: Float, right: Float, color: Color) {
            if (right - left <= 0f) return
            drawRoundRect(color, Offset(left, top), Size(right - left, bar), CornerRadius(bar / 2f, bar / 2f))
        }
        rounded(0f, hx - gap, NyaoColors.Ya)
        rounded(hx + gap, w, NyaoColors.Yt)
        drawRoundRect(
            NyaoColors.OnPrimary,
            Offset(hx - 2.dp.toPx(), 2.dp.toPx()),
            Size(4.dp.toPx(), size.height - 4.dp.toPx()),
            CornerRadius(2.dp.toPx(), 2.dp.toPx()),
        )
    }
}

/** Пилюля-фильтр: выбранная залита лавандовым */
@Composable
fun PillChip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(36.dp)
            .bouncy().clip(RoundedCornerShape(18.dp))
            .background(if (selected) NyaoColors.Lavender else NyaoColors.S2)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = if (selected) NyaoColors.OnLavender else NyaoColors.Muted, maxLines = 1)
    }
}
