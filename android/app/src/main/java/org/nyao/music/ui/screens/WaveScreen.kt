package org.nyao.music.ui.screens

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.components.appear
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.SOURCE_YT
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.BalanceBar
import org.nyao.music.ui.components.ConnectedGroup
import org.nyao.music.ui.components.DropShape
import org.nyao.music.ui.components.FlowLines
import org.nyao.music.ui.components.PolarShape
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.components.rememberPlayShape
import org.nyao.music.ui.theme.NyaoColors

val DIVERSITY = listOf(
    Triple("favorite", "Любимое", "Больше того, что ты уже лайкал, плюс сами лайки из YouTube Music."),
    Triple("discover", "Незнакомое", "Только новое: в поток не попадёт ничего из твоих лайков."),
    Triple("popular", "Популярное", "Хиты и то, что сейчас слушают чаще всего."),
)

private data class Mood(val key: String, val title: String, val color: Color, val shape: Shape)

private val MOODS = listOf(
    Mood("active", "Бодрое", Color(0xFFFFB86B), PolarShape(8, 0.16f)),
    Mood("fun", "Весёлое", Color(0xFFE8F06B), PolarShape(5, 0.20f, (-Math.PI / 10).toFloat())),
    Mood("calm", "Спокойное", Color(0xFF7CE0C3), PolarShape(12, 0.06f)),
    Mood("sad", "Грустное", Color(0xFF8FB4FF), DropShape),
)

val WaveBg = Color(0xFF1A1726)

@Composable
fun WaveScreen(model: AppModel) {
    val mode by Repo.mode.collectAsState()
    val playing by PlayerConnection.playing.collectAsState()
    val current by PlayerConnection.current.collectAsState()
    val waveOn = mode == Repo.Mode.WAVE && current != null
    val active = waveOn && playing

    Column(
        Modifier.fillMaxSize().background(WaveBg).verticalScroll(rememberScrollState()).statusBarsPadding().padding(BottomInset),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { model.go(Route.Home) }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Назад", tint = NyaoColors.Text) }
            Text("Моя волна", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
            Box(Modifier.size(48.dp))
        }
        // Пучок линий, два «печенья»-подложки и большая кнопка
        Box(Modifier.fillMaxWidth().height(330.dp), contentAlignment = Alignment.Center) {
            FlowLines(Modifier.fillMaxSize(), lines = 14, animate = active, amplitude = 0.14f, spread = 0.2f, center = 0.5f, middle = NyaoColors.Lavender)
            // Подложки медленно вращаются навстречу друг другу, кнопка «дышит», пока играет волна
            val inf = rememberInfiniteTransition(label = "waveBg")
            val spin by inf.animateFloat(0f, (2 * Math.PI).toFloat(), infiniteRepeatable(tween(40000, easing = LinearEasing)), label = "spin")
            val breath by inf.animateFloat(1f, 1.05f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "breath")
            val k = if (active) 1f else 0f
            val b = if (active) breath else 1f
            Box(Modifier.size(264.dp).graphicsLayer { scaleX = b; scaleY = b }.clip(PolarShape(12, 0.045f, spin / 12f * k)).background(Color(0xFF2E2650)))
            Box(Modifier.size(226.dp).clip(PolarShape(12, 0.03f, (Math.PI / 12).toFloat() - spin / 12f * k)).background(Color(0xFF342B5C)))
            Box(
                Modifier.size(180.dp).bouncy().clip(rememberPlayShape(active, 9, 0.075f)).background(NyaoColors.Lavender).clickable { model.waveButton() },
                contentAlignment = Alignment.Center,
            ) {
                if (model.waveStarting) CircularProgressIndicator(color = NyaoColors.OnLavender, modifier = Modifier.size(44.dp))
                else Icon(if (active) Icons.Rounded.Pause else Icons.Rounded.PlayArrow, if (active) "Пауза" else "Слушать", tint = NyaoColors.OnLavender, modifier = Modifier.size(76.dp))
            }
        }
        Text("Моя волна", style = MaterialTheme.typography.displaySmall)
        val t = current
        if (waveOn && t != null) {
            Row(
                Modifier.padding(top = 10.dp, start = 24.dp, end = 24.dp).height(36.dp).bouncy().clip(RoundedCornerShape(18.dp)).background(NyaoColors.Tonal)
                    .clickable { model.nowPlayingOpen = true }.padding(start = 6.dp, end = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SourceTag(t.source)
                Text(t.title, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text(t.artist, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            }
        }
        WaveSettings(onChanged = { model.refreshWave() }, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 22.dp))
    }
}

/** Характер, настроение и баланс источников — на экране волны и в приветствии */
@Composable
fun WaveSettings(onChanged: () -> Unit, modifier: Modifier = Modifier, showMood: Boolean = true) {
    val settings by Repo.prefs.settings.collectAsState()
    val accounts by Repo.accounts.collectAsState()
    var liveShare by remember { mutableStateOf<Int?>(null) }
    val share = liveShare ?: settings.ytmShare
    Column(modifier.widthIn(max = 560.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Label("Характер")
            val idx = DIVERSITY.indexOfFirst { it.first == settings.diversity }.coerceAtLeast(0)
            ConnectedGroup(DIVERSITY.map { it.second }, idx, { i ->
                Repo.prefs.setDiversity(DIVERSITY[i].first)
                onChanged()
            })
            Text(DIVERSITY[idx].third, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, modifier = Modifier.padding(start = 4.dp))
        }
        if (showMood) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Label("Настроение")
            Row(Modifier.fillMaxWidth()) {
                MOODS.forEach { m ->
                    val on = settings.mood == m.key
                    Column(
                        Modifier.weight(1f).bouncy().clip(RoundedCornerShape(16.dp)).clickable {
                            Repo.prefs.setMood(if (on) null else m.key)
                            onChanged()
                        }.padding(vertical = 4.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        // Обводка: внешняя фигура — цвет настроения (или белая у выбранного), внутренняя — заливка
                        Box(Modifier.size(64.dp).clip(m.shape).background(if (on) Color.White else m.color), contentAlignment = Alignment.Center) {
                            Box(Modifier.size(57.dp).clip(m.shape).background(if (on) m.color else NyaoColors.Tonal))
                        }
                        Text(m.title, style = MaterialTheme.typography.labelMedium, color = if (on) Color.White else NyaoColors.Muted, maxLines = 1)
                    }
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            val ya = accounts[SOURCE_YA] != null
            val yt = accounts[SOURCE_YT] != null || accounts[org.nyao.music.data.SOURCE_SC] != null
            Row(Modifier.padding(horizontal = 4.dp)) {
                Text("Яндекс ${100 - share}%", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Muted, modifier = Modifier.weight(1f))
                Text(if (accounts[org.nyao.music.data.SOURCE_SC] != null) "$share% YouTube и SoundCloud" else "$share% YouTube Music", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Muted)
            }
            BalanceBar(share, onChange = { liveShare = it }, onFinish = {
                liveShare = null
                Repo.prefs.setShare(it)
                onChanged()
            })
            if (!ya || !yt) Text(
                if (!ya && !yt) "Сервисы не подключены" else if (!yt) "YouTube Music и SoundCloud не подключены — волна только из Яндекса" else "Яндекс не подключён — волна из YouTube Music / SoundCloud",
                style = MaterialTheme.typography.bodySmall,
                color = NyaoColors.Muted,
                modifier = Modifier.padding(start = 4.dp),
            )
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = NyaoColors.Muted, modifier = Modifier.padding(start = 4.dp))
}
