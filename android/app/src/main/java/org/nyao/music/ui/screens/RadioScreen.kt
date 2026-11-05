package org.nyao.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_LIVE
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.Track
import org.nyao.music.data.YandexRadio
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.Hint
import org.nyao.music.ui.components.Loading
import org.nyao.music.ui.components.NyaoIcons
import org.nyao.music.ui.components.PillChip
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.theme.NyaoColors

/**
 * Радио: прямой эфир станций Яндекс Радио (как на ПК, src/renderer/app.js → renderRadio).
 * Цвета — только из темы (NyaoColors / MaterialTheme), поэтому экран сам подстраивается под Expressive, Mono и Glass.
 */
@Composable
fun RadioScreen(model: AppModel) {
    var stations by remember { mutableStateOf<List<YandexRadio.Station>?>(null) }
    var genres by remember { mutableStateOf<List<YandexRadio.Genre>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var genre by rememberSaveable { mutableStateOf("all") }
    var query by rememberSaveable { mutableStateOf("") }
    var searching by rememberSaveable { mutableStateOf(false) }
    var reload by remember { mutableStateOf(0) }
    val settings by Repo.prefs.settings.collectAsState()
    val current by PlayerConnection.current.collectAsState()
    val playing by PlayerConnection.playing.collectAsState()

    LaunchedEffect(reload) {
        error = null
        runCatching {
            withContext(Dispatchers.IO) {
                val st = YandexRadio.stations()
                val g = runCatching { YandexRadio.genres() }.getOrDefault(emptyList())
                st to g
            }
        }.onSuccess { (st, g) ->
            stations = st
            // жанры — только где есть хотя бы две станции, в порядке числа станций
            val n = st.flatMap { it.genres }.groupingBy { it }.eachCount()
            genres = g.filter { (n[it.slug] ?: 0) >= 2 }.sortedByDescending { n[it.slug] ?: 0 }.take(14)
        }.onFailure { error = "Не получилось загрузить станции: ${it.message}" }
    }

    val all = stations
    val q = query.trim().lowercase()
    val shown = all?.filter { (genre == "all" || genre in it.genres) && (q.isEmpty() || it.name.lowercase().contains(q) || it.desc.lowercase().contains(q)) }
    val favs = all?.let { list -> settings.radioFavs.mapNotNull { slug -> list.firstOrNull { it.slug == slug } } }.orEmpty()
    val liveSlug = current?.takeIf { it.source == SOURCE_LIVE }?.srcId?.substringBefore('/')

    fun play(st: YandexRadio.Station) {
        if (liveSlug == st.slug) { PlayerConnection.toggle(); return }
        // очередь эфира — станции, которые сейчас видно: ‹ › листают их
        val list = shown?.takeIf { l -> l.any { it.slug == st.slug } } ?: all ?: return
        PlayerConnection.playLive(list, list.indexOfFirst { it.slug == st.slug })
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        item {
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 16.dp, top = 14.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Радио", style = MaterialTheme.typography.displayMedium, maxLines = 1)
                    Text(if (all != null) "Прямой эфир ${all.size} станций" else "Прямой эфир из Яндекс Радио", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                }
                Box(Modifier.size(44.dp).bouncy().clip(CircleShape).background(NyaoColors.S2).clickable { searching = !searching; if (!searching) query = "" }, contentAlignment = Alignment.Center) {
                    Icon(if (searching) NyaoIcons.Close else NyaoIcons.Search, if (searching) "Закрыть поиск" else "Поиск станции", tint = NyaoColors.Text)
                }
            }
        }
        if (searching) item {
            TextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp),
                placeholder = { Text("Станция или жанр", color = NyaoColors.Muted) },
                leadingIcon = { Icon(NyaoIcons.Search, null, tint = NyaoColors.Muted) },
                singleLine = true,
                shape = RoundedCornerShape(28.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = NyaoColors.S3, unfocusedContainerColor = NyaoColors.S3,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, cursorColor = NyaoColors.Lavender,
                ),
            )
        }
        if (genres.isNotEmpty()) item {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillChip("Все", genre == "all", { genre = "all" })
                genres.forEach { g -> PillChip(g.name, genre == g.slug, { genre = g.slug }) }
            }
        }
        current?.takeIf { it.source == SOURCE_LIVE }?.let { t -> item { OnAirCard(model, t, playing) } }
        if (favs.isNotEmpty() && genre == "all" && q.isEmpty()) {
            item { Text("Мои станции", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 10.dp)) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(favs, key = { it.slug }) { st ->
                        Column(Modifier.width(80.dp).bouncy().clip(RoundedCornerShape(20.dp)).clickable { play(st) }.padding(bottom = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            StationLogo(st, 72, ring = st.slug == liveSlug)
                            Text(st.name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
                        }
                    }
                }
            }
        }
        when {
            error != null -> item {
                Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Hint(error!!)
                    PillChip("Ещё раз", false, { reload++ })
                }
            }
            shown == null -> item { Loading() }
            shown.isEmpty() -> item { Hint("Ничего не нашлось") }
            else -> {
                item {
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                        Text(if (genre == "all" && q.isEmpty()) "Все станции" else "Станции", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                        Text("по слушателям", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                    }
                }
                items(shown, key = { it.slug }) { st -> StationRow(st, st.slug == liveSlug) { play(st) } }
            }
        }
    }
}

