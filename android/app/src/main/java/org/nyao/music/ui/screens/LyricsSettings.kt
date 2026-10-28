package org.nyao.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.unit.dp
import org.nyao.music.data.LyricsApi
import org.nyao.music.data.Repo
import org.nyao.music.ui.components.NyaoIcons
import org.nyao.music.ui.theme.NyaoColors

/** «Текст песни»: порядок провайдеров — как порядок загрузки дисков; первый с таймингами побеждает */
@Composable
fun LyricsSettings() {
    val s by Repo.prefs.settings.collectAsState()
    val order = LyricsApi.order(s.lyricsOrder)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Текст ищется сверху вниз: берётся первый с таймингами. Если таймингов нет нигде — первый найденный текст.",
            style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, modifier = Modifier.padding(horizontal = 4.dp),
        )
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(vertical = 6.dp)) {
            order.forEachIndexed { i, (id, on) ->
                Row(
                    Modifier.fillMaxWidth().padding(start = 16.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.size(28.dp).clip(CircleShape).background(NyaoColors.S3), contentAlignment = Alignment.Center) {
                        Text("${i + 1}", style = MaterialTheme.typography.labelLarge, color = NyaoColors.Text)
                    }
                    Column(Modifier.weight(1f).alpha(if (on) 1f else 0.5f)) {
                        Text(LyricsApi.PROVIDER_NAMES[id] ?: id, style = MaterialTheme.typography.titleSmall, color = NyaoColors.Text)
                        Text(LyricsApi.PROVIDER_CAPS[id] ?: "", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
                    }
                    IconButton(onClick = { Repo.prefs.setLyricsOrder(order.toMutableList().apply { add(i - 1, removeAt(i)) }) }, enabled = i > 0) {
                        Icon(NyaoIcons.KeyboardArrowDown, "Выше", modifier = Modifier.rotate(180f))
                    }
                    IconButton(onClick = { Repo.prefs.setLyricsOrder(order.toMutableList().apply { add(i + 1, removeAt(i)) }) }, enabled = i < order.lastIndex) {
                        Icon(NyaoIcons.KeyboardArrowDown, "Ниже")
                    }
                    Switch(checked = on, onCheckedChange = { v ->
                        val next = order.map { if (it.first == id) it.first to v else it }
                        // хотя бы один источник остаётся включённым
                        if (next.any { it.second }) Repo.prefs.setLyricsOrder(next)
                    })
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text("Караоке LyricLabs важнее порядка", style = MaterialTheme.typography.titleSmall, color = NyaoColors.Text)
                Text("Если в Nyao LyricLabs у песни размечены слова — берётся он, даже когда источник выше нашёл текст по строкам", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            }
            Switch(checked = s.lyricsWordsFirst, onCheckedChange = { Repo.prefs.setLyricsWordsFirst(it) })
        }
        TextButton(onClick = {
            Repo.prefs.setLyricsOrder(null)
            Repo.prefs.setLyricsWordsFirst(true)
        }) { Text("Сбросить по умолчанию") }
    }
}
