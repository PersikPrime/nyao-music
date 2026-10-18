package org.nyao.music.ui.screens

import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.layout.width
import org.nyao.music.ui.components.NyaoIcons

import androidx.compose.foundation.rememberScrollState

import androidx.compose.foundation.horizontalScroll

import androidx.compose.material3.TextButton

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.components.appear
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.nyao.music.data.Playlist
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.SOURCE_YT
import kotlinx.coroutines.launch
import org.nyao.music.data.Track
import org.nyao.music.data.alternate
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.ConnectedGroup
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.Hint
import org.nyao.music.ui.components.Loading
import org.nyao.music.ui.components.PillChip
import org.nyao.music.ui.components.PolarShape
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.components.TrackRow
import org.nyao.music.ui.components.groupShape
import org.nyao.music.ui.theme.NyaoColors

/** Формы обложек в сетке плейлистов чередуются — как «печенья» в макетах */
private val TILE_SHAPES: List<Shape> = listOf(
    RoundedCornerShape(30.dp),
    PolarShape(10, 0.04f),
    PolarShape(squircle = 1f),
    RoundedCornerShape(topStart = 60.dp, topEnd = 60.dp, bottomStart = 20.dp, bottomEnd = 20.dp),
)

/** Сгруппированный список треков внутри LazyColumn */
private fun LazyListScope.trackGroup(model: AppModel, tracks: List<Track>, label: String, currentId: String?, liked: Set<String>, onPlay: ((Int) -> Unit)? = null) {
    itemsIndexed(tracks) { i, t ->
        TrackRow(
            track = t,
            current = currentId == t.id,
            liked = t.id in liked,
            onClick = { onPlay?.invoke(i) ?: PlayerConnection.playList(tracks, i, label) },
            onPlayNext = { PlayerConnection.playNext(t) },
            onLike = { on -> model.like(t, on) },
            onArtist = { model.openArtist(t) },
            onAlbum = model.albumOf(t)?.let { al -> { model.go(Route.PlaylistPage(al)) } },
            shape = groupShape(i, tracks.size),
            modifier = Modifier.appear(if (i < 12) i else 0).padding(bottom = 3.dp),
        )
    }
}

@Composable
private fun ScreenHeader(title: String, onBack: (() -> Unit)? = null, action: (@Composable () -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(start = if (onBack != null) 8.dp else 20.dp, end = 16.dp, top = 14.dp, bottom = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) IconButton(onClick = onBack) { Icon(NyaoIcons.ArrowBack, "Назад", tint = NyaoColors.Text) }
        Text(title, style = MaterialTheme.typography.displayMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        action?.invoke()
    }
}

@Composable
private fun CircleButton(onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(Modifier.size(44.dp).bouncy().clip(CircleShape).background(NyaoColors.S2).clickable(onClick = onClick), contentAlignment = Alignment.Center) { content() }
}

/** Пара кнопок «Слушать / Вперемешку» в стиле группы кнопок */
@Composable
private fun PlayButtons(tracks: List<Track>, label: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            Modifier.weight(1.4f).height(52.dp).bouncy().clip(RoundedCornerShape(26.dp, 10.dp, 10.dp, 26.dp)).background(NyaoColors.Lavender)
                .clickable(enabled = tracks.isNotEmpty()) { PlayerConnection.playList(tracks, 0, label) },
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(NyaoIcons.PlayArrow, null, tint = NyaoColors.OnLavender)
            Spacer(Modifier.size(6.dp))
            Text("Слушать", style = MaterialTheme.typography.labelLarge, color = NyaoColors.OnLavender)
        }
        Row(
            Modifier.weight(1f).height(52.dp).bouncy().clip(RoundedCornerShape(10.dp, 26.dp, 26.dp, 10.dp)).background(NyaoColors.Tonal)
                .clickable(enabled = tracks.isNotEmpty()) { PlayerConnection.playList(tracks.shuffled(), 0, label) },
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(NyaoIcons.Shuffle, null, tint = NyaoColors.Text)
            Spacer(Modifier.size(6.dp))
            Text("Вперемешку", style = MaterialTheme.typography.labelLarge, maxLines = 1)
        }
    }
}

