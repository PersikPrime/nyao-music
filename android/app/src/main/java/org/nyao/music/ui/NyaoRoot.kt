package org.nyao.music.ui

import androidx.compose.foundation.layout.widthIn

import androidx.compose.ui.input.pointer.pointerInput

import androidx.compose.foundation.gestures.detectVerticalDragGestures

import org.nyao.music.ui.components.NyaoIcons

import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.graphics.drawscope.clipRect

import androidx.compose.ui.layout.onGloballyPositioned

import androidx.compose.ui.graphics.layer.drawLayer

import androidx.compose.ui.draw.blur
import androidx.compose.ui.input.nestedscroll.nestedScroll

import androidx.compose.ui.draw.drawWithContent

import androidx.compose.runtime.mutableStateOf

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.core.spring
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.components.appear
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.nyao.music.data.Repo
import org.nyao.music.playback.PlaybackEvents
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.WavyProgress
import org.nyao.music.ui.components.rememberCoverPalette
import org.nyao.music.ui.theme.NyaoColors
import org.nyao.music.ui.screens.HomeScreen
import org.nyao.music.ui.screens.LibraryScreen
import org.nyao.music.ui.screens.LoginScreen
import org.nyao.music.ui.screens.NowPlayingScreen
import org.nyao.music.ui.screens.OnboardingScreen
import org.nyao.music.ui.screens.PlaylistScreen
import org.nyao.music.ui.screens.SearchScreen
import org.nyao.music.ui.screens.WaveScreen

/** Порядок экранов для направления анимации: вкладки слева направо, страницы плейлистов — «глубже» */
private fun routeOrder(r: Route): Int = when (r) {
    Route.Home -> 0
    Route.Wave -> 1
    Route.Library -> 2
    Route.Search -> 3
    Route.Settings -> 4
    Route.Together -> 5
    is Route.PlaylistPage -> 6
    is Route.ArtistPage -> 7
    Route.Stats -> 8
    is Route.SettingsPage -> 9
    is Route.UserPage -> 10
}

/** icon — обычная (контурная), iconOn — залитая для выбранной вкладки, как в Material 3 Expressive */
private data class Tab(val route: Route, val label: String, val icon: ImageVector, val iconOn: ImageVector = icon)

private val HOME_TAB = Tab(Route.Home, "Главная", NyaoIcons.Home, NyaoIcons.HomeFilled)
private val WAVE_TAB = Tab(Route.Wave, "Волна", NyaoIcons.Waves, NyaoIcons.WavesFilled)
private val LIBRARY_TAB = Tab(Route.Library, "Медиатека", NyaoIcons.LibraryMusic, NyaoIcons.LibraryMusicFilled)
private val SEARCH_TAB = Tab(Route.Search, "Поиск", NyaoIcons.Search)
private val PROFILE_TAB = Tab(Route.Settings, "Профиль", NyaoIcons.Person, NyaoIcons.PersonFilled)
private val TOGETHER_TAB = Tab(Route.Together, "Вместе", NyaoIcons.Groups, NyaoIcons.GroupsFilled)

/** Основная панель: Главная · (Волна) · Медиатека · Поиск · аватар профиля */
private fun tabsFor(s: org.nyao.music.data.Settings): List<Tab> =
    listOf(HOME_TAB) + (if (s.isWaveLayout || s.waveTab) listOf(WAVE_TAB) else emptyList()) + listOf(LIBRARY_TAB, SEARCH_TAB, PROFILE_TAB)

/** Раздел профиля: панель превращается в «домой» отдельной кнопкой + профиль и «Вместе» */
private fun isProfileArea(r: Route): Boolean = r == Route.Settings || r == Route.Together || r == Route.Stats || r is Route.SettingsPage || r is Route.UserPage

