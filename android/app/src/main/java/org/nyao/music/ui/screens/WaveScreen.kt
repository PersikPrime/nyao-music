package org.nyao.music.ui.screens

import org.nyao.music.ui.components.NyaoIcons

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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.components.appear
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.SOURCE_YT
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.BalanceBar
import org.nyao.music.ui.components.ConnectedGroup
import org.nyao.music.ui.components.DropShape
import org.nyao.music.ui.components.PolarShape
import org.nyao.music.ui.components.SourceTag
import org.nyao.music.ui.theme.NyaoColors

val DIVERSITY = listOf(
    Triple("any", "Всё", "Без ограничений: и любимое, и новое, и популярное — как обычная «Моя волна»."),
    Triple("favorite", "Любимое", "В основном твои лайки из всех сервисов. Свежесть задаёт долю недавнего."),
    Triple("discover", "Незнакомое", "Только новое: в поток не попадёт ничего из твоих лайков."),
    Triple("popular", "Популярное", "Больше рекомендаций сервисов, меньше личных лайков."),
)

private data class Mood(val key: String, val title: String, val color: Color, val shape: Shape)

private val MOODS = listOf(
    Mood("active", "Бодрое", Color(0xFFFFB86B), PolarShape(8, 0.16f)),
    Mood("fun", "Весёлое", Color(0xFFE8F06B), PolarShape(5, 0.20f, (-Math.PI / 10).toFloat())),
    Mood("calm", "Спокойное", Color(0xFF7CE0C3), PolarShape(12, 0.06f)),
    Mood("sad", "Грустное", Color(0xFF8FB4FF), DropShape),
)

/** Фон волны — почти чёрный с оттенком акцента */
val WaveBg: Color get() = if (org.nyao.music.ui.theme.Look.current.glass) Color.Transparent
    else androidx.compose.ui.graphics.lerp(NyaoColors.Bg, NyaoColors.Hero, 0.2f)

/** Цвет фигуры: в Mono — оттенки серого и одна акцентная, в остальных темах — палитра акцента */
private fun shapeTone(tone: Int): Color = if (org.nyao.music.ui.theme.Look.current.mono) {
    when (tone) {
        0 -> Color(0xFF2C2C30)
        1 -> Color(0xFF4A4A50)
        2 -> NyaoColors.Lavender
        else -> Color(0xFF8A8A92)
    }
} else when (tone) {
    0 -> NyaoColors.Hero
    1 -> NyaoColors.Primary
    2 -> NyaoColors.Lavender
    else -> NyaoColors.OnPrimary
}

/**
 * Фигуры Material 3 Expressive по краям — как на ПК: плотные, в цветах акцента,
 * выезжают с краёв по очереди. edge — отступ от своего края (минус — фигура заходит за край).
 */
private data class EdgeShape(
    val left: Boolean,
    val edge: Int,
    val top: Int,
    val w: Int,
    val h: Int,
    val shape: Shape,
    val tone: Int, // 0 hero, 1 container, 2 accent, 3 onContainer
    val rot: Float = 0f,
)

private val EDGE_SHAPES = listOf(
    EdgeShape(true, -72, -24, 176, 176, PolarShape(9, 0.07f), 0),
    EdgeShape(true, 74, 6, 56, 56, PolarShape(8, 0.09f), 2),
    EdgeShape(true, 22, 148, 74, 30, RoundedCornerShape(50), 3, 14f),
    EdgeShape(true, -6, 206, 100, 100, PolarShape(4, 0.2f, 0.4f), 1),
    EdgeShape(false, -84, 4, 196, 196, PolarShape(6, 0.11f), 0),
    EdgeShape(false, 56, -16, 64, 64, PolarShape(5, 0.14f, 0.2f), 3),
    EdgeShape(false, 30, 176, 82, 32, RoundedCornerShape(50), 1, -18f),
    EdgeShape(false, 6, 226, 84, 84, PolarShape(3, 0.17f, 0.3f), 2),
)