// ---------- Медиатека ----------

@Composable
fun LibraryScreen(model: AppModel, wide: Boolean) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var filter by rememberSaveable { mutableStateOf("all") }
    LaunchedEffect(tab) { if (tab == 0) model.loadLiked() else if (tab == 1) model.loadPlaylists() else Repo.importYaArtists() }
    val current by PlayerConnection.current.collectAsState()
    val likedIds by Repo.liked.collectAsState()

    val mono = org.nyao.music.ui.theme.Look.current.mono
    val header: @Composable () -> Unit = {
        Column {
            if (mono) {
                // Mono: крупный заголовок, как в макете
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Медиатека", style = MaterialTheme.typography.displaySmall, modifier = Modifier.weight(1f))
                    CircleButton({ model.go(Route.Search) }) { Icon(NyaoIcons.Search, "Поиск", tint = NyaoColors.Text) }
                }
            } else ScreenHeader("Медиатека", action = { CircleButton({ model.go(Route.Search) }) { Icon(NyaoIcons.Search, "Поиск", tint = NyaoColors.Text) } })
            ConnectedGroup(listOf("Мне нравится", "Плейлисты", "Исполнители"), tab, { tab = it }, Modifier.padding(horizontal = 16.dp), height = 48.dp)
            Spacer(Modifier.height(14.dp))
        }
    }

    if (tab == 2) {
        // любимые исполнители: сердечко на странице исполнителя (и «Мои исполнители» из Яндекса)
        val favs by Repo.favArtists.collectAsState()
        LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
            item { header() }
            if (favs.isEmpty()) item { Hint("Здесь будут любимые исполнители. Открой исполнителя и нажми ♥ — его треки станут чаще попадать в «Мою волну».") }
            items(favs.size) { i ->
                val a = favs[i]
                Row(
                    Modifier.padding(horizontal = 12.dp, vertical = 2.dp).fillMaxWidth().bouncy().clip(RoundedCornerShape(20.dp)).background(NyaoColors.S2)
                        .clickable { model.go(Route.ArtistPage(a.ref.substringBefore(':'), a.ref.substringAfter(':'), a.name)) }.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Cover(a.cover, Modifier.size(52.dp), androidx.compose.foundation.shape.CircleShape)
                    Column(Modifier.weight(1f)) {
                        Text(a.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(if (a.at > 0) "Любимый исполнитель" else "Из «Моих исполнителей» Яндекса", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                    }
                    Icon(NyaoIcons.Favorite, null, tint = NyaoColors.Lavender, modifier = Modifier.size(20.dp))
                }
            }
        }
        return
    }
    if (tab == 0) {
        val liked = model.liked
        LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
            item { header() }
            when {
                liked == null -> item { Loading() }
                liked.isEmpty() -> item { Hint("Пока пусто. Лайкай треки — они появятся здесь из обоих сервисов.") }
                else -> {
                    val ya = liked.count { it.source == SOURCE_YA }
                    val sc = liked.count { it.source == org.nyao.music.data.SOURCE_SC }
                    val vk = liked.count { it.source == org.nyao.music.data.SOURCE_VK }
                    val yt = liked.size - ya - sc - vk
                    val shown = if (filter == "all") liked else liked.filter { it.source == filter }
                    if (mono) item { MonoLikedCards(model, liked.size, shown) }
                    if (!mono) item {
                        // Карточка «Мне нравится»: печенька с сердцем, счётчики и кнопки
                        Column(
                            Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(32.dp)).background(NyaoColors.Hero).padding(18.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                Box(Modifier.size(64.dp).clip(PolarShape(9, 0.08f)).background(NyaoColors.Lavender), contentAlignment = Alignment.Center) {
                                    Icon(NyaoIcons.Favorite, null, tint = NyaoColors.OnLavender, modifier = Modifier.size(28.dp))
                                }
                                Column {
                                    Text("Мне нравится", style = MaterialTheme.typography.headlineSmall, color = NyaoColors.OnPrimary)
                                    Text("Яндекс $ya · YouTube $yt" + (if (sc > 0) " · SoundCloud $sc" else "") + (if (vk > 0) " · VK $vk" else ""), style = MaterialTheme.typography.bodySmall, color = NyaoColors.Lavender)
                                }
                            }
                            PlayButtons(shown, "Мне нравится")
                        }
                    }
                    item {
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            LikesDownloadChip(model, liked)
                            PillChip("Все · ${liked.size}", filter == "all", { filter = "all" })
                            if (ya > 0) PillChip("Яндекс · $ya", filter == SOURCE_YA, { filter = SOURCE_YA })
                            if (yt > 0) PillChip("YouTube · $yt", filter == SOURCE_YT, { filter = SOURCE_YT })
                            if (sc > 0) PillChip("SoundCloud · $sc", filter == org.nyao.music.data.SOURCE_SC, { filter = org.nyao.music.data.SOURCE_SC })
                            if (vk > 0) PillChip("VK · $vk", filter == org.nyao.music.data.SOURCE_VK, { filter = org.nyao.music.data.SOURCE_VK })
                        }
                    }
                    trackGroup(model, shown, "Мне нравится", current?.id, likedIds)
                }
            }
        }
    } else {
        val settings by Repo.prefs.settings.collectAsState()
        val mixes by Repo.mixStore.mixes.collectAsState()
        LaunchedEffect(settings.splitLiked) { if (settings.splitLiked) model.loadLiked() }
        // лайки по сервисам (если включено) + свои миксы + плейлисты сервисов
        val lists = model.playlists?.let { pl ->
            (if (settings.splitLiked) likedPlaylists(model.liked, true).filter { it.id != "liked" } else emptyList()) + mixes.map { it.asPlaylist() } + pl
        }
        LazyVerticalGrid(
            GridCells.Adaptive(if (wide) 180.dp else 150.dp),
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 190.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.padding(horizontal = 0.dp)) { header() } }
            item(span = { GridItemSpan(maxLineSpan) }) {
                Row(
                    Modifier.fillMaxWidth().bouncy().clip(RoundedCornerShape(24.dp)).background(NyaoColors.Tonal).clickable { model.mixBuilderOpen = true }.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(Modifier.size(44.dp).clip(PolarShape(6, 0.1f)).background(NyaoColors.Lavender), contentAlignment = Alignment.Center) { Text("+", style = MaterialTheme.typography.titleLarge, color = NyaoColors.OnLavender) }
                    Column {
                        Text("Новый микс", style = MaterialTheme.typography.titleMedium)
                        Text("Из самого прослушиваемого или пустой", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                    }
                }
            }
            when {
                lists == null -> item(span = { GridItemSpan(maxLineSpan) }) { Loading() }
                lists.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) { Hint("Плейлистов нет или сервисы не подключены.") }
                else -> itemsIndexed(lists) { i, p ->
                    Box(Modifier.appear(if (i < 12) i else 0)) { GridPlaylist(p, TILE_SHAPES[i % TILE_SHAPES.size]) { model.go(Route.PlaylistPage(p)) } }
                }
            }
        }
    }
}