@Composable
fun NyaoRoot() {
    val scope = rememberCoroutineScope()
    val model = remember { AppModel(scope) }
    val settings by Repo.prefs.settings.collectAsState()
    var toast by remember { mutableStateOf<Toast?>(null) }
    var requiredUpdate by remember { mutableStateOf<org.nyao.music.data.UpdateInfo?>(null) }
    val outdated by Repo.cloud.outdated.collectAsState()

    LaunchedEffect(Unit) {
        Repo.refreshAccounts()
        // «Мои исполнители» из Яндекса — один раз в любимые (для подмеса волны)
        launch { runCatching { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Repo.importYaArtists() } } }
        // Тихая проверка обновлений при запуске (после того, как начали слушать сообщения)
        launch {
            delay(60_000)
            while (true) {
                runCatching { Repo.flushScLikes() }
                delay(10 * 60_000L)
            }
        }
        // аккаунт Nyao: дослать историю, накопленную офлайн
        launch {
            delay(5000)
            // сверка с сервером: история, настройки волны, вид приложения, миксы — и потом раз в 5 минут
            while (true) {
                runCatching { kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { Repo.syncCloud() } }
                delay(5 * 60_000L)
            }
        }
        // техработы и сбои сервисов: сразу и потом раз в 2 минуты
        launch {
            var wasDown = false
            while (true) {
                val s = Repo.refreshStatus()
                if (s != null) {
                    if (s.maintenance.active && !wasDown) org.nyao.music.playback.PlayerConnection.pauseIfPlaying()
                    if (!s.maintenance.active && wasDown) PlaybackEvents.emit("Nyao снова работает")
                    wasDown = s.maintenance.active
                }
                delay(2 * 60_000L)
            }
        }
        launch {
            delay(3000)
            runCatching { org.nyao.music.data.Updates.check(org.nyao.music.BuildConfig.VERSION_CODE) }.getOrNull()?.let { u ->
                if (u.required) requiredUpdate = u
                else if (u.available) PlaybackEvents.emit("Доступна Nyao Music ${u.label} — обновить можно в Настройках")
            }
        }
        // новое уведомление сразу заменяет старое (без очереди); одинаковое — просто продлевает показ
        var seq = 0L
        PlaybackEvents.messages.collect { text -> toast = Toast(text, ++seq) }
    }

    BackHandler(enabled = model.loginFor != null || model.nowPlayingOpen || model.stack.size > 1 || model.route != Route.Home) {
        model.back()
    }

    // Surface задаёт цвет текста по умолчанию (иначе Compose красит его в чёрный)
    // Glass: под полупрозрачными поверхностями — цветной фон из акцента
    val glass = org.nyao.music.ui.theme.Look.current.glass
    val rootBg = if (glass) Modifier.background(
        Brush.linearGradient(listOf(NyaoColors.Hero, Color(0xFF0E0C16), Color(0xFF0E0C16), NyaoColors.Primary.copy(alpha = 0.85f))),
    ) else Modifier
    Surface(Modifier.fillMaxSize().then(rootBg), color = if (glass) Color.Transparent else MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
    Box(Modifier.fillMaxSize()) {
        if (!settings.onboarded) {
            OnboardingScreen(model)
        } else {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                if (maxWidth >= 600.dp) WideLayout(model, showPane = maxWidth >= 840.dp) else PhoneLayout(model)
            }
        }

        // Окно входа поверх всего (и в приветствии, и в настройках)
        AnimatedVisibility(model.loginFor != null, enter = fadeIn(), exit = fadeOut()) {
            val svc = model.loginFor
            if (svc != null) LoginScreen(svc, onClose = { ok ->
                model.loginFor = null
                if (ok) model.accountsChanged()
            })
        }

        // проверка SoundCloud (капча): после неё досылаем отложенные лайки
        val captcha by Repo.sc.captcha.collectAsState()
        captcha?.let { url ->
            org.nyao.music.ui.screens.ScCaptchaScreen(url) { ok ->
                Repo.sc.captcha.value = null
                if (ok) scope.launch {
                    runCatching { Repo.flushScLikes() }
                    PlaybackEvents.emit("Проверка пройдена — лайки SoundCloud отправлены")
                }
            }
        }

        // техработы — заглушка поверх всего (скачанное слушать можно)
        val svc by Repo.status.collectAsState()
        AnimatedVisibility(svc.maintenance.active, enter = fadeIn(), exit = fadeOut()) {
            org.nyao.music.ui.screens.MaintenanceScreen(model)
        }

        TopToast(toast, onDismiss = { toast = null }, modifier = Modifier.align(Alignment.TopCenter))

        // ---- друзья: всплывашки, «отправить другу», ник при первом входе, ссылки-приглашения ----
        org.nyao.music.ui.screens.SocialBannerHost(model, Modifier.align(Alignment.TopCenter))
        val shareTrack by org.nyao.music.playback.Friends.shareRequest.collectAsState()
        shareTrack?.let { t -> org.nyao.music.ui.screens.FriendPickerSheet(model, t) { org.nyao.music.playback.Friends.shareRequest.value = null } }
        val social by org.nyao.music.playback.Friends.profile.collectAsState()
        val ctx = androidx.compose.ui.platform.LocalContext.current
        val socialPrefs = remember { ctx.getSharedPreferences("nyao_social", android.content.Context.MODE_PRIVATE) }
        var nickAsked by remember { mutableStateOf(socialPrefs.getBoolean("nickAsked", false)) }
        val p = social
        if (settings.onboarded && p != null && !p.nickSet && !nickAsked) org.nyao.music.ui.screens.NickSetupSheet(model) {
            nickAsked = true
            socialPrefs.edit().putBoolean("nickAsked", true).apply()
        }
        val cloudUser by Repo.cloud.user.collectAsState()
        LaunchedEffect(cloudUser) {
            if (cloudUser == null) return@LaunchedEffect
            runCatching { org.nyao.music.playback.Friends.refresh() }
            org.nyao.music.playback.NyaoPush.register()
            // вошёл после того, как открыл приглашение — спросим, добавлять ли
            org.nyao.music.playback.Friends.pendingInvite?.let { code ->
                org.nyao.music.playback.Friends.pendingInvite = null
                org.nyao.music.playback.Friends.inviteLinks.value = code
            }
        }
        // ссылка-приглашение и вход в комнату снаружи — только после «Добавить» / «Войти»
        var askInvite by remember { mutableStateOf<Pair<String, org.nyao.music.data.UserCard?>?>(null) }
        var askRoom by remember { mutableStateOf<Pair<String, String?>?>(null) }
        LaunchedEffect(Unit) {
            org.nyao.music.playback.Friends.inviteLinks.collect { code ->
                if (code != null) {
                    org.nyao.music.playback.Friends.inviteLinks.value = null
                    if (!Repo.cloud.loggedIn) org.nyao.music.ui.screens.openInvite(model, code)
                    else runCatching { Repo.cloud.invitePreview(code) }
                        .onSuccess { (u, rel) ->
                            when (rel) {
                                "self" -> model.message("Это твоё приглашение")
                                "friends" -> { model.message("${u?.display ?: "Вы"} уже в друзьях"); u?.let { model.go(Route.UserPage(it.id)) } }
                                else -> askInvite = code to u
                            }
                        }
                        .onFailure { model.message(it.message ?: "Приглашение не открылось") }
                }
            }
        }
        LaunchedEffect(Unit) {
            org.nyao.music.playback.Friends.roomLinks.collect { r ->
                if (r != null) {
                    org.nyao.music.playback.Friends.roomLinks.value = null
                    askRoom = r
                }
            }
        }
        askInvite?.let { (code, u) ->
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { askInvite = null },
                icon = { org.nyao.music.ui.screens.UserAvatar(u, 56) },
                title = { Text("Добавить в друзья?") },
                text = { Text(if (u != null) "${u.display} (@${u.nick}) зовёт тебя в друзья. Вы будете видеть, что слушаете, и сможете звать друг друга в комнаты." else "Приглашение в друзья") },
                confirmButton = { androidx.compose.material3.Button(onClick = { askInvite = null; org.nyao.music.ui.screens.openInvite(model, code) }) { Text("Добавить") } },
                dismissButton = { androidx.compose.material3.TextButton(onClick = { askInvite = null }) { Text("Отмена") } },
            )
        }
        askRoom?.let { (code, from) ->
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { askRoom = null },
                title = { Text("Войти в комнату?") },
                text = { Text((if (from != null) "$from зовёт слушать вместе. " else "") + "Комната $code — музыка у всех будет играть одновременно.") },
                confirmButton = {
                    androidx.compose.material3.Button(onClick = {
                        askRoom = null
                        model.go(Route.Together)
                        scope.launch { runCatching { org.nyao.music.playback.Together.join(code) }.onFailure { model.message(it.message ?: "Комната уже закрыта") } }
                    }) { Text("Войти") }
                },
                dismissButton = { androidx.compose.material3.TextButton(onClick = { askRoom = null }) { Text("Отмена") } },
            )
        }

        // режим «Плеер»: окно нового микса; после обновления с 0.4 — выбор вида; устаревшая сборка — обновиться
        if (model.mixBuilderOpen) org.nyao.music.ui.screens.MixBuilderDialog(model)
        // Nyao Connect и перенос плейлиста
        if (model.connectOpen) org.nyao.music.ui.screens.ConnectSheet(model) { model.connectOpen = false }
        model.transferFor?.let { (p, t) -> org.nyao.music.ui.screens.TransferSheet(model, p, t) { model.transferFor = null } }
        if (settings.onboarded && settings.layout == null) org.nyao.music.ui.screens.LayoutAskDialog()
        if (requiredUpdate != null || outdated > 0) org.nyao.music.ui.screens.OutdatedDialog(requiredUpdate?.apkUrl)
    }
    }
}

