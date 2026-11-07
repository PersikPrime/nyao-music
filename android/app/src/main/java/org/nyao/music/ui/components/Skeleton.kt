package org.nyao.music.ui.components

import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.nyao.music.ui.theme.NyaoColors

/**
 * Силуэт загрузки: серая форма будущего элемента, по которой наискосок катится мягкий блик.
 * Цвета — из темы (S2 и чуть светлее), так что в Expressive, Glass и Mono силуэт свой.
 * Если в системе выключены анимации — просто статичная серая форма.
 */
fun Modifier.shimmer(shape: Shape = RoundedCornerShape(12.dp)): Modifier = composed {
    val context = LocalContext.current
    val still = remember {
        runCatching { Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
    val base = NyaoColors.S2
    val glow = Color.White.copy(alpha = if (NyaoColors.Bg.luminance() > 0.5f) 0.35f else 0.06f)
    val clipped = this.clip(shape).background(base)
    if (still) return@composed clipped
    val t by rememberInfiniteTransition(label = "shimmer").animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart),
        label = "shimmer-x",
    )
    clipped.drawWithContent {
        drawContent()
        val w = size.width
        val band = maxOf(w * 0.6f, 120f)
        // блик идёт слева направо и уходит за край целиком, прежде чем начаться снова
        val x = -band + (w + band * 2) * t
        drawRect(
            Brush.linearGradient(
                listOf(Color.Transparent, glow, Color.Transparent),
                start = Offset(x - band / 2, 0f),
                end = Offset(x + band / 2, size.height * 0.35f),
            ),
        )
    }
}

private fun Color.luminance(): Float = 0.2126f * red + 0.7152f * green + 0.0722f * blue

/** Пустая форма-силуэт нужного размера */
@Composable
fun Silhouette(modifier: Modifier, shape: Shape = RoundedCornerShape(8.dp)) {
    Box(modifier.shimmer(shape))
}

/** Полка, пока грузится: строка заголовка и три квадратные обложки с подписями */
@Composable
fun ShelfSkeleton(modifier: Modifier = Modifier, title: Boolean = true, tile: Int = 140) {
    Column(modifier.fillMaxWidth().semantics { contentDescription = "Загружается" }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (title) Silhouette(Modifier.padding(start = 20.dp).width(172.dp).height(22.dp))
        Row(Modifier.padding(start = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            repeat(3) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Silhouette(Modifier.size(tile.dp), RoundedCornerShape(22.dp))
                    Silhouette(Modifier.width((tile * 0.77f).dp).height(13.dp), RoundedCornerShape(6.dp))
                    Silhouette(Modifier.width((tile * 0.5f).dp).height(11.dp), RoundedCornerShape(6.dp))
                }
            }
        }
    }
}

/** Сетка быстрых плиток (2 колонки), пока грузятся лайки и плейлисты */
@Composable
fun QuickGridSkeleton(modifier: Modifier = Modifier, count: Int = 6) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp).semantics { contentDescription = "Загружается" }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat((count + 1) / 2) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                repeat(2) { Silhouette(Modifier.weight(1f).height(56.dp), RoundedCornerShape(18.dp)) }
            }
        }
    }
}

/** Строки списка (трек: обложка + две строки), пока грузится список */
@Composable
fun RowsSkeleton(modifier: Modifier = Modifier, count: Int = 5) {
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp).semantics { contentDescription = "Загружается" }, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        repeat(count) { i ->
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Silhouette(Modifier.size(48.dp), RoundedCornerShape(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Silhouette(Modifier.width((150 + (i * 37) % 60).dp).height(13.dp), RoundedCornerShape(6.dp))
                    Silhouette(Modifier.width((90 + (i * 23) % 40).dp).height(11.dp), RoundedCornerShape(6.dp))
                }
            }
        }
    }
}
