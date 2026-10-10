package org.nyao.music.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.expandVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Computer
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import org.nyao.music.data.CloudDevice
import org.nyao.music.data.RemoteNow
import org.nyao.music.data.Repo
import org.nyao.music.data.formatTime
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.components.Cover
import org.nyao.music.ui.components.bouncy
import org.nyao.music.ui.theme.NyaoColors

private val TelegramBlue = Color(0xFF2AABEE)

/** Аватар аккаунта Nyao: фото из Telegram или первая буква */
@Composable
fun NyaoAvatar(size: Int = 52) {
    val user by Repo.cloud.user.collectAsState()
    Box(
        Modifier.size(size.dp).clip(CircleShape).background(Brush.linearGradient(listOf(NyaoColors.Lavender, Color(0xFF7F6BFF)))),
        contentAlignment = Alignment.Center,
    ) {
        val pic = user?.picture
        if (pic != null) AsyncImage(model = pic, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        else Text((user?.name?.firstOrNull() ?: 'N').uppercase(), color = NyaoColors.OnLavender, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
    }
}

private fun ago(iso: String): String {
    val at = runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return ""
    val m = (System.currentTimeMillis() - at) / 60_000
    return when {
        m < 2 -> "сейчас"
        m < 60 -> "$m мин назад"
        m < 60 * 24 -> "${m / 60} ч назад"
        else -> "${m / 60 / 24} дн назад"
    }
}

/** Карточка в настройках: вход через Telegram, устройства, выход */
@Composable
fun NyaoAccountCard(model: AppModel) {
    val context = LocalContext.current
    val user by Repo.cloud.user.collectAsState()
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<CloudDevice>?>(null) }
    LaunchedEffect(user != null) {
        devices = if (user != null) runCatching { Repo.cloud.devices() }.getOrNull() else null
    }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(Brush.linearGradient(listOf(NyaoColors.Tonal, MaterialTheme.colorScheme.surfaceContainer)))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            NyaoAvatar()
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(user?.name ?: "Аккаунт Nyao", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    when {
                        user != null -> (user?.username?.let { "@$it · " } ?: "") + "синхронизация включена"
                        model.cloudLogging -> "Подтверди вход в Telegram и возвращайся сюда"
                        else -> "История, волна без повторов и «продолжить с компа»"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            when {
                user != null -> OutlinedButton(onClick = { model.cloudLogout() }) { Text("Выйти") }
                model.cloudLogging -> TextButton(onClick = { model.cancelCloudLogin() }) { Text("Отмена") }
                else -> Button(
                    onClick = { model.cloudLogin(context) },
                    colors = ButtonDefaults.buttonColors(containerColor = TelegramBlue, contentColor = Color.White),
                ) { Text("Telegram") }
            }
        }
        if (model.cloudLogging) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            Text("Жду подтверждения…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val list = devices
        if (user != null && list != null) {
            Text("Устройства", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            list.forEach { d ->
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(NyaoColors.S2).padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(if (d.platform == "android") Icons.Rounded.PhoneAndroid else Icons.Rounded.Computer, null, tint = NyaoColors.Lavender)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(d.device.ifBlank { "Устройство" }, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(if (d.current) "это устройство" else "был ${ago(d.lastSeen)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!d.current) TextButton(onClick = {
                        scope.launch {
                            runCatching { Repo.cloud.removeDevice(d.id) }
                            devices = runCatching { Repo.cloud.devices() }.getOrNull()
                        }
                    }) { Text("Отключить") }
                }
            }
        }
        Text(
            "Токены Яндекса, YouTube и SoundCloud на сервер не отправляются — они остаются только на телефоне.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Карточка на главной: «Продолжить с ПК» */
@Composable
fun ContinueCard(model: AppModel, r: RemoteNow, modifier: Modifier = Modifier) {
    val visible = remember { mutableStateOf(false) }
    LaunchedEffect(r.deviceId) { visible.value = true }
    AnimatedVisibility(visible.value, enter = fadeIn() + expandVertically(), modifier = modifier) {
        Row(
            Modifier.fillMaxWidth().bouncy().clip(RoundedCornerShape(28.dp))
                .background(Brush.horizontalGradient(listOf(NyaoColors.Hero, NyaoColors.S1)))
                .clickable { model.resume(r) }
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Cover(r.track.cover, Modifier.size(60.dp), RoundedCornerShape(18.dp))
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                val pos = if (r.playing) r.positionSec + (System.currentTimeMillis() - r.updatedAt) / 1000.0 else r.positionSec
                Text("Продолжить с «${r.device}»", style = MaterialTheme.typography.labelMedium, color = NyaoColors.Lavender, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(r.track.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${r.track.artist} · ${formatTime(minOf(pos.toInt(), if (r.track.duration > 0) r.track.duration else pos.toInt()))}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box(Modifier.size(48.dp).clip(CircleShape).background(NyaoColors.Lavender), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.PlayArrow, "Продолжить", tint = NyaoColors.OnLavender)
            }
            IconButton(onClick = { model.dismissOther(r) }) { Icon(Icons.Rounded.Close, "Скрыть", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