@Composable
private fun Content(model: AppModel, wide: Boolean) {
    AnimatedContent(
        model.route,
        transitionSpec = {
            val from = routeOrder(initialState)
            val to = routeOrder(targetState)
            val dir = if (to >= from) 1 else -1
            val spec = spring<IntOffset>(dampingRatio = 0.85f, stiffness = 380f)
            (slideInHorizontally(spec) { w -> dir * w / 5 } + fadeIn(tween(220)) + scaleIn(tween(260), initialScale = 0.97f)) togetherWith
                (slideOutHorizontally(spec) { w -> -dir * w / 6 } + fadeOut(tween(160)))
        },
        label = "route",
    ) { r ->
        when (r) {
            Route.Home -> HomeScreen(model, wide)
            Route.Wave -> WaveScreen(model)
            Route.Search -> SearchScreen(model)
            Route.Library -> LibraryScreen(model, wide)
            Route.Settings -> org.nyao.music.ui.screens.ProfileScreen(model)
            is Route.SettingsPage -> org.nyao.music.ui.screens.SettingsPageScreen(model, r.section)
            is Route.PlaylistPage -> PlaylistScreen(model, r.playlist)
            is Route.ArtistPage -> org.nyao.music.ui.screens.ArtistScreen(model, r)
            Route.Together -> org.nyao.music.ui.screens.TogetherScreen(model)
            Route.Stats -> org.nyao.music.ui.screens.StatsScreen(model)
            is Route.UserPage -> org.nyao.music.ui.screens.UserScreen(model, r.key)
        }
    }
}

