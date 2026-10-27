package org.nyao.music.ui.screens

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Bundle
import android.widget.FrameLayout
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.nyao.music.data.Repo
import org.nyao.music.playback.NyaoWaveWidget
import org.nyao.music.playback.NyaoWidget
import org.nyao.music.playback.WidgetState
import org.nyao.music.playback.WidgetStyle
import org.nyao.music.playback.WidgetViews
import org.nyao.music.ui.theme.Accent
import org.nyao.music.ui.theme.NyaoColors
import org.nyao.music.ui.theme.UiLook

/**
 * «Стиль виджетов»: шесть стилей (по два на тему) с живым предпросмотром —
 * показывается настоящий виджет, тот же, что на рабочем столе.
 */
@Composable
fun WidgetStyleSettings() {
    val ctx = LocalContext.current
    val settings by Repo.prefs.settings.collectAsState()
    val current = WidgetStyle.of(settings.widgetStyle, settings.theme)
    val auto = settings.widgetStyle == "auto"
    val themeName = UiLook.themes.firstOrNull { it.first == settings.theme }?.second ?: "Expressive"
    fun choose(id: String) {
        Repo.prefs.setWidgetStyle(id)
        NyaoWidget.refreshAll(ctx)
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(
            "Виджет плеера сам перестраивается под размер: 4×1, 4×2, 2×2 и 4×3 со строкой текста песни. Отдельно есть «Моя волна» 2×2.",
            style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, modifier = Modifier.padding(horizontal = 4.dp),
        )
        val mgr = AppWidgetManager.getInstance(ctx)
        if (android.os.Build.VERSION.SDK_INT >= 26 && mgr.isRequestPinAppWidgetSupported) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = { mgr.requestPinAppWidget(ComponentName(ctx, NyaoWidget::class.java), null, null) }) { Text("Добавить плеер") }
                FilledTonalButton(onClick = { mgr.requestPinAppWidget(ComponentName(ctx, NyaoWaveWidget::class.java), null, null) }) { Text("Добавить волну") }
            }
        }
        // «как тема»
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(MaterialTheme.colorScheme.surfaceContainer)
                .clickable { choose("auto") }.padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text("Как тема приложения", style = MaterialTheme.typography.titleSmall, color = NyaoColors.Text)
                Text("Сейчас $themeName → ${WidgetStyle.byTheme(settings.theme).title}", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            }
            Check(auto)
        }
        WidgetStyle.entries.forEach { st ->
            StyleCard(st, selected = !auto && st == current) { choose(st.id) }
        }
    }
}

@Composable
private fun Check(on: Boolean) {
    Box(
        Modifier.size(22.dp).clip(CircleShape)
            .then(if (on) Modifier.background(Accent.palette.a) else Modifier.border(2.dp, NyaoColors.Outline, CircleShape)),
        contentAlignment = Alignment.Center,
    ) {
        if (on) Box(Modifier.size(8.dp).clip(CircleShape).background(Accent.palette.onA))
    }
}

@Composable
private fun StyleCard(st: WidgetStyle, selected: Boolean, onClick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .then(if (selected) Modifier.border(2.dp, Accent.palette.a, RoundedCornerShape(28.dp)) else Modifier)
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        // подложка «обои», чтобы стекло было видно
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
                .background(Brush.verticalGradient(listOf(Color(0xFF9FB7CC), Color(0xFF8C8F7A), Color(0xFF4E4A3C))))
                .padding(10.dp),
        ) {
            WidgetPreview(st, onClick)
        }
        Row(Modifier.padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text(st.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = NyaoColors.Text)
                Text(st.note, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            }
            Check(selected)
        }
    }
}

/** Настоящий виджет 4×2 в выбранном стиле (касания перехватывает карточка) */
@Composable
private fun WidgetPreview(st: WidgetStyle, onClick: () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth().height(170.dp)) {
        val wDp = maxWidth.value.toInt()
        val state = NyaoWidget.last.takeIf { it.live } ?: WidgetState(title = "Название трека", artist = "Исполнитель", playing = true, progress = 0.42f)
        AndroidView(
            factory = { FrameLayout(it) },
            update = { fl ->
                val opts = Bundle().apply {
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, wDp)
                    putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 170)
                }
                fl.removeAllViews()
                runCatching { fl.addView(WidgetViews.player(fl.context, st, state, opts).apply(fl.context, fl)) }
            },
            modifier = Modifier.fillMaxSize(),
        )
        // прозрачный слой: касание выбирает стиль, а не жмёт кнопки предпросмотра
        Box(Modifier.fillMaxSize().clickable(onClick = onClick))
    }
}
