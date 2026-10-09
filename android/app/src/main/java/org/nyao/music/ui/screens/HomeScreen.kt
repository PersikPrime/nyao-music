package org.nyao.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.components.appear
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.nyao.music.data.Playlist
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.SOURCE_YT
import org.nyao.music.data.Track
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.FlowLines
import org.nyao.music.ui.components.Hint
import org.nyao.music.ui.components.Loading
import org.nyao.music.ui.components.NyaoWaves
import org.nyao.music.ui.components.PolarShape
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.components.rememberPlayShape
import org.nyao.music.ui.theme.NyaoColors
import java.util.Calendar

/** Отступ снизу под мини-плеер и плавающую панель */
val BottomInset = PaddingValues(bottom = 190.dp)

private fun greeting(): String = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
    in 5..11 -> "Доброе\nутро"
    in 12..17 -> "Добрый\nдень"
    in 18..22 -> "Добрый\nвечер"
    else -> "Доброй\nночи"
}

/** Формы и цвета «быстрых миксов» — как в макете */
private data class MixStyle(val shape: Shape, val bg: Color, val fg: Color)

private val MIX_STYLES = listOf(
    MixStyle(PolarShape(9, 0.08f), Color(0xFF4F378B), Color(0xFFEADDFF)),
    MixStyle(PolarShape(4, 0.14f, (Math.PI / 4).toFloat()), Color(0xFF5C4D00), Color(0xFFFFD60A)),
    MixStyle(PolarShape(6, 0.10f), Color(0xFF73332A), Color(0xFFFFB4A8)),
    MixStyle(PolarShape(12, 0.05f), Color(0xFF1F4D45), Color(0xFF7CE0C3)),
)

private val MOOD_NAMES = mapOf("active" to "Бодрое", "fun" to "Весёлое", "calm" to "Спокойное", "sad" to "Грустное")
private val CHAR_NAMES = mapOf("favorite" to "Любимое", "discover" to "Незнакомое", "popular" to "Популярное")

@Composable
fun HomeScreen(model: AppModel, wide: Boolean) {
    val accounts by Repo.accounts.collectAsState()
    val anyAccount = accounts.values.any { it != null }
    LaunchedEffect(anyAccount) { if (anyAccount) model.loadHome() }
    val home = model.home
    val name = (accounts[SOURCE_YA] ?: accounts[SOURCE_YT] ?: accounts[org.nyao.music.data.SOURCE_SC])?.name

    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        // Верхняя строка: бейдж приложения, поиск, аватар-печенька
        item {
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 20.dp, top = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(
                    Modifier.height(36.dp).clip(RoundedCornerShape(18.dp)).background(NyaoColors.S2).padding(start = 8.dp, end = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    NyaoWaves(Modifier.size(20.dp), animate = false, strokeDp = 2f)
                    Text("Nyao Music", style = MaterialTheme.typography.labelLarge)
                }
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier.size(44.dp).bouncy().clip(CircleShape).background(NyaoColors.S2).clickable { model.go(Route.Search) },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Rounded.Search, "Поиск", tint = NyaoColors.Text) }
                Box(
                    Modifier.size(44.dp).bouncy().clip(PolarShape(7, 0.08f)).background(NyaoColors.Primary).clickable { model.go(Route.Settings) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text((name?.firstOrNull() ?: 'N').uppercase(), style = MaterialTheme.typography.titleMedium, color = NyaoColors.OnPrimary)
                }
            }
        }
        item {
            Text(
                greeting(),
                style = MaterialTheme.typography.displayLarge,
                modifier = Modifier.padding(start = 20.dp, top = 22.dp, bottom = 18.dp),
            )
        }
        item { WaveHero(model, Modifier.appear(0, 40f).padding(horizontal = 16.dp)) }

        if (!anyAccount) {
            item {
                Column(
                    Modifier.padding(16.dp).fillMaxWidth().bouncy().clip(RoundedCornerShape(30.dp)).background(NyaoColors.S2).clickable { model.go(Route.Settings) }.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text("Подключи сервисы", style = MaterialTheme.typography.titleLarge)
                    Text("Войди в Яндекс Музыку, YouTube Music или SoundCloud — появятся волна, лайки и плейлисты.", color = NyaoColors.Muted, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        if (anyAccount && home == null) item { Loading() }

        home?.let { h ->
            val continueLists = (h.yaPlaylists + h.ytSections.flatMap { it.playlists }).take(12)
            if (continueLists.isNotEmpty()) {
                item { Text("Продолжить", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, top = 22.dp, bottom = 12.dp)) }
                item {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        itemsIndexed(continueLists) { i, p -> Box(Modifier.appear(i)) { CarouselCard(p, if (i == 0) 214 else 128) { model.go(Route.PlaylistPage(p)) } } }
                    }
                }
            }
            // Быстрые миксы: «Мне нравится» + первые плейлисты Яндекса
            item {
                val quick = listOf<Pair<String, () -> Unit>>("Мне нравится" to { model.go(Route.Library) }) +
                    h.yaPlaylists.take(3).map { p -> p.title to { model.go(Route.PlaylistPage(p)) } }
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 22.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    quick.take(4).forEachIndexed { i, (title, open) ->
                        val st = MIX_STYLES[i % MIX_STYLES.size]
                        Column(Modifier.width(76.dp).bouncy().clickable(onClick = open), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(Modifier.size(72.dp).clip(st.shape).background(st.bg), contentAlignment = Alignment.Center) {
                                Box(Modifier.size(20.dp).clip(CircleShape).background(st.fg))
                            }
                            Text(title, style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        }
                    }
                }
            }
            h.ytSections.filter { it.tracks.isNotEmpty() }.forEach { section ->
                item { Text(section.title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, top = 8.dp, bottom = 12.dp), maxLines = 1, overflow = TextOverflow.Ellipsis) }
                item {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(bottom = 18.dp)) {
                        itemsIndexed(section.tracks) { i, t -> Box(Modifier.appear(i)) { TrackTile(t) { PlayerConnection.playList(section.tracks, i, section.title) } } }
                    }
                }
            }
            if (h.yaPlaylists.isEmpty() && h.ytSections.isEmpty()) item { Hint("Здесь пока пусто — запусти волну или загляни в поиск.") }
        }
    }
}

