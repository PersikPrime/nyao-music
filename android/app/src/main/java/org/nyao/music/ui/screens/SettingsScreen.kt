package org.nyao.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.nyao.music.BuildConfig
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.SOURCE_YT
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.NyaoWaves
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.components.sourceColor
import org.nyao.music.ui.theme.NyaoColors

// ======================= Профиль (вместо вкладки «Настройки») =======================

/**
 * Профиль: карточка аккаунта Nyao и все настройки списком разделов, как в Android 16.
 * part: "all" — всё вместе; "profile" — только профиль (настройки вынесены кнопкой); "prefs" — только настройки
 */
@Composable
fun ProfileScreen(model: AppModel, part: String = "all") {
    val user by Repo.cloud.user.collectAsState()
    val accounts by Repo.accounts.collectAsState()
    val s by Repo.prefs.settings.collectAsState()
    val lf by Repo.lastfm.state.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 16.dp).padding(top = 12.dp).padding(BottomInset),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        if (part == "prefs") Text("Настройки", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
        // Карточка профиля: нажатие открывает свою страницу профиля (её видят друзья)
        val social by org.nyao.music.playback.Friends.profile.collectAsState()
        if (part != "prefs") {
        androidx.compose.runtime.LaunchedEffect(user) { if (user != null) runCatching { org.nyao.music.playback.Friends.refresh() } }
        Column(
            Modifier.fillMaxWidth().bouncy(0.97f).clip(RoundedCornerShape(32.dp)).background(MaterialTheme.colorScheme.surfaceContainer)
                .clickable(enabled = user != null) { model.go(Route.UserPage("")) }.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                NyaoAvatar(size = 76, shape = org.nyao.music.ui.components.PolarShape(9, 0.06f))
                Column(Modifier.weight(1f).padding(start = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(user?.name ?: "Аккаунт Nyao", style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    Text(
                        when {
                            user != null -> social?.nick?.let { "@$it" } ?: user?.username?.let { "@$it" } ?: "синхронизация включена"
                            model.cloudLogging -> "Подтверди вход в Telegram"
                            else -> "Войди, чтобы история и миксы были везде"
                        },
                        style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, maxLines = 1,
                    )
                    val connected = org.nyao.music.data.ALL_SOURCES.filter { accounts[it] != null }
                    if (connected.isNotEmpty()) Row(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        connected.forEach { ServiceLogo(it, size = 24) }
                    }
                }
            }
            if (user == null) {
                if (model.cloudLogging) {
                    OutlinedButton(onClick = { model.cancelCloudLogin() }, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Отменить вход") }
                } else {
                    Button(
                        onClick = { model.cloudLogin(context) },
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Color(0xFF2AABEE), contentColor = Color.White),
                    ) { Text("Войти через Telegram") }
                }
            }
        }

        SettingsGroup("Профиль") {
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.BarChart, "Статистика") { model.go(Route.Stats) }
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Devices, "Устройства") { model.connectOpen = true }
            if (user != null) SettingsRow(org.nyao.music.ui.components.NyaoIcons.Edit, "Мой профиль и приватность", social?.let { if (it.invisible) "невидимка" else when (it.visibility) { "all" -> "видят все"; "nobody" -> "скрыт"; else -> "только друзья" } }) { model.go(Route.SettingsPage("profile")) }
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Person, "Аккаунт Nyao", if (user != null) "вход выполнен" else "не выполнен", last = true) { model.go(Route.SettingsPage("account")) }
        }
        }
        if (part == "profile") SettingsGroup("Настройки") {
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Settings, "Все настройки", last = true) { model.go(Route.AppSettings) }
        }
        if (part != "profile") {
        SettingsGroup("Приложение") {
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Equalizer, "Звук и воспроизведение", if (s.eqOn) "эквалайзер вкл." else null) { model.go(Route.SettingsPage("sound")) }
            // настройки волны живут на экране «Моя волна» — здесь их больше нет
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.FormatQuote, "Текст песни", org.nyao.music.data.LyricsApi.order(s.lyricsOrder).firstOrNull { it.second }?.let { org.nyao.music.data.LyricsApi.PROVIDER_NAMES[it.first] }) { model.go(Route.SettingsPage("lyrics")) }
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Database, "Офлайн и кэш", last = true) { model.go(Route.SettingsPage("cache")) }
        }
        SettingsGroup("Оформление") {
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Palette, "Тема и сетка", org.nyao.music.ui.theme.UiLook.themes.firstOrNull { it.first == s.theme }?.second) { model.go(Route.SettingsPage("theme")) }
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Home, "Вид главной", if (s.isWaveLayout) "Моя волна" else "Плеер") { model.go(Route.SettingsPage("view")) }
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Widgets, "Стиль виджетов", if (s.widgetStyle == "auto") "как тема" else org.nyao.music.playback.WidgetStyle.of(s.widgetStyle, s.theme).title, last = true) { model.go(Route.SettingsPage("widgets")) }
        }
        SettingsGroup("Сервисы") {
            val list = listOf(SOURCE_YA, SOURCE_YT, org.nyao.music.data.SOURCE_SC, org.nyao.music.data.SOURCE_VK, org.nyao.music.data.SOURCE_SP)
            list.forEachIndexed { i, src ->
                SettingsRow(null, org.nyao.music.data.sourceName(src), if (accounts[src] != null) "подключено" else "войти", leading = { ServiceLogo(src, size = 26) }, valueOk = accounts[src] != null, last = i == list.lastIndex) {
                    model.go(Route.SettingsPage("svc:$src"))
                }
            }
        }
        SettingsGroup("Интеграции") {
            SettingsRow(null, "Last.fm", lf.name ?: if (lf.configured) "подключить" else "выключен", leading = {
                Box(Modifier.size(26.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFFD51007)), contentAlignment = Alignment.Center) { Text("fm", color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall) }
            }, valueOk = lf.name != null, last = true) { model.go(Route.SettingsPage("lastfm")) }
        }
        if (user?.dev == true) SettingsGroup("Разработчик") {
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Code, "Разработчик", "тесты и диагностика", last = true) { model.go(Route.SettingsPage("dev")) }
        }
        SettingsGroup("Другое") {
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Refresh, "Обновления", BuildConfig.VERSION_NAME) { model.go(Route.SettingsPage("updates")) }
            SettingsRow(org.nyao.music.ui.components.NyaoIcons.Info, "О приложении") { model.go(Route.SettingsPage("about")) }
            if (user != null) SettingsRow(org.nyao.music.ui.components.NyaoIcons.Logout, "Выйти из аккаунта Nyao", danger = true, last = true, chevron = false) { model.cloudLogout() }
            else SettingsRow(org.nyao.music.ui.components.NyaoIcons.Refresh, "Показать приветствие снова", last = true, chevron = false) { Repo.prefs.setOnboarded(false) }
        }
        Text(
            "Токены Яндекса, YouTube, SoundCloud, VK и Spotify остаются только на этом телефоне.",
            style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, modifier = Modifier.padding(horizontal = 8.dp),
        )
        }
    }
}

