package org.nyao.music.ui.screens

import androidx.compose.foundation.basicMarquee

import org.nyao.music.ui.components.NyaoIcons

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.components.appear
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import androidx.media3.common.Player
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.formatTime
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.CoverPalette
import org.nyao.music.ui.components.PolarShape
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.components.WavyProgress
import org.nyao.music.ui.components.rememberCoverPalette
import org.nyao.music.ui.theme.tabular

/**
 * «Сейчас играет» по макету: обложка-«гребешок», заголовок Unbounded, лайк-печенька,
 * волнистый прогресс, группа кнопок, панель инструментов и «Далее» снизу. Цвета — из обложки.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun NowPlayingScreen(model: AppModel, asPane: Boolean, onClose: () -> Unit) {
    val current by PlayerConnection.current.collectAsState()
    val playing by PlayerConnection.playing.collectAsState()
    val buffering by PlayerConnection.buffering.collectAsState()
    val queue by PlayerConnection.queue.collectAsState()
    val index by PlayerConnection.index.collectAsState()
    val liked by Repo.liked.collectAsState()
    val label by Repo.queueLabel.collectAsState()
    val mode by Repo.mode.collectAsState()
    val sleep by PlayerConnection.sleep.collectAsState()
    val t = current ?: return
    val pal = rememberCoverPalette(t.cover)
    var showQueue by remember { mutableStateOf(false) }
    var showLyrics by remember { mutableStateOf(false) }
    var showInfo by remember { mutableStateOf(false) }
    val repeat by PlayerConnection.repeat.collectAsState()
    val shuffle by PlayerConnection.shuffle.collectAsState()
    val nextList by PlayerConnection.upNext.collectAsState()

    var pos by remember { mutableLongStateOf(0L) }
    var dur by remember { mutableLongStateOf(0L) }
    LaunchedEffect(t.id) {
        while (true) {
            pos = PlayerConnection.positionMs()
            dur = PlayerConnection.durationMs()
            delay(250)
        }
    }
    val isLiked = t.id in liked
    val upNext = nextList.take(40)
    val wave = mode == Repo.Mode.WAVE

    LazyColumn(
        Modifier.fillMaxSize().background(pal.background),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (!asPane) IconButton(onClick = onClose) { Icon(NyaoIcons.KeyboardArrowDown, "Свернуть", tint = pal.onContainer, modifier = Modifier.size(28.dp)) }
                else Spacer(Modifier.size(48.dp))
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("ИГРАЕТ ИЗ", style = MaterialTheme.typography.labelSmall, color = pal.sub)
                    Text(label.ifEmpty { "Очередь" }, style = MaterialTheme.typography.titleSmall, color = pal.onContainer, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.size(48.dp))
            }
        }
        item {
            Box(Modifier.padding(horizontal = 32.dp, vertical = 12.dp).widthIn(max = 400.dp).fillMaxWidth().aspectRatio(1f)) {
                // На паузе обложка чуть уменьшается, при смене трека — уезжает в сторону
                val coverScale by animateFloatAsState(if (playing) 1f else 0.88f, spring(dampingRatio = 0.55f, stiffness = 220f), label = "coverScale")
                AnimatedContent(
                    t,
                    transitionSpec = {
                        (slideInHorizontally(spring(dampingRatio = 0.8f, stiffness = 300f)) { it / 2 } + fadeIn() + scaleIn(initialScale = 0.85f)) togetherWith
                            (slideOutHorizontally(spring(dampingRatio = 0.9f, stiffness = 300f)) { -it / 2 } + fadeOut() + scaleOut(targetScale = 0.85f))
                    },
                    contentKey = { it.id },
                    label = "cover",
                ) { tr ->
                    Cover(tr.cover, Modifier.fillMaxSize().graphicsLayer { scaleX = coverScale; scaleY = coverScale }, PolarShape(12, 0.035f))
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().widthIn(max = 520.dp).padding(start = 24.dp, end = 16.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                // длинное название бежит строкой; нажатие — «О треке» со всеми данными
                Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable { showInfo = true }) {
                    AnimatedContent(t.title, transitionSpec = { (slideInVertically { it / 2 } + fadeIn()) togetherWith (slideOutVertically { -it / 2 } + fadeOut()) }, label = "title") { title ->
                        Text(
                            title,
                            style = MaterialTheme.typography.headlineMedium,
                            color = pal.onContainer,
                            maxLines = 1,
                            modifier = Modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 1500, velocity = 40.dp),
                        )
                    }
                    Text(
                        t.artist + if (t.album.isNotEmpty()) " · ${t.album}" else "",
                        style = MaterialTheme.typography.bodyLarge,
                        color = pal.accent,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        modifier = Modifier.basicMarquee(iterations = Int.MAX_VALUE, initialDelayMillis = 2500, velocity = 30.dp),
                    )
                }
                LikeCookie(isLiked, pal) { model.like(t, !isLiked) }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(start = 24.dp, top = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(
                    Modifier.height(30.dp).clip(RoundedCornerShape(15.dp)).background(pal.surface).padding(start = 4.dp, end = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    SourceTag(t.source)
                    Text("из ${org.nyao.music.data.sourceName(t.source, genitive = true)}", style = MaterialTheme.typography.bodySmall, color = pal.onContainer)
                }
            }
        }
        item {
            Column(Modifier.fillMaxWidth().widthIn(max = 560.dp).padding(horizontal = 20.dp, vertical = 14.dp)) {
                WavyProgress(
                    progress = if (dur > 0) pos.toFloat() / dur else 0f,
                    playing = playing,
                    onSeek = { f -> PlayerConnection.seekTo((f * dur).toLong()) },
                    color = pal.accent,
                    trackColor = pal.container.copy(alpha = 0.7f),
                )
                Row(Modifier.padding(top = 4.dp)) {
                    Text(formatTime((pos / 1000).toInt()), style = MaterialTheme.typography.bodySmall.tabular, color = pal.sub, modifier = Modifier.weight(1f))
                    Text(formatTime((dur / 1000).toInt()), style = MaterialTheme.typography.bodySmall.tabular, color = pal.sub)
                }
            }
        }
        // Группа кнопок: «Играть» шире и меняет форму
        item {
            val playWeight by animateFloatAsState(if (playing) 2.2f else 1.6f, spring(dampingRatio = 0.65f), label = "pw")
            val playRadius by animateFloatAsState(if (playing) 20f else 40f, spring(dampingRatio = 0.65f), label = "pr")
            Row(Modifier.fillMaxWidth().widthIn(max = 560.dp).padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(
                    Modifier.weight(1f).height(80.dp).bouncy().clip(RoundedCornerShape(28.dp, 12.dp, 12.dp, 28.dp)).background(pal.container).clickable { PlayerConnection.prev() },
                    contentAlignment = Alignment.Center,
                ) { Icon(NyaoIcons.SkipPrevious, "Предыдущий", tint = pal.onContainer, modifier = Modifier.size(32.dp)) }
                Box(
                    Modifier.weight(playWeight).height(80.dp).bouncy().clip(RoundedCornerShape(playRadius.dp)).background(pal.accent).clickable { PlayerConnection.toggle() },
                    contentAlignment = Alignment.Center,
                ) {
                    if (buffering && !playing) CircularProgressIndicator(color = pal.onAccent, modifier = Modifier.size(30.dp), strokeWidth = 3.dp)
                    else Icon(if (playing) NyaoIcons.Pause else NyaoIcons.PlayArrow, if (playing) "Пауза" else "Играть", tint = pal.onAccent, modifier = Modifier.size(38.dp))
                }
                Box(
                    Modifier.weight(1f).height(80.dp).bouncy().clip(RoundedCornerShape(12.dp, 28.dp, 28.dp, 12.dp)).background(pal.container).clickable { PlayerConnection.next() },
                    contentAlignment = Alignment.Center,
                ) { Icon(NyaoIcons.SkipNext, "Следующий", tint = pal.onContainer, modifier = Modifier.size(32.dp)) }
            }
        }
        // Панель инструментов
        item {
            Row(Modifier.fillMaxWidth().widthIn(max = 560.dp).padding(horizontal = 12.dp, vertical = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                Tool(NyaoIcons.FormatQuote, "Текст", showLyrics, pal) {
                    showLyrics = !showLyrics
                    if (showLyrics) showQueue = false
                }
                Tool(NyaoIcons.QueueMusic, "Очередь", showQueue, pal) {
                    showQueue = !showQueue
                    if (showQueue) showLyrics = false
                }
                Tool(NyaoIcons.Shuffle, if (shuffle) "Перемешивание включено" else "Перемешать", shuffle, pal, enabled = !wave) { PlayerConnection.toggleShuffle() }
                Tool(
                    if (repeat == Player.REPEAT_MODE_ONE) NyaoIcons.RepeatOne else NyaoIcons.Repeat,
                    when (repeat) {
                        Player.REPEAT_MODE_ONE -> "Повтор трека"
                        Player.REPEAT_MODE_ALL -> "Повтор плейлиста"
                        else -> "Повтор выключен"
                    },
                    repeat != Player.REPEAT_MODE_OFF,
                    pal,
                ) { PlayerConnection.cycleRepeat() }
                Tool(NyaoIcons.Block, "Не нравится", false, pal, enabled = wave) { model.dislike() }
                Tool(NyaoIcons.Bedtime, if (sleep) "Таймер сна: 30 мин" else "Таймер сна", sleep, pal) {
                    PlayerConnection.toggleSleep()
                    model.message(if (!sleep) "Пауза через 30 минут" else "Таймер сна выключен")
                }
            }
        }
        if (showLyrics) item { LyricsPanel(t, pos, pal) }
        // «Далее»: следующий трек или вся очередь
        if (!showLyrics && upNext.isNotEmpty()) {
            val shown = if (showQueue) upNext else upNext.take(1)
            item {
                Text(
                    "ДАЛЕЕ",
                    style = MaterialTheme.typography.labelSmall,
                    color = pal.sub,
                    modifier = Modifier.fillMaxWidth().padding(start = 28.dp, top = 4.dp, bottom = 8.dp),
                )
            }
            itemsIndexed(shown) { i, (queueIndex, q) ->
                val shape = when {
                    shown.size == 1 -> RoundedCornerShape(28.dp)
                    i == 0 -> RoundedCornerShape(28.dp, 28.dp, 6.dp, 6.dp)
                    i == shown.lastIndex -> RoundedCornerShape(6.dp, 6.dp, 28.dp, 28.dp)
                    else -> RoundedCornerShape(6.dp)
                }
                Row(
                    Modifier.padding(horizontal = 12.dp, vertical = 1.5.dp).fillMaxWidth().widthIn(max = 560.dp).bouncy().clip(shape).background(pal.surface)
                        .clickable { PlayerConnection.playAt(queueIndex) }.padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Cover(q.cover, Modifier.size(44.dp), RoundedCornerShape(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(q.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall, color = pal.onContainer)
                        Text(q.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = pal.sub)
                    }
                    SourceTag(q.source)
                    // очередь можно править: убрать трек или переставить
                    Box {
                        var qm by remember { mutableStateOf(false) }
                        IconButton(onClick = { qm = true }, modifier = Modifier.size(36.dp)) { Icon(NyaoIcons.MoreVert, "Ещё", tint = pal.sub) }
                        androidx.compose.material3.DropdownMenu(expanded = qm, onDismissRequest = { qm = false }) {
                            androidx.compose.material3.DropdownMenuItem(text = { Text("Играть следующим") }, onClick = { qm = false; PlayerConnection.move(queueIndex, index + 1) })
                            if (queueIndex > index + 1) androidx.compose.material3.DropdownMenuItem(text = { Text("Выше") }, onClick = { qm = false; PlayerConnection.move(queueIndex, queueIndex - 1) })
                            if (queueIndex < queue.size - 1) androidx.compose.material3.DropdownMenuItem(text = { Text("Ниже") }, onClick = { qm = false; PlayerConnection.move(queueIndex, queueIndex + 1) })
                            androidx.compose.material3.DropdownMenuItem(text = { Text("Убрать из очереди") }, onClick = { qm = false; PlayerConnection.removeAt(queueIndex) })
                            androidx.compose.material3.DropdownMenuItem(text = { Text("Похожее · радио по треку") }, onClick = { qm = false; PlayerConnection.startRadio(q) })
                        }
                    }
                }
            }
        }
        item { Spacer(Modifier.navigationBarsPadding().height(28.dp)) }
    }
    if (showInfo) TrackInfoSheet(model, t) { showInfo = false }
}

/** Ссылка на трек в его сервисе */
private fun trackLink(t: org.nyao.music.data.Track): String = when (t.source) {
    org.nyao.music.data.SOURCE_YA -> if (t.albumId != null) "https://music.yandex.ru/album/${t.albumId}/track/${t.srcId}" else "https://music.yandex.ru/track/${t.srcId}"
    org.nyao.music.data.SOURCE_SC -> "https://soundcloud.com/search/sounds?q=" + android.net.Uri.encode("${t.artist} ${t.title}")
    org.nyao.music.data.SOURCE_VK -> "https://vk.com/audio${t.srcId}"
    else -> "https://music.youtube.com/watch?v=${t.srcId}"
}

