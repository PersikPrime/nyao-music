package org.nyao.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_SP
import org.nyao.music.spotify.Spotify
import org.nyao.music.spotify.SpotifyAuth
import org.nyao.music.spotify.SpotifyEngine
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.components.PolarShape
import org.nyao.music.ui.components.sourceColor
import org.nyao.music.ui.theme.NyaoColors

/**
 * Spotify в настройках: свой Client ID → вход (PKCE) → плеер.
 * Приложения Spotify в режиме разработки пускают только тех, кого владелец добавил вручную,
 * поэтому каждый подключает собственное приложение из Spotify Developer Dashboard.
 */
@Composable
fun SpotifyCard(model: AppModel) {
    val accounts by Repo.accounts.collectAsState()
    val acc = accounts[SOURCE_SP]
    val loggedIn by Spotify.auth.loggedIn.collectAsState()
    val status by Spotify.engine.status.collectAsState()
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val clip = LocalClipboardManager.current
    val color = sourceColor(SOURCE_SP)
    var clientId by remember { mutableStateOf(Spotify.auth.clientId) }
    var log by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }

    fun act(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            runCatching { block() }.onFailure { model.message(it.message ?: "Spotify: ошибка") }
            busy = false
        }
    }

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.fillMaxWidth()) {
            Box(Modifier.matchParentSize().background(Brush.radialGradient(listOf(color.copy(alpha = 0.35f), Color.Transparent))))
            Column(
                Modifier.fillMaxWidth().padding(vertical = 18.dp).clip(RoundedCornerShape(32.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainer.copy(alpha = 0.85f)).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(76.dp).clip(PolarShape(9, 0.06f)).background(color), contentAlignment = Alignment.Center) {
                    Text("SP", color = Color.Black, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleLarge)
                }
                Text(if (loggedIn) "Spotify подключён" else "Подключить Spotify", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 8.dp))
                Text(
                    when {
                        loggedIn && acc?.plus == false -> "Вход выполнен: ${acc.name} · без Premium плеер Spotify не играет, работают только поиск и библиотека"
                        loggedIn -> "Вход выполнен: ${acc?.name ?: "…"}. Звук идёт из официального плеера Spotify — прослушивания засчитываются в твой Spotify."
                        else -> "Поиск, «Любимые треки», плейлисты и воспроизведение через официальный Web Playback SDK. Нужен Spotify Premium и своё приложение в Spotify for Developers."
                    },
                    style = MaterialTheme.typography.bodyMedium, color = NyaoColors.Muted, textAlign = TextAlign.Center,
                )
                if (loggedIn) {
                    Text("Плеер: " + statusText(status), style = MaterialTheme.typography.bodySmall, color = if (status is SpotifyEngine.Status.Ready) Color(0xFF8FE3B0) else NyaoColors.Muted)
                    if (status !is SpotifyEngine.Status.Ready) {
                        FilledTonalButton(onClick = { act { Spotify.engine.awaitReady(); model.message("Плеер Spotify готов") } }, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(52.dp)) { Text("Проверить плеер") }
                    }
                    OutlinedButton(onClick = { act { Repo.spotifyLogout(); model.accountsChanged() } }, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("Выйти") }
                } else {
                    Button(
                        onClick = {
                            Spotify.auth.clientId = clientId
                            runCatching { Spotify.auth.login(ctx) }.onFailure { model.message(it.message ?: "Не открылось окно входа") }
                        },
                        enabled = Regex("^[0-9a-fA-F]{32}$").matches(clientId.trim()),
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color.Black),
                    ) { Text("Войти через Spotify") }
                }
            }
        }

        if (!loggedIn) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(18.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("Один раз настроить", style = MaterialTheme.typography.titleMedium)
                Step(1, "Открой developer.spotify.com/dashboard и нажми Create app.")
                Step(2, "В Redirect URIs добавь адрес ниже — посимвольно.")
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(NyaoColors.S3).padding(start = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(SpotifyAuth.REDIRECT_URI, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    TextButton(onClick = { clip.setText(AnnotatedString(SpotifyAuth.REDIRECT_URI)); model.message("Скопировано") }) { Text("Копировать") }
                }
                Step(3, "В «Which API/SDKs are you planning to use» отметь Web API и Web Playback SDK.")
                Step(4, "В Settings → User Management добавь почту своего Spotify (и друзей — до 5 человек).")
                Step(5, "Скопируй Client ID из Basic Information и вставь сюда. Client Secret не нужен.")
                OutlinedTextField(
                    value = clientId,
                    onValueChange = { clientId = it.trim().take(64) },
                    label = { Text("Client ID") },
                    singleLine = true,
                    isError = clientId.isNotEmpty() && !Regex("^[0-9a-fA-F]{32}$").matches(clientId),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "Client ID и вход хранятся только на этом телефоне.",
                    style = MaterialTheme.typography.bodySmall, color = NyaoColors.Muted,
                )
            }
        }

        TextButton(onClick = {
            log = buildString {
                appendLine("Client ID: " + if (Spotify.auth.hasClientId) "задан" else "нет")
                appendLine("Вход: " + if (loggedIn) "да" else "нет")
                appendLine("Плеер: " + statusText(status))
                appendLine()
                append(Repo.sp.debugText().ifBlank { "Ошибок Web API пока не было." })
            }
        }) { Text("Что-то не работает?") }

        log?.let { text ->
            AlertDialog(
                onDismissRequest = { log = null },
                title = { Text("Журнал Spotify") },
                text = { Text(text, style = MaterialTheme.typography.bodySmall, modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) },
                confirmButton = { TextButton(onClick = { clip.setText(AnnotatedString(text)); model.message("Скопировано") }) { Text("Скопировать") } },
                dismissButton = { TextButton(onClick = { log = null }) { Text("Закрыть") } },
            )
        }
    }
}

@Composable
private fun Step(n: Int, text: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(24.dp).clip(RoundedCornerShape(12.dp)).background(NyaoColors.S3), contentAlignment = Alignment.Center) {
            Text("$n", style = MaterialTheme.typography.labelMedium)
        }
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
    }
}

private fun statusText(s: SpotifyEngine.Status): String = when (s) {
    SpotifyEngine.Status.Idle -> "запустится с первым треком"
    SpotifyEngine.Status.Loading -> "загружается…"
    SpotifyEngine.Status.Connecting -> "подключается…"
    is SpotifyEngine.Status.Ready -> "готов"
    is SpotifyEngine.Status.NotReady -> "нет связи, переподключается"
    is SpotifyEngine.Status.Failed -> s.message
}