/** Карточка «Моя волна» с пучком линий, чипами настроек и кнопкой-печенькой */
@Composable
fun WaveHero(model: AppModel, modifier: Modifier = Modifier) {
    val settings by Repo.prefs.settings.collectAsState()
    val mode by Repo.mode.collectAsState()
    val playing by PlayerConnection.playing.collectAsState()
    val current by PlayerConnection.current.collectAsState()
    val waveOn = mode == Repo.Mode.WAVE && current != null
    val active = waveOn && playing
    Box(
        modifier.fillMaxWidth().height(196.dp).bouncy().clip(RoundedCornerShape(34.dp)).background(NyaoColors.Hero).clickable { model.go(Route.Wave) },
    ) {
        FlowLines(Modifier.fillMaxSize(), lines = 10, animate = active, amplitude = 0.15f, spread = 0.17f, center = 0.61f)
        Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Я + YOUTUBE MUSIC", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Lavender)
            Text("Моя волна", style = MaterialTheme.typography.headlineMedium, color = NyaoColors.OnPrimary)
            if (waveOn) Text("${current?.title} · ${current?.artist}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.OnPrimary.copy(alpha = 0.8f), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(220.dp))
        }
        Row(Modifier.align(Alignment.BottomStart).padding(start = 22.dp, bottom = 20.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val first = settings.mood?.let { MOOD_NAMES[it] } ?: CHAR_NAMES[settings.diversity] ?: "Любимое"
            Box(Modifier.height(32.dp).clip(RoundedCornerShape(16.dp)).background(NyaoColors.OnPrimary).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                Text(first, style = MaterialTheme.typography.labelMedium, color = NyaoColors.OnLavender)
            }
            Box(
                Modifier.height(32.dp).clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.08f)).padding(horizontal = 12.dp),
                contentAlignment = Alignment.Center,
            ) { Text("${100 - settings.ytmShare} : ${settings.ytmShare}", style = MaterialTheme.typography.labelMedium, color = NyaoColors.OnPrimary) }
        }
        Box(
            Modifier.align(Alignment.BottomEnd).padding(16.dp).size(104.dp).bouncy().clip(rememberPlayShape(active)).background(NyaoColors.Lavender).clickable { model.waveButton() },
            contentAlignment = Alignment.Center,
        ) {
            if (model.waveStarting) CircularProgressIndicator(color = NyaoColors.OnLavender, modifier = Modifier.size(30.dp), strokeWidth = 3.dp)
            else Icon(if (active) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (active) "Пауза" else "Запустить волну", tint = NyaoColors.OnLavender, modifier = Modifier.size(42.dp))
        }
    }
}

/** Карточка карусели «Продолжить»: обложка во всю карточку, подпись поверх */
@Composable
private fun CarouselCard(p: Playlist, width: Int, onClick: () -> Unit) {
    Box(Modifier.width(width.dp).height(186.dp).bouncy().clip(RoundedCornerShape(30.dp)).clickable(onClick = onClick)) {
        Cover(p.cover, Modifier.fillMaxSize(), RoundedCornerShape(0.dp))
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Transparent, Color.Black.copy(alpha = 0.75f)))))
        SourceTag(p.source, Modifier.align(Alignment.TopStart).padding(14.dp))
        Column(Modifier.align(Alignment.BottomStart).padding(start = 16.dp, end = 12.dp, bottom = 14.dp)) {
            Text(p.title, style = MaterialTheme.typography.titleMedium, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val sub = p.subtitle.ifEmpty { if (p.count > 0) "${org.nyao.music.data.sourceName(p.source)} · ${p.count}" else "" }
            if (sub.isNotEmpty() && width > 150) Text(sub, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.8f), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun TrackTile(t: Track, onClick: () -> Unit) {
    Column(Modifier.width(140.dp).bouncy().clip(RoundedCornerShape(24.dp)).clickable(onClick = onClick).padding(bottom = 6.dp)) {
        Cover(t.cover, Modifier.size(140.dp), RoundedCornerShape(28.dp))
        Spacer(Modifier.height(8.dp))
        Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 6.dp))
        Text(t.artist, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, modifier = Modifier.padding(horizontal = 6.dp))
    }
}

/** Плитка плейлиста для сеток (медиатека): обложка в форме, подпись снизу */
@Composable
fun PlaylistTile(p: Playlist, shape: Shape = RoundedCornerShape(28.dp), size: Int = 152, onClick: () -> Unit) {
    Column(Modifier.width(size.dp).bouncy().clip(RoundedCornerShape(20.dp)).clickable(onClick = onClick).padding(bottom = 6.dp)) {
        Box {
            Cover(p.cover, Modifier.size(size.dp), shape)
            SourceTag(p.source, Modifier.align(Alignment.TopStart).padding(10.dp))
        }
        Spacer(Modifier.height(8.dp))
        Text(p.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 4.dp))
    }
}

