package org.nyao.music.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.animation.scaleIn
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SkipNext
import androidx.compose.material.icons.rounded.Waves
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
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
import org.nyao.music.ui.screens.SettingsScreen
import org.nyao.music.ui.screens.WaveScreen

/** Порядок экранов для направления анимации: вкладки слева направо, страницы плейлистов — «глубже» */
private fun routeOrder(r: Route): Int = when (r) {
    Route.Home -> 0
    Route.Wave -> 1
    Route.Library -> 2
    Route.Search -> 3
    Route.Settings -> 4
    is Route.PlaylistPage -> 5
}

private data class Tab(val route: Route, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab(Route.Home, "Главная", Icons.Rounded.Home),
    Tab(Route.Wave, "Волна", Icons.Rounded.Waves),
    Tab(Route.Library, "Медиатека", Icons.Rounded.LibraryMusic),
    Tab(Route.Settings, "Настройки", Icons.Rounded.Settings),
)

@Composable
fun NyaoRoot() {
    val scope = rememberCoroutineScope()
    val model = remember { AppModel(scope) }
    val settings by Repo.prefs.settings.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        Repo.refreshAccounts()
        PlaybackEvents.messages.collect { snackbar.showSnackbar(it) }
    }

    BackHandler(enabled = model.loginFor != null || model.nowPlayingOpen || model.stack.size > 1 || model.route != Route.Home) {
        model.back()
    }

    // Surface задаёт цвет текста по умолчанию (иначе Compose красит его в чёрный)
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
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

        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 140.dp))
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
            Route.Settings -> SettingsScreen(model)
            is Route.PlaylistPage -> PlaylistScreen(model, r.playlist)
        }
    }
}

// ---------- Телефон: контент + мини-плеер + плавающая панель ----------

@Composable
private fun PhoneLayout(model: AppModel) {
    val current by PlayerConnection.current.collectAsState()
    Box(Modifier.fillMaxSize()) {
        Content(model, wide = false)
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().padding(bottom = 12.dp),
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
    }
}

/** Плавающая панель из макета: выбранная вкладка раскрывается в «таблетку» с подписью */
@Composable
private fun FloatingToolbar(model: AppModel) {
    val selectedRoute = if (model.route is Route.PlaylistPage || model.route == Route.Search) Route.Library else model.route
    Surface(shape = RoundedCornerShape(30.dp), color = NyaoColors.S3, shadowElevation = 12.dp) {
        Row(Modifier.height(60.dp).padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            TABS.forEach { tab ->
                val selected = selectedRoute == tab.route
                Row(
                    Modifier
                        .height(44.dp)
                        .bouncy().clip(RoundedCornerShape(22.dp))
                        .background(if (selected) NyaoColors.Primary else NyaoColors.S3)
                        .clickable { model.go(tab.route) }
                        .padding(horizontal = if (selected) 16.dp else 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(tab.icon, tab.label, tint = if (selected) NyaoColors.OnPrimary else NyaoColors.Muted, modifier = Modifier.size(22.dp))
                    AnimatedVisibility(selected, enter = expandHorizontally(spring(dampingRatio = 0.7f)) + fadeIn(), exit = shrinkHorizontally(spring(dampingRatio = 0.9f)) + fadeOut()) {
                        Text(tab.label, style = MaterialTheme.typography.labelLarge, color = NyaoColors.OnPrimary, maxLines = 1)
                    }
                }
            }
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
                Text(t.artist + if (t.source == "yt") " · YT" else " · Я", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = pal.sub)
            }
            Box(
                Modifier.size(48.dp).bouncy().clip(RoundedCornerShape(16.dp)).background(pal.accent).clickable { PlayerConnection.toggle() },
                contentAlignment = Alignment.Center,
            ) { Icon(if (playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (playing) "Пауза" else "Играть", tint = pal.onAccent) }
            IconButton(onClick = { PlayerConnection.next() }) { Icon(Icons.Rounded.SkipNext, "Следующий", tint = pal.onContainer) }
        }
        WavyProgress(
            progress = progress,
            playing = playing,
            onSeek = { f -> PlayerConnection.seekTo((f * PlayerConnection.durationMs()).toLong()) },
            color = pal.accent,
            trackColor = pal.container,
            height = 8.dp,
            modifier = Modifier.align(Alignment.BottomCenter).padding(horizontal = 28.dp),
        )
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
            TABS.forEach { tab ->
                val selected = model.route == tab.route
                Column(Modifier.bouncy().clip(RoundedCornerShape(16.dp)).clickable { model.go(tab.route) }.padding(4.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.width(56.dp).height(32.dp).clip(RoundedCornerShape(16.dp)).background(if (selected) NyaoColors.Primary else Color.Transparent), contentAlignment = Alignment.Center) {
                        Icon(tab.icon, null, tint = if (selected) NyaoColors.OnPrimary else NyaoColors.Muted, modifier = Modifier.size(22.dp))
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