// ---------- Уведомления: капсула сверху ----------

private data class Toast(val text: String, val id: Long) {
    /** Ошибки и длинные сообщения висят дольше, подтверждения — коротко */
    val durationMs: Long get() {
        val problem = Regex("(?i)не |ошиб|не удалось|недоступ|закончил").containsMatchIn(text)
        return (if (problem) 4500L else 2200L) + (if (text.length > 60) 1500L else 0L)
    }
}

/** Капсула, выезжающая сверху: не закрывает кнопки плеера; смахивается вверх или по нажатию */
@Composable
private fun TopToast(toast: Toast?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    var shown by remember { mutableStateOf(toast) }
    if (toast != null) shown = toast
    LaunchedEffect(toast?.id) {
        if (toast != null) {
            delay(toast.durationMs)
            onDismiss()
        }
    }
    var drag by remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    AnimatedVisibility(
        toast != null,
        modifier = modifier.statusBarsPadding().padding(top = 8.dp, start = 16.dp, end = 16.dp),
        enter = slideInVertically(spring(dampingRatio = 0.75f, stiffness = 500f)) { -it * 2 } + fadeIn(),
        exit = slideOutVertically { -it * 2 } + fadeOut(),
    ) {
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = NyaoColors.S3,
            contentColor = NyaoColors.Text,
            shadowElevation = 10.dp,
            modifier = Modifier
                .widthIn(max = 520.dp)
                .graphicsLayer { translationY = drag.coerceAtMost(0f) }
                .pointerInput(Unit) {
                    detectVerticalDragGestures(
                        onDragEnd = { if (drag < -30f) onDismiss(); drag = 0f },
                        onDragCancel = { drag = 0f },
                    ) { _, dy -> drag += dy }
                }
                .clickable(onClick = onDismiss),
        ) {
            AnimatedContent(shown?.text ?: "", transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "toast") { text ->
                Text(
                    text,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

// ---------- Телефон: контент + мини-плеер + плавающая панель ----------

@Composable
private fun PhoneLayout(model: AppModel) {
    val current by PlayerConnection.current.collectAsState()
    // Снимок экрана под плеером: из него рисуем размытую полосу за мини-плеером и панелью
    val shot = androidx.compose.ui.graphics.rememberGraphicsLayer()
    var barsTop by remember { androidx.compose.runtime.mutableFloatStateOf(Float.NaN) }
    // Спотлайт: список уже в самом верху, а палец тянет дальше вниз — копим «перетяг» и открываем поиск
    val pullMax = with(androidx.compose.ui.platform.LocalDensity.current) { 120.dp.toPx() }
    var pull by remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    val pullConn = remember(model, pullMax) {
        object : androidx.compose.ui.input.nestedscroll.NestedScrollConnection {
            override fun onPostScroll(consumed: androidx.compose.ui.geometry.Offset, available: androidx.compose.ui.geometry.Offset, source: androidx.compose.ui.input.nestedscroll.NestedScrollSource): androidx.compose.ui.geometry.Offset {
                if (source == androidx.compose.ui.input.nestedscroll.NestedScrollSource.UserInput && available.y > 0f && consumed.y == 0f && model.route != Route.Search && !model.spotlightOpen) {
                    pull += available.y
                    if (pull >= pullMax) {
                        pull = 0f
                        model.spotlightOpen = true
                    }
                } else if (consumed.y != 0f || available.y < 0f) pull = 0f
                return androidx.compose.ui.geometry.Offset.Zero
            }
            override suspend fun onPreFling(available: androidx.compose.ui.unit.Velocity): androidx.compose.ui.unit.Velocity {
                pull = 0f
                return androidx.compose.ui.unit.Velocity.Zero
            }
        }
    }
    val pullShown by androidx.compose.animation.core.animateFloatAsState((pull / pullMax).coerceIn(0f, 1f), spring(stiffness = 800f), label = "pull")
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize().nestedScroll(pullConn).drawWithContent {
                shot.record { this@drawWithContent.drawContent() }
                drawLayer(shot)
            }.then(
                // пока открыт спотлайт, экран под ним размыт
                if (model.spotlightOpen && android.os.Build.VERSION.SDK_INT >= 31) Modifier.blur(24.dp) else Modifier,
            ),
        ) { Content(model, wide = false) }
        // подсказка при перетяге: капсула «Поиск» выезжает сверху
        if (pullShown > 0.02f && !model.spotlightOpen) {
            Row(
                Modifier.align(Alignment.TopCenter).statusBarsPadding()
                    .graphicsLayer { alpha = pullShown; translationY = (pullShown - 1f) * 40.dp.toPx(); scaleX = 0.8f + 0.2f * pullShown; scaleY = 0.8f + 0.2f * pullShown }
                    .padding(top = 8.dp).clip(RoundedCornerShape(20.dp)).background(NyaoColors.S3).padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(NyaoIcons.Search, null, tint = if (pullShown >= 0.98f) NyaoColors.Lavender else NyaoColors.Muted, modifier = Modifier.size(18.dp))
                Text(if (pullShown >= 0.98f) "Поиск" else "Тяни ниже — поиск", style = MaterialTheme.typography.labelLarge)
            }
        }
        BottomBlur(shot, barsTop)
        // вся нижняя зона (вокруг плеера и панели) забирает касания себе — иначе тап мимо кнопок попадал в список под ней
        if (!barsTop.isNaN()) {
            val topDp = with(androidx.compose.ui.platform.LocalDensity.current) { barsTop.toDp() } - 10.dp
            Box(
                Modifier.fillMaxSize().padding(top = topDp.coerceAtLeast(0.dp))
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            while (true) awaitPointerEvent().changes.forEach { it.consume() }
                        }
                    },
            )
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp)
                .onGloballyPositioned { barsTop = it.positionInParent().y },
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (current != null) MiniPlayer(onOpen = { model.nowPlayingOpen = true }, modifier = Modifier.padding(horizontal = 12.dp))
            FloatingToolbar(model)
        }
        AnimatedVisibility(
            model.nowPlayingOpen && current != null,
            enter = slideInVertically { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
        ) {
            NowPlayingScreen(model, asPane = false, onClose = { model.nowPlayingOpen = false })
        }
        AnimatedVisibility(
            model.spotlightOpen && !model.nowPlayingOpen,
            enter = fadeIn(tween(180)) + slideInVertically(spring(dampingRatio = 0.8f, stiffness = 420f)) { -it / 8 },
            exit = fadeOut(tween(140)),
        ) {
            org.nyao.music.ui.screens.SpotlightOverlay(model, onClose = { model.spotlightOpen = false })
        }
    }
}