/** «О треке»: всё, что известно о треке, плюс копирование, поиск исполнителя и переход в сервис */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun TrackInfoSheet(model: AppModel, t: org.nyao.music.data.Track, onClose: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val clip = androidx.compose.ui.platform.LocalClipboardManager.current
    var details by remember(t.id) { mutableStateOf<org.nyao.music.data.TrackDetails?>(null) }
    androidx.compose.runtime.LaunchedEffect(t.id) { details = Repo.trackDetails(t) }
    androidx.compose.material3.ModalBottomSheet(onDismissRequest = onClose) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
                Cover(t.cover, Modifier.size(88.dp), RoundedCornerShape(20.dp))
                Column(Modifier.weight(1f)) {
                    Text(t.title, style = MaterialTheme.typography.titleLarge)
                    Text(t.artist, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary)
                }
            }
            @Composable
            fun Info(label: String, value: String) {
                if (value.isBlank()) return
                Row {
                    Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(110.dp))
                    Text(value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Info("Название", t.title)
                Info("Исполнители", t.artist)
                Info("Альбом", t.album)
                Info("Длительность", if (t.duration > 0) org.nyao.music.data.formatTime(t.duration) else "")
                Info("Сервис", org.nyao.music.data.sourceName(t.source))
                Info("Год", details?.year?.toString().orEmpty())
                Info("Жанр", details?.genre.orEmpty())
                Info("Лейбл", details?.label.orEmpty())
                Info("Номер в альбоме", details?.position.orEmpty())
                Info("Прослушиваний", details?.plays?.let { java.text.NumberFormat.getInstance(java.util.Locale("ru")).format(it) }.orEmpty())
                Info("Возраст", if (details?.explicit == true) "18+" else "")
                Info("ID в сервисе", t.srcId)
            }
            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                androidx.compose.material3.FilledTonalButton(onClick = {
                    clip.setText(androidx.compose.ui.text.AnnotatedString("${t.artist} — ${t.title}"))
                    model.message("Название скопировано")
                }) { Text("Скопировать") }
                androidx.compose.material3.OutlinedButton(onClick = {
                    onClose()
                    model.openArtist(t)
                }) { Text("Исполнитель") }
                model.albumOf(t)?.let { al ->
                    androidx.compose.material3.OutlinedButton(onClick = {
                        onClose()
                        model.nowPlayingOpen = false
                        model.go(org.nyao.music.ui.Route.PlaylistPage(al))
                    }) { Text("Альбом") }
                }
                androidx.compose.material3.OutlinedButton(onClick = {
                    runCatching { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(trackLink(t))).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
                }) { Text("Открыть в ${if (t.source == org.nyao.music.data.SOURCE_YA) "Яндексе" else org.nyao.music.data.sourceName(t.source)}") }
            }
        }
    }
}