@Composable
private fun GridPlaylist(p: Playlist, shape: Shape, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().bouncy().clip(RoundedCornerShape(20.dp)).clickable(onClick = onClick)) {
        Box(Modifier.fillMaxWidth()) {
            Cover(p.cover, Modifier.fillMaxWidth().aspectRatio(1f), shape)
            SourceTag(p.source, Modifier.align(Alignment.BottomEnd).padding(10.dp))
        }
        Text(p.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp, start = 4.dp, end = 4.dp))
        val sub = p.subtitle.ifEmpty { if (p.count > 0) "${p.count} треков" else "" }
        if (sub.isNotEmpty()) Text(sub, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, modifier = Modifier.padding(start = 4.dp, end = 4.dp))
    }
}

// ---------- Плейлист ----------

@Composable
fun PlaylistScreen(model: AppModel, playlist: Playlist) {
    LaunchedEffect(playlist.id) { model.loadPlaylist(playlist.id) }
    val tracks = model.playlistTracks[playlist.id]
    val current by PlayerConnection.current.collectAsState()
    val likedIds by Repo.liked.collectAsState()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { model.back() }) { Icon(NyaoIcons.ArrowBack, "Назад", tint = NyaoColors.Text) }
                Spacer(Modifier.weight(1f))
                // перенести в другой сервис
                if (!tracks.isNullOrEmpty()) IconButton(onClick = { model.transferFor = playlist to tracks }) { Icon(NyaoIcons.SwapHoriz, "Перенести в другой сервис", tint = NyaoColors.Text) }
                // свой микс можно удалить
                if (playlist.id.startsWith("mix:")) TextButton(onClick = {
                    Repo.mixStore.delete(playlist.id)
                    model.message("Микс «${playlist.title}» удалён")
                    model.back()
                }) { Text("Удалить микс") }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box {
                    Cover(playlist.cover ?: tracks?.firstOrNull()?.cover, Modifier.size(220.dp), PolarShape(12, 0.035f))
                    SourceTag(playlist.source, Modifier.align(Alignment.TopStart).padding(18.dp))
                }
                Text(playlist.title, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 18.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Text(
                    (if (playlist.source == "mix") playlist.subtitle.ifEmpty { "Все сервисы" } else org.nyao.music.data.sourceName(playlist.source)) + (tracks?.let { " · ${it.size} треков" } ?: ""),
                    style = MaterialTheme.typography.bodyMedium,
                    color = NyaoColors.Muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
                PlayButtons(tracks ?: emptyList(), playlist.title, Modifier.padding(top = 18.dp, bottom = 8.dp))
                OfflineButton(model, playlist, tracks)
            }
        }
        if (tracks == null) item { Loading() } else trackGroup(model, tracks, playlist.title, current?.id, likedIds)
    }
}

