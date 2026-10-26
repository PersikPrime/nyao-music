package org.nyao.music.ui.screens

import org.nyao.music.ui.components.NyaoIcons

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.nyao.music.data.ALL_SOURCES
import org.nyao.music.data.Playlist
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.Track
import org.nyao.music.data.sourceName
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.FlowLines
import org.nyao.music.ui.components.PillChip
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.components.appear
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.components.sourceColor
import org.nyao.music.ui.theme.NyaoColors

// ---------------------------------------------------------------------------------------------
// «Мне нравится» по сервисам: общая плитка + по одной на каждый подключённый сервис
// ---------------------------------------------------------------------------------------------

/** Плейлисты лайков. split = false — один общий */
fun likedPlaylists(liked: List<Track>?, split: Boolean): List<Playlist> {
    val all = Playlist("liked", "mix", "Мне нравится", liked?.size ?: 0, null, "Все сервисы")
    if (!split) return listOf(all)
    val accounts = Repo.accounts.value
    val per = ALL_SOURCES.filter { s -> accounts[s] != null || liked?.any { it.source == s } == true }.map { s ->
        Playlist("liked:$s", s, "Мне нравится · ${if (s == SOURCE_YA) "Яндекс" else sourceName(s)}", liked?.count { it.source == s } ?: 0, null, sourceName(s))
    }
    return if (per.size > 1) listOf(all) + per else listOf(all)
}

private fun tint(source: String): Pair<Color, Color> = if (org.nyao.music.ui.theme.Look.current.mono) NyaoColors.S3 to NyaoColors.Text else when (source) {
    SOURCE_YA -> Color(0xFF5C4D00) to NyaoColors.Ya
    org.nyao.music.data.SOURCE_SC -> Color(0xFF6A2A00) to Color(0xFFFFB37A)
    org.nyao.music.data.SOURCE_VK -> Color(0xFF00337A) to Color(0xFFA8CCFF)
    org.nyao.music.data.SOURCE_SP -> Color(0xFF0B4D27) to Color(0xFF9CF0BC)
    org.nyao.music.data.SOURCE_YT -> Color(0xFF73332A) to Color(0xFFFFB4A8)
    else -> NyaoColors.Primary to NyaoColors.OnPrimary
}

private data class Quick(val title: String, val source: String, val icon: ImageVector, val cover: String?, val onClick: () -> Unit)