@Composable
private fun EdgeShapes(modifier: Modifier = Modifier, shapes: List<EdgeShape> = EDGE_SHAPES, fadeTo: Color = WaveBg) {
    val anims = remember { List(shapes.size) { androidx.compose.animation.core.Animatable(0f) } }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        anims.forEachIndexed { i, a ->
            launch {
                delay(60L + i * 70L)
                a.animateTo(1f, androidx.compose.animation.core.spring(dampingRatio = 0.72f, stiffness = androidx.compose.animation.core.Spring.StiffnessLow))
            }
        }
    }
    Box(modifier.clipToBounds()) {
        shapes.forEachIndexed { i, sh ->
            val color = shapeTone(sh.tone)
            val dir = if (sh.left) -1f else 1f
            Box(
                Modifier.align(if (sh.left) Alignment.TopStart else Alignment.TopEnd)
                    .offset(x = (if (sh.left) sh.edge else -sh.edge).dp, y = sh.top.dp)
                    .size(sh.w.dp, sh.h.dp)
                    .graphicsLayer {
                        val p = anims[i].value
                        translationX = (1f - p) * dir * 520.dp.toPx()
                        rotationZ = sh.rot + (1f - p) * dir * 40f
                        alpha = p.coerceIn(0f, 1f)
                    }
                    .clip(sh.shape)
                    .background(color),
            )
        }
        // низ не режется, а плавно уходит в фон
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(130.dp)
                .background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color.Transparent, fadeTo.copy(alpha = 0.75f * fadeTo.alpha), fadeTo))),
        )
    }
}

/** Фигуры справа в шапке главной темы Mono */
private val MONO_SHAPES = listOf(
    EdgeShape(false, -56, 24, 210, 210, PolarShape(9, 0.07f), 0),
    EdgeShape(false, 150, 18, 72, 72, PolarShape(5, 0.14f, 0.2f), 1),
    EdgeShape(false, 118, 150, 112, 112, PolarShape(4, 0.2f, 0.4f), 2),
    EdgeShape(false, 8, 214, 92, 92, PolarShape(6, 0.11f), 3),
    EdgeShape(false, 176, 272, 88, 34, RoundedCornerShape(50), 1, -18f),
)

/**
 * Шапка главной в теме Mono: огромное «Моя волна», фигуры Material 3 справа (вместо чужого зигзага),
 * капсула с настройкой волны и крупная кнопка запуска.
 */
