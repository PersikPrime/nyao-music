package org.nyao.music.ui.screens

import android.content.Intent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.nyao.music.data.ConnectDevice
import org.nyao.music.data.Playlist
import org.nyao.music.data.Repo
import org.nyao.music.data.Track
import org.nyao.music.data.arr
import org.nyao.music.data.objects
import org.nyao.music.data.obj
import org.nyao.music.data.sourceName
import org.nyao.music.data.str
import org.nyao.music.playback.Live
import org.nyao.music.playback.PlaybackEvents
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.playback.Together
import org.nyao.music.playback.plural
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.Hint
import org.nyao.music.ui.components.Loading
import org.nyao.music.ui.components.NyaoIcons
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.components.appear
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.theme.NyaoColors

// ======================= Nyao Connect =======================

/** Шторка «Устройства»: пульт для других своих устройств */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectSheet(model: AppModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<ConnectDevice>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val current by PlayerConnection.current.collectAsState()
    val loggedIn = Repo.cloud.loggedIn
    suspend fun load() {
        try {
            devices = withContext(kotlinx.coroutines.Dispatchers.IO) { Repo.cloud.connectDevices() }
            error = null
        } catch (e: Exception) {
            error = e.message
        }
    }
    LaunchedEffect(Unit) {
        if (!loggedIn) return@LaunchedEffect
        load()
        // «сейчас играет» на других устройствах приходит сразу
        Live.events.collect { e ->
            if (e.optString("type") != "now") return@collect
            val d = Repo.cloud.parseDevice(e.put("online", true))
            val list = devices ?: return@collect
            devices = if (list.any { it.deviceId == d.deviceId }) list.map { if (it.deviceId == d.deviceId) d.copy(lastSeen = it.lastSeen) else it } else list + d
        }
    }
    fun cmd(d: ConnectDevice, c: String, args: JSONObject = JSONObject()) = scope.launch {
        runCatching { withContext(kotlinx.coroutines.Dispatchers.IO) { Repo.cloud.connectCmd(d.deviceId, c, args) } }
            .onFailure { model.message(it.message ?: "Не получилось") }
    }
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Nyao Connect", style = MaterialTheme.typography.headlineSmall)
                    Text("Управляй музыкой на своих устройствах", style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted)
                }
                if (loggedIn) TextButton(onClick = { scope.launch { load() } }) { Text("Обновить") }
            }
            if (!loggedIn) {
                Hint("Войди в аккаунт Nyao здесь и на компьютере — и сможешь переключать треки на одном устройстве с другого.")
                Button(onClick = { onClose(); model.go(Route.Settings) }) { Text("Войти в аккаунт Nyao") }
                return@Column
            }
            DeviceCard(
                name = "Это устройство", platform = "android", online = true,
                status = current?.let { "${it.title} · ${it.artist}" } ?: "Ничего не играет", highlight = true,
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            val others = devices?.filter { !it.current }?.sortedByDescending { it.online }
            when {
                devices == null -> Loading()
                others.isNullOrEmpty() -> Hint("Других устройств пока нет — войди в аккаунт Nyao на компьютере или другом телефоне.")
                else -> others.forEach { d ->
                    val status = if (!d.online) "Не в сети" else if (d.track == null) "В сети" else if (d.playing) "Играет" else "На паузе"
                    DeviceCard(d.device, d.platform, d.online, status, track = d.track) {
                        if (!d.online) return@DeviceCard
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = { cmd(d, "prev") }) { Icon(NyaoIcons.SkipPrevious, "Предыдущий") }
                            FilledIconButton(onClick = {
                                cmd(d, "toggle")
                                devices = devices?.map { if (it.deviceId == d.deviceId) it.copy(playing = !it.playing, positionSec = it.livePosition(), updatedAt = System.currentTimeMillis()) else it }
                            }) { Icon(if (d.playing) NyaoIcons.Pause else NyaoIcons.PlayArrow, if (d.playing) "Пауза" else "Играть") }
                            IconButton(onClick = { cmd(d, "next") }) { Icon(NyaoIcons.SkipNext, "Следующий") }
                            if (d.volume != null) {
                                var vol by remember(d.deviceId) { mutableStateOf(d.volume.toFloat()) }
                                var job by remember { mutableStateOf<Job?>(null) }
                                Slider(
                                    value = vol,
                                    onValueChange = {
                                        vol = it
                                        job?.cancel()
                                        job = scope.launch {
                                            delay(250)
                                            cmd(d, "volume", JSONObject().put("volume", it.toDouble()))
                                        }
                                    },
                                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                                )
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (d.track != null) OutlinedButton(onClick = {
                                if (Together.room.value?.isHost == false) Together.leave(silent = true)
                                PlayerConnection.resume(d.track, (d.livePosition() * 1000).toLong(), "С «${d.device}»")
                                cmd(d, "pause")
                                onClose()
                            }) { Text("Забрать сюда") }
                            if (current != null) Button(onClick = {
                                val q = PlayerConnection.queue.value
                                val i = PlayerConnection.index.value.coerceAtLeast(0)
                                val from = (i - 20).coerceAtLeast(0)
                                val slice = q.drop(from).take(300)
                                val arr = org.json.JSONArray().apply { slice.forEach { put(Repo.cloud.trackJson(it)) } }
                                cmd(d, "playTracks", JSONObject().put("tracks", arr).put("index", i - from).put("position", PlayerConnection.positionMs() / 1000.0).put("title", Repo.queueLabel.value))
                                PlayerConnection.pauseIfPlaying()
                                model.message("Играет на «${d.device}»")
                                onClose()
                            }) { Text("Включить там") }
                        }
                    }
                }
            }
            FilledTonalButton(onClick = { onClose(); model.go(Route.Together) }, modifier = Modifier.fillMaxWidth()) {
                Icon(NyaoIcons.Group, null, Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Слушать вместе с друзьями")
            }
        }
    }
}