/**
 * Мягкое размытие под мини-плеером и панелью: снизу контент размыт, кверху размытие плавно сходит на нет.
 * Настоящее размытие — с Android 12; на старых версиях остаётся только плавное затемнение.
 */
@Composable
private fun BottomBlur(shot: androidx.compose.ui.graphics.layer.GraphicsLayer, barsTop: Float) {
    if (barsTop.isNaN()) return
    val bg = MaterialTheme.colorScheme.background
    val fade = with(androidx.compose.ui.platform.LocalDensity.current) { 56.dp.toPx() }
    val blur = if (android.os.Build.VERSION.SDK_INT >= 31) Modifier.blur(18.dp, androidx.compose.ui.draw.BlurredEdgeTreatment.Rectangle) else Modifier
    Box(
        Modifier.fillMaxSize()
            .graphicsLayer { compositingStrategy = androidx.compose.ui.graphics.CompositingStrategy.Offscreen }
            .then(blur)
            .drawWithContent {
                val top = (barsTop - fade).coerceAtLeast(0f)
                clipRect(top = top) { drawLayer(shot) }
                // сверху размытие плавно исчезает
                drawRect(
                    androidx.compose.ui.graphics.Brush.verticalGradient(0f to Color.Transparent, 1f to Color.Black, startY = top, endY = top + fade * 1.6f),
                    blendMode = androidx.compose.ui.graphics.BlendMode.DstIn,
                )
                // и чуть притемняем, чтобы панель читалась на любом фоне
                drawRect(androidx.compose.ui.graphics.Brush.verticalGradient(0f to Color.Transparent, 1f to bg.copy(alpha = 0.55f), startY = top, endY = size.height))
            },
    )
}