@Composable
fun MonoWaveHero(model: AppModel, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    val settings by Repo.prefs.settings.collectAsState()
    val mode by Repo.mode.collectAsState()
    val playing by PlayerConnection.playing.collectAsState()
    val current by PlayerConnection.current.collectAsState()
    val active = mode == Repo.Mode.WAVE && current != null && playing
    val bg = NyaoColors.Bg
    Box(modifier.fillMaxWidth().height(440.dp).background(androidx.compose.ui.graphics.Brush.verticalGradient(listOf(Color(0xFF2B2B2E), Color(0xFF161618), bg)))) {
        EdgeShapes(Modifier.fillMaxSize(), MONO_SHAPES, fadeTo = bg)
        Text(
            "Моя\nволна",
            style = MaterialTheme.typography.displayLarge.copy(fontSize = 66.sp, lineHeight = 62.sp),
            color = Color.White,
            modifier = Modifier.statusBarsPadding().padding(start = 22.dp, top = 30.dp),
        )
        Box(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 16.dp, end = 16.dp)) { trailing() }
        val first = settings.mood?.let { m -> MOODS.firstOrNull { it.key == m }?.title } ?: DIVERSITY.firstOrNull { it.first == settings.diversity }?.second ?: "Всё"
        Row(
            Modifier.align(Alignment.BottomStart).padding(start = 22.dp, bottom = 40.dp).height(42.dp).bouncy().clip(RoundedCornerShape(21.dp))
                .background(Color.White.copy(alpha = 0.08f)).clickable { model.go(Route.Wave) }.padding(start = 12.dp, end = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(NyaoIcons.Tune, null, tint = Color.White.copy(alpha = 0.85f), modifier = Modifier.size(18.dp))
            Text(first, style = MaterialTheme.typography.labelLarge, color = Color.White.copy(alpha = 0.9f))
        }
        Box(
            Modifier.align(Alignment.BottomEnd).padding(end = 22.dp, bottom = 22.dp).size(96.dp).bouncy()
                .clip(org.nyao.music.ui.theme.playButtonShape(active)).background(Color.White).clickable { model.waveButton() },
            contentAlignment = Alignment.Center,
        ) {
            if (model.waveStarting) CircularProgressIndicator(color = Color.Black, modifier = Modifier.size(32.dp), strokeWidth = 3.dp)
            else Icon(if (active) NyaoIcons.Pause else NyaoIcons.PlayArrow, if (active) "Пауза" else "Запустить волну", tint = Color.Black, modifier = Modifier.size(44.dp))
        }
    }
}

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
            IconButton(onClick = { model.go(Route.Home) }) { Icon(NyaoIcons.ArrowBack, "Назад", tint = NyaoColors.Text) }
            Text("Моя волна", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
            Box(Modifier.size(48.dp))
        }
        // Фигуры по краям (как на ПК), два «печенья»-подложки и большая кнопка
        Box(Modifier.fillMaxWidth().height(330.dp), contentAlignment = Alignment.Center) {
            EdgeShapes(Modifier.fillMaxSize())
            // Подложки медленно вращаются навстречу друг другу, кнопка «дышит», пока играет волна
            val inf = rememberInfiniteTransition(label = "waveBg")
            val spin by inf.animateFloat(0f, (2 * Math.PI).toFloat(), infiniteRepeatable(tween(40000, easing = LinearEasing)), label = "spin")
            val breath by inf.animateFloat(1f, 1.05f, infiniteRepeatable(tween(1400), RepeatMode.Reverse), label = "breath")
            val k = if (active) 1f else 0f
            val b = if (active) breath else 1f
            // Mono: кнопка белая, как в шапке главной
            val mono = org.nyao.music.ui.theme.Look.current.mono
            val btnBg = if (mono) Color.White else NyaoColors.Lavender
            val btnFg = if (mono) Color.Black else NyaoColors.OnLavender
            Box(Modifier.size(264.dp).graphicsLayer { scaleX = b; scaleY = b }.clip(PolarShape(12, 0.045f, spin / 12f * k)).background(NyaoColors.Tonal))
            Box(Modifier.size(226.dp).clip(PolarShape(12, 0.03f, (Math.PI / 12).toFloat() - spin / 12f * k)).background(androidx.compose.ui.graphics.lerp(NyaoColors.Tonal, NyaoColors.Hero, 0.45f)))
            Box(
                Modifier.size(180.dp).bouncy().clip(org.nyao.music.ui.theme.playButtonShape(active)).background(btnBg).clickable { model.waveButton() },
                contentAlignment = Alignment.Center,
            ) {
                if (model.waveStarting) CircularProgressIndicator(color = btnFg, modifier = Modifier.size(44.dp))
                else Icon(if (active) NyaoIcons.Pause else NyaoIcons.PlayArrow, if (active) "Пауза" else "Слушать", tint = btnFg, modifier = Modifier.size(76.dp))
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
        if (t?.waveReason != null) Text(t.waveReason, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
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
        Text("Если свежих лайков мало, подбор расширится до остальных любимых и рекомендаций.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        // Свежесть: насколько волна тянется к недавним лайкам
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            var liveFresh by remember { mutableStateOf<Float?>(null) }
            val fresh = liveFresh ?: settings.waveFresh.toFloat()
            Row(Modifier.padding(horizontal = 4.dp)) {
                Label("Свежесть")
                Spacer(Modifier.weight(1f))
                Text(
                    when {
                        fresh >= 80 -> "Приоритет недавних лайков"
                        fresh >= 50 -> "Недавнее чаще"
                        fresh >= 20 -> "Немного свежее"
                        else -> "Все лайки поровну"
                    },
                    style = MaterialTheme.typography.labelMedium, color = NyaoColors.Lavender,
                )
            }
            androidx.compose.material3.Slider(
                value = fresh, onValueChange = { liveFresh = it }, valueRange = 0f..100f, steps = 9,
                onValueChangeFinished = {
                    Repo.prefs.setFresh((liveFresh ?: fresh).toInt())
                    liveFresh = null
                    onChanged()
                },
            )
            Row(Modifier.padding(horizontal = 4.dp)) {
                Text("Всё время", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, modifier = Modifier.weight(1f))
                Text("Что слушаю сейчас", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            val ya = accounts[SOURCE_YA] != null
            val extras = listOf("yt" to "YouTube", "sc" to "SoundCloud", "vk" to "VK", "sp" to "Spotify").filter { accounts[it.first] != null }.joinToString(" + ") { it.second }
            val yt = extras.isNotEmpty()
            Row(Modifier.padding(horizontal = 4.dp)) {
                Text("Яндекс ${100 - share}%", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Muted, modifier = Modifier.weight(1f))
                Text("$share% ${extras.ifEmpty { "Другие сервисы" }}", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Muted)
            }
            BalanceBar(share, onChange = { liveShare = it }, onFinish = {
                liveShare = null
                Repo.prefs.setShare(it)
                onChanged()
            })
            if (!ya || !yt) Text(
                if (!ya && !yt) "Сервисы не подключены" else if (!yt) "Другие сервисы не подключены — волна только из Яндекса" else "Яндекс не подключён — волна из остальных сервисов",
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