/** Лайк-«печенька»: заливается акцентом, когда трек нравится */
@Composable
private fun LikeCookie(liked: Boolean, pal: CoverPalette, onClick: () -> Unit) {
    val depth by animateFloatAsState(if (liked) 0.08f else 0.0f, spring(dampingRatio = 0.5f), label = "like")
    // «Хлопок» при лайке: сердце подпрыгивает и чуть поворачивается
    val pop = remember { androidx.compose.animation.core.Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(liked) {
        if (first) {
            first = false
            return@LaunchedEffect
        }
        pop.snapTo(if (liked) 1.3f else 0.8f)
        pop.animateTo(1f, spring(dampingRatio = 0.3f, stiffness = 500f))
    }
    Box(
        Modifier.size(56.dp).graphicsLayer { scaleX = pop.value; scaleY = pop.value; rotationZ = (pop.value - 1f) * 40f }.bouncy().clip(PolarShape(9, depth)).background(if (liked) pal.accent else pal.surface).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(if (liked) NyaoIcons.Favorite else NyaoIcons.FavoriteBorder, if (liked) "Убрать из «Мне нравится»" else "Нравится", tint = if (liked) pal.onAccent else pal.sub)
    }
}

@Composable
private fun Tool(icon: ImageVector, label: String, on: Boolean, pal: CoverPalette, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        Modifier.width(52.dp).height(44.dp).bouncy().clip(RoundedCornerShape(22.dp)).background(if (on) pal.container else Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, tint = (if (on) pal.onContainer else pal.sub).copy(alpha = if (enabled) 1f else 0.35f))
    }
}