/**
 * Плавающая панель: выбранная вкладка раскрывается в «таблетку» с подписью.
 * Нажал на свой аватар — панель перестраивается: «Главная» уходит в отдельный кружок слева,
 * а в капсуле остаются профиль и «Вместе» (комнаты).
 */
@Composable
private fun FloatingToolbar(model: AppModel) {
    val settings by Repo.prefs.settings.collectAsState()
    val profileArea = isProfileArea(model.route)
    AnimatedContent(
        profileArea,
        transitionSpec = {
            val spec = spring<IntOffset>(dampingRatio = 0.8f, stiffness = 420f)
            ((fadeIn(tween(220, delayMillis = 60)) + slideInHorizontally(spec) { if (targetState) it / 5 else -it / 5 } + scaleIn(spring(dampingRatio = 0.7f, stiffness = 380f), initialScale = 0.9f)) togetherWith
                (fadeOut(tween(120)) + scaleOut(tween(160), targetScale = 0.96f)))
                .using(androidx.compose.animation.SizeTransform(clip = false) { _, _ -> spring(dampingRatio = 0.78f, stiffness = 380f) })
        },
        label = "toolbar",
    ) { profile ->
        if (!profile) {
            val selectedRoute = if (model.route is Route.PlaylistPage || model.route is Route.ArtistPage) Route.Library else model.route
            ToolbarCapsule {
                tabsFor(settings).forEach { tab -> ToolbarItem(tab, selectedRoute == tab.route) { model.go(tab.route) } }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                // «Главная» — отдельным кружком: вернуться из профиля одним нажатием
                // кружок «выкатывается» из капсулы слева
                Surface(
                    shape = CircleShape, color = NyaoColors.S3, shadowElevation = 12.dp,
                    modifier = Modifier.animateEnterExit(
                        enter = slideInHorizontally(spring(dampingRatio = 0.62f, stiffness = 320f)) { it } + scaleIn(spring(dampingRatio = 0.55f, stiffness = 320f), initialScale = 0.4f) + fadeIn(tween(180)),
                        exit = slideOutHorizontally(tween(160)) { it } + scaleOut(tween(160), targetScale = 0.4f) + fadeOut(tween(120)),
                    ),
                ) {
                    Box(Modifier.size(60.dp).bouncy().clip(CircleShape).clickable { model.go(Route.Home) }, contentAlignment = Alignment.Center) {
                        Icon(NyaoIcons.Home, "Главная", tint = NyaoColors.Muted, modifier = Modifier.size(24.dp))
                    }
                }
                ToolbarCapsule {
                    val inRooms = model.route == Route.Together
                    ToolbarItem(PROFILE_TAB, !inRooms) { model.go(Route.Settings) }
                    ToolbarItem(TOGETHER_TAB, inRooms) { model.go(Route.Together) }
                }
            }
        }
    }
}

