package org.nyao.music.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.nyao.music.playback.Offline
import org.nyao.music.playback.PlaybackCache
import org.nyao.music.playback.plural
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.theme.Look
import org.nyao.music.ui.theme.NyaoColors
import org.nyao.music.ui.theme.tabular
import java.io.File

/** Сколько места занимает приложение, по частям */
private data class Usage(val audio: Long, val offline: Long, val covers: Long, val data: Long, val free: Long) {
    val total: Long get() = audio + offline + covers + data
}

private fun dirSize(f: File?): Long {
    if (f == null || !f.exists()) return 0L
    if (f.isFile) return f.length()
    return f.listFiles()?.sumOf { dirSize(it) } ?: 0L
}

private fun measure(ctx: android.content.Context): Usage {
    val audio = runCatching { PlaybackCache.sizeBytes(ctx) }.getOrDefault(0L)
    val offline = runCatching { Offline.sizeBytes(ctx) }.getOrDefault(0L)
    val covers = runCatching { coil3.SingletonImageLoader.get(ctx).diskCache?.size ?: 0L }.getOrDefault(0L)
    // всё остальное: настройки, база кэша, медиатека, логи — что лежит в папках приложения помимо трёх частей выше
    val all = dirSize(ctx.filesDir) + dirSize(ctx.cacheDir)
    val data = (all - audio - offline - covers).coerceAtLeast(0L)
    val free = runCatching { android.os.StatFs(ctx.filesDir.path).availableBytes }.getOrDefault(0L)
    return Usage(audio, offline, covers, data, free)
}

fun formatBytes(b: Long): String = when {
    b >= 1L shl 30 -> String.format(java.util.Locale("ru"), "%.1f ГБ", b / (1L shl 30).toDouble())
    b >= 1L shl 20 -> "${b / (1L shl 20)} МБ"
    b >= 1L shl 10 -> "${b / (1L shl 10)} КБ"
    else -> "$b Б"
}

/**
 * «Офлайн и кэш»: кольцевая диаграмма места (кэш прослушанного, скачанное, обложки, данные),
 * под ней — разбивка с кнопками очистки и список скачанных плейлистов.
 */
@Composable
fun StorageCard() {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var usage by remember { mutableStateOf<Usage?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var confirm by remember { mutableStateOf(false) }
    val offline by Offline.state.collectAsState()
    LaunchedEffect(tick, offline.tracks.size) { usage = withContext(Dispatchers.IO) { measure(ctx) } }
    val mono = Look.current.mono
    val colors = if (mono) {
        listOf(Color(0xFFF2F2F3), Color(0xFFA5A5AC), Color(0xFF6A6A72), Color(0xFF3A3A3F))
    } else {
        listOf(NyaoColors.Lavender, Color(0xFF7CE0C3), Color(0xFFFFD60A), Color(0xFFFFB4A8))
    }
    fun refresh() { tick++ }

    val u = usage
    val parts = if (u == null) emptyList() else listOf(u.audio, u.offline, u.covers, u.data)
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(Modifier.size(200.dp), contentAlignment = Alignment.Center) {
            Donut(parts, colors, Modifier.size(200.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (u == null) "…" else formatBytes(u.total), style = MaterialTheme.typography.headlineMedium.tabular)
                Text("занимает Nyao", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            }
        }
        if (u != null) Text("Свободно на телефоне: ${formatBytes(u.free)}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, textAlign = TextAlign.Center)
    }

    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer)) {
        UsageRow(colors[0], "Кэш прослушанного", u?.audio, "До ${formatBytes(PlaybackCache.MAX_BYTES)}, старое удаляется само. Повторно трек играет с диска.", "Очистить") {
            scope.launch {
                withContext(Dispatchers.IO) { PlaybackCache.clear(ctx) }
                refresh()
            }
        }
        UsageRow(colors[1], "Скачанное", u?.offline, "${offline.tracks.size} ${plural(offline.tracks.size, "трек", "трека", "треков")} без интернета, само не удаляется.", if (offline.tracks.isNotEmpty()) "Удалить" else null) { confirm = true }
        UsageRow(colors[2], "Обложки", u?.covers, "Картинки альбомов и плейлистов — чтобы ленты открывались быстро.", "Очистить") {
            scope.launch {
                withContext(Dispatchers.IO) { runCatching { coil3.SingletonImageLoader.get(ctx).diskCache?.clear() } }
                runCatching { coil3.SingletonImageLoader.get(ctx).memoryCache?.clear() }
                refresh()
            }
        }
        UsageRow(colors[3], "Данные приложения", u?.data, "Медиатека, настройки, история. Очищаются только вместе с приложением.", null, last = true) {}
    }

    if (offline.playlists.isNotEmpty() || offline.progress.isNotEmpty()) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("Скачанные плейлисты", style = MaterialTheme.typography.titleSmall)
            offline.playlists.forEach { (id, title) ->
                val p = offline.progress[id]
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(colors[1]))
                    Text(title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f).padding(start = 10.dp), maxLines = 1)
                    Text(if (p != null) "качается ${p.first}/${p.second}" else "готово", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                }
            }
        }
    }

    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Удалить скачанное?") },
        text = { Text("Все скачанные треки пропадут с телефона — без интернета они играть не будут. Лайки и плейлисты останутся.") },
        confirmButton = {
            TextButton(onClick = {
                confirm = false
                Offline.removeAll()
                scope.launch {
                    kotlinx.coroutines.delay(400)
                    refresh()
                }
            }) { Text("Удалить") }
        },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Отмена") } },
    )
}