/** Синхронный текст из LRCLIB: текущая строка крупнее и ярче, панель сама прокручивается, тап по строке — перемотка */
@Composable
private fun LyricsPanel(track: org.nyao.music.data.Track, posMs: Long, pal: CoverPalette) {
    var lyrics by remember(track.id) { mutableStateOf<org.nyao.music.data.Lyrics?>(null) }
    var loading by remember(track.id) { mutableStateOf(true) }
    LaunchedEffect(track.id) {
        lyrics = org.nyao.music.data.LyricsApi.find(track)
        loading = false
    }
    val state = rememberLazyListState()
    val l = lyrics
    val sec = posMs / 1000.0
    val currentLine = if (l != null && l.synced) l.lines.indexOfLast { (it.time ?: 0.0) <= sec + 0.3 } else -1
    LaunchedEffect(currentLine) {
        if (currentLine >= 0) state.animateScrollToItem((currentLine - 2).coerceAtLeast(0))
    }
    Box(
        Modifier.padding(horizontal = 12.dp).fillMaxWidth().widthIn(max = 560.dp).height(380.dp).clip(RoundedCornerShape(30.dp)).background(pal.surface),
        contentAlignment = Alignment.Center,
    ) {
        when {
            loading -> CircularProgressIndicator(color = pal.accent)
            l == null -> Text("Текста для этого трека не нашлось", style = MaterialTheme.typography.bodyMedium, color = pal.sub)
            else -> LazyColumn(state = state, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 24.dp)) {
                itemsIndexed(l.lines) { i, line ->
                    val active = i == currentLine
                    val past = l.synced && i < currentLine
                    Text(
                        line.text.ifEmpty { "♪" },
                        style = if (active) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleLarge,
                        color = when {
                            !l.synced -> pal.onContainer
                            active -> pal.accent
                            past -> pal.sub.copy(alpha = 0.5f)
                            else -> pal.onContainer.copy(alpha = 0.75f)
                        },
                        modifier = Modifier.fillMaxWidth()
                            .clickable(enabled = line.time != null) { line.time?.let { PlayerConnection.seekTo((it * 1000).toLong()) } }
                            .padding(horizontal = 22.dp, vertical = 7.dp),
                    )
                }
            }
        }
    }
}
