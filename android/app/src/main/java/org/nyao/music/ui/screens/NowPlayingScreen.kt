package org.nyao.music.ui.screens

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.QueueMusic
import androidx.compose.material.icons.rounded.Bedtime
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.FormatQuote
import androidx.compose.material.icons.rounded.Repeat
import androidx.compose.material.icons.rounded.RepeatOne
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.SkipPrevious
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
                if (!asPane) IconButton(onClick = onClose) { Icon(Icons.Rounded.KeyboardArrowDown, "Свернуть", tint = pal.onContainer, modifier = Modifier.size(28.dp)) }
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
                Column(Modifier.weight(1f)) {
                    AnimatedContent(t.title, transitionSpec = { (slideInVertically { it / 2 } + fadeIn()) togetherWith (slideOutVertically { -it / 2 } + fadeOut()) }, label = "title") { title ->
                        Text(title, style = MaterialTheme.typography.headlineMedium, color = pal.onContainer, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Text(
                        t.artist + if (t.album.isNotEmpty()) " · ${t.album}" else "",
                        style = MaterialTheme.typography.bodyLarge,
                        color = pal.accent,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
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
                    Text("из ${org.nyao.music.data.sourceName(t.source)}", style = MaterialTheme.typography.bodySmall, color = pal.onContainer)
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
                ) { Icon(Icons.Rounded.SkipPrevious, "Предыдущий", tint = pal.onContainer, modifier = Modifier.size(32.dp)) }
                Box(
                    Modifier.weight(playWeight).height(80.dp).bouncy().clip(RoundedCornerShape(playRadius.dp)).background(pal.accent).clickable { PlayerConnection.toggle() },
                    contentAlignment = Alignment.Center,
                ) {
                    if (buffering && !playing) CircularProgressIndicator(color = pal.onAccent, modifier = Modifier.size(30.dp), strokeWidth = 3.dp)
                    else Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Пауза" else "Играть", tint = pal.onAccent, modifier = Modifier.size(38.dp))
                }
                Box(
                    Modifier.weight(1f).height(80.dp).bouncy().clip(RoundedCornerShape(12.dp, 28.dp, 28.dp, 12.dp)).background(pal.container).clickable { PlayerConnection.next() },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Rounded.SkipNext, "Следующий", tint = pal.onContainer, modifier = Modifier.size(32.dp)) }
            }
        }
        // Панель инструментов
        item {
            Row(Modifier.fillMaxWidth().widthIn(max = 560.dp).padding(horizontal = 12.dp, vertical = 16.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                Tool(Icons.Rounded.FormatQuote, "Текст", showLyrics, pal) {
                    showLyrics = !showLyrics
                    if (showLyrics) showQueue = false
                }
                Tool(Icons.AutoMirrored.Rounded.QueueMusic, "Очередь", showQueue, pal) {
                    showQueue = !showQueue
                    if (showQueue) showLyrics = false
                }
                Tool(Icons.Rounded.Shuffle, if (shuffle) "Перемешивание включено" else "Перемешать", shuffle, pal, enabled = !wave) { PlayerConnection.toggleShuffle() }
                Tool(
                    if (repeat == Player.REPEAT_MODE_ONE) Icons.Rounded.RepeatOne else Icons.Rounded.Repeat,
                    when (repeat) {
                        Player.REPEAT_MODE_ONE -> "Повтор трека"
                        Player.REPEAT_MODE_ALL -> "Повтор плейлиста"
                        else -> "Повтор выключен"
                    },
                    repeat != Player.REPEAT_MODE_OFF,
                    pal,
                ) { PlayerConnection.cycleRepeat() }
                Tool(Icons.Rounded.Block, "Не нравится", false, pal, enabled = wave) { model.dislike() }
                Tool(Icons.Rounded.Bedtime, if (sleep) "Таймер сна: 30 мин" else "Таймер сна", sleep, pal) {
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
                }
            }
        }
        item { Spacer(Modifier.navigationBarsPadding().height(28.dp)) }
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
        Icon(if (liked) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder, if (liked) "Убрать из «Мне нравится»" else "Нравится", tint = if (liked) pal.onAccent else pal.sub)
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