/** Скачать плейлист для прослушивания без интернета (Яндекс и YouTube; SoundCloud и VK — пока нельзя) */
@Composable
private fun OfflineButton(model: AppModel, playlist: Playlist, tracks: List<Track>?) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val st by org.nyao.music.playback.Offline.state.collectAsState()
    val mod = Modifier.padding(bottom = 14.dp)
    if (tracks.isNullOrEmpty()) return
    if (playlist.id == org.nyao.music.playback.Offline.PLAYLIST_ID) {
        TextButton(onClick = {
            org.nyao.music.playback.Offline.removeAll()
            model.message("Скачанное удалено")
            model.back()
        }, modifier = mod) { Text("Удалить всё скачанное") }
        return
    }
    val prog = st.progress[playlist.id]
    val ids = st.ids
    val can = tracks.count { org.nyao.music.playback.Offline.canDownload(it) }
    val have = tracks.count { it.id in ids && org.nyao.music.playback.Offline.canDownload(it) }
    when {
        prog != null -> Row(mod, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            androidx.compose.material3.CircularProgressIndicator(
                progress = { if (prog.second == 0) 0f else prog.first / prog.second.toFloat() },
                modifier = Modifier.size(22.dp),
                strokeWidth = 3.dp,
            )
            Text("Скачиваю ${prog.first} из ${prog.second}", style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted)
            TextButton(onClick = { org.nyao.music.playback.Offline.cancel(playlist.id) }) { Text("Отменить") }
        }
        can == 0 -> Text("SoundCloud и VK пока нельзя скачать для офлайна", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, modifier = mod)
        have >= can -> androidx.compose.material3.OutlinedButton(onClick = {
            org.nyao.music.playback.Offline.remove(playlist.id, tracks)
            model.message("Загрузка «${playlist.title}» удалена")
        }, modifier = mod) {
            Icon(NyaoIcons.DownloadDone, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.size(8.dp))
            Text("Скачано · удалить")
        }
        else -> androidx.compose.material3.FilledTonalButton(onClick = {
            org.nyao.music.playback.Offline.download(ctx, playlist.id, playlist.title, tracks)
            model.message("Скачиваю «${playlist.title}» — можно слушать дальше")
        }, modifier = mod) {
            Icon(NyaoIcons.Download, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.size(8.dp))
            Text(if (have > 0) "Докачать (${can - have})" else "Скачать для офлайна")
        }
    }
}