@Composable
private fun StationLogo(st: YandexRadio.Station, size: Int, ring: Boolean = false) {
    val mod = if (ring) Modifier.size(size.dp).clip(CircleShape).background(NyaoColors.Lavender).padding(3.dp).clip(CircleShape).background(NyaoColors.Bg).padding(3.dp)
    else Modifier.size(size.dp)
    Box(mod.clip(CircleShape).background(Color(st.bg)), contentAlignment = Alignment.Center) {
        Text(st.name.removePrefix("Радио ").take(2), color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size / 4).sp)
        if (st.logo.isNotBlank()) Cover(st.logo, Modifier.fillMaxSize(), CircleShape)
    }
}

@Composable
private fun StationRow(st: YandexRadio.Station, current: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).background(if (current) NyaoColors.S2 else Color.Transparent).padding(horizontal = 20.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        StationLogo(st, 48)
        Column(Modifier.weight(1f)) {
            Text(st.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (current) "Играет сейчас" else st.desc, style = MaterialTheme.typography.bodySmall, color = if (current) NyaoColors.Lavender else NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (st.listeners > 0) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(Color(0xFF3DD68C)))
            Text("%,d".format(st.listeners).replace(',', ' '), style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted)
        }
    }
}

/** Трек из эфира как трек Яндекс Музыки — для лайка и «слушать целиком» */
fun onAirTrack(a: YandexRadio.OnAir): Track? = a.yaId?.let { Track(id = "$SOURCE_YA:$it", source = SOURCE_YA, srcId = it, title = a.title, artist = a.artist, cover = a.cover) }

/** «Сейчас в эфире»: станция, поток, трек с лайком в Яндекс Музыку, недавно звучало */
@Composable
private fun OnAirCard(model: AppModel, t: Track, playing: Boolean) {
    val recent by YandexRadio.recent.collectAsState()
    val liked by Repo.liked.collectAsState()
    val settings by Repo.prefs.settings.collectAsState()
    val st = YandexRadio.stationOf(t)
    val slug = t.srcId.substringBefore('/')
    val stream = YandexRadio.streamOf(t)
    val now = YandexRadio.nowOf(recent)
    val fav = slug in settings.radioFavs
    Column(
        Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.Hero).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (st != null) StationLogo(st, 48) else Cover(t.cover, Modifier.size(48.dp), CircleShape)
            Column(Modifier.weight(1f)) {
                Text(t.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(7.dp).clip(CircleShape).background(Color(0xFFFF4D4D)))
                    Text(if (playing) "В эфире" else "На паузе", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                }
            }
            IconButton(onClick = {
                Repo.prefs.setRadioFavs(if (fav) settings.radioFavs - slug else listOf(slug) + settings.radioFavs)
                model.message(if (fav) "Убрал из «Моих станций»" else "Станция в «Моих станциях»")
            }) { Icon(if (fav) NyaoIcons.StarFilled else NyaoIcons.Star, if (fav) "Убрать из моих станций" else "В мои станции", tint = if (fav) NyaoColors.Lavender else NyaoColors.Muted) }
            Box(Modifier.size(48.dp).bouncy().clip(CircleShape).background(NyaoColors.Primary).clickable { PlayerConnection.toggle() }, contentAlignment = Alignment.Center) {
                Icon(if (playing) NyaoIcons.Stop else NyaoIcons.PlayArrow, if (playing) "Остановить эфир" else "Слушать", tint = NyaoColors.OnPrimary)
            }
        }
        if (st != null && st.streams.size > 1) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            st.streams.forEach { s -> PillChip(s.name.ifBlank { "Эфир" }, s.slug == stream, { if (s.slug != stream) PlayerConnection.switchLiveStream(st, s.slug) }) }
        }
        if (now != null) {
            val track = onAirTrack(now)
            val isLiked = track != null && track.id in liked
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(NyaoColors.S1).padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Cover(now.cover, Modifier.size(52.dp), RoundedCornerShape(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(now.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(now.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (track != null) {
                    IconButton(onClick = { model.like(track, !isLiked) }) {
                        Icon(if (isLiked) NyaoIcons.Favorite else NyaoIcons.FavoriteBorder, if (isLiked) "Убрать из лайков" else "В лайки Яндекс Музыки", tint = if (isLiked) NyaoColors.Lavender else NyaoColors.Muted)
                    }
                    IconButton(onClick = { PlayerConnection.playList(listOf(track), 0, "Из эфира «${t.title}»") }) {
                        Icon(NyaoIcons.PlayArrow, "Слушать трек целиком", tint = NyaoColors.Muted)
                    }
                }
            }
        } else Text(if (recent.isNotEmpty()) "Сейчас реклама, новости или ведущие" else "Станция не сообщает, что играет", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        val earlier = recent.drop(if (now != null) 1 else 0).take(5)
        if (earlier.isNotEmpty()) {
            Text("Недавно звучало", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 4.dp))
            earlier.forEach { x ->
                val tr = onAirTrack(x)
                val on = tr != null && tr.id in liked
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (x.at > 0) android.text.format.DateFormat.format("HH:mm", x.at).toString() else "", style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted, modifier = Modifier.width(40.dp))
                    Column(Modifier.weight(1f)) {
                        Text(x.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(x.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (tr != null) IconButton(onClick = { model.like(tr, !on) }) {
                        Icon(if (on) NyaoIcons.Favorite else NyaoIcons.FavoriteBorder, if (on) "Убрать из лайков" else "В лайки Яндекс Музыки", tint = if (on) NyaoColors.Lavender else NyaoColors.Muted, modifier = Modifier.size(20.dp))
                    }
                }
            }
        }
        Spacer(Modifier.height(2.dp))
    }
}