@Composable
private fun SettingsGroup(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.labelLarge, color = NyaoColors.Muted, modifier = Modifier.padding(start = 8.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer)) { content() }
    }
}

@Composable
private fun SettingsRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector?,
    title: String,
    value: String? = null,
    leading: (@Composable () -> Unit)? = null,
    valueOk: Boolean = false,
    danger: Boolean = false,
    chevron: Boolean = true,
    last: Boolean = false,
    onClick: () -> Unit,
) {
    Box {
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 60.dp).padding(horizontal = 18.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) {
                when {
                    leading != null -> leading()
                    icon != null -> androidx.compose.material3.Icon(icon, null, tint = if (danger) Color(0xFFFF8A80) else NyaoColors.Muted, modifier = Modifier.size(24.dp))
                }
            }
            Text(title, style = MaterialTheme.typography.bodyLarge, color = if (danger) Color(0xFFFF8A80) else NyaoColors.Text, modifier = Modifier.weight(1f), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
            if (value != null) Text(value, style = MaterialTheme.typography.bodySmall, color = if (valueOk) Color(0xFF8FE3B0) else NyaoColors.Muted, maxLines = 1)
            if (chevron) androidx.compose.material3.Icon(org.nyao.music.ui.components.NyaoIcons.ChevronRight, null, tint = NyaoColors.Outline, modifier = Modifier.size(20.dp))
        }
        if (!last) Box(Modifier.align(Alignment.BottomEnd).padding(start = 60.dp).fillMaxWidth().height(1.dp).background(Color.White.copy(alpha = 0.06f)))
    }
}