// ---------------------------------------------------------------------------------------------
// Главная в режиме «Плеер»
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PlayerHome(model: AppModel, name: String?) {
    val settings by Repo.prefs.settings.collectAsState()
    val accounts by Repo.accounts.collectAsState()
    val mixes by Repo.mixStore.mixes.collectAsState()
    val anyAccount = accounts.values.any { it != null }
    LaunchedEffect(anyAccount) {
        if (anyAccount) {
            model.loadLiked()
            model.loadPlaylists()
        }
        model.loadRecent()
    }
    val liked = model.liked
    val quick = buildList {
        likedPlaylists(liked, settings.splitLiked).take(3).forEach { p -> add(Quick(p.title, p.source, NyaoIcons.Favorite, null) { model.go(Route.PlaylistPage(p)) }) }
        add(Quick("Моя волна", "mix", NyaoIcons.Waves, null) { model.waveButton() })
        mixes.take(2).forEach { m -> add(Quick(m.title, "mix", NyaoIcons.QueueMusic, m.asPlaylist().cover) { model.go(Route.PlaylistPage(m.asPlaylist())) }) }
        (model.playlists ?: emptyList()).forEach { p -> add(Quick(p.title, p.source, NyaoIcons.QueueMusic, p.cover) { model.go(Route.PlaylistPage(p)) }) }
    }.take(6)

    val mono = org.nyao.music.ui.theme.Look.current.mono
    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        // Mono: вместо приветствия — огромная «Моя волна» с фигурами
        if (mono) item { MonoWaveHero(model, Modifier.padding(bottom = 6.dp), trailing = { HomeSearchButton(model) }) }
        if (!mono) item {
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 16.dp, top = 18.dp, bottom = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    greetingLine() + (name?.split(" ")?.firstOrNull()?.let { ", $it" } ?: ""),
                    style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Box(
                    Modifier.size(44.dp).bouncy().clip(CircleShape).background(NyaoColors.S2).clickable { model.go(Route.Search) },
                    contentAlignment = Alignment.Center,
                ) { Icon(NyaoIcons.Search, "Поиск", tint = NyaoColors.Text) }
            }
        }
        item(key = "outage") { OutageBanner(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) }
        model.others.firstOrNull()?.let { r ->
            item(key = "continue-" + r.deviceId) { ContinueCard(model, r, Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) }
        }
        if (!anyAccount) {
            item {
                Column(
                    Modifier.padding(16.dp).fillMaxWidth().bouncy().clip(RoundedCornerShape(30.dp)).background(NyaoColors.S2).clickable { model.go(Route.Settings) }.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text("Подключи сервисы", style = MaterialTheme.typography.titleLarge)
                    Text("Войди в Яндекс Музыку, YouTube Music или SoundCloud — здесь появятся лайки, плейлисты и волна.", color = NyaoColors.Muted, style = MaterialTheme.typography.bodyMedium)
                }
            }
        } else {
            item {
                FlowRow(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    maxItemsInEachRow = 2,
                ) {
                    quick.forEachIndexed { i, q ->
                        val (bg, fg) = tint(q.source)
                        Row(
                            Modifier.weight(1f).height(56.dp).appear(i).bouncy().clip(RoundedCornerShape(18.dp)).background(NyaoColors.S2).clickable(onClick = q.onClick),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.size(56.dp).background(bg), contentAlignment = Alignment.Center) {
                                if (q.cover != null) Cover(q.cover, Modifier.fillMaxSize(), RoundedCornerShape(0.dp))
                                else Icon(q.icon, null, tint = fg, modifier = Modifier.size(24.dp))
                            }
                            Text(q.title, style = MaterialTheme.typography.labelLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 10.dp))
                        }
                    }
                }
            }
        }
        val recent = model.recent
        if (!recent.isNullOrEmpty()) {
            item { Text("Недавно слушал", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 12.dp)) }
            item { TrackShelf(recent) { i -> PlayerConnection.playList(recent, i, "Недавно слушал") } }
        }
        val top = model.top
        if (!top.isNullOrEmpty()) {
            item {
                Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 24.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Чаще всего за месяц", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    TextButton(onClick = { model.mixBuilderOpen = true }) { Text("Микс из них") }
                }
            }
            val tracks = top.take(5).map { it.first }
            itemsIndexed(top.take(5)) { i, (t, n) ->
                Row(
                    Modifier.fillMaxWidth().clickable { PlayerConnection.playList(tracks, i, "Чаще всего") }.padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("${i + 1}", style = MaterialTheme.typography.titleMedium, color = NyaoColors.Muted, modifier = Modifier.width(18.dp))
                    Cover(t.cover, Modifier.size(48.dp), org.nyao.music.ui.theme.coverShape(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(t.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(t.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    org.nyao.music.ui.components.TrackSourceTag(t)
                    Text("$n ×", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                }
            }
        }
        if (!mono) item {
            Text("Для настроения", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 12.dp))
            WaveHero(model, Modifier.padding(horizontal = 16.dp))
        }
    }
}

private fun greetingLine(): String = when (java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)) {
    in 5..11 -> "Доброе утро"
    in 12..17 -> "Добрый день"
    in 18..22 -> "Добрый вечер"
    else -> "Доброй ночи"
}

// ---------------------------------------------------------------------------------------------
// Выбор вида приложения
// ---------------------------------------------------------------------------------------------

