package org.nyao.music.ui.screens

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.nyao.music.BuildConfig
import org.nyao.music.data.LyricsApi
import org.nyao.music.data.Maintenance
import org.nyao.music.data.Net
import org.nyao.music.data.Repo
import org.nyao.music.data.SvcStatus
import org.nyao.music.playback.PlaybackEvents
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.theme.NyaoColors

/**
 * Раздел «Разработчик» — виден аккаунтам, которые сервер Nyao отметил разработчиками (NYAO_DEV_IDS).
 * Всё здесь — локальные проверки на этом телефоне: на сервере ничего не включается.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DevSettings() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val clip = LocalClipboardManager.current
    val current by PlayerConnection.current.collectAsState()
    var probe by remember { mutableStateOf<List<LyricsApi.Probe>?>(null) }
    var probing by remember { mutableStateOf(false) }
    var ping by remember { mutableStateOf<List<Triple<String, Long, String>>?>(null) }
    var pinging by remember { mutableStateOf(false) }

    @Composable
    fun Group(title: String, content: @Composable () -> Unit) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = NyaoColors.Text)
            content()
        }
    }

    @Composable
    fun Kv(k: String, v: String) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(k, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted, modifier = Modifier.width(120.dp))
            Text(v, style = MaterialTheme.typography.bodySmall, color = NyaoColors.Text)
        }
    }

    @Composable
    fun Buttons(vararg items: Pair<String, () -> Unit>) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items.forEach { (label, onClick) -> FilledTonalButton(onClick = onClick) { Text(label) } }
        }
    }

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Group("Сборка") {
            Kv("Версия", BuildConfig.VERSION_NAME)
            Kv("Канал сборки", BuildConfig.CHANNEL)
            Kv("Канал обновлений", org.nyao.music.data.Updates.channel())
            Kv("Устройство", "${Build.MANUFACTURER} ${Build.MODEL}")
            Kv("Android", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            val rt = Runtime.getRuntime()
            Kv("Память", "${(rt.totalMemory() - rt.freeMemory()) / 1048576} из ${rt.maxMemory() / 1048576} МБ")
        }

        Group("Тексты песен") {
            val t = current
            Text(if (t != null) "Текущий трек: ${t.artist} — ${t.title}" else "Включи трек, чтобы проверить источники", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            probe?.forEach { p ->
                val l = p.lyrics
                Kv(
                    LyricsApi.PROVIDER_NAMES[p.id] ?: p.id,
                    "${p.ms} мс · " + when {
                        l == null || l.lines.isEmpty() -> "нет"
                        l.words -> "по словам · ${l.lines.size} стр."
                        l.synced -> "с таймингами · ${l.lines.size} стр."
                        else -> "без таймингов · ${l.lines.size} стр."
                    },
                )
            }
            Buttons(
                (if (probing) "Проверяю…" else "Прогнать все источники") to {
                    val tr = current
                    if (tr != null && !probing) {
                        probing = true
                        scope.launch {
                            probe = withContext(Dispatchers.IO) { LyricsApi.probe(tr) }
                            probing = false
                        }
                    }
                },
                "Искать тексты заново" to {
                    LyricsApi.clearCache()
                    PlaybackEvents.emit("Тексты будут найдены заново")
                },
            )
        }

        Group("Воспроизведение") {
            Text(current?.let { "Источник: ${it.source} · ${it.id}" } ?: "Ничего не играет", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            Buttons(
                "В конец трека" to {
                    val d = PlayerConnection.durationMs()
                    if (d > 8000) PlayerConnection.seekTo(d - 6000)
                },
            )
        }

        Group("Сеть и сервер") {
            ping?.forEach { (name, ms, res) -> Kv(name, "$ms мс · $res") }
            Buttons(
                (if (pinging) "Пингую…" else "Пинг серверов") to {
                    if (!pinging) {
                        pinging = true
                        scope.launch {
                            ping = listOf(
                                "API Nyao" to "${org.nyao.music.data.NyaoCloud.BASE}/health",
                                "Зеркало" to org.nyao.music.data.Updates.MIRROR,
                                "LyricLabs" to "https://api.corrode5-15.withnyao.app/",
                                "GitHub" to "https://api.github.com/zen",
                            ).map { (name, url) ->
                                async {
                                    val t0 = System.currentTimeMillis()
                                    val res = runCatching { Net.call(Request.Builder().url(url).header("User-Agent", "NyaoMusic-Android").build()).first }
                                        .fold({ "HTTP $it" }, { it.message ?: "ошибка" })
                                    Triple(name, System.currentTimeMillis() - t0, res)
                                }
                            }.awaitAll()
                            pinging = false
                        }
                    }
                },
            )
        }

        Group("Статус-экраны") {
            Text("Только на этом телефоне. Техработы ставят музыку на паузу, как настоящие.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            Buttons(
                "Техработы" to {
                    PlayerConnection.pauseIfPlaying()
                    Repo.status.value = SvcStatus(Maintenance(true, "Скоро вернёмся", "Это предпросмотр экрана техработ из раздела «Разработчик».", "Примерно через 15 минут"))
                },
                "Сбой Яндекса и YouTube" to { Repo.status.value = SvcStatus(outages = listOf("ya", "yt")) },
                "Настоящий статус" to { scope.launch { Repo.refreshStatus() } },
            )
        }

        Group("Android") {
            Buttons(
                "Обновить виджеты" to { org.nyao.music.playback.NyaoWidget.refreshAll(ctx) },
                "Тестовое уведомление" to {
                    org.nyao.music.playback.Friends.notifyPush(mapOf("title" to "Nyao Music", "body" to "Тестовое уведомление из раздела «Разработчик»"))
                },
                "Очистить кэш обложек" to {
                    val loader = coil3.SingletonImageLoader.get(ctx)
                    loader.memoryCache?.clear()
                    loader.diskCache?.clear()
                    PlaybackEvents.emit("Кэш обложек очищен")
                },
            )
        }

        Group("Стабильность") {
            Text("Проверка отчёта о сбое и перезапуска. Приложение закроется.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            Buttons("Уронить приложение" to { throw RuntimeException("Проверочный сбой из раздела «Разработчик»") })
        }

        Group("Журналы") {
            Buttons(
                "Скопировать диагностику" to {
                    val s = Repo.prefs.settings.value
                    val text = buildString {
                        appendLine("Nyao Music ${BuildConfig.VERSION_NAME} · канал ${BuildConfig.CHANNEL}")
                        appendLine("${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
                        appendLine("Статус: ${Repo.status.value}")
                        appendLine("Тема: ${s.theme} · акцент ${s.accent} · виджеты ${s.widgetStyle} · обновления ${s.updateChannel.ifEmpty { "как у сборки" }}")
                        appendLine("Тексты: ${LyricsApi.order(s.lyricsOrder)} · караоке важнее: ${s.lyricsWordsFirst}")
                    }
                    clip.setText(AnnotatedString(text))
                    PlaybackEvents.emit("Диагностика скопирована (без токенов)")
                },
            )
        }

        Group("Приколы") {
            Text("Ломают вид, но приложение работает. Только до перезапуска; «Сбросить приколы» — всё как было.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                org.nyao.music.ui.Pranks.LIST.forEach { (id, title, _) ->
                    androidx.compose.material3.FilterChip(
                        selected = org.nyao.music.ui.Pranks.has(id),
                        onClick = { org.nyao.music.ui.Pranks.toggle(id) },
                        label = { Text(title) },
                    )
                }
            }
        }

        Group("Флаги") {
            Text("Экспериментальных флагов пока нет — новые фичи сначала будут появляться здесь.", style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted)
        }
    }
}