private fun sectionTitle(section: String): String = when {
    section == "profile" -> "Мой профиль"
    section == "account" -> "Аккаунт Nyao"
    section == "sound" -> "Звук и воспроизведение"
    section == "wave" -> "Моя волна"
    section == "cache" -> "Офлайн и кэш"
    section == "view" -> "Вид главной"
    section == "theme" -> "Тема и сетка"
    section == "widgets" -> "Стиль виджетов"
    section == "lyrics" -> "Текст песни"
    section == "dev" -> "Разработчик"
    section == "lastfm" -> "Last.fm"
    section == "updates" -> "Обновления"
    section == "about" -> "О приложении"
    section.startsWith("svc:") -> org.nyao.music.data.sourceName(section.removePrefix("svc:"))
    else -> "Настройки"
}

/** Раздел настроек, открытый из профиля: заголовок с «назад» и знакомые карточки */
@Composable
fun SettingsPageScreen(model: AppModel, section: String) {
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.material3.IconButton(onClick = { model.back() }) {
                androidx.compose.material3.Icon(org.nyao.music.ui.components.NyaoIcons.ArrowBack, "Назад")
            }
            Text(sectionTitle(section), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(start = 4.dp))
        }
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 8.dp).padding(BottomInset),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            when {
                section == "profile" -> EditProfileCard(model)
                section == "account" -> NyaoAccountCard(model)
                section == "sound" -> EqCard(showTitle = false)
                section == "wave" -> WaveSettings(onChanged = { model.refreshWave() })
                section == "cache" -> StorageCard()
                section == "view" -> ViewSettingsCard()
                section == "theme" -> LookSettings()
                section == "widgets" -> WidgetStyleSettings()
                section == "lyrics" -> LyricsSettings()
                section == "dev" -> if (Repo.cloud.user.value?.dev == true) DevSettings()
                section == "lastfm" -> LastFmCard(model)
                section == "updates" -> UpdateCard(model, showTitle = false)
                section == "about" -> AboutCard()
                section == "svc:sp" -> SpotifyCard(model)
                section.startsWith("svc:") -> ServiceCard(model, section.removePrefix("svc:"))
            }
        }
    }
}

@Composable
private fun AboutCard() {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(NyaoColors.Ink), contentAlignment = Alignment.Center) {
                NyaoWaves(Modifier.size(40.dp), animate = false, strokeDp = 3.5f)
            }
            Column(Modifier.padding(start = 14.dp)) {
                Text("Nyao Music", style = MaterialTheme.typography.titleLarge)
                Text("версия ${BuildConfig.VERSION_NAME}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(
            "Сервисы подключены через неофициальные API — после их обновлений что-то может сломаться. Для личного пользования.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(onClick = { Repo.prefs.setOnboarded(false) }) { Text("Показать приветствие снова") }
    }
}

