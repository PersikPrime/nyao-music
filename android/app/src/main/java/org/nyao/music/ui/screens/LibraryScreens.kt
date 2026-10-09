package org.nyao.music.ui.screens

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shuffle
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
private fun LazyListScope.trackGroup(model: AppModel, tracks: List<Track>, label: String, currentId: String?, liked: Set<String>) {
    itemsIndexed(tracks) { i, t ->
        TrackRow(
            track = t,
            current = currentId == t.id,
            liked = t.id in liked,
            onClick = { PlayerConnection.playList(tracks, i, label) },
            onPlayNext = { PlayerConnection.playNext(t) },
            onLike = { on -> model.like(t, on) },
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
        if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Назад", tint = NyaoColors.Text) }
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
            Icon(Icons.Rounded.PlayArrow, null, tint = NyaoColors.OnLavender)
            Spacer(Modifier.size(6.dp))
            Text("Слушать", style = MaterialTheme.typography.labelLarge, color = NyaoColors.OnLavender)
        }
        Row(
            Modifier.weight(1f).height(52.dp).bouncy().clip(RoundedCornerShape(10.dp, 26.dp, 26.dp, 10.dp)).background(NyaoColors.Tonal)
                .clickable(enabled = tracks.isNotEmpty()) { PlayerConnection.playList(tracks.shuffled(), 0, label) },
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Rounded.Shuffle, null, tint = NyaoColors.Text)
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
    LaunchedEffect(tab) { if (tab == 0) model.loadLiked() else model.loadPlaylists() }
    val current by PlayerConnection.current.collectAsState()
    val likedIds by Repo.liked.collectAsState()

    val header: @Composable () -> Unit = {
        Column {
            ScreenHeader("Медиатека", action = { CircleButton({ model.go(Route.Search) }) { Icon(Icons.Rounded.Search, "Поиск", tint = NyaoColors.Text) } })
            ConnectedGroup(listOf("Мне нравится", "Плейлисты"), tab, { tab = it }, Modifier.padding(horizontal = 16.dp), height = 48.dp)
            Spacer(Modifier.height(14.dp))
        }
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
                    val yt = liked.size - ya - sc
                    val shown = if (filter == "all") liked else liked.filter { it.source == filter }
                    item {
                        // Карточка «Мне нравится»: печенька с сердцем, счётчики и кнопки
                        Column(
                            Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(32.dp)).background(NyaoColors.Hero).padding(18.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                Box(Modifier.size(64.dp).clip(PolarShape(9, 0.08f)).background(NyaoColors.Lavender), contentAlignment = Alignment.Center) {
                                    Icon(Icons.Rounded.Favorite, null, tint = NyaoColors.OnLavender, modifier = Modifier.size(28.dp))
                                }
                                Column {
                                    Text("Мне нравится", style = MaterialTheme.typography.headlineSmall, color = NyaoColors.OnPrimary)
                                    Text("Яндекс $ya · YouTube $yt" + (if (sc > 0) " · SoundCloud $sc" else ""), style = MaterialTheme.typography.bodySmall, color = NyaoColors.Lavender)
                                }
                            }
                            PlayButtons(shown, "Мне нравится")
                        }
                    }
                    item {
                        Row(Modifier.padding(start = 16.dp, top = 14.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PillChip("Все · ${liked.size}", filter == "all", { filter = "all" })
                            if (ya > 0) PillChip("Яндекс · $ya", filter == SOURCE_YA, { filter = SOURCE_YA })
                            if (yt > 0) PillChip("YouTube · $yt", filter == SOURCE_YT, { filter = SOURCE_YT })
                            if (sc > 0) PillChip("SoundCloud · $sc", filter == org.nyao.music.data.SOURCE_SC, { filter = org.nyao.music.data.SOURCE_SC })
                        }
                    }
                    trackGroup(model, shown, "Мне нравится", current?.id, likedIds)
                }
            }
        }
    } else {
        val lists = model.playlists
        LazyVerticalGrid(
            GridCells.Adaptive(if (wide) 180.dp else 150.dp),
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 190.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.padding(horizontal = 0.dp)) { header() } }
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
            Row(Modifier.statusBarsPadding().padding(8.dp)) {
                IconButton(onClick = { model.back() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Назад", tint = NyaoColors.Text) }
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
                    org.nyao.music.data.sourceName(playlist.source) + (tracks?.let { " · ${it.size} треков" } ?: ""),
                    style = MaterialTheme.typography.bodyMedium,
                    color = NyaoColors.Muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
                PlayButtons(tracks ?: emptyList(), playlist.title, Modifier.padding(top = 18.dp, bottom = 18.dp))
            }
        }
        if (tracks == null) item { Loading() } else trackGroup(model, tracks, playlist.title, current?.id, likedIds)
    }
}

// ---------- Поиск ----------

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
                leadingIcon = { Icon(Icons.Rounded.Search, null, tint = NyaoColors.Muted) },
                trailingIcon = { if (text.isNotEmpty()) IconButton(onClick = { text = "" }) { Icon(Icons.Rounded.Close, "Очистить", tint = NyaoColors.Muted) } },
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
            res == null -> item { Hint("Ищет сразу в Яндекс Музыке и YouTube Music. YouTube работает и без входа.") }
            else -> {
                item {
                    Row(Modifier.padding(start = 16.dp, top = 14.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PillChip("Все", filter == "all", { filter = "all" })
                        PillChip("Яндекс · ${res.ya.size}", filter == SOURCE_YA, { filter = SOURCE_YA })
                        PillChip("YouTube · ${res.yt.size}", filter == SOURCE_YT, { filter = SOURCE_YT })
                        PillChip("SoundCloud · ${res.sc.size}", filter == org.nyao.music.data.SOURCE_SC, { filter = org.nyao.music.data.SOURCE_SC })
                    }
                }
                val shown = when (filter) {
                    SOURCE_YA -> res.ya
                    SOURCE_YT -> res.yt
                    org.nyao.music.data.SOURCE_SC -> res.sc
                    else -> org.nyao.music.data.alternateAll(res.ya, res.yt, res.sc)
                }
                if (shown.isEmpty()) item { Hint("Ничего не нашлось.") }
                else trackGroup(model, shown, "Поиск: ${model.searchQuery}", current?.id, likedIds)
            }
        }
    }
}