@Composable
private fun ToolbarCapsule(content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit) {
    Surface(shape = RoundedCornerShape(30.dp), color = NyaoColors.S3, shadowElevation = 12.dp) {
        // ширина капсулы пружинит, когда подпись выбранной вкладки появляется и исчезает
        Row(Modifier.animateContentSize(spring(dampingRatio = 0.72f, stiffness = 420f)).height(60.dp).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically, content = content)
    }
}

@Composable
private fun ToolbarItem(tab: Tab, selected: Boolean, onClick: () -> Unit) {
    // подложка перетекает цветом, иконка «подпрыгивает» при выборе
    val bg by androidx.compose.animation.animateColorAsState(if (selected) NyaoColors.Primary else NyaoColors.S3, spring(stiffness = 500f), label = "tabBg")
    val tint by androidx.compose.animation.animateColorAsState(if (selected) NyaoColors.OnPrimary else NyaoColors.Muted, spring(stiffness = 500f), label = "tabTint")
    val pop = remember { androidx.compose.animation.core.Animatable(1f) }
    var seen by remember { mutableStateOf(false) }
    LaunchedEffect(selected) {
        if (!seen) { seen = true; return@LaunchedEffect }
        if (selected) {
            pop.snapTo(0.72f)
            pop.animateTo(1f, spring(dampingRatio = 0.38f, stiffness = 520f))
        }
    }
    Row(
        Modifier
            .height(44.dp)
            .bouncy().clip(RoundedCornerShape(22.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(start = if (selected) 12.dp else 10.dp, end = if (selected && org.nyao.music.ui.theme.Look.current.navLabels) 16.dp else if (selected) 12.dp else 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        // профиль — твой аватар из аккаунта Nyao (или буква), остальные — иконки
        Box(Modifier.graphicsLayer { scaleX = pop.value; scaleY = pop.value }) {
            if (tab.route == Route.Settings) org.nyao.music.ui.screens.NyaoAvatar(size = 28, contentDescription = tab.label)
            else androidx.compose.animation.Crossfade(selected, animationSpec = tween(180), label = "tabIcon") { on ->
                Icon(if (on) tab.iconOn else tab.icon, tab.label, tint = tint, modifier = Modifier.size(22.dp))
            }
        }
        // подписи можно выключить в «Теме и сетке» — тогда выбранная вкладка просто подсвечивается
        AnimatedVisibility(selected && org.nyao.music.ui.theme.Look.current.navLabels, enter = expandHorizontally(spring(dampingRatio = 0.7f)) + fadeIn(), exit = shrinkHorizontally(spring(dampingRatio = 0.9f)) + fadeOut()) {
            Text(tab.label, style = MaterialTheme.typography.labelLarge, color = NyaoColors.OnPrimary, maxLines = 1)
        }
    }
}

/** Мини-плеер из макета: капсула в цвет обложки, круглая обложка, квадратная кнопка паузы и волна прогресса */
@Composable
private fun MiniPlayer(onOpen: () -> Unit, modifier: Modifier = Modifier) {
    val current by PlayerConnection.current.collectAsState()
    val playing by PlayerConnection.playing.collectAsState()
    val t = current ?: return
    val pal = rememberCoverPalette(t.cover)
    var progress by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(t.id) {
        while (true) {
            val d = PlayerConnection.durationMs()
            progress = if (d > 0) PlayerConnection.positionMs().toFloat() / d else 0f
            delay(500)
        }
    }
    Box(modifier.fillMaxWidth().height(64.dp).bouncy().clip(RoundedCornerShape(32.dp)).background(pal.surface).clickable(onClick = onOpen)) {
        Row(Modifier.fillMaxSize().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            SpinningCover(t.cover, playing)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                AnimatedContent(t.title, transitionSpec = { (slideInVertically { it / 2 } + fadeIn()) togetherWith (slideOutVertically { -it / 2 } + fadeOut()) }, label = "miniTitle") { title ->
                    Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall, color = pal.onContainer)
                }
                Text(t.artist + " · " + org.nyao.music.ui.components.sourceShort(t.source), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = pal.sub)
            }
            Box(
                Modifier.size(48.dp).bouncy().clip(org.nyao.music.ui.theme.smallButtonShape()).background(pal.accent).clickable { PlayerConnection.toggle() },
                contentAlignment = Alignment.Center,
            ) { Icon(if (playing) NyaoIcons.Pause else NyaoIcons.PlayArrow, if (playing) "Пауза" else "Играть", tint = pal.onAccent) }
            IconButton(onClick = { PlayerConnection.next() }) { Icon(NyaoIcons.SkipNext, "Следующий", tint = pal.onContainer) }
        }
        // Прогресс — тонкая прямая полоска внутри капсулы и без перемотки: нажатие на нижнюю половину
        // мини-плеера открывает экран «Сейчас играет», а не перематывает трек (перемотка — там, на волне)
        Box(
            Modifier.align(Alignment.BottomCenter).padding(start = 32.dp, end = 32.dp, bottom = 4.dp)
                .fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(pal.container),
        ) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(progress.coerceIn(0f, 1f)).clip(RoundedCornerShape(2.dp)).background(pal.accent))
        }
    }
}