/** Mono: градиентная карточка «Мне нравится» и рядом «Скачанное», под ними — кнопки «Слушать» и «Вперемешку» */
@Composable
private fun MonoLikedCards(model: AppModel, total: Int, shown: List<Track>) {
    val off by org.nyao.music.playback.Offline.state.collectAsState()
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().height(132.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.weight(1.9f).fillMaxHeight().clip(RoundedCornerShape(26.dp))
                    .background(androidx.compose.ui.graphics.Brush.linearGradient(listOf(NyaoColors.Lavender.copy(alpha = 0.55f), NyaoColors.Lavender)))
                    .padding(16.dp),
            ) {
                Box(Modifier.align(Alignment.TopEnd).offset(x = 40.dp, y = (-40).dp).size(130.dp).clip(PolarShape(9, 0.07f)).background(Color.White.copy(alpha = 0.16f)))
                Icon(NyaoIcons.Favorite, null, tint = NyaoColors.OnLavender, modifier = Modifier.size(28.dp))
                Column(Modifier.align(Alignment.BottomStart)) {
                    Text("Мне нравится", style = MaterialTheme.typography.titleLarge, color = NyaoColors.OnLavender)
                    Text("$total · все сервисы", style = MaterialTheme.typography.bodySmall, color = NyaoColors.OnLavender.copy(alpha = 0.8f))
                }
            }
            Box(
                Modifier.weight(1f).fillMaxHeight().bouncy().clip(RoundedCornerShape(26.dp)).background(NyaoColors.S3)
                    .clickable { org.nyao.music.playback.Offline.asPlaylist()?.let { model.go(Route.PlaylistPage(it)) } ?: model.message("Пока ничего не скачано") }
                    .padding(16.dp),
            ) {
                Icon(NyaoIcons.Download, null, tint = NyaoColors.Muted, modifier = Modifier.size(26.dp))
                Column(Modifier.align(Alignment.BottomStart)) {
                    Text("Скачанное", style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text("${off.tracks.size}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                }
            }
        }
        PlayButtons(shown, "Мне нравится")
    }
}

/** «Скачать все лайки» — рядом с фильтрами в «Мне нравится» */
@Composable
private fun LikesDownloadChip(model: AppModel, liked: List<Track>) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val st by org.nyao.music.playback.Offline.state.collectAsState()
    val id = "liked"
    val prog = st.progress[id]
    val can = liked.count { org.nyao.music.playback.Offline.canDownload(it) }
    val have = liked.count { it.id in st.ids && org.nyao.music.playback.Offline.canDownload(it) }
    if (can == 0) return
    val done = prog == null && have >= can
    Row(
        Modifier.height(36.dp).bouncy().clip(RoundedCornerShape(18.dp))
            .background(if (done) NyaoColors.S2 else NyaoColors.Tonal)
            .clickable {
                when {
                    prog != null -> {
                        org.nyao.music.playback.Offline.cancel(id)
                        model.message("Загрузка лайков остановлена")
                    }
                    done -> model.message("Все лайки уже скачаны — удалить можно в «Скачанном»")
                    else -> {
                        org.nyao.music.playback.Offline.download(ctx, id, "Мне нравится", liked)
                        model.message("Скачиваю лайки (${can - have}) — можно слушать дальше")
                    }
                }
            }
            .semantics { contentDescription = if (prog != null) "Скачиваю лайки, ${prog.first} из ${prog.second}. Нажми, чтобы отменить" else if (done) "Все лайки скачаны" else "Скачать все лайки" }
            .padding(start = 12.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (prog != null) {
            androidx.compose.material3.CircularProgressIndicator(
                progress = { if (prog.second == 0) 0f else prog.first / prog.second.toFloat() },
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.5.dp,
                color = NyaoColors.Lavender,
            )
            Text("${prog.first} / ${prog.second}", style = MaterialTheme.typography.labelLarge, color = NyaoColors.Text, maxLines = 1)
            Icon(NyaoIcons.Close, null, tint = NyaoColors.Muted, modifier = Modifier.size(16.dp))
        } else {
            Icon(if (done) NyaoIcons.DownloadDone else NyaoIcons.Download, null, tint = if (done) NyaoColors.Muted else NyaoColors.Lavender, modifier = Modifier.size(18.dp))
            Text(
                when {
                    done -> "Лайки скачаны"
                    have > 0 -> "Докачать лайки (${can - have})"
                    else -> "Скачать все лайки"
                },
                style = MaterialTheme.typography.labelLarge,
                color = if (done) NyaoColors.Muted else NyaoColors.Text,
                maxLines = 1,
            )
        }
    }
}

// ---------- Поиск ----------

/** Большая карточка, когда запрос — имя исполнителя */
@Composable
private fun BestArtistCard(a: org.nyao.music.data.SearchArtist, onOpen: () -> Unit) {
    Row(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().bouncy().clip(RoundedCornerShape(28.dp))
            .background(NyaoColors.Tonal).clickable(onClick = onOpen).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Cover(a.cover, Modifier.size(84.dp), CircleShape)
        Column(Modifier.weight(1f)) {
            Text("ИСПОЛНИТЕЛЬ · ${org.nyao.music.data.sourceName(a.source).uppercase()}", style = MaterialTheme.typography.labelSmall, color = NyaoColors.Lavender)
            Text(a.name, style = MaterialTheme.typography.headlineSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Популярное, альбомы и все треки", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        }
        Icon(NyaoIcons.PlayArrow, null, tint = NyaoColors.Lavender)
    }
}

@Composable
fun SearchScreen(model: AppModel) {
    var text by rememberSaveable { mutableStateOf(model.searchQuery) }
    var filter by rememberSaveable { mutableStateOf("all") }
    val focus = LocalFocusManager.current
    val current by PlayerConnection.current.collectAsState()
    val likedIds by Repo.liked.collectAsState()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        item { ScreenHeader("Поиск", onBack = { model.back() }) }
        item {
            TextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                placeholder = { Text("Трек или исполнитель", color = NyaoColors.Muted) },
                leadingIcon = { Icon(NyaoIcons.Search, null, tint = NyaoColors.Muted) },
                trailingIcon = { if (text.isNotEmpty()) IconButton(onClick = { text = "" }) { Icon(NyaoIcons.Close, "Очистить", tint = NyaoColors.Muted) } },
                singleLine = true,
                shape = RoundedCornerShape(28.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = NyaoColors.S3,
                    unfocusedContainerColor = NyaoColors.S3,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = NyaoColors.Lavender,
                ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {
                    model.searchQuery = text
                    model.runSearch(text)
                    focus.clearFocus()
                }),
            )
        }
        val res = model.search
        when {
            model.searching -> item { Loading() }
            res == null -> item { Hint("Ищет сразу в Яндекс Музыке, YouTube Music, SoundCloud и VK (если вошёл). YouTube и SoundCloud работают и без входа.") }
            else -> {
                item {
                    Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PillChip("Все", filter == "all", { filter = "all" })
                        PillChip("Яндекс · ${res.ya.size}", filter == SOURCE_YA, { filter = SOURCE_YA })
                        PillChip("YouTube · ${res.yt.size}", filter == SOURCE_YT, { filter = SOURCE_YT })
                        PillChip("SoundCloud · ${res.sc.size}", filter == org.nyao.music.data.SOURCE_SC, { filter = org.nyao.music.data.SOURCE_SC })
                        if (res.vk.isNotEmpty() || Repo.vk.loggedIn) PillChip("VK · ${res.vk.size}", filter == org.nyao.music.data.SOURCE_VK, { filter = org.nyao.music.data.SOURCE_VK })
                    }
                }
                val arr = org.nyao.music.data.Search.arrange(res, filter, model.searchQuery)
                val shown = arr.tracks
                arr.best?.let { b -> item { BestArtistCard(b) { model.go(Route.ArtistPage(b.source, b.id, b.name)) } } }
                if (arr.artists.isNotEmpty()) {
                    item { Text("Исполнители", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 10.dp)) }
                    item {
                        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(arr.artists, key = { it.source + it.id }) { a ->
                                Column(Modifier.width(104.dp).bouncy().clip(RoundedCornerShape(20.dp)).clickable { model.go(Route.ArtistPage(a.source, a.id, a.name)) }.padding(bottom = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                    Box {
                                        Cover(a.cover, Modifier.size(96.dp), CircleShape)
                                        SourceTag(a.source, Modifier.align(Alignment.BottomEnd))
                                    }
                                    Text(a.name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                                }
                            }
                        }
                    }
                }
                if (arr.albums.isNotEmpty()) {
                    item { Text("Альбомы", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 10.dp)) }
                    item {
                        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(arr.albums, key = { it.id }) { p -> PlaylistTile(p, size = 136) { model.go(Route.PlaylistPage(p)) } }
                        }
                    }
                }
                if (shown.isNotEmpty()) item {
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 18.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Треки", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                        TextButton(onClick = { PlayerConnection.enqueueAll(shown, next = true, label = "Поиск: ${model.searchQuery}"); model.message("${shown.size} треков — играют следующими") }) { Text("Следующими") }
                        TextButton(onClick = { PlayerConnection.enqueueAll(shown, next = false, label = "Поиск: ${model.searchQuery}"); model.message("${shown.size} треков — в конце очереди") }) { Text("В конец") }
                    }
                }
                if (shown.isEmpty() && arr.best == null && arr.artists.isEmpty() && arr.albums.isEmpty()) item { Hint("Ничего не нашлось.") }
                else if (shown.isNotEmpty()) trackGroup(model, shown, "Поиск: ${model.searchQuery}", current?.id, likedIds) { i ->
                    if (Repo.prefs.settings.value.searchPlay == "similar") {
                        // трек из поиска: только он, а дальше — похожее на него
                        PlayerConnection.playList(listOf(shown[i]), 0, "Поиск: ${model.searchQuery}")
                        Repo.forceContinue = true
                    } else PlayerConnection.playList(shown, i, "Поиск: ${model.searchQuery}")
                }
            }
        }
    }
}

