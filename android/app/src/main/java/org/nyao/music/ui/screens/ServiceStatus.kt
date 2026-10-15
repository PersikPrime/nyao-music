package org.nyao.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.nyao.music.data.Repo
import org.nyao.music.data.sourceName
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.components.NyaoIcons
import org.nyao.music.ui.theme.NyaoColors

/** Наши три волны (как на значке приложения) */
@Composable
private fun Waves(modifier: Modifier = Modifier) {
    androidx.compose.foundation.Canvas(modifier) {
        val w = size.width
        val h = size.height
        val stroke = h * 0.13f
        listOf(Color(0xFFFFD60A) to -0.12f, NyaoColors.Lavender to 0f, Color(0xFFFF6A5C) to 0.12f).forEach { (c, dy) ->
            val p = androidx.compose.ui.graphics.Path()
            val y = h * (0.5f + dy)
            val amp = h * 0.26f
            p.moveTo(w * 0.08f, y)
            p.cubicTo(w * 0.2f, y - amp * 1.6f, w * 0.3f, y - amp * 1.6f, w * 0.38f, y)
            p.cubicTo(w * 0.46f, y + amp * 1.6f, w * 0.56f, y + amp * 1.6f, w * 0.64f, y)
            p.cubicTo(w * 0.72f, y - amp * 1.6f, w * 0.84f, y - amp * 1.6f, w * 0.92f, y)
            drawPath(p, c, style = Stroke(width = stroke, cap = StrokeCap.Round))
        }
    }
}

/** Техработы: заглушка на весь экран. Скачанное можно слушать и сейчас */
@Composable
fun MaintenanceScreen(model: AppModel) {
    val st by Repo.status.collectAsState()
    val m = st.maintenance
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    val offline by org.nyao.music.playback.Offline.state.collectAsState()
    Column(
        Modifier.fillMaxSize().background(NyaoColors.Ink).padding(horizontal = 28.dp).navigationBarsPadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterVertically),
    ) {
        Box(Modifier.size(168.dp).clip(CircleShape).background(NyaoColors.Tonal), contentAlignment = Alignment.Center) {
            Waves(Modifier.size(width = 104.dp, height = 60.dp))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(m.title.ifBlank { "Скоро вернёмся" }, style = MaterialTheme.typography.headlineLarge, textAlign = TextAlign.Center)
            Text(
                m.text.ifBlank { "Nyao на техобслуживании — чиним сервер. Музыка вернётся сама." },
                style = MaterialTheme.typography.bodyLarge, color = NyaoColors.Muted, textAlign = TextAlign.Center,
            )
        }
        if (m.until.isNotBlank()) Row(
            Modifier.height(36.dp).clip(RoundedCornerShape(18.dp)).background(NyaoColors.Hero).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) { Text(m.until, color = NyaoColors.OnPrimary, style = MaterialTheme.typography.labelLarge) }
        Column(Modifier.fillMaxWidth().padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (offline.tracks.isNotEmpty()) Button(
                onClick = { org.nyao.music.playback.PlayerConnection.playList(offline.tracks, 0, "Скачанное") },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = NyaoColors.Lavender, contentColor = NyaoColors.OnLavender),
            ) {
                Icon(NyaoIcons.Download, null, modifier = Modifier.size(20.dp))
                Text("  Слушать скачанное · ${offline.tracks.size}")
            }
            FilledTonalButton(
                onClick = {
                    checking = true
                    scope.launch {
                        val s = runCatching { Repo.refreshStatus() }.getOrNull()
                        checking = false
                        if (s?.maintenance?.active == true) model.message("Пока ещё чиним — загляни чуть позже")
                    }
                },
                enabled = !checking,
                modifier = Modifier.fillMaxWidth().height(56.dp),
            ) { Text(if (checking) "Проверяю…" else "Проверить снова") }
        }
        Text("Лайки, плейлисты и входы в сервисы в порядке", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Outline, textAlign = TextAlign.Center)
    }
}

/** Плашка «сервис не отвечает» для главной */
@Composable
fun OutageBanner(modifier: Modifier = Modifier) {
    val st by Repo.status.collectAsState()
    var hidden by remember { mutableStateOf(emptySet<String>()) }
    val list = st.outages.filter { it !in hidden }
    if (list.isEmpty()) return
    val names = list.joinToString(", ") { sourceName(it) }
    val one = list.size == 1
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Color(0xFF4A2532)).padding(start = 16.dp, top = 14.dp, bottom = 14.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { list.forEach { ServiceLogo(it, 36) } }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("$names ${if (one) "сейчас не отвечает" else "сейчас не отвечают"}", style = MaterialTheme.typography.titleSmall, color = Color(0xFFFFD9DE))
            Text(
                "${if (one) "Его" else "Их"} треки в волне и поиске пока пропускаем, остальное работает. Вернётся — подключим сами.",
                style = MaterialTheme.typography.bodySmall, color = Color(0xFFFFD9DE).copy(alpha = 0.85f),
            )
        }
        IconButton(onClick = { hidden = hidden + list }) { Icon(NyaoIcons.Close, "Скрыть", tint = Color(0xFFFFD9DE)) }
    }
}