@Composable
fun LayoutChoice(selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf(
            Triple("player", "Плеер", "Своя музыка на первом плане. Волна — плитка"),
            Triple("wave", "Моя волна", "Как раньше: волна в центре"),
        ).forEach { (id, title, sub) ->
            val on = selected == id
            Column(
                Modifier.weight(1f).bouncy().clip(RoundedCornerShape(24.dp))
                    .background(if (on) NyaoColors.Tonal else NyaoColors.S2)
                    .border(BorderStroke(2.dp, if (on) NyaoColors.Lavender else Color.Transparent), RoundedCornerShape(24.dp))
                    .clickable { onSelect(id) }.padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.fillMaxWidth().height(96.dp).clip(RoundedCornerShape(16.dp)).background(NyaoColors.Bg)) {
                    if (id == "wave") {
                        FlowLines(Modifier.fillMaxSize(), lines = 7, animate = false, amplitude = 0.15f, spread = 0.2f, center = 0.5f)
                    } else {
                        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Box(Modifier.width(60.dp).height(7.dp).clip(RoundedCornerShape(4.dp)).background(NyaoColors.S3))
                            repeat(3) { r ->
                                Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                    listOf(tint(listOf(SOURCE_YA, "mix", org.nyao.music.data.SOURCE_SC)[r]).first, NyaoColors.S3).forEach { c ->
                                        Box(Modifier.weight(1f).height(16.dp).clip(RoundedCornerShape(5.dp)).background(c))
                                    }
                                }
                            }
                        }
                    }
                }
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(sub, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, minLines = 2)
            }
        }
    }
}

/** Карточка в настройках: вид, лайки по сервисам, вкладка волны */
@Composable
fun ViewSettingsCard() {
    val s by Repo.prefs.settings.collectAsState()
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Вид приложения", style = MaterialTheme.typography.titleMedium)
        LayoutChoice(s.layout ?: "player", { Repo.prefs.setLayout(it) })
        SwitchRow("«Мне нравится» по сервисам", "Отдельные плейлисты лайков Яндекса, YouTube Music и SoundCloud", s.splitLiked) { Repo.prefs.setSplitLiked(it) }
        if (!s.isWaveLayout) SwitchRow("Вкладка «Волна» в панели", "В режиме «Плеер» волна — плитка на главной", s.waveTab) { Repo.prefs.setWaveTab(it) }
    }
}