// ---------- Исполнитель ----------

/** Страница исполнителя: обложка, популярное, альбомы. У SoundCloud и VK — его треки из поиска */
@Composable
fun ArtistScreen(model: AppModel, r: Route.ArtistPage) {
    var page by remember(r) { mutableStateOf<org.nyao.music.data.ArtistPage?>(null) }
    var failed by remember(r) { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(r) {
        page = runCatching { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Repo.artistPage(r.source, r.id, r.name) } }.getOrNull()
        failed = page == null
    }
    val current by PlayerConnection.current.collectAsState()
    val likedIds by Repo.liked.collectAsState()
    val p = page
    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { model.back() }) { Icon(NyaoIcons.ArrowBack, "Назад", tint = NyaoColors.Text) }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Cover(p?.cover, Modifier.size(200.dp), androidx.compose.foundation.shape.CircleShape)
                Text(p?.name ?: r.name, style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(top = 16.dp), maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                Text(
                    org.nyao.music.data.sourceName(r.source) + (p?.listeners?.let { " · ${java.text.NumberFormat.getInstance(java.util.Locale("ru")).format(it)} слушателей за месяц" } ?: ""),
                    style = MaterialTheme.typography.bodyMedium,
                    color = NyaoColors.Muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
                if (p != null && p.popular.isNotEmpty()) PlayButtons(p.popular, p.name, Modifier.padding(top = 18.dp, bottom = 8.dp))
                // ♥ исполнителю: его треки чаще в «Моей волне», в Яндексе — «Мои исполнители»
                if (p != null && p.id != null && (p.source == SOURCE_YA || p.source == SOURCE_YT)) {
                    val favs by Repo.favArtists.collectAsState()
                    val fav = favs.any { it.matches(p.source, p.id) }
                    val scope = androidx.compose.runtime.rememberCoroutineScope()
                    androidx.compose.material3.FilledTonalButton(
                        onClick = {
                            scope.launch {
                                runCatching { Repo.likeArtist(p.source, p.id, p.name, p.cover, !fav) }
                                    .onSuccess { model.message(if (!fav) "${p.name} — в любимых: будет чаще в «Моей волне»" else "Убрано из любимых исполнителей") }
                                    .onFailure { model.message(it.message ?: "Не получилось") }
                            }
                        },
                        modifier = Modifier.padding(bottom = 8.dp).bouncy(),
                        colors = if (fav) androidx.compose.material3.ButtonDefaults.filledTonalButtonColors(containerColor = NyaoColors.Lavender, contentColor = NyaoColors.OnLavender) else androidx.compose.material3.ButtonDefaults.filledTonalButtonColors(),
                    ) {
                        Icon(if (fav) NyaoIcons.Favorite else NyaoIcons.FavoriteBorder, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(if (fav) "Любимый исполнитель" else "В любимые")
                    }
                }
            }
        }
        when {
            p == null && !failed -> item { Loading() }
            p == null -> item { Hint("Не получилось загрузить исполнителя.") }
            else -> {
                if (p.popular.isNotEmpty()) {
                    item { Text("Популярное", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 20.dp, top = 14.dp, bottom = 10.dp)) }
                    trackGroup(model, p.popular.take(20), p.name, current?.id, likedIds)
                    item {
                        androidx.compose.material3.FilledTonalButton(
                            onClick = { model.go(Route.PlaylistPage(Playlist("artist:${p.source}:${p.id ?: ""}:${p.name}", p.source, p.name, subtitle = "Все треки", cover = p.cover))) },
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                        ) { Text("Все треки") }
                    }
                }
                if (p.albums.isNotEmpty()) {
                    item { Text("Альбомы и синглы", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 20.dp, top = 22.dp, bottom = 10.dp)) }
                    item {
                        androidx.compose.foundation.lazy.LazyRow(
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(p.albums.size) { i ->
                                val al = p.albums[i]
                                Column(Modifier.size(width = 150.dp, height = 200.dp).clip(RoundedCornerShape(20.dp)).clickable { model.go(Route.PlaylistPage(al)) }) {
                                    Cover(al.cover, Modifier.size(150.dp), RoundedCornerShape(20.dp))
                                    Text(al.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp, start = 4.dp, end = 4.dp))
                                    if (al.subtitle.isNotBlank()) Text(al.subtitle, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, modifier = Modifier.padding(horizontal = 4.dp))
                                }
                            }
                        }
                    }
                }
                if (p.popular.isEmpty() && p.albums.isEmpty()) item { Hint("У этого исполнителя ничего не нашлось.") }
            }
        }
    }
}