@Composable
private fun DeviceCard(
    name: String, platform: String, online: Boolean, status: String,
    track: Track? = null, highlight: Boolean = false, content: @Composable () -> Unit = {},
) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp))
            .background(if (highlight) NyaoColors.Tonal else NyaoColors.S2)
            .alpha(if (online) 1f else 0.6f).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(NyaoColors.S3), contentAlignment = Alignment.Center) {
                Icon(if (platform == "android") NyaoIcons.PhoneAndroid else NyaoIcons.Computer, null, tint = NyaoColors.Muted, modifier = Modifier.size(22.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(status, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box(Modifier.size(9.dp).clip(CircleShape).background(if (online) Color(0xFF4ADE80) else NyaoColors.Outline))
        }
        if (track != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Cover(track.cover, Modifier.size(48.dp), RoundedCornerShape(12.dp))
            Column(Modifier.weight(1f)) {
                Text(track.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(track.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        content()
    }
}

// ======================= Слушать вместе =======================

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TogetherScreen(model: AppModel) {
    val room by Together.room.collectAsState()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val clip = LocalClipboardManager.current
    val flying = remember { mutableStateListOf<Triple<Long, String, String>>() }
    LaunchedEffect(Unit) { Together.refresh() }
    LaunchedEffect(Unit) {
        Together.reactions.collect { (emoji, name) ->
            val id = System.nanoTime()
            flying += Triple(id, emoji, name)
            launch {
                delay(2600)
                flying.removeAll { it.first == id }
            }
        }
    }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
            item {
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { model.back() }) { Icon(NyaoIcons.ArrowBack, "Назад", tint = NyaoColors.Text) }
                    Text("Слушать вместе", style = MaterialTheme.typography.titleLarge)
                }
            }
            val r = room
            if (!Repo.cloud.loggedIn) {
                item {
                    Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Hint("Комнаты работают через аккаунт Nyao (вход через Telegram). Токены музыкальных сервисов остаются на телефоне.")
                        Button(onClick = { model.go(Route.Settings) }) { Text("Войти в аккаунт Nyao") }
                    }
                }
            } else if (r == null) {
                item {
                    Text(
                        "Одна музыка на всех: хост включает треки, а у остальных они играют одновременно — каждый слушает в своём сервисе. Если трека там нет, Nyao найдёт его в другом.",
                        style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    )
                }
                item {
                    Column(
                        Modifier.appear(0).padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(32.dp))
                            .background(Brush.linearGradient(listOf(NyaoColors.Hero, NyaoColors.S1))).padding(22.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("ТЫ ВЕДЁШЬ", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Lavender)
                        Text("Создать комнату", style = MaterialTheme.typography.headlineSmall)
                        Text("Получишь код и ссылку — отправь друзьям.", color = NyaoColors.Muted)
                        Button(onClick = { scope.launch { runCatching { Together.create() }.onSuccess { model.message("Комната создана — поделись кодом") }.onFailure { model.message(it.message ?: "Не получилось") } } }) { Text("Создать") }
                    }
                }
                item {
                    var code by remember { mutableStateOf("") }
                    Column(
                        Modifier.appear(1).padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(32.dp)).background(NyaoColors.S2).padding(22.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text("ТЕБЯ ПОЗВАЛИ", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Muted)
                        Text("Войти по коду", style = MaterialTheme.typography.headlineSmall)
                        OutlinedTextField(
                            value = code, onValueChange = { code = it.take(64) }, singleLine = true,
                            placeholder = { Text("Код или ссылка") },
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(onClick = {
                            scope.launch {
                                runCatching { Together.join(code) }
                                    .onSuccess { model.message(if (it.isHost) "Это твоя комната" else "Ты слушаешь вместе с ${it.hostName}") }
                                    .onFailure { model.message(it.message ?: "Не получилось") }
                            }
                        }, enabled = Together.parseCode(code) != null) { Text("Войти") }
                    }
                }
            } else {
                item {
                    Column(
                        Modifier.appear(0).padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(32.dp))
                            .background(Brush.linearGradient(listOf(NyaoColors.Hero, NyaoColors.S1))).padding(22.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(if (r.isHost) "ТВОЯ КОМНАТА" else "КОМНАТА ${r.hostName.uppercase()}", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Lavender)
                        Text(
                            r.code, fontSize = 48.sp, fontWeight = FontWeight.Bold, letterSpacing = 6.sp,
                            modifier = Modifier.clickable { clip.setText(AnnotatedString(r.code)); model.message("Код скопирован") },
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = {
                                val send = Intent(Intent.ACTION_SEND).setType("text/plain")
                                    .putExtra(Intent.EXTRA_TEXT, "Слушаем вместе в Nyao Music — код ${r.code}\n${Together.JOIN_BASE}${r.code}")
                                ctx.startActivity(Intent.createChooser(send, "Пригласить"))
                            }) { Text("Пригласить") }
                            OutlinedButton(onClick = { Together.leave() }) { Text(if (r.isHost) "Закрыть" else "Выйти") }
                        }
                    }
                }
                item {
                    val st = r.state
                    val t = st?.track
                    Row(
                        Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2).padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        if (t != null) {
                            Cover(t.cover, Modifier.size(84.dp), RoundedCornerShape(20.dp))
                            Column(Modifier.weight(1f)) {
                                Text(if (st.playing) "СЕЙЧАС ИГРАЕТ У ВСЕХ" else "НА ПАУЗЕ", style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted)
                                Text(t.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(t.artist, style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        } else {
                            Text(if (r.isHost) "Включи что-нибудь — все услышат" else "Ждём, пока ${r.hostName} включит музыку", style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }
                item {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("В комнате · ${r.members.size + 1}", style = MaterialTheme.typography.titleMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            (listOf(r.hostName to true) + r.members.map { it to false }).forEach { (n, host) ->
                                Row(
                                    Modifier.clip(RoundedCornerShape(50)).background(NyaoColors.S2).padding(start = 6.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Box(Modifier.size(28.dp).clip(CircleShape).background(NyaoColors.Tonal), contentAlignment = Alignment.Center) {
                                        Text(n.take(1), color = NyaoColors.Lavender, fontWeight = FontWeight.Bold)
                                    }
                                    Text(n, style = MaterialTheme.typography.bodyMedium)
                                    if (host) Text("ведёт", style = MaterialTheme.typography.labelSmall, color = NyaoColors.Lavender)
                                }
                            }
                        }
                        Text(
                            if (r.isHost) "Всё, что ты включаешь, ставишь на паузу или перематываешь, повторяется у всех." else "Музыку выбирает ${r.hostName}. Треки из сервисов, которых у тебя нет, ищутся в твоих.",
                            style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted,
                        )
                        Text("Реакции", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Together.REACTIONS.forEach { e ->
                                Box(
                                    Modifier.size(52.dp).bouncy().clip(RoundedCornerShape(16.dp)).background(NyaoColors.S2).clickable { Together.react(e) },
                                    contentAlignment = Alignment.Center,
                                ) { Text(e, fontSize = 24.sp) }
                            }
                        }
                    }
                }
            }
        }
        // летящие реакции
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val h = maxHeight
            val w = maxWidth
            flying.forEach { (id, emoji, name) ->
                androidx.compose.runtime.key(id) {
                    val y = remember { Animatable(0f) }
                    val x = remember { (0.1f + (id % 80) / 100f) }
                    LaunchedEffect(Unit) { y.animateTo(1f, tween(2600)) }
                    Column(
                        Modifier.offset(x = w * x, y = h * (0.85f - 0.6f * y.value)).alpha(1f - y.value),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(emoji, fontSize = 40.sp)
                        Text(name, style = MaterialTheme.typography.labelSmall, modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.Black.copy(alpha = 0.5f)).padding(horizontal = 8.dp, vertical = 2.dp))
                    }
                }
            }
        }
    }
}

// ======================= Итоги =======================

private val PERIODS = listOf("week" to "Неделя", "month" to "Месяц", "year" to "Год", "all" to "Всё")

private fun minutesText(m: Int): String = if (m < 60) "$m ${plural(m, "минута", "минуты", "минут")}" else "${m / 60} ч ${m % 60} мин"

private fun num(n: Int): String = "%,d".format(n).replace(',', ' ')

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatsScreen(model: AppModel) {
    var period by remember { mutableStateOf("month") }
    var data by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(period) {
        if (!Repo.cloud.loggedIn) return@LaunchedEffect
        data = null
        error = null
        try {
            data = withContext(kotlinx.coroutines.Dispatchers.IO) { Repo.cloud.stats(period) }
        } catch (e: Exception) {
            error = e.message
        }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { model.back() }) { Icon(NyaoIcons.ArrowBack, "Назад", tint = NyaoColors.Text) }
                Text("Итоги", style = MaterialTheme.typography.titleLarge)
            }
        }
        item {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                PERIODS.forEachIndexed { i, (v, l) ->
                    SegmentedButton(selected = period == v, onClick = { period = v }, shape = SegmentedButtonDefaults.itemShape(i, PERIODS.size)) { Text(l) }
                }
            }
        }
        val s = data
        when {
            !Repo.cloud.loggedIn -> item {
                Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Hint("Итоги собираются из истории прослушиваний со всех твоих устройств — она хранится в аккаунте Nyao.")
                    Button(onClick = { model.go(Route.Settings) }) { Text("Войти в аккаунт Nyao") }
                }
            }
            error != null -> item { Hint(error!!, Modifier.padding(20.dp)) }
            s == null -> item { Loading() }
            s.optInt("plays") == 0 -> item { Hint("За этот период пока нечего подводить — послушай что-нибудь, и здесь появятся итоги.", Modifier.padding(20.dp)) }
            else -> {
                val minutes = s.optInt("minutes")
                val plays = s.optInt("plays")
                val topArtists = s.arr("topArtists").objects()
                val topTracks = s.arr("topTracks").objects().mapNotNull { t ->
                    val id = t.optString("trackId")
                    val src = t.optString("source").ifBlank { id.substringBefore(':') }
                    if (id.isBlank()) null else Track(id = id, source = src, srcId = id.substringAfter(':'), title = t.optString("title"), artist = t.optString("artist"), album = "", duration = t.optInt("duration"), cover = t.str("cover")) to t.optInt("plays")
                }
                item {
                    Column(
                        Modifier.appear(0).padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(36.dp))
                            .background(Brush.linearGradient(listOf(NyaoColors.Hero, Color(0xFF120E22)))).padding(24.dp),
                    ) {
                        Text(periodTitle(period, s.str("from")), style = MaterialTheme.typography.labelLarge, color = NyaoColors.Lavender)
                        Text(num(minutes), fontSize = 72.sp, fontWeight = FontWeight.Bold, lineHeight = 76.sp)
                        Text("${plural(minutes, "минута", "минуты", "минут")} музыки · ${num(plays)} ${plural(plays, "прослушивание", "прослушивания", "прослушиваний")}", color = NyaoColors.Muted)
                        topArtists.firstOrNull()?.let { a ->
                            Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Cover(a.str("cover"), Modifier.size(36.dp), CircleShape)
                                Text("Главный исполнитель — ${a.optString("name")}", style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
                item {
                    val facts = buildList {
                        add(num(s.optInt("tracksUnique")) to plural(s.optInt("tracksUnique"), "трек", "трека", "треков"))
                        add(num(s.optInt("artistsUnique")) to plural(s.optInt("artistsUnique"), "исполнитель", "исполнителя", "исполнителей"))
                        s.optInt("longestStreak").takeIf { it > 1 }?.let { add(num(it) to "${plural(it, "день", "дня", "дней")} подряд с музыкой") }
                        if (!s.isNull("topHour") && s.has("topHour")) s.optInt("topHour").let { h -> add("%02d:00".format(h) to "чаще всего слушаешь ${if (h < 5) "ночью" else if (h < 12) "утром" else if (h < 18) "днём" else "вечером"}") }
                        s.obj("busiestDay")?.let { add(minutesText(it.optInt("minutes")) to "в самый музыкальный день") }
                    }
                    FlowRow(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        facts.forEachIndexed { i, (big, label) ->
                            Column(Modifier.appear(i).width(160.dp).clip(RoundedCornerShape(24.dp)).background(NyaoColors.S2).padding(16.dp)) {
                                Text(big, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                                Text(label, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                            }
                        }
                    }
                }
                item { Text("Исполнители", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 20.dp, top = 24.dp, bottom = 8.dp)) }
                itemsIndexed(topArtists) { i, a ->
                    Row(Modifier.padding(horizontal = 20.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("${i + 1}", color = NyaoColors.Outline, modifier = Modifier.width(22.dp), fontWeight = FontWeight.SemiBold)
                        Cover(a.str("cover"), Modifier.size(if (i == 0) 56.dp else 44.dp), CircleShape)
                        Column(Modifier.weight(1f)) {
                            Text(a.optString("name"), style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${minutesText(a.optInt("minutes"))} · ${a.optInt("tracks")} ${plural(a.optInt("tracks"), "трек", "трека", "треков")}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                        }
                    }
                }
                item {
                    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 24.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Треки", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                        TextButton(onClick = { PlayerConnection.playList(topTracks.map { it.first }, 0, "Итоги: любимое") }) { Text("Слушать все") }
                    }
                }
                itemsIndexed(topTracks) { i, (t, n) ->
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 2.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(NyaoColors.S2)
                            .clickable { PlayerConnection.playList(topTracks.map { it.first }, i, "Итоги: любимое") }.padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Cover(t.cover, Modifier.size(48.dp), RoundedCornerShape(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(t.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(t.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Text("×$n", color = NyaoColors.Lavender, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(end = 8.dp))
                    }
                }
                item {
                    val hours = (0 until 24).map { s.arr("hours")?.optInt(it) ?: 0 }
                    val max = (hours.maxOrNull() ?: 1).coerceAtLeast(1)
                    Column(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2).padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Когда слушаешь", style = MaterialTheme.typography.titleMedium)
                        Row(Modifier.fillMaxWidth().height(110.dp), horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.Bottom) {
                            hours.forEach { m ->
                                Box(Modifier.weight(1f).fillMaxHeight((m.toFloat() / max).coerceAtLeast(0.03f)).clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)).background(NyaoColors.Lavender))
                            }
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            listOf("00", "06", "12", "18", "23").forEach { Text(it, style = MaterialTheme.typography.labelSmall, color = NyaoColors.Outline) }
                        }
                    }
                }
                item {
                    val src = s.optJSONObject("sources") ?: JSONObject()
                    val keys = src.keys().asSequence().toList()
                    val total = keys.sumOf { src.optInt(it) }.coerceAtLeast(1)
                    Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2).padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Сервисы", style = MaterialTheme.typography.titleMedium)
                        keys.forEach { k ->
                            val share = src.optInt(k).toFloat() / total
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(Modifier.fillMaxWidth()) {
                                    Text(sourceName(k), modifier = Modifier.weight(1f))
                                    Text("${(share * 100).toInt()}%", fontWeight = FontWeight.SemiBold)
                                }
                                Box(Modifier.fillMaxWidth(share.coerceAtLeast(0.02f)).height(6.dp).clip(RoundedCornerShape(6.dp)).background(srcColor(k)))
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun srcColor(k: String) = when (k) {
    "ya" -> NyaoColors.Ya
    "yt" -> NyaoColors.Yt
    "sc" -> NyaoColors.Sc
    "vk" -> Color(0xFF0077FF)
    else -> NyaoColors.Lavender
}

private fun periodTitle(period: String, from: String?): String {
    if (period == "week") return "ПОСЛЕДНИЕ 7 ДНЕЙ"
    if (period == "all") return "ЗА ВСЁ ВРЕМЯ"
    val d = runCatching { java.time.OffsetDateTime.parse(from).plusDays(1) }.getOrNull() ?: java.time.OffsetDateTime.now()
    if (period == "year") return d.year.toString()
    val m = d.month.getDisplayName(java.time.format.TextStyle.FULL_STANDALONE, java.util.Locale("ru"))
    return "${m.uppercase()} ${d.year}"
}

// ======================= Перенос плейлиста =======================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TransferSheet(model: AppModel, playlist: Playlist, tracks: List<Track>, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val targets = remember { Repo.transferTargets().filter { it.id != playlist.source } }
    var target by remember { mutableStateOf(targets.firstOrNull { it.ok }?.id) }
    var title by remember { mutableStateOf(playlist.title) }
    var progress by remember { mutableStateOf<Triple<Int, Int, Int>?>(null) }
    var result by remember { mutableStateOf<Repo.TransferResult?>(null) }
    var running by remember { mutableStateOf(false) }
    ModalBottomSheet(onDismissRequest = { if (!running) onClose() }) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Перенести плейлист", style = MaterialTheme.typography.headlineSmall)
            Text("«${playlist.title}» · ${tracks.size} ${plural(tracks.size, "трек", "трека", "треков")}. Каждый трек найдём в выбранном сервисе, ненайденные покажем списком.", color = NyaoColors.Muted, style = MaterialTheme.typography.bodyMedium)
            val r = result
            if (r == null) {
                targets.forEach { t ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
                            .background(if (target == t.id) NyaoColors.Tonal else NyaoColors.S2)
                            .selectable(selected = target == t.id, enabled = t.ok && !running, onClick = { target = t.id })
                            .alpha(if (t.ok) 1f else 0.5f).padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = target == t.id, onClick = null, enabled = t.ok)
                        Column(Modifier.padding(start = 8.dp)) {
                            Text(t.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                if (t.id == "mix") "Плейлист внутри Nyao, синхронизируется между устройствами" else if (t.ok) "Создадим приватный плейлист" else "Нужен вход в этот сервис",
                                style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted,
                            )
                        }
                    }
                }
                OutlinedTextField(value = title, onValueChange = { title = it.take(80) }, label = { Text("Название") }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !running)
                progress?.let { (done, total, found) ->
                    LinearProgressIndicator(progress = { done.toFloat() / total.coerceAtLeast(1) }, modifier = Modifier.fillMaxWidth())
                    Text("Проверено $done из $total · найдено $found", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                }
                Button(
                    onClick = {
                        val to = target ?: return@Button
                        running = true
                        progress = Triple(0, tracks.size, 0)
                        scope.launch {
                            try {
                                result = Repo.transfer(tracks, title, to) { d, t, f -> progress = Triple(d, t, f) }
                                model.invalidatePlaylists()
                            } catch (e: Exception) {
                                PlaybackEvents.emit(e.message ?: "Не получилось перенести")
                            } finally {
                                running = false
                            }
                        }
                    },
                    enabled = target != null && !running,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (running) "Переношу…" else "Перенести") }
            } else {
                Text(if (r.playlistId != null) "Готово: перенесено ${r.found} из ${r.total}" else "Ничего не нашлось", style = MaterialTheme.typography.titleMedium)
                if (r.missing.isNotEmpty()) {
                    Text("Не нашлись (${r.missing.size}):", style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted)
                    r.missing.take(100).forEach { Text("${it.artist} — ${it.title}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onClose) { Text("Закрыть") }
                    if (r.playlistId != null) Button(onClick = {
                        onClose()
                        val id = r.playlistId
                        val src = if (id.startsWith("mix:")) "mix" else id.substringBefore(':')
                        model.go(Route.PlaylistPage(Playlist(id, src, title, r.found)))
                    }) { Text("Открыть") }
                }
            }
        }
    }
}