/**
 * «Тема и сетка»: готовые темы меняют всё разом, ниже можно собрать своё поверх темы —
 * например, кнопки-печеньки из Expressive в теме Mono.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LookSettings() {
    val s by Repo.prefs.settings.collectAsState()
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Готовая тема меняет всё сразу. Ниже можно собрать своё — например, кнопки-печеньки от Expressive в теме Mono.", style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            org.nyao.music.ui.theme.UiLook.themes.forEach { (id, name) ->
                val on = s.theme == id
                Column(
                    Modifier.weight(1f).bouncy().clip(RoundedCornerShape(22.dp)).clickable { Repo.prefs.setTheme(id) }.padding(4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ThemePreview(id, Modifier.fillMaxWidth().height(150.dp).border(BorderStroke(if (on) 3.dp else 1.dp, if (on) NyaoColors.Text else Color.White.copy(alpha = 0.1f)), RoundedCornerShape(20.dp)))
                    Text(name, style = MaterialTheme.typography.titleSmall, color = if (on) NyaoColors.Text else NyaoColors.Muted)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Собрать своё", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = { Repo.prefs.setTheme(s.theme) }) { Text("Сбросить к теме") }
        }
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            ChipChoice("Кнопки", listOf("cookie" to "Печенька", "circle" to "Круг", "square" to "Квадрат"), s.buttons) { Repo.prefs.setLookButtons(it) }
            ChipChoice("Сетка главной", listOf("carousels" to "Карусели", "tiles" to "Плитка", "mosaic" to "Мозаика"), s.grid) { Repo.prefs.setLookGrid(it) }
            ChipChoice("Обложки", listOf("rounded" to "Скруглённые", "square" to "Квадратные", "cookie" to "Печенька"), s.covers) { Repo.prefs.setLookCovers(it) }
            SwitchRow("Подписи в панели", "Название выбранной вкладки рядом с иконкой", s.navLabels) { Repo.prefs.setLookNavLabels(it) }
            AccentChoice(s.accent) { Repo.prefs.setAccent(it) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipChoice(title: String, options: List<Pair<String, String>>, current: String, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (id, label) -> org.nyao.music.ui.components.PillChip(label, id == current, { onPick(id) }) }
        }
    }
}

/** Миниатюра главной в теме — чтобы было видно разницу до выбора */
@Composable
private fun ThemePreview(theme: String, modifier: Modifier) {
    val b = org.nyao.music.ui.theme.BasePalette.of(theme)
    val acc = org.nyao.music.ui.theme.Accent.palette
    val bg: androidx.compose.ui.graphics.Brush = when (theme) {
        "glass" -> androidx.compose.ui.graphics.Brush.linearGradient(listOf(acc.hero, Color(0xFF0E0C16), acc.container))
        "mono" -> androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color(0xFF2B2B2E), b.bg, b.bg))
        else -> androidx.compose.ui.graphics.Brush.verticalGradient(listOf(b.bg, b.bg))
    }
    Box(modifier.clip(RoundedCornerShape(20.dp)).background(bg)) {
        when (theme) {
            "mono" -> {
                Box(Modifier.align(Alignment.TopEnd).offset(x = 14.dp, y = 10.dp).size(56.dp).clip(org.nyao.music.ui.components.PolarShape(9, 0.07f)).background(Color(0xFF3A3A3E)))
                Box(Modifier.align(Alignment.TopEnd).offset(x = (-14).dp, y = 52.dp).size(26.dp).clip(org.nyao.music.ui.components.PolarShape(4, 0.2f, 0.4f)).background(acc.a))
                Text("Моя\nволна", color = Color.White, fontWeight = androidx.compose.ui.text.font.FontWeight.Black, fontSize = 15.sp, lineHeight = 14.sp, modifier = Modifier.padding(8.dp))
                Box(Modifier.align(Alignment.CenterEnd).padding(end = 8.dp, top = 30.dp).size(22.dp).clip(CircleShape).background(Color.White))
            }
            "glass" -> {
                Box(Modifier.padding(8.dp).fillMaxWidth().height(46.dp).clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.14f)).border(BorderStroke(1.dp, Color.White.copy(alpha = 0.25f)), RoundedCornerShape(12.dp)))
                Box(Modifier.padding(start = 16.dp, top = 30.dp).size(16.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.4f)))
            }
            else -> {
                Box(Modifier.align(Alignment.TopCenter).padding(top = 12.dp).size(54.dp).clip(org.nyao.music.ui.components.PolarShape(12, 0.05f)).background(acc.tonal))
                Box(Modifier.align(Alignment.TopCenter).padding(top = 20.dp).size(38.dp).clip(org.nyao.music.ui.components.PolarShape(9, 0.08f)).background(acc.a))
            }
        }
        // плитки и панель снизу
        Column(Modifier.align(Alignment.BottomCenter).padding(8.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                val tile = if (theme == "glass") Color.White.copy(alpha = 0.12f) else b.s3
                Box(Modifier.weight(1f).height(22.dp).clip(RoundedCornerShape(7.dp)).background(tile))
                Box(Modifier.weight(1f).height(22.dp).clip(RoundedCornerShape(7.dp)).background(if (theme == "mono") tile else acc.container))
            }
            Box(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(7.dp)).background(if (theme == "glass") Color.White.copy(alpha = 0.2f) else b.s2))
        }
    }
}