@Composable
private fun ServiceCard(model: AppModel, source: String) {
    val accounts by Repo.accounts.collectAsState()
    val acc = accounts[source]
    val ya = source == SOURCE_YA
    val isSc = source == org.nyao.music.data.SOURCE_SC
    val isVk = source == org.nyao.music.data.SOURCE_VK
    val scope = rememberCoroutineScope()
    var manual by remember { mutableStateOf(Repo.accounts.value[source] == null) }
    var vkLog by remember { mutableStateOf<String?>(null) }
    var value by remember { mutableStateOf("") }
    val color = org.nyao.music.ui.components.sourceColor(source)
    val name = org.nyao.music.data.sourceName(source)
    fun logout() {
        scope.launch {
            when {
                ya -> Repo.setYandexToken(null)
                isSc -> Repo.setScToken(null)
                isVk -> Repo.setVk(null, null)
                else -> Repo.setYtCookie(null)
            }
            // cookie только этого сервиса — чтобы не выкинуло из остальных
            if (isSc) Repo.clearCookies("https://soundcloud.com", "https://api-v2.soundcloud.com", "https://secure.soundcloud.com")
            else if (!ya && !isVk) Repo.clearCookies("https://music.youtube.com", "https://www.youtube.com", "https://youtube.com", "https://accounts.google.com", "https://www.google.com", "https://google.com")
            model.accountsChanged()
        }
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // Свечение цвета сервиса и большая карточка входа
        Box(Modifier.fillMaxWidth()) {
            Box(
                Modifier.matchParentSize().background(
                    androidx.compose.ui.graphics.Brush.radialGradient(listOf(color.copy(alpha = 0.35f), Color.Transparent)),
                ),
            )
            Column(
                Modifier.fillMaxWidth().padding(vertical = 18.dp).clip(RoundedCornerShape(32.dp)).background(MaterialTheme.colorScheme.surfaceContainer.copy(alpha = 0.85f)).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(76.dp).clip(org.nyao.music.ui.components.PolarShape(9, 0.06f)).background(color), contentAlignment = Alignment.Center) {
                    Text(org.nyao.music.ui.components.sourceShort(source), color = if (ya) Color.Black else Color.White, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleLarge)
                }
                Text(if (acc != null) "$name подключена" else "Войти в $name", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
                Text(
                    when {
                        acc != null -> "Вход выполнен: ${acc.name}" + (if (ya && acc.plus == false) " · без Плюса треки могут не играть" else if (isSc) " · треки Go+ пропускаются" else if (isVk) " · бета" else "")
                        ya -> "Лайки, плейлисты и «Моя волна» Яндекса. Один раз войти — дальше Nyao всё подхватит сам."
                        isSc -> "Лайки, плейлисты и похожие треки. Поиск работает и без входа."
                        isVk -> "Музыка VK через сайт vk.com — пока бета."
                        else -> "Лайки, плейлисты и радио YouTube Music."
                    },
                    style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                if (acc != null) {
                    OutlinedButton(onClick = { logout() }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(52.dp)) { Text("Выйти") }
                } else {
                    Button(
                        onClick = { model.loginFor = source },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(52.dp),
                        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black),
                    ) { Text("Войти в окне ${name.substringBefore(' ')}") }
                }
            }
        }
        val isYt = !ya && !isSc && !isVk
        if (isYt && acc != null) {
            // Отчёт о сбоях плейлистов: стек и структура ответа, без cookies
            TextButton(onClick = {
                vkLog = Repo.yt.diagFile?.takeIf { it.exists() }?.readText()?.takeLast(120_000)?.ifBlank { null } ?: "Сбоев YouTube пока не было."
            }) { Text("Плейлисты не открываются? Отчёт") }
        }
        if (isVk || isYt) {
            if (isVk) TextButton(onClick = { vkLog = Repo.vk.debugText().ifBlank { "Сбоев пока не было." } }) { Text("Что-то не работает?") }
            vkLog?.let { log ->
                val clip = androidx.compose.ui.platform.LocalClipboardManager.current
                androidx.compose.material3.AlertDialog(
                    onDismissRequest = { vkLog = null },
                    title = { Text(if (isVk) "Журнал VK" else "Отчёт YouTube") },
                    text = {
                        Text(
                            if (log.length > 20_000) "…" + log.takeLast(20_000) else log,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                        )
                    },
                    confirmButton = { TextButton(onClick = { clip.setText(androidx.compose.ui.text.AnnotatedString(log)); model.message("Скопировано") }) { Text("Скопировать") } },
                    dismissButton = { TextButton(onClick = { vkLog = null }) { Text("Закрыть") } },
                )
            }
            if (isVk) return@Column
        }
        if (!manual) TextButton(onClick = { manual = true }) {
            Text(if (ya) "Вставить OAuth-токен вручную" else if (isSc) "Вставить токен вручную (cookie oauth_token)" else "Вставить cookies вручную (если Google не пускает)")
        }
        if (manual) {
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f).height(1.dp).background(Color.White.copy(alpha = 0.08f)))
                Text("ИЛИ ВРУЧНУЮ", style = MaterialTheme.typography.labelSmall, color = NyaoColors.Muted)
                Box(Modifier.weight(1f).height(1.dp).background(Color.White.copy(alpha = 0.08f)))
            }
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text(if (ya) "y0_AgAAAA…" else if (isSc) "2-123456-…" else "SAPISID=…; __Secure-3PAPISID=…; …") },
                shape = RoundedCornerShape(16.dp),
                minLines = if (ya || isSc) 1 else 3,
            )
            FilledTonalButton(onClick = {
                scope.launch {
                    when {
                        ya -> Repo.setYandexToken(value)
                        isSc -> Repo.setScToken(value)
                        else -> Repo.setYtCookie(value)
                    }
                    value = ""
                    manual = false
                    model.accountsChanged()
                    model.message("Сохранено")
                }
            }, enabled = value.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Сохранить") }
            Text("Токен хранится только на этом телефоне — на сервер Nyao он не уходит.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            if (!ya && !isSc) Text(
                "Cookies можно скопировать из десктопной версии Nyao или из браузера, где ты вошёл в music.youtube.com (нужны SAPISID и __Secure-3PSID).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun ServiceLogo(source: String, size: Int = 48) {
    val ya = source == SOURCE_YA
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size / 3.5f).dp)).background(sourceColor(source)), contentAlignment = Alignment.Center) {
        Text(org.nyao.music.ui.components.sourceShort(source), color = if (ya || source == org.nyao.music.data.SOURCE_SP) Color.Black else Color.White, fontWeight = FontWeight.Bold)
    }
}