/** Кольцо: доли по кругу с зазорами, вырастает при открытии */
@Composable
private fun Donut(parts: List<Long>, colors: List<Color>, modifier: Modifier = Modifier) {
    val grow = remember { Animatable(0f) }
    LaunchedEffect(parts.isNotEmpty()) { if (parts.isNotEmpty()) grow.animateTo(1f, tween(900)) }
    val track = NyaoColors.S3
    Canvas(modifier) {
        val stroke = 22.dp.toPx()
        val inset = stroke / 2f
        val arc = Size(size.width - stroke, size.height - stroke)
        val tl = Offset(inset, inset)
        drawArc(track, 0f, 360f, false, tl, arc, style = Stroke(stroke))
        val total = parts.sum()
        if (total <= 0L) return@Canvas
        val shown = parts.withIndex().filter { it.value > 0 }
        // зазор между долями и минимальная видимая доля, чтобы мелочь не пропадала
        val gap = if (shown.size > 1) 6f else 0f
        val sweepAll = 360f * grow.value - gap * shown.size
        val minSweep = 4f
        val raw = shown.map { (it.value.toFloat() / total) * sweepAll }
        val bonus = raw.sumOf { (minSweep - it).coerceAtLeast(0f).toDouble() }.toFloat()
        val bigSum = raw.filter { it > minSweep }.sum().coerceAtLeast(1f)
        var start = -90f
        shown.forEachIndexed { i, (idx, _) ->
            val r = raw[i]
            val sweep = if (r <= minSweep) minSweep else r - bonus * (r / bigSum)
            if (sweep > 0f) drawArc(colors[idx], start + gap / 2f, sweep.coerceAtLeast(0.5f), false, tl, arc, style = Stroke(stroke, cap = StrokeCap.Butt))
            start += sweep + gap
        }
    }
}

@Composable
private fun UsageRow(color: Color, title: String, bytes: Long?, hint: String, action: String?, last: Boolean = false, onAction: () -> Unit) {
    Column {
        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 10.dp, top = 14.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(14.dp).clip(CircleShape).background(color))
            Column(Modifier.weight(1f).padding(start = 14.dp, end = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    Text(bytes?.let { formatBytes(it) } ?: "…", style = MaterialTheme.typography.titleSmall.tabular)
                }
                Text(hint, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            }
            if (action != null) {
                TextButton(onClick = onAction, enabled = (bytes ?: 0L) > 0L, modifier = Modifier.bouncy()) { Text(action) }
            }
        }
        if (!last) Box(Modifier.padding(start = 46.dp).fillMaxWidth().height(1.dp).background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)))
    }
}
