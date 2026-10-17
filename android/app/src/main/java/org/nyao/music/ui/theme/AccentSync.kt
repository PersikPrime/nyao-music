package org.nyao.music.ui.theme

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import org.nyao.music.data.Repo
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.components.rememberCoverPalette

/** Держит Accent.palette в согласии с настройкой; «Из обложки» плавно перекрашивается вслед за треком */
@Composable
fun AccentSync() {
    val settings by Repo.prefs.settings.collectAsState()
    val current by PlayerConnection.current.collectAsState()
    val fromCover = settings.accent == "cover"
    val cp = rememberCoverPalette(if (fromCover) current?.cover else null)
    val target = if (fromCover && current?.cover != null) {
        AccentPalette(cp.accent, cp.onAccent, cp.container, cp.onContainer, hero = cp.container, tonal = cp.surface)
    } else {
        AccentPalette.preset(settings.accent)
    }
    val spec = tween<Color>(450)
    val a by animateColorAsState(target.a, spec, label = "acc-a")
    val onA by animateColorAsState(target.onA, spec, label = "acc-onA")
    val c by animateColorAsState(target.container, spec, label = "acc-c")
    val onC by animateColorAsState(target.onContainer, spec, label = "acc-onC")
    val hero by animateColorAsState(target.hero, spec, label = "acc-hero")
    val tonal by animateColorAsState(target.tonal, spec, label = "acc-tonal")
    val next = AccentPalette(a, onA, c, onC, hero, tonal)
    val look = UiLook(settings.theme, settings.buttons, settings.grid, settings.covers, settings.navLabels)
    SideEffect {
        if (Accent.palette != next) Accent.palette = next
        if (Look.current != look) Look.current = look
    }
}