/** Last.fm: подключение через подтверждение в браузере */
@Composable
private fun LastFmCard(model: AppModel) {
    val st by Repo.lastfm.state.collectAsState()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFD51007)), contentAlignment = Alignment.Center) {
            Text("fm", color = Color.White, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text("Last.fm", style = MaterialTheme.typography.titleMedium)
            Text(
                when {
                    !st.configured -> "В этой сборке Last.fm выключен"
                    st.waiting -> "Подтверди доступ на странице Last.fm…"
                    st.name != null -> "Подключено: ${st.name}" + (if (st.queued > 0) " · ждут отправки: ${st.queued}" else "")
                    else -> "Записывает прослушанное из всех сервисов в твой профиль"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        when {
            !st.configured -> Unit
            st.waiting -> OutlinedButton(onClick = { Repo.lastfm.cancel() }) { Text("Отмена") }
            st.name != null -> OutlinedButton(onClick = { Repo.lastfm.disconnect(); model.message("Last.fm отключён") }) { Text("Отключить") }
            else -> Button(onClick = {
                scope.launch {
                    try {
                        val name = Repo.lastfm.connect { url ->
                            runCatching { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        }
                        model.message("Last.fm подключён: $name")
                    } catch (e: Exception) {
                        if (e !is kotlinx.coroutines.CancellationException) model.message(e.message ?: "Не получилось подключить Last.fm")
                    }
                }
            }) { Text("Подключить") }
        }
    }
}

/** Эквалайзер: пресеты и 10 полос, как на ПК. Работает через системный эквалайзер телефона */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun EqCard(showTitle: Boolean = true) {
    val s by Repo.prefs.settings.collectAsState()
    if (showTitle) Text("Звук", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Выравнивать громкость", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Треки из разных сервисов звучат одинаково громко — по данным Яндекса и YouTube. SoundCloud и VK такие данные не дают.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            androidx.compose.material3.Switch(checked = s.normalize, onCheckedChange = { Repo.prefs.setNormalize(it) })
        }
        Column {
            Text("Плавные переходы", style = MaterialTheme.typography.titleSmall)
            Text(
                if (s.fade > 0) "Трек затихает за ${s.fade} с до конца, следующий плавно нарастает" else "Выключены — треки сменяются сразу",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            androidx.compose.material3.Slider(
                value = s.fade.toFloat(),
                onValueChange = { v -> Math.round(v).let { if (it != s.fade) Repo.prefs.setFade(it) } },
                valueRange = 0f..10f,
                steps = 9,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Продолжать похожим", style = MaterialTheme.typography.titleSmall)
                Text("Плейлист или альбом доиграл — дальше без паузы идёт радио по последнему треку", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            androidx.compose.material3.Switch(checked = s.continueSimilar, onCheckedChange = { Repo.prefs.setContinueSimilar(it) })
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Трек из поиска", style = MaterialTheme.typography.titleSmall)
            Text(
                if (s.searchPlay == "similar") "Играет он, а дальше — похожее на него, как в Яндексе" else "После него играют остальные найденные треки",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                org.nyao.music.ui.components.PillChip("Дальше похожее", s.searchPlay == "similar", { Repo.prefs.setSearchPlay("similar") })
                org.nyao.music.ui.components.PillChip("Весь поиск", s.searchPlay == "list", { Repo.prefs.setSearchPlay("list") })
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Эквалайзер", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Настраивает звук всех сервисов. Выключен — звук без изменений.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            androidx.compose.material3.Switch(checked = s.eqOn, onCheckedChange = { Repo.prefs.setEq(it, s.eqPreset, s.eqGains) })
        }
        if (s.eqOn) {
            androidx.compose.foundation.layout.FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                org.nyao.music.playback.EqPresets.ALL.forEach { (id, name, gains) ->
                    org.nyao.music.ui.components.PillChip(name, s.eqPreset == id, { Repo.prefs.setEq(true, id, gains) })
                }
                if (s.eqPreset == "custom") org.nyao.music.ui.components.PillChip("Свой", true, {})
            }
            org.nyao.music.playback.EqPresets.BANDS.forEachIndexed { i, hz ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        org.nyao.music.playback.EqPresets.label(hz),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(width = 40.dp, height = 20.dp),
                    )
                    androidx.compose.material3.Slider(
                        value = s.eqGains[i].toFloat(),
                        onValueChange = { v ->
                            val g = s.eqGains.toMutableList().also { it[i] = Math.round(v) }
                            if (g != s.eqGains) Repo.prefs.setEq(true, "custom", g)
                        },
                        valueRange = -12f..12f,
                        steps = 23,
                        modifier = Modifier.weight(1f),
                    )
                    val g = s.eqGains[i]
                    Text(
                        (if (g > 0) "+" else "") + g,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(start = 8.dp).size(width = 32.dp, height = 20.dp),
                    )
                }
            }
        }
    }
}

/** Кэш прослушанного: сколько занято и кнопка очистки */
@Composable
private fun CacheCard(showTitle: Boolean = true) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var used by remember { mutableStateOf<Long?>(null) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        used = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { org.nyao.music.playback.PlaybackCache.sizeBytes(context) }
    }
    if (showTitle) Text("Кэш", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val mb = (used ?: 0L) / (1024 * 1024)
        Text(if (used == null) "Считаю…" else "Занято $mb МБ из ${org.nyao.music.playback.PlaybackCache.MAX_BYTES / (1024 * 1024)} МБ", style = MaterialTheme.typography.titleSmall)
        Text(
            "Прослушанные треки сохраняются на телефон: повторно они играют с диска и без интернета. Старые удаляются сами, когда место кончается.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = {
            scope.launch {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { org.nyao.music.playback.PlaybackCache.clear(context) }
                used = 0L
            }
        }, enabled = (used ?: 0L) > 0L) { Text("Очистить кэш") }
    }
}

/**
 * Центр обновлений: сравнивает номер сборки с последним релизом на GitHub.
 * APK скачивается браузером — после загрузки Android сам предложит установить его поверх.
 */
@Composable
private fun UpdateCard(model: AppModel, showTitle: Boolean = true) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    var info by remember { mutableStateOf<org.nyao.music.data.UpdateInfo?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    fun check() {
        checking = true
        error = null
        scope.launch {
            try {
                info = org.nyao.music.data.Updates.check(BuildConfig.VERSION_CODE)
            } catch (e: Exception) {
                error = e.message
            }
            checking = false
        }
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { check() }
    if (showTitle) Text("Обновления", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val i = info
        Text(
            when {
                checking -> "Проверяю обновления…"
                error != null -> "Не получилось: $error"
                i != null && i.available -> "Доступна версия ${i.label} · ${i.apkSize / (1024 * 1024)} МБ"
                i != null -> "Установлена последняя версия" + (i.label?.let { " ($it)" } ?: "")
                else -> "Сейчас: ${BuildConfig.VERSION_NAME}"
            },
            style = MaterialTheme.typography.titleSmall,
        )
        Text("Сейчас установлена ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Канал обновлений — как в центре обновлений macOS
        val channel = Repo.prefs.settings.collectAsState().value.let { org.nyao.music.data.Updates.channel() }
        Text("Канал обновлений", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            org.nyao.music.data.Updates.CHANNELS.forEach { (id, label) ->
                val on = id == channel
                androidx.compose.material3.FilterChip(
                    selected = on,
                    onClick = {
                        if (!on) {
                            Repo.prefs.setUpdateChannel(id)
                            check()
                        }
                    },
                    label = { Text(label, maxLines = 1) },
                )
            }
        }
        Text(
            when (channel) {
                "dev" -> "Бета: новое раньше всех, иногда с недочётами. Если обычный релиз новее — придёт он."
                "nightly" -> "Ночные сборки: эксперименты прямо из разработки, могут ломаться."
                else -> "Проверенные релизы."
            } + if (i != null && !i.available && i.build in 1 until BuildConfig.VERSION_CODE) " Версия в этом канале старше установленной — обновление придёт, когда канал её догонит." else "",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (i != null && i.available && i.notes.isNotBlank()) {
            Text(i.notes.take(400), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (i != null && i.available && i.apkUrl != null) {
                Button(onClick = {
                    context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(i.apkUrl)))
                    model.message("APK скачивается в браузере — открой его, чтобы установить")
                }) { Text("Скачать ${i.label}") }
            } else {
                OutlinedButton(onClick = { check() }, enabled = !checking) { Text("Проверить") }
            }
            if (i?.pageUrl != null) TextButton(onClick = {
                context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(i.pageUrl)))
            }) { Text("Релизы") }
        }
    }
}
