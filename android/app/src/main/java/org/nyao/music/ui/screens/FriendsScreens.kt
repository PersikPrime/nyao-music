package org.nyao.music.ui.screens

import android.app.Activity
import android.content.Intent
import android.nfc.NfcAdapter
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.nyao.music.data.Friend
import org.nyao.music.data.InboxItem
import org.nyao.music.data.PublicProfile
import org.nyao.music.data.Repo
import org.nyao.music.data.SearchUser
import org.nyao.music.data.Track
import org.nyao.music.data.UserCard
import org.nyao.music.playback.Friends
import org.nyao.music.playback.NfcShare
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.playback.SocialBanner
import org.nyao.music.playback.Together
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.Hint
import org.nyao.music.ui.components.NyaoIcons
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.components.appear
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.theme.NyaoColors

private val REACTIONS = listOf("🔥", "❤️", "😂", "😮", "👏", "🎶")

/** Аватар любого пользователя: фото из Telegram или первая буква на градиенте акцента */
@Composable
fun UserAvatar(user: UserCard?, size: Int, modifier: Modifier = Modifier) {
    Box(
        modifier.size(size.dp).clip(CircleShape).background(Brush.linearGradient(listOf(NyaoColors.Lavender, Color(0xFF7F6BFF)))),
        contentAlignment = Alignment.Center,
    ) {
        val pic = user?.picture
        if (pic != null) AsyncImage(model = pic, contentDescription = user?.display, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text(((user?.name?.firstOrNull() ?: user?.nick?.firstOrNull()) ?: 'N').uppercase(), color = NyaoColors.OnLavender, fontWeight = FontWeight.Bold, fontSize = (size * 0.42f).sp)
    }
}

private fun ago(at: Long): String {
    val m = ((System.currentTimeMillis() - at) / 60_000).coerceAtLeast(0)
    return when {
        m < 1 -> "только что"
        m < 60 -> "$m мин назад"
        m < 24 * 60 -> "${m / 60} ч назад"
        else -> "${m / (24 * 60)} дн назад"
    }
}

/** Открыть приглашение (ссылка, QR, касание): сразу друзья и переход в профиль друга */
fun openInvite(model: AppModel, code: String) {
    if (!Repo.cloud.loggedIn) {
        Friends.pendingInvite = code
        model.message("Войди в аккаунт Nyao — и друг добавится сам")
        model.go(Route.Settings)
        return
    }
    Friends.pendingInvite = null
    model.launch {
        runCatching { Repo.cloud.useInvite(code) }
            .onSuccess { (rel, u) ->
                if (rel == "self") model.message("Это твоё приглашение")
                else {
                    model.message("${u?.display ?: "Друг"} теперь в друзьях")
                    Friends.refreshAsync()
                    u?.let { model.go(Route.UserPage(it.id)) }
                }
            }
            .onFailure { model.message(it.message ?: "Не получилось добавить") }
    }
}

/** Код приглашения из ссылки https://…/add/CODE или nyao://add/CODE */
fun inviteCode(uri: android.net.Uri?): String? {
    uri ?: return null
    val code = when {
        uri.scheme == "nyao" && uri.host == "add" -> uri.pathSegments.firstOrNull()
        uri.pathSegments.size >= 2 && uri.pathSegments[0] == "add" -> uri.pathSegments[1]
        else -> null
    }
    return code?.takeIf { Regex("^[a-z0-9]{6,16}$").matches(it) }
}

// ---------------------------------------------------------------------------------------------
// «Вместе»: друзья, заявки и входящие над комнатами
// ---------------------------------------------------------------------------------------------

@Composable
fun FriendsHub(model: AppModel) {
    val friends by Friends.friends.collectAsState()
    val incoming by Friends.incoming.collectAsState()
    val inbox by Friends.inbox.collectAsState()
    var adding by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { Friends.refresh() } }
    Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Друзья", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            FilledTonalButton(onClick = { adding = true }, modifier = Modifier.bouncy()) {
                Icon(NyaoIcons.PersonAdd, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Добавить")
            }
        }
        // заявки
        incoming.forEach { u ->
            Row(
                Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(NyaoColors.Tonal)
                    .clickable { model.go(Route.UserPage(u.id)) }.padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                UserAvatar(u, 44)
                Column(Modifier.weight(1f)) {
                    Text(u.display, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("хочет дружить · @${u.nick}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1)
                }
                TextButton(onClick = { model.launch { runCatching { Repo.cloud.removeFriend(u.id) }; Friends.refresh() } }) { Text("Нет") }
                Button(onClick = { model.launch { runCatching { Repo.cloud.acceptFriend(u.id) }.onFailure { model.message(it.message ?: "Не получилось") }; Friends.refresh() } }) { Text("Принять") }
            }
        }
        // друзья: кто что слушает
        if (friends.isEmpty()) {
            Column(
                Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("Пока никого", style = MaterialTheme.typography.titleSmall)
                Text("Добавь друзей по нику, QR-коду или приложи телефоны — увидишь, что они слушают, и сможешь звать их в комнату.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            }
        } else {
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                items(friends, key = { it.user.id }) { f -> FriendTile(model, f) }
            }
        }
        // входящие: треки, приглашения, реакции
        if (inbox.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Входящие", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                if (inbox.any { !it.read }) TextButton(onClick = { Friends.markInboxRead() }) { Text("Прочитано") }
            }
            inbox.take(6).forEach { item -> InboxRow(model, item) }
        }
    }
    if (adding) AddFriendSheet(model) { adding = false }
}