/** Акцентный цвет — как выбор цветов в Android 16 */
@Composable
private fun AccentChoice(current: String, onPick: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column {
            Text("Акцентный цвет", style = MaterialTheme.typography.titleSmall)
            Text("Красит кнопки, выделение, прогресс и волну. «Из обложки» — под текущий трек.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            org.nyao.music.ui.theme.Accent.ids.forEach { (id, label) ->
                val on = id == current
                Column(
                    Modifier.clip(RoundedCornerShape(16.dp)).clickable(role = androidx.compose.ui.semantics.Role.RadioButton) { onPick(id) }
                        .semantics { selected = on; contentDescription = "Акцент: $label" }
                        .padding(4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    val ring = if (on) Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, androidx.compose.foundation.shape.CircleShape).padding(4.dp) else Modifier.padding(4.dp)
                    Box(ring) {
                        if (id == "cover") {
                            Box(
                                Modifier.size(44.dp).clip(androidx.compose.foundation.shape.CircleShape).background(
                                    androidx.compose.ui.graphics.Brush.sweepGradient(listOf(Color(0xFFFFB4A2), Color(0xFFFFD60A), Color(0xFF7CE0C3), Color(0xFF8FB4FF), Color(0xFFC6B8FF), Color(0xFFFFB4A2)))
                                )
                            )
                        } else {
                            val p = org.nyao.music.ui.theme.AccentPalette.preset(id)
                            Row(Modifier.size(44.dp).clip(androidx.compose.foundation.shape.CircleShape)) {
                                Box(Modifier.weight(1f).fillMaxHeight().background(p.a))
                                Column(Modifier.weight(1f).fillMaxHeight()) {
                                    Box(Modifier.weight(1f).fillMaxWidth().background(p.container))
                                    Box(Modifier.weight(1f).fillMaxWidth().background(p.hero))
                                }
                            }
                        }
                    }
                    Text(label, style = MaterialTheme.typography.labelSmall, color = if (on) MaterialTheme.colorScheme.onSurface else NyaoColors.Muted)
                }
            }
        }
    }
}

@Composable
private fun SwitchRow(title: String, sub: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(sub, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        }
        Switch(checked = on, onCheckedChange = onChange)
    }
}

/** Обновился с 0.4, где вида ещё не было: один раз предлагаем выбрать */
@Composable
fun LayoutAskDialog() {
    var sel by remember { mutableStateOf("player") }
    AlertDialog(
        onDismissRequest = {},
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
        title = { Text("Новый вид Nyao Music") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Можно выбрать, что главное: обычный плеер с твоей музыкой или, как раньше, «Моя волна». Поменять — в «Настройках».", style = MaterialTheme.typography.bodyMedium)
                LayoutChoice(sel, { sel = it })
            }
        },
        confirmButton = { Button(onClick = { Repo.prefs.setLayout(sel) }) { Text("Готово") } },
    )
}

/** Сервер Nyao требует обновиться — дальше не пускаем */
@Composable
fun OutdatedDialog(apkUrl: String?) {
    val context = androidx.compose.ui.platform.LocalContext.current
    AlertDialog(
        onDismissRequest = {},
        properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
        title = { Text("Нужно обновиться") },
        text = { Text("Эта версия Nyao Music (${org.nyao.music.BuildConfig.VERSION_NAME}) больше не поддерживается. Скачай свежую — обновление встанет поверх, входы сохранятся.") },
        confirmButton = {
            Button(onClick = {
                val url = apkUrl ?: "https://github.com/PersikPrime/nyao-music/releases/latest"
                context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
            }) { Text("Скачать") }
        },
    )
}

