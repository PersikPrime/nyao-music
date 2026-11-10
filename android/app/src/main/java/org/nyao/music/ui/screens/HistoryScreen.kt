package org.nyao.music.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.nyao.music.data.NyaoCloud
import org.nyao.music.data.Repo
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.Hint
import org.nyao.music.ui.components.NyaoIcons
import org.nyao.music.ui.components.RowsSkeleton
import org.nyao.music.ui.components.TrackRow
import org.nyao.music.ui.theme.NyaoColors
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * История прослушиваний: что играло, по дням (свежее сверху), с поиском.
 * Своя история + с сервера (все устройства за 90 дней). Пропущенные треки — бледнее.
 */
@Composable
fun HistoryScreen(model: AppModel) {
    var plays by remember { mutableStateOf<List<NyaoCloud.Play>?>(null) }
    var query by remember { mutableStateOf("") }
    val current by PlayerConnection.current.collectAsState()
    val liked by Repo.liked.collectAsState()
    LaunchedEffect(Unit) {
        plays = withContext(Dispatchers.IO) { runCatching { Repo.cloud.historyAll() }.getOrDefault(emptyList()) }
    }
    val q = query.trim().lowercase()
    val shown = plays?.filter { q.isEmpty() || "${it.track.title} ${it.track.artist}".lowercase().contains(q) }
    val tracks = shown?.map { it.track }.orEmpty()
    val time = remember { SimpleDateFormat("HH:mm", Locale("ru")) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { model.back() }) { Icon(NyaoIcons.ArrowBack, "Назад", tint = NyaoColors.Text) }
                Text("История", style = MaterialTheme.typography.titleLarge)
            }
        }
        item {
            OutlinedTextField(
                value = query, onValueChange = { query = it }, singleLine = true,
                placeholder = { Text("Найти трек из истории") },
                leadingIcon = { Icon(NyaoIcons.Search, null) },
                shape = RoundedCornerShape(28.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            )
        }
        when {
            shown == null -> item { RowsSkeleton(Modifier.padding(top = 12.dp), count = 8) }
            shown.isEmpty() -> item { Hint(if (q.isNotEmpty()) "В истории такого не нашлось" else "История пока пустая — включи что-нибудь", Modifier.padding(20.dp)) }
            else -> {
                var lastDay = ""
                shown.forEachIndexed { i, p ->
                    val day = dayLabel(p.at)
                    if (day != lastDay) {
                        lastDay = day
                        item(key = "day-$i") {
                            Text(day, style = MaterialTheme.typography.titleSmall, color = NyaoColors.Muted, modifier = Modifier.padding(start = 24.dp, top = 18.dp, bottom = 6.dp))
                        }
                    }
                    item(key = "p-$i-${p.track.id}") {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(time.format(Date(p.at)), style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted, modifier = Modifier.padding(start = 20.dp).width(40.dp))
                            Box(Modifier.weight(1f).alpha(if (p.skipped) 0.55f else 1f)) {
                                TrackRow(
                                    track = p.track,
                                    current = current?.id == p.track.id,
                                    liked = p.track.id in liked,
                                    onClick = { PlayerConnection.playList(tracks, i, "История") },
                                    onPlayNext = { PlayerConnection.playNext(p.track) },
                                    onLike = { on -> model.like(p.track, on) },
                                    onArtist = { model.openArtist(p.track) },
                                    onAlbum = model.albumOf(p.track)?.let { al -> { model.go(Route.PlaylistPage(al)) } },
                                    modifier = Modifier.padding(bottom = 3.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun dayLabel(at: Long): String {
    val c = Calendar.getInstance().apply { timeInMillis = at }
    val today = Calendar.getInstance()
    fun sameDay(a: Calendar, b: Calendar) = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
    if (sameDay(c, today)) return "Сегодня"
    if (sameDay(c, (today.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -1) })) return "Вчера"
    val fmt = if (c.get(Calendar.YEAR) == today.get(Calendar.YEAR)) "d MMMM" else "d MMMM yyyy"
    return SimpleDateFormat(fmt, Locale("ru")).format(Date(at))
}