// ---------- Планшет / раскрытый Fold: рейка слева, плеер справа ----------

@Composable
private fun WideLayout(model: AppModel, showPane: Boolean) {
    val current by PlayerConnection.current.collectAsState()
    Row(Modifier.fillMaxSize()) {
        // Рейка из макета складного: таблетка-индикатор над подписью
        Column(
            Modifier.width(96.dp).fillMaxHeight().statusBarsPadding().padding(vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val railTabs = tabsFor(Repo.prefs.settings.collectAsState().value).let { it.dropLast(1) + TOGETHER_TAB + it.last() }
            railTabs.forEach { tab ->
                val selected = model.route == tab.route || (tab.route == Route.Settings && (model.route == Route.Stats || model.route is Route.SettingsPage)) ||
                    (tab.route == Route.Library && (model.route is Route.PlaylistPage || model.route is Route.ArtistPage))
                Column(Modifier.bouncy().clip(RoundedCornerShape(16.dp)).clickable { model.go(tab.route) }.padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.width(56.dp).height(32.dp).clip(RoundedCornerShape(16.dp)).background(if (selected) NyaoColors.Primary else Color.Transparent), contentAlignment = Alignment.Center) {
                        if (tab.route == Route.Settings) org.nyao.music.ui.screens.NyaoAvatar(size = 26, contentDescription = tab.label)
                        else Icon(if (selected) tab.iconOn else tab.icon, null, tint = if (selected) NyaoColors.OnPrimary else NyaoColors.Muted, modifier = Modifier.size(22.dp))
                    }
                    Text(tab.label, style = MaterialTheme.typography.labelMedium, color = if (selected) NyaoColors.Text else NyaoColors.Muted, maxLines = 1)
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxHeight().padding(vertical = 12.dp).clip(RoundedCornerShape(32.dp)).background(NyaoColors.S1)) {
            Content(model, wide = true)
            if (!showPane && current != null) {
                MiniPlayer(onOpen = { model.nowPlayingOpen = true }, modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(12.dp))
            }
            androidx.compose.animation.AnimatedVisibility(!showPane && model.nowPlayingOpen && current != null, enter = slideInVertically { it }, exit = slideOutVertically { it }) {
                NowPlayingScreen(model, asPane = false, onClose = { model.nowPlayingOpen = false })
            }
        }
        if (showPane && current != null) {
            Box(Modifier.width(400.dp).fillMaxHeight().padding(12.dp).clip(RoundedCornerShape(32.dp))) {
                NowPlayingScreen(model, asPane = true, onClose = {})
            }
        }
    }
}

/** Круглая обложка мини-плеера крутится, как пластинка, пока играет музыка */
@Composable
private fun SpinningCover(url: String?, playing: Boolean) {
    val rot = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(playing) {
        if (playing) {
            while (true) {
                rot.animateTo(rot.value + 360f, tween(12000, easing = androidx.compose.animation.core.LinearEasing))
            }
        }
    }
    Cover(url, Modifier.size(48.dp).graphicsLayer { rotationZ = rot.value % 360f }, CircleShape)
}