// ---------------------------------------------------------------------------------------------
// Новый микс: из самого прослушиваемого, по исполнителям или пустой
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MixBuilderDialog(model: AppModel) {
    var mode by remember { mutableStateOf("top") }
    var days by remember { mutableStateOf(30) }
    var count by remember { mutableStateOf(20) }
    var src by remember { mutableStateOf(ALL_SOURCES.toSet()) }
    var off by remember { mutableStateOf(setOf<String>()) }
    var data by remember { mutableStateOf<List<Pair<Track, Int>>?>(null) }
    var name by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(days) {
        data = null
        data = runCatching { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Repo.cloud.top(days) } }.getOrDefault(emptyList())
    }
    val rows: List<Pair<Track, Int>> = run {
        val d = (data ?: emptyList()).filter { it.first.source in src }
        when (mode) {
            "empty" -> emptyList()
            "artists" -> {
                val groups = d.groupBy { it.first.artist.split(",", "×", " feat", " & ").first().trim() }
                    .values.sortedByDescending { g -> g.sumOf { it.second } }.take(8)
                val out = ArrayList<Pair<Track, Int>>()
                var i = 0
                while (out.size < count && groups.any { it.size > i }) {
                    groups.forEach { g -> if (g.size > i && out.size < count) out += g[i] }
                    i++
                }
                out
            }
            else -> d.take(count)
        }
    }
    val chosen = rows.filter { it.first.id !in off }.map { it.first }
    val defaultName = when (mode) {
        "empty" -> "Новый микс"
        "artists" -> "Любимые исполнители"
        else -> when (days) { 7 -> "Топ недели"; 365 -> "Топ года"; else -> "Топ месяца" }
    }
    Dialog(onDismissRequest = { model.mixBuilderOpen = false }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.fillMaxWidth().padding(12.dp).heightIn(max = 760.dp).clip(RoundedCornerShape(32.dp)).background(NyaoColors.S1)
                .verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Новый микс", style = MaterialTheme.typography.headlineSmall)
            OutlinedTextField(name ?: defaultName, { name = it }, label = { Text("Название") }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp))
            listOf("top" to "Из самого прослушиваемого", "artists" to "По любимым исполнителям", "empty" to "Пустой микс").forEach { (id, label) ->
                val on = mode == id
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(if (on) NyaoColors.Tonal else NyaoColors.S2).clickable { mode = id; name = null }.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(18.dp).clip(CircleShape).border(2.dp, if (on) NyaoColors.Lavender else NyaoColors.Outline, CircleShape), contentAlignment = Alignment.Center) {
                        if (on) Box(Modifier.size(8.dp).clip(CircleShape).background(NyaoColors.Lavender))
                    }
                    Spacer(Modifier.width(12.dp))
                    Text(label, style = MaterialTheme.typography.titleSmall)
                }
            }
            if (mode != "empty") {
                Text("За какое время", style = MaterialTheme.typography.labelLarge, color = NyaoColors.Muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(7 to "Неделя", 30 to "Месяц", 365 to "Год").forEach { (d, l) -> PillChip(l, days == d, { days = d; name = null }) }
                }
                Text("Откуда", style = MaterialTheme.typography.labelLarge, color = NyaoColors.Muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ALL_SOURCES.forEach { s -> PillChip(if (s == SOURCE_YA) "Яндекс" else sourceName(s), s in src, { src = if (s in src) src - s else src + s }) }
                }
                Text("Сколько треков", style = MaterialTheme.typography.labelLarge, color = NyaoColors.Muted)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(20, 30, 50).forEach { n -> PillChip("$n", count == n, { count = n }) }
                }
                Text(if (data == null) "Считаю историю…" else "Что попадёт в микс · ${chosen.size}", style = MaterialTheme.typography.titleSmall)
                if (data != null && rows.isEmpty()) {
                    Text("Пока мало истории. Послушай что-нибудь — Nyao запоминает треки на всех устройствах с аккаунтом Nyao.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                }
                rows.forEach { (t, n) ->
                    Row(Modifier.fillMaxWidth().clickable { off = if (t.id in off) off - t.id else off + t.id }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(t.id !in off, { off = if (t.id in off) off - t.id else off + t.id }, colors = CheckboxDefaults.colors(checkedColor = NyaoColors.Lavender, checkmarkColor = NyaoColors.OnLavender))
                        Cover(t.cover, Modifier.size(40.dp), RoundedCornerShape(12.dp))
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                            Text(t.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(t.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Box(Modifier.size(8.dp).clip(CircleShape).background(sourceColor(t.source)))
                        Text("  $n ×", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                    }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
                OutlinedButton(onClick = { model.mixBuilderOpen = false }) { Text("Отмена") }
                Button(
                    onClick = {
                        val m = Repo.mixStore.create((name ?: defaultName).trim(), if (mode == "empty") emptyList() else chosen)
                        model.mixBuilderOpen = false
                        model.message("Создан микс «${m.title}»" + if (m.tracks.isNotEmpty()) " · ${m.tracks.size} треков" else "")
                        model.go(Route.PlaylistPage(m.asPlaylist()))
                    },
                    enabled = mode == "empty" || chosen.isNotEmpty(),
                ) { Text(if (mode == "empty") "Создать" else "Собрать ${chosen.size}") }
            }
        }
    }
}
