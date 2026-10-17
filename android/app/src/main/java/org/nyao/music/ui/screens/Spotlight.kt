package org.nyao.music.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.nyao.music.data.Playlist
import org.nyao.music.data.Repo
import org.nyao.music.data.Search
import org.nyao.music.data.Track
import org.nyao.music.playback.Offline
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.DownloadedMark
import org.nyao.music.ui.components.NyaoIcons
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.components.appear
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.theme.NyaoColors

/** Совпадение по названию: все слова запроса есть в названии (или в «исполнитель — название») */
private fun matches(q: List<String>, vararg fields: String): Boolean {
    val hay = Search.norm(fields.joinToString(" "))
    return q.all { hay.contains(it) }
}

/** Выше — где название начинается с запроса, потом — где оно его содержит */
private fun score(nq: String, t: Track): Int {
    val title = Search.norm(t.title)
    return when {
        title == nq -> 0
        title.startsWith(nq) -> 1
        title.contains(nq) -> 2
        else -> 3
    }
}

/**
 * Спотлайт: быстрый поиск поверх размытого экрана. Сразу показывает совпадения по названию
 * из медиатеки, скачанного и уже виденного, а через полсекунды — из сервисов.
 * «Найти» на клавиатуре открывает полный поиск.
 */
@Composable
fun SpotlightOverlay(model: AppModel, onClose: () -> Unit) {
    var text by remember { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val offline by Offline.state.collectAsState()
    val current by PlayerConnection.current.collectAsState()
    LaunchedEffect(Unit) {
        model.loadLiked()
        model.loadPlaylists()
        delay(120)
        runCatching { focus.requestFocus() }
    }
    BackHandler(onBack = onClose)

    val nq = Search.norm(text)
    val words = nq.split(' ').filter { it.isNotBlank() }
    val local = remember(nq, model.liked, offline.tracks) {
        if (words.isEmpty()) emptyList()
        else ((model.liked ?: emptyList()) + offline.tracks + Repo.knownTracks())
            .asSequence()
            .distinctBy { it.id }
            .filter { matches(words, it.title, it.artist) }
            .sortedBy { score(nq, it) }
            .take(8)
            .toList()
    }
    val lists = remember(nq, model.playlists) {
        if (words.isEmpty()) emptyList() else (model.playlists ?: emptyList()).filter { matches(words, it.title) }.take(4)
    }
    var online by remember { mutableStateOf<List<Track>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    LaunchedEffect(nq) {
        online = emptyList()
        if (nq.length < 2) { loading = false; return@LaunchedEffect }
        loading = true
        delay(450)
        val res = runCatching { Repo.search(text) }.getOrNull()
        val localIds = local.mapTo(HashSet()) { it.id }
        online = res?.let { Search.arrange(it, "all", text).tracks.filter { t -> t.id !in localIds }.take(10) } ?: emptyList()
        loading = false
    }

    fun openFull() {
        if (text.isBlank()) return
        model.searchQuery = text
        model.runSearch(text)
        model.go(Route.Search)
        onClose()
    }

    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClose),
    ) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().imePadding().padding(top = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            TextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.padding(horizontal = 16.dp).widthIn(max = 640.dp).fillMaxWidth().focusRequester(focus).appear(0),
                placeholder = { Text("Название трека", color = NyaoColors.Muted) },
                leadingIcon = { Icon(NyaoIcons.Search, null, tint = NyaoColors.Muted) },
                trailingIcon = {
                    IconButton(onClick = { if (text.isNotEmpty()) text = "" else onClose() }) { Icon(NyaoIcons.Close, if (text.isNotEmpty()) "Очистить" else "Закрыть", tint = NyaoColors.Muted) }
                },
                singleLine = true,
                shape = RoundedCornerShape(30.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = NyaoColors.S3,
                    unfocusedContainerColor = NyaoColors.S3,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = NyaoColors.Lavender,
                ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { openFull() }),
            )
            val anything = local.isNotEmpty() || lists.isNotEmpty() || online.isNotEmpty() || loading
            if (words.isEmpty()) {
                Text(
                    "Ищет по названию — сначала в твоей медиатеке и скачанном, потом в сервисах",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.75f),
                    modifier = Modifier.padding(horizontal = 32.dp, vertical = 14.dp),
                )
            } else if (anything) {
                LazyColumn(
                    Modifier.padding(top = 12.dp).padding(horizontal = 12.dp).widthIn(max = 640.dp).fillMaxWidth()
                        .clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2)
                        // касания по самому списку не закрывают спотлайт
                        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    if (lists.isNotEmpty() || local.isNotEmpty()) item { Section("В медиатеке") }
                    itemsIndexed(lists, key = { _, p -> "pl" + p.id }) { _, p ->
                        PlaylistHit(p) {
                            model.go(Route.PlaylistPage(p))
                            onClose()
                        }
                    }
                    itemsIndexed(local, key = { _, t -> "l" + t.id }) { i, t ->
                        TrackHit(t, t.id == current?.id) {
                            PlayerConnection.playList(local, i, "Поиск")
                            onClose()
                        }
                    }
                    if (online.isNotEmpty() || loading) item { Section("В сервисах") }
                    if (loading && online.isEmpty()) item {
                        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = NyaoColors.Lavender, modifier = Modifier.size(24.dp), strokeWidth = 2.5.dp) }
                    }
                    itemsIndexed(online, key = { _, t -> "o" + t.id }) { i, t ->
                        TrackHit(t, t.id == current?.id) {
                            PlayerConnection.playList(online, i, "Поиск: $text")
                            onClose()
                        }
                    }
                    item {
                        Row(
                            Modifier.fillMaxWidth().clickable { openFull() }.padding(horizontal = 20.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Все результаты для «$text»", style = MaterialTheme.typography.labelLarge, color = NyaoColors.Lavender, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Icon(NyaoIcons.ChevronRight, null, tint = NyaoColors.Lavender)
                        }
                    }
                }
            } else {
                Text("Ничего не нашлось", style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.8f), modifier = Modifier.padding(16.dp))
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted, modifier = Modifier.padding(start = 20.dp, top = 10.dp, bottom = 6.dp))
}

@Composable
private fun TrackHit(t: Track, playing: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().bouncy().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cover(t.cover, Modifier.size(44.dp), RoundedCornerShape(12.dp))
        Column(Modifier.weight(1f)) {
            Text(t.title, style = MaterialTheme.typography.titleSmall, color = if (playing) NyaoColors.Lavender else NyaoColors.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(t.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        DownloadedMark(t)
        SourceTag(t.source)
    }
}

@Composable
private fun PlaylistHit(p: Playlist, onClick: () -> Unit) {
    val shape: Shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().bouncy().clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cover(p.cover, Modifier.size(44.dp), shape)
        Column(Modifier.weight(1f)) {
            Text(p.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("Плейлист", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        }
    }
}