@Composable
private fun FriendTile(model: AppModel, f: Friend) {
    val now = f.now
    Column(
        Modifier.width(150.dp).bouncy().clip(RoundedCornerShape(26.dp)).background(NyaoColors.S2).clickable { model.go(Route.UserPage(f.user.id)) }.padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box {
            UserAvatar(f.user, 48)
            if (now?.playing == true) Box(Modifier.align(Alignment.BottomEnd).size(14.dp).clip(CircleShape).background(NyaoColors.S2).padding(2.dp).clip(CircleShape).background(Color(0xFF4ADE80)))
        }
        Text(f.user.display, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (now != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Cover(now.track.cover, Modifier.size(28.dp), RoundedCornerShape(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(now.track.title, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(now.track.artist, style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        } else {
            Text("@${f.user.nick}", style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (f.online) "в сети" else "не слушает", style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted)
        }
    }
}

@Composable
private fun InboxRow(model: AppModel, item: InboxItem) {
    val t = item.track
    Row(
        Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(if (item.read) NyaoColors.S2 else NyaoColors.Tonal)
            .clickable {
                when {
                    item.kind == "room" && item.code != null -> model.launch {
                        runCatching { Together.join(item.code) }.onSuccess { model.message("Ты в комнате ${item.from.display}") }.onFailure { model.message(it.message ?: "Комната уже закрыта") }
                    }
                    t != null -> PlayerConnection.playList(listOf(t), 0, "От ${item.from.display}")
                    else -> model.go(Route.UserPage(item.from.id))
                }
            }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (t != null && item.kind == "track") Cover(t.cover, Modifier.size(44.dp), RoundedCornerShape(12.dp)) else UserAvatar(item.from, 44)
        Column(Modifier.weight(1f)) {
            Text(
                when (item.kind) {
                    "track" -> "${item.from.display} прислал трек ${item.emoji ?: ""}"
                    "room" -> "${item.from.display} зовёт слушать вместе"
                    else -> "${item.from.display}: ${item.emoji ?: ""}"
                },
                style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(
                when {
                    item.kind == "room" -> "Нажми, чтобы войти · ${ago(item.createdAt)}"
                    t != null && item.kind == "track" -> "${t.artist} — ${t.title}"
                    t != null -> "на «${t.title}» · ${ago(item.createdAt)}"
                    else -> ago(item.createdAt)
                },
                style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        if (t != null && item.kind == "track") SourceTag(t.source)
    }
}

// ---------------------------------------------------------------------------------------------
// Добавить друга: поиск по нику, свой QR, ссылка и касание телефонов
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddFriendSheet(model: AppModel, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchUser>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var invite by remember { mutableStateOf<String?>(null) }
    var tapping by remember { mutableStateOf(false) }
    val profile by Friends.profile.collectAsState()
    val nfc = remember { NfcAdapter.getDefaultAdapter(ctx) }
    LaunchedEffect(Unit) { invite = runCatching { Repo.cloud.invite().url }.getOrNull() }
    LaunchedEffect(query) {
        val q = query.trim().removePrefix("@")
        if (q.length < 2) {
            results = emptyList()
            return@LaunchedEffect
        }
        searching = true
        delay(350)
        results = runCatching { Repo.cloud.searchUsers(q) }.getOrDefault(emptyList())
        searching = false
    }
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Добавить друга", style = MaterialTheme.typography.headlineSmall)
            OutlinedTextField(
                value = query, onValueChange = { query = it.take(25) }, singleLine = true,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("@ник друга") },
                leadingIcon = { Icon(NyaoIcons.Search, null) },
                shape = RoundedCornerShape(20.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
            )
            if (searching && results.isEmpty()) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.5.dp) }
            results.forEach { r -> SearchRow(model, r) { updated -> results = results.map { if (it.user.id == updated.user.id) updated else it } } }
            if (query.trim().length >= 2 && !searching && results.isEmpty()) Text("Никого не нашлось — проверь ник", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)

            // свой код: QR и ссылка
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2).padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Мой код", style = MaterialTheme.typography.titleMedium)
                val url = invite
                Box(Modifier.size(200.dp).clip(RoundedCornerShape(24.dp)).background(Color.White).padding(14.dp), contentAlignment = Alignment.Center) {
                    if (url != null) QrCode(url, Modifier.fillMaxSize()) else CircularProgressIndicator(color = NyaoColors.Ink)
                }
                Text("@${profile?.nick ?: "…"}", style = MaterialTheme.typography.titleSmall, color = NyaoColors.Lavender)
                Text("Друг наводит камеру — и вы сразу друзья. Ссылка живёт неделю.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, textAlign = TextAlign.Center)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        url ?: return@OutlinedButton
                        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Добавляйся в друзья в Nyao Music: $url")
                        ctx.startActivity(Intent.createChooser(send, "Пригласить в друзья"))
                    }, enabled = url != null) {
                        Icon(NyaoIcons.Share, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Ссылка")
                    }
                    if (nfc != null) Button(onClick = { tapping = true }, enabled = url != null) {
                        Icon(NyaoIcons.Nfc, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Приложить телефон")
                    }
                }
            }
        }
    }
    val url = invite
    if (tapping && url != null) TapToShareSheet(url, nfcOn = nfc?.isEnabled == true) {
        tapping = false
        scope.launch { delay(300); Friends.refreshAsync() }
    }
}

@Composable
private fun SearchRow(model: AppModel, r: SearchUser, onChange: (SearchUser) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).clickable { model.go(Route.UserPage(r.user.id)) }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        UserAvatar(r.user, 44)
        Column(Modifier.weight(1f)) {
            Text(r.user.display, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("@${r.user.nick}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        }
        RelationButton(model, r.user, r.relation) { onChange(r.copy(relation = it)) }
    }
}

/** Кнопка отношения: Добавить / Заявка отправлена / Принять / В друзьях */
@Composable
private fun RelationButton(model: AppModel, user: UserCard, relation: String, onChange: (String) -> Unit) {
    when (relation) {
        "none" -> Button(onClick = {
            model.launch {
                runCatching { Repo.cloud.requestFriend(userId = user.id) }
                    .onSuccess { onChange(it); model.message(if (it == "friends") "${user.display} теперь в друзьях" else "Заявка отправлена"); Friends.refreshAsync() }
                    .onFailure { model.message(it.message ?: "Не получилось") }
            }
        }) { Text("Добавить") }
        "outgoing" -> OutlinedButton(onClick = {
            model.launch { runCatching { Repo.cloud.removeFriend(user.id) }.onSuccess { onChange("none"); Friends.refreshAsync() } }
        }) { Text("Отменить") }
        "incoming" -> Button(onClick = {
            model.launch { runCatching { Repo.cloud.acceptFriend(user.id) }.onSuccess { onChange("friends"); Friends.refreshAsync() } }
        }) { Text("Принять") }
        "friends" -> FilledTonalButton(onClick = {}, enabled = false) { Text("В друзьях") }
        "blocked" -> OutlinedButton(onClick = {
            model.launch { runCatching { Repo.cloud.unblock(user.id) }.onSuccess { onChange("none") } }
        }) { Text("Разблокировать") }
        else -> {}
    }
}

/** QR-код: zxing считает матрицу, рисуем квадратами (скруглять модули не стоит — хуже читается) */
@Composable
fun QrCode(text: String, modifier: Modifier = Modifier) {
    val matrix = remember(text) {
        runCatching {
            com.google.zxing.qrcode.QRCodeWriter().encode(text, com.google.zxing.BarcodeFormat.QR_CODE, 0, 0, mapOf(com.google.zxing.EncodeHintType.MARGIN to 0))
        }.getOrNull()
    }
    Canvas(modifier.aspectRatio(1f)) {
        val m = matrix ?: return@Canvas
        val cell = size.width / m.width
        for (y in 0 until m.height) for (x in 0 until m.width) {
            if (m.get(x, y)) drawRect(Color(0xFF13111C), Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
        }
    }
}

/** «Приложи телефон»: пока шторка открыта, телефон — NFC-метка с приглашением */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TapToShareSheet(url: String, nfcOn: Boolean, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var done by remember { mutableStateOf(false) }
    DisposableEffect(url) {
        NfcShare.start(url)
        NfcShare.onRead = { done = true }
        // пока делимся, свой телефон не читает чужие метки — иначе два Nyao «читали» бы друг друга
        val activity = ctx as? Activity
        val adapter = NfcAdapter.getDefaultAdapter(ctx)
        runCatching {
            activity?.let {
                adapter?.enableReaderMode(it, { }, NfcAdapter.FLAG_READER_NFC_BARCODE or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK or NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS, null)
            }
        }
        onDispose {
            NfcShare.stop()
            NfcShare.onRead = null
            runCatching { activity?.let { adapter?.disableReaderMode(it) } }
        }
    }
    LaunchedEffect(done) {
        if (done) {
            delay(1400)
            onClose()
        }
    }
    LaunchedEffect(Unit) {
        delay(120_000)
        onClose()
    }
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 32.dp).navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            val profile by Friends.profile.collectAsState()
            Box(Modifier.size(220.dp), contentAlignment = Alignment.Center) {
                // волны вокруг аватара, пока ждём касания
                val t = rememberInfiniteTransition(label = "nfc")
                val p by t.animateFloat(0f, 1f, infiniteRepeatable(tween(1800), RepeatMode.Restart), label = "nfcWave")
                val color = NyaoColors.Lavender
                if (!done) Canvas(Modifier.fillMaxSize()) {
                    for (i in 0 until 3) {
                        val k = (p + i / 3f) % 1f
                        drawCircle(color.copy(alpha = (1f - k) * 0.5f), radius = size.minDimension / 2f * (0.35f + 0.65f * k))
                    }
                }
                Box(Modifier.size(96.dp).clip(CircleShape)) { NyaoAvatar(size = 96) }
                if (done) Box(Modifier.align(Alignment.BottomEnd).padding(36.dp).size(44.dp).clip(CircleShape).background(Color(0xFF4ADE80)), contentAlignment = Alignment.Center) {
                    Icon(NyaoIcons.Check, null, tint = Color(0xFF0B3D1E))
                }
            }
            Text(if (done) "Готово!" else "Приложи телефон к телефону друга", style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            Text(
                when {
                    done -> "Друг получил приглашение"
                    !nfcOn -> "NFC выключен — включи его в настройках телефона, или покажи QR-код"
                    else -> "Спинками друг к другу. У друга должен быть включён NFC и разблокирован экран. @${profile?.nick ?: ""}"
                },
                style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, textAlign = TextAlign.Center,
            )
            if (!nfcOn) OutlinedButton(onClick = { runCatching { ctx.startActivity(Intent(android.provider.Settings.ACTION_NFC_SETTINGS)) } }) { Text("Открыть настройки NFC") }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Профиль пользователя
// ---------------------------------------------------------------------------------------------

@Composable
fun UserScreen(model: AppModel, key: String) {
    val myProfile by Friends.profile.collectAsState()
    val realKey = key.ifBlank { myProfile?.nick ?: "" }
    var p by remember(realKey) { mutableStateOf<PublicProfile?>(null) }
    var error by remember(realKey) { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    var share by remember { mutableStateOf(false) }
    LaunchedEffect(realKey, tick) {
        if (realKey.isBlank()) {
            runCatching { Friends.refresh() }
            return@LaunchedEffect
        }
        runCatching { Repo.cloud.user(realKey) }.onSuccess { p = it; error = null }.onFailure { error = it.message }
    }
    // друг сменил трек — обновим блок «сейчас»
    val friends by Friends.friends.collectAsState()
    val live = p?.let { pp -> friends.firstOrNull { it.user.id == pp.user.id }?.now } ?: p?.now

    LazyColumn(Modifier.fillMaxSize(), contentPadding = BottomInset) {
        item {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { model.back() }) { Icon(NyaoIcons.ArrowBack, "Назад") }
                Spacer(Modifier.weight(1f))
                val pp = p
                if (pp != null && pp.relation == "self") IconButton(onClick = { model.go(Route.SettingsPage("profile")) }) { Icon(NyaoIcons.Edit, "Изменить профиль") }
                if (pp != null && pp.relation != "self") UserMenu(model, pp) { tick++ }
            }
        }
        val pp = p
        when {
            error != null -> item { Hint(error ?: "") }
            pp == null -> item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = NyaoColors.Lavender) } }
            else -> {
                item {
                    Column(Modifier.fillMaxWidth().appear(0).padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        UserAvatar(pp.user, 112)
                        Spacer(Modifier.height(6.dp))
                        Text(pp.user.display, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
                        Text("@${pp.user.nick}", style = MaterialTheme.typography.bodyLarge, color = NyaoColors.Lavender)
                        if (!pp.private && pp.bio.isNotBlank()) Text(pp.bio, style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, textAlign = TextAlign.Center)
                        if (!pp.private) Text("${pp.friends} ${org.nyao.music.playback.plural(pp.friends, "друг", "друга", "друзей")}", style = MaterialTheme.typography.labelLarge, color = NyaoColors.Muted)
                        Spacer(Modifier.height(6.dp))
                        when (pp.relation) {
                            "self" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilledTonalButton(onClick = { model.go(Route.SettingsPage("profile")) }) { Text("Изменить") }
                                Button(onClick = { share = true }) {
                                    Icon(NyaoIcons.QrCode, null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Поделиться")
                                }
                            }
                            else -> RelationButton(model, pp.user, pp.relation) { p = pp.copy(relation = it); tick++ }
                        }
                    }
                }
                if (pp.private) item {
                    Column(
                        Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2).padding(22.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(NyaoIcons.VisibilityOff, null, tint = NyaoColors.Muted)
                        Text("Профиль скрыт", style = MaterialTheme.typography.titleSmall)
                        Text(if (pp.relation == "blocked") "Ты заблокировал этого пользователя" else "Его музыку видят только друзья", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, textAlign = TextAlign.Center)
                    }
                }
                if (!pp.private && live != null) item { NowCard(model, pp, live) }
                val st = pp.stats
                if (!pp.private && st != null && st.plays > 0) {
                    item {
                        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatTile("${st.minutes}", "минут за месяц", Modifier.weight(1f))
                            StatTile("${st.plays}", "прослушиваний", Modifier.weight(1f))
                        }
                    }
                    if (st.topArtists.isNotEmpty()) item {
                        Column(Modifier.padding(horizontal = 16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2).padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("Любимые исполнители", style = MaterialTheme.typography.titleSmall)
                            st.topArtists.forEachIndexed { i, a ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text("${i + 1}", style = MaterialTheme.typography.titleMedium, color = NyaoColors.Lavender, modifier = Modifier.width(28.dp))
                                    Text(a.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${a.plays}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                                }
                            }
                        }
                    }
                    if (st.topTracks.isNotEmpty()) item {
                        Column(Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(NyaoColors.S2).padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text("Чаще всего слушает", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 18.dp, bottom = 6.dp))
                            st.topTracks.forEachIndexed { i, (t, n) ->
                                Row(
                                    Modifier.fillMaxWidth().clickable { PlayerConnection.playList(st.topTracks.map { it.first }, i, "Любимое @${pp.user.nick}") }.padding(horizontal = 14.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    Cover(t.cover, Modifier.size(40.dp), RoundedCornerShape(10.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(t.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text(t.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                    Text("$n×", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Muted)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (share) AddFriendSheet(model) { share = false }
}

@Composable
private fun StatTile(value: String, label: String, modifier: Modifier = Modifier) {
    Column(modifier.clip(RoundedCornerShape(24.dp)).background(NyaoColors.S2).padding(16.dp)) {
        Text(value, style = MaterialTheme.typography.headlineSmall)
        Text(label, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
    }
}

/** «Сейчас слушает»: включить себе, реакция, позвать в комнату */
@Composable
private fun NowCard(model: AppModel, pp: PublicProfile, now: org.nyao.music.data.FriendNow) {
    val room by Together.room.collectAsState()
    Column(
        Modifier.padding(16.dp).fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(Brush.linearGradient(listOf(NyaoColors.Hero, NyaoColors.S2))).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(if (now.playing) "СЕЙЧАС СЛУШАЕТ" else "СЛУШАЛ ${ago(now.updatedAt).uppercase()}", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Lavender)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Cover(now.track.cover, Modifier.size(64.dp), RoundedCornerShape(16.dp))
            Column(Modifier.weight(1f)) {
                Text(now.track.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(now.track.artist, style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = { PlayerConnection.playList(listOf(now.track), 0, "Как у @${pp.user.nick}") }) { Icon(NyaoIcons.PlayArrow, "Включить себе") }
        }
        if (pp.relation == "friends") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                REACTIONS.forEach { e ->
                    Box(
                        Modifier.size(40.dp).bouncy().clip(CircleShape).background(Color.White.copy(alpha = 0.08f)).clickable {
                            model.launch { runCatching { Repo.cloud.reactToFriend(pp.user.id, e, now.track) }.onSuccess { model.message("Реакция отправлена $e") }.onFailure { model.message(it.message ?: "Не получилось") } }
                        },
                        contentAlignment = Alignment.Center,
                    ) { Text(e, fontSize = 18.sp) }
                }
            }
            FilledTonalButton(onClick = {
                model.launch {
                    runCatching {
                        if (Together.room.value == null) Together.create()
                        Repo.cloud.inviteToRoom(pp.user.id)
                    }.onSuccess { model.message("${pp.user.display} получит приглашение в комнату") }.onFailure { model.message(it.message ?: "Не получилось") }
                }
            }, modifier = Modifier.fillMaxWidth()) {
                Icon(NyaoIcons.Groups, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(if (room != null) "Позвать в мою комнату" else "Создать комнату и позвать")
            }
        }
    }
}

@Composable
private fun UserMenu(model: AppModel, pp: PublicProfile, onChanged: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(NyaoIcons.MoreVert, "Ещё") }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            if (pp.relation == "friends") DropdownMenuItem(text = { Text("Удалить из друзей") }, leadingIcon = { Icon(NyaoIcons.PersonRemove, null) }, onClick = {
                open = false
                model.launch { runCatching { Repo.cloud.removeFriend(pp.user.id) }; Friends.refreshAsync(); onChanged() }
            })
            if (pp.relation == "blocked") DropdownMenuItem(text = { Text("Разблокировать") }, onClick = {
                open = false
                model.launch { runCatching { Repo.cloud.unblock(pp.user.id) }; onChanged() }
            }) else DropdownMenuItem(text = { Text("Заблокировать") }, leadingIcon = { Icon(NyaoIcons.Block, null) }, onClick = {
                open = false
                model.launch { runCatching { Repo.cloud.block(pp.user.id) }.onSuccess { model.message("Пользователь заблокирован") }; Friends.refreshAsync(); onChanged() }
            })
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Редактирование профиля и приватность (Профиль → Мой профиль)
// ---------------------------------------------------------------------------------------------

@Composable
fun EditProfileCard(model: AppModel) {
    val profile by Friends.profile.collectAsState()
    LaunchedEffect(Unit) { runCatching { Friends.setProfile(Repo.cloud.profile()) } }
    val p = profile
    if (!Repo.cloud.loggedIn) {
        Hint("Профиль и друзья работают через аккаунт Nyao (вход через Telegram).")
        return
    }
    if (p == null) {
        Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = NyaoColors.Lavender) }
        return
    }
    var nick by remember(p.nick) { mutableStateOf(p.nick) }
    var bio by remember(p.bio) { mutableStateOf(p.bio) }
    var nickError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(nick) {
        nickError = null
        if (nick.equals(p.nick, ignoreCase = true)) return@LaunchedEffect
        delay(400)
        nickError = runCatching { Repo.cloud.checkNick(nick) }.getOrNull()
    }
    fun save(changes: JSONObject, ok: String? = null) {
        model.launch {
            runCatching { Repo.cloud.updateProfile(changes) }
                .onSuccess { Friends.setProfile(it); ok?.let { m -> model.message(m) } }
                .onFailure { model.message(it.message ?: "Не получилось сохранить") }
        }
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            NyaoAvatar(size = 64)
            Column(Modifier.weight(1f)) {
                Text(Repo.cloud.user.collectAsState().value?.name ?: "", style = MaterialTheme.typography.titleMedium)
                Text("Фото и имя — из Telegram", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            }
        }
        OutlinedTextField(
            value = nick, onValueChange = { nick = it.take(24).filter { c -> c.isLetterOrDigit() || c == '_' || c == '.' } },
            label = { Text("Ник") }, prefix = { Text("@") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
            isError = nickError != null, supportingText = { Text(nickError ?: "Латиница, цифры, точка и _ · по нему тебя найдут") },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
            shape = RoundedCornerShape(18.dp),
        )
        OutlinedTextField(
            value = bio, onValueChange = { bio = it.take(160) },
            label = { Text("О себе") }, modifier = Modifier.fillMaxWidth(), maxLines = 3,
            supportingText = { Text("${bio.length}/160") }, shape = RoundedCornerShape(18.dp),
        )
        Button(
            onClick = { save(JSONObject().put("nick", nick).put("bio", bio), "Профиль сохранён") },
            enabled = nickError == null && (nick != p.nick || bio != p.bio || !p.nickSet),
        ) { Text("Сохранить") }
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Кто видит профиль", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("all" to "Все", "friends" to "Друзья", "nobody" to "Никто").forEach { (id, label) ->
                org.nyao.music.ui.components.PillChip(label, p.visibility == id, { save(JSONObject().put("visibility", id)) })
            }
        }
        Text(
            when (p.visibility) {
                "all" -> "Профиль и статистику видят все, кто тебя найдёт. Что ты слушаешь сейчас — только друзья."
                "nobody" -> "Тебя находят только по точному нику, профиль закрыт даже для друзей."
                else -> "Профиль открыт только друзьям. Остальные видят ник и аватар."
            },
            style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted,
        )
        PrivacySwitch("Показывать, что слушаю сейчас", "Друзья видят трек в реальном времени", p.showNow) { save(JSONObject().put("showNow", it)) }
        PrivacySwitch("Показывать статистику", "Минуты, любимые исполнители и треки за месяц", p.showStats) { save(JSONObject().put("showStats", it)) }
        PrivacySwitch("Невидимка", "Пока включено, никто не видит, что ты слушаешь", p.invisible) { save(JSONObject().put("invisible", it), if (it) "Невидимка включена" else null) }
    }
    BlockedList(model)
}

@Composable
private fun PrivacySwitch(title: String, hint: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        }
        Switch(checked = on, onCheckedChange = onChange)
    }
}

@Composable
private fun BlockedList(model: AppModel) {
    var list by remember { mutableStateOf<List<UserCard>>(emptyList()) }
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(tick) { list = runCatching { Repo.cloud.blocked() }.getOrDefault(emptyList()) }
    if (list.isEmpty()) return
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Заблокированные", style = MaterialTheme.typography.titleSmall)
        list.forEach { u ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                UserAvatar(u, 36)
                Text(u.display, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                TextButton(onClick = { model.launch { runCatching { Repo.cloud.unblock(u.id) }; tick++ } }) { Text("Разблокировать") }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Первый вход: выбрать ник
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NickSetupSheet(model: AppModel, onDone: () -> Unit) {
    val p by Friends.profile.collectAsState()
    val suggested = remember(p) {
        val name = Repo.cloud.user.value?.username ?: ""
        name.lowercase().filter { it.isLetterOrDigit() && it.code < 128 || it == '_' || it == '.' }.take(24)
    }
    var nick by remember { mutableStateOf(suggested) }
    var error by remember { mutableStateOf<String?>(null) }
    var checking by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    LaunchedEffect(nick) {
        error = null
        if (nick.length < 3) return@LaunchedEffect
        checking = true
        delay(400)
        error = runCatching { Repo.cloud.checkNick(nick) }.getOrNull()
        checking = false
    }
    ModalBottomSheet(onDismissRequest = onDone) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 28.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            NyaoAvatar(size = 72)
            Text("Придумай ник", style = MaterialTheme.typography.headlineSmall)
            Text("По нику тебя найдут друзья. Его можно поменять потом в профиле.", style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted)
            OutlinedTextField(
                value = nick, onValueChange = { nick = it.take(24).lowercase().filter { c -> (c.isLetterOrDigit() && c.code < 128) || c == '_' || c == '.' } },
                prefix = { Text("@") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                isError = error != null,
                supportingText = { Text(error ?: if (checking) "Проверяю…" else if (nick.length >= 3) "Свободен" else "Минимум 3 символа") },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                shape = RoundedCornerShape(18.dp),
            )
            Button(
                onClick = {
                    saving = true
                    model.launch {
                        runCatching { Repo.cloud.updateProfile(JSONObject().put("nick", nick)) }
                            .onSuccess { Friends.setProfile(it); model.message("Привет, @${it.nick}!"); onDone() }
                            .onFailure { error = it.message }
                        saving = false
                    }
                },
                enabled = nick.length >= 3 && error == null && !checking && !saving,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("Готово") }
            TextButton(onClick = onDone, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Позже — останется @${p?.nick ?: "user_…"}") }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Отправить трек другу
// ---------------------------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FriendPickerSheet(model: AppModel, track: Track, onClose: () -> Unit) {
    val friends by Friends.friends.collectAsState()
    var emoji by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { Friends.refresh() } }
    ModalBottomSheet(onDismissRequest = onClose) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Cover(track.cover, Modifier.size(52.dp), RoundedCornerShape(14.dp))
                Column(Modifier.weight(1f)) {
                    Text("Отправить другу", style = MaterialTheme.typography.titleMedium)
                    Text("${track.artist} — ${track.title}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                REACTIONS.forEach { e ->
                    Box(
                        Modifier.size(42.dp).bouncy().clip(CircleShape).background(if (emoji == e) NyaoColors.Tonal else NyaoColors.S2)
                            .then(if (emoji == e) Modifier.border(2.dp, NyaoColors.Lavender, CircleShape) else Modifier)
                            .clickable { emoji = if (emoji == e) null else e },
                        contentAlignment = Alignment.Center,
                    ) { Text(e, fontSize = 18.sp) }
                }
            }
            if (friends.isEmpty()) Text("Сначала добавь друзей — во вкладке «Вместе»", style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted)
            friends.forEach { f ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).clickable {
                        model.launch {
                            runCatching { Repo.cloud.shareTrack(f.user.id, track, emoji) }
                                .onSuccess { model.message("Отправлено ${f.user.display}") }
                                .onFailure { model.message(it.message ?: "Не получилось") }
                        }
                        onClose()
                    }.padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    UserAvatar(f.user, 40)
                    Text(f.user.display, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Icon(NyaoIcons.Send, "Отправить", tint = NyaoColors.Lavender)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Всплывашки сверху: заявки, приглашения в комнату, треки и реакции
// ---------------------------------------------------------------------------------------------

@Composable
fun SocialBannerHost(model: AppModel, modifier: Modifier = Modifier) {
    var banner by remember { mutableStateOf<SocialBanner?>(null) }
    LaunchedEffect(Unit) {
        Friends.banners.collect { b ->
            banner = b
        }
    }
    LaunchedEffect(banner?.id) {
        if (banner != null) {
            delay(6000)
            banner = null
        }
    }
    AnimatedVisibility(banner != null, modifier = modifier, enter = slideInVertically { -it } + fadeIn(), exit = slideOutVertically { -it } + fadeOut()) {
        val b = banner ?: return@AnimatedVisibility
        Row(
            Modifier.statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp).widthIn(max = 560.dp).fillMaxWidth()
                .clip(RoundedCornerShape(28.dp)).background(NyaoColors.S3)
                .clickable {
                    banner = null
                    when {
                        b.kind == "room" && b.code != null -> model.launch {
                            runCatching { Together.join(b.code) }.onSuccess { model.go(Route.Together) }.onFailure { model.message(it.message ?: "Комната уже закрыта") }
                        }
                        b.track != null -> PlayerConnection.playList(listOf(b.track), 0, "От ${b.user?.display ?: "друга"}")
                        b.user != null -> model.go(Route.UserPage(b.user.id))
                        else -> model.go(Route.Together)
                    }
                }
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (b.track != null) Cover(b.track.cover, Modifier.size(44.dp), RoundedCornerShape(12.dp)) else UserAvatar(b.user, 44)
            Column(Modifier.weight(1f)) {
                Text(b.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (b.body.isNotBlank()) Text(b.body, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text(
                when (b.kind) {
                    "room" -> "Войти"
                    "track" -> "Слушать"
                    "friend-request" -> "Открыть"
                    else -> ""
                },
                style = MaterialTheme.typography.labelLarge, color = NyaoColors.Lavender, modifier = Modifier.padding(end = 6.dp),
            )
        }
    }
}
