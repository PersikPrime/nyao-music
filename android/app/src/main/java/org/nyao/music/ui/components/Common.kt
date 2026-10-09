package org.nyao.music.ui.components

import android.graphics.Bitmap
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Equalizer
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.SingletonImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.SuccessResult
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.Track
import org.nyao.music.data.formatTime
import org.nyao.music.ui.theme.NyaoColors

fun sourceColor(source: String): Color = if (source == SOURCE_YA) NyaoColors.Ya else NyaoColors.YtBadge

@Composable
fun Cover(url: String?, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(16.dp)) {
    Box(modifier.clip(shape).background(NyaoColors.S3), contentAlignment = Alignment.Center) {
        if (url == null) {
            NyaoWaves(Modifier.fillMaxSize().padding(14.dp), animate = false, strokeDp = 3f, alpha = 0.5f)
        } else {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** Значок сервиса: «Я» на жёлтом или «YT» на красном */
@Composable
fun SourceTag(source: String, modifier: Modifier = Modifier) {
    val ya = source == SOURCE_YA
    Box(modifier.clip(RoundedCornerShape(10.dp)).background(sourceColor(source)).padding(horizontal = 6.dp, vertical = 2.dp)) {
        Text(if (ya) "Я" else "YT", color = if (ya) Color.Black else Color.White, fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, maxLines = 1)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleLarge, modifier = modifier.padding(horizontal = 20.dp, vertical = 10.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = NyaoColors.Lavender) }
}

@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, modifier = modifier.padding(horizontal = 20.dp, vertical = 12.dp))
}

/**
 * Строка трека в сгруппированном списке: плитки идут с зазором 3 dp,
 * у первой и последней сильно скруглены внешние углы.
 */
@Composable
fun TrackRow(
    track: Track,
    current: Boolean,
    liked: Boolean,
    onClick: () -> Unit,
    onPlayNext: () -> Unit,
    onLike: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(6.dp),
    coverSize: Dp = 48.dp,
) {
    var menu by remember { mutableStateOf(false) }
    val alpha = if (track.available) 1f else 0.4f
    Row(
        modifier
            .padding(horizontal = 12.dp)
            .fillMaxWidth()
            .bouncy().clip(shape)
            .background(if (current) NyaoColors.Primary else NyaoColors.S2)
            .clickable(enabled = track.available, onClick = onClick)
            .padding(start = 8.dp, end = 0.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box {
            Cover(track.cover, Modifier.size(coverSize), RoundedCornerShape(14.dp))
            if (current) {
                Box(Modifier.size(coverSize).clip(RoundedCornerShape(14.dp)).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Equalizer, null, tint = NyaoColors.Lavender)
                }
            }
        }
        Column(Modifier.weight(1f)) {
            Text(
                track.title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleSmall,
                color = (if (current) NyaoColors.OnPrimary else NyaoColors.Text).copy(alpha = alpha),
            )
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                SourceTag(track.source)
                Text(
                    track.artist + if (track.duration > 0) " · ${formatTime(track.duration)}" else "",
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                    color = NyaoColors.Muted.copy(alpha = alpha),
                )
            }
        }
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "Ещё", tint = NyaoColors.Muted) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Играть следующим") }, onClick = { menu = false; onPlayNext() })
                DropdownMenuItem(text = { Text(if (liked) "Убрать из «Мне нравится»" else "Мне нравится") }, onClick = { menu = false; onLike(!liked) })
            }
        }
    }
}

/** Цвета «Сейчас играет» из обложки: как в макете — светлый акцент, тёмный контейнер и почти чёрный фон того же оттенка */
data class CoverPalette(
    val accent: Color,
    val onAccent: Color,
    val container: Color,
    val onContainer: Color,
    val background: Color,
    val surface: Color,
    val sub: Color,
)

private fun hsv(h: Float, s: Float, v: Float) = Color(android.graphics.Color.HSVToColor(floatArrayOf(h, s, v)))

fun paletteFor(hue: Float, sat: Float = 1f): CoverPalette {
    val k = sat.coerceIn(0.35f, 1f)
    return CoverPalette(
        accent = hsv(hue, 0.30f * k + 0.05f, 1f),
        onAccent = hsv(hue, 0.65f * k, 0.32f),
        container = hsv(hue, 0.55f * k, 0.42f),
        onContainer = hsv(hue, 0.15f, 1f),
        background = hsv(hue, 0.40f * k, 0.10f),
        surface = hsv(hue, 0.30f * k, 0.16f),
        sub = hsv(hue, 0.12f, 0.85f),
    )
}

val DefaultPalette = paletteFor(262f)

@Composable
fun rememberCoverPalette(url: String?): CoverPalette {
    val context = LocalContext.current
    var hue by remember { mutableStateOf<Pair<Float, Float>?>(null) }
    LaunchedEffect(url) {
        if (url == null) {
            hue = null
            return@LaunchedEffect
        }
        val bmp = withContext(Dispatchers.IO) {
            runCatching {
                val req = ImageRequest.Builder(context).data(url).size(48).allowHardware(false).build()
                (SingletonImageLoader.get(context).execute(req) as? SuccessResult)?.image?.toBitmap()
            }.getOrNull()
        }
        hue = bmp?.let { dominantHue(it) }
    }
    val target = hue?.let { paletteFor(it.first, it.second) } ?: DefaultPalette
    val spec = tween<Color>(600)
    val accent by animateColorAsState(target.accent, spec, label = "a")
    val onAccent by animateColorAsState(target.onAccent, spec, label = "oa")
    val container by animateColorAsState(target.container, spec, label = "c")
    val onContainer by animateColorAsState(target.onContainer, spec, label = "oc")
    val bg by animateColorAsState(target.background, spec, label = "bg")
    val surface by animateColorAsState(target.surface, spec, label = "s")
    val sub by animateColorAsState(target.sub, spec, label = "sub")
    return CoverPalette(accent, onAccent, container, onContainer, bg, surface, sub)
}

/** Оттенок самого «говорящего» цвета обложки и его насыщенность */
private fun dominantHue(bmp: Bitmap): Pair<Float, Float>? {
    val small = Bitmap.createScaledBitmap(bmp, 16, 16, true)
    val hsv = FloatArray(3)
    var best: Pair<Float, Float>? = null
    var bestScore = 0.08f
    for (x in 0 until small.width) for (y in 0 until small.height) {
        android.graphics.Color.colorToHSV(small.getPixel(x, y), hsv)
        val score = hsv[1] * (1f - kotlin.math.abs(hsv[2] - 0.7f))
        if (score > bestScore) {
            bestScore = score
            best = hsv[0] to hsv[1]
        }
    }
    return best
}

@Composable
fun Dot(color: Color, size: Dp = 10.dp) {
    Box(Modifier.size(size).clip(CircleShape).background(color))
}

