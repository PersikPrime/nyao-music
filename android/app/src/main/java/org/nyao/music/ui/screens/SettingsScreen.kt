package org.nyao.music.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.nyao.music.BuildConfig
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.SOURCE_YT
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.Route
import org.nyao.music.ui.components.NyaoWaves
import org.nyao.music.ui.components.sourceColor
import org.nyao.music.ui.theme.NyaoColors

@Composable
fun SettingsScreen(model: AppModel) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding().padding(16.dp).padding(BottomInset),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Настройки", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.padding(start = 4.dp, top = 4.dp, bottom = 4.dp))
        NyaoAccountCard(model)
        ViewSettingsCard()
        Text("Сервисы", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
        ServiceCard(model, SOURCE_YA)
        ServiceCard(model, SOURCE_YT)
        ServiceCard(model, org.nyao.music.data.SOURCE_SC)
        ServiceCard(model, org.nyao.music.data.SOURCE_VK)

        Text("Моя волна", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
        OutlinedButton(onClick = { model.go(Route.Wave) }, modifier = Modifier.fillMaxWidth()) { Text("Характер, настроение и баланс источников") }

        EqCard()
        LastFmCard(model)
        CacheCard()
        UpdateCard(model)

        Text("О приложении", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(NyaoColors.Ink), contentAlignment = Alignment.Center) {
                    NyaoWaves(Modifier.size(40.dp), animate = false, strokeDp = 3.5f)
                }
                Column(Modifier.padding(start = 14.dp)) {
                    Text("Nyao Music", style = MaterialTheme.typography.titleLarge)
                    Text("версия ${BuildConfig.VERSION_NAME}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text(
                "Оба сервиса подключены через неофициальные API — после их обновлений что-то может сломаться. Для личного пользования.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = { Repo.prefs.setOnboarded(false) }) { Text("Показать приветствие снова") }
        }
    }
}

@Composable
private fun ServiceCard(model: AppModel, source: String) {
    val accounts by Repo.accounts.collectAsState()
    val acc = accounts[source]
    val ya = source == SOURCE_YA
    val isSc = source == org.nyao.music.data.SOURCE_SC
    val isVk = source == org.nyao.music.data.SOURCE_VK
    val scope = rememberCoroutineScope()
    var manual by remember { mutableStateOf(false) }
    var vkLog by remember { mutableStateOf<String?>(null) }
    var value by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            ServiceLogo(source)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(org.nyao.music.data.sourceName(source), style = MaterialTheme.typography.titleMedium)
                Text(
                    if (acc != null) "Вход выполнен: ${acc.name}" + (if (ya && acc.plus == false) " · без Плюса треки могут не играть" else if (isSc) " · треки Go+ пропускаются" else if (isVk) " · бета" else "")
                    else if (isSc) "Не подключено · поиск работает и без входа" else if (isVk) "Не подключено · бета" else "Не подключено",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (acc != null) {
                OutlinedButton(onClick = {
                    scope.launch {
                        when {
                            ya -> Repo.setYandexToken(null)
                            isSc -> Repo.setScToken(null)
                            isVk -> Repo.setVk(null, null)
                            else -> Repo.setYtCookie(null)
                        }
                        // cookie только этого сервиса — чтобы не выкинуло из остальных
                        if (isSc) Repo.clearCookies("https://soundcloud.com", "https://api-v2.soundcloud.com", "https://secure.soundcloud.com")
                        else if (!ya && !isVk) Repo.clearCookies("https://music.youtube.com", "https://www.youtube.com", "https://youtube.com", "https://accounts.google.com", "https://www.google.com", "https://google.com")
                        model.accountsChanged()
                    }
                }) { Text("Выйти") }
            } else {
                Button(onClick = { model.loginFor = source }) { Text("Войти") }
            }
        }
        if (isVk) {
            TextButton(onClick = { vkLog = Repo.vk.debugText().ifBlank { "Сбоев пока не было." } }) { Text("Что-то не работает?") }
            vkLog?.let { log ->
                val clip = androidx.compose.ui.platform.LocalClipboardManager.current
                androidx.compose.material3.AlertDialog(
                    onDismissRequest = { vkLog = null },
                    title = { Text("Журнал VK") },
                    text = {
                        Text(
                            log,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                        )
                    },
                    confirmButton = { TextButton(onClick = { clip.setText(androidx.compose.ui.text.AnnotatedString(log)); model.message("Скопировано") }) { Text("Скопировать") } },
                    dismissButton = { TextButton(onClick = { vkLog = null }) { Text("Закрыть") } },
                )
            }
            return@Column
        }
        TextButton(onClick = { manual = !manual }) {
            Text(if (ya) "Вставить OAuth-токен вручную" else if (isSc) "Вставить токен вручную (cookie oauth_token)" else "Вставить cookies вручную (если Google не пускает)")
        }
        if (manual) {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text(if (ya) "y0_AgAAAA…" else if (isSc) "2-123456-…" else "SAPISID=…; __Secure-3PAPISID=…; …") },
                shape = RoundedCornerShape(16.dp),
                minLines = if (ya || isSc) 1 else 3,
            )
            FilledTonalButton(onClick = {
                scope.launch {
                    when {
                        ya -> Repo.setYandexToken(value)
                        isSc -> Repo.setScToken(value)
                        else -> Repo.setYtCookie(value)
                    }
                    value = ""
                    manual = false
                    model.accountsChanged()
                    model.message("Сохранено")
                }
            }, enabled = value.isNotBlank()) { Text("Сохранить") }
            if (!ya && !isSc) Text(
                "Cookies можно скопировать из десктопной версии Nyao или из браузера, где ты вошёл в music.youtube.com (нужны SAPISID и __Secure-3PSID).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun ServiceLogo(source: String, size: Int = 48) {
    val ya = source == SOURCE_YA
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size / 3.5f).dp)).background(sourceColor(source)), contentAlignment = Alignment.Center) {
        Text(org.nyao.music.ui.components.sourceShort(source), color = if (ya) Color.Black else Color.White, fontWeight = FontWeight.Bold)
    }
}

/** Last.fm: подключение через подтверждение в браузере */
@Composable
private fun LastFmCard(model: AppModel) {
    val st by Repo.lastfm.state.collectAsState()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(14.dp)).background(Color(0xFFD51007)), contentAlignment = Alignment.Center) {
            Text("fm", color = Color.White, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text("Last.fm", style = MaterialTheme.typography.titleMedium)
            Text(
                when {
                    !st.configured -> "В этой сборке Last.fm выключен"
                    st.waiting -> "Подтверди доступ на странице Last.fm…"
                    st.name != null -> "Подключено: ${st.name}" + (if (st.queued > 0) " · ждут отправки: ${st.queued}" else "")
                    else -> "Записывает прослушанное из всех сервисов в твой профиль"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        when {
            !st.configured -> Unit
            st.waiting -> OutlinedButton(onClick = { Repo.lastfm.cancel() }) { Text("Отмена") }
            st.name != null -> OutlinedButton(onClick = { Repo.lastfm.disconnect(); model.message("Last.fm отключён") }) { Text("Отключить") }
            else -> Button(onClick = {
                scope.launch {
                    try {
                        val name = Repo.lastfm.connect { url ->
                            runCatching { ctx.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        }
                        model.message("Last.fm подключён: $name")
                    } catch (e: Exception) {
                        if (e !is kotlinx.coroutines.CancellationException) model.message(e.message ?: "Не получилось подключить Last.fm")
                    }
                }
            }) { Text("Подключить") }
        }
    }
}

/** Эквалайзер: пресеты и 10 полос, как на ПК. Работает через системный эквалайзер телефона */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun EqCard() {
    val s by Repo.prefs.settings.collectAsState()
    Text("Звук", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Выравнивать громкость", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Треки из разных сервисов звучат одинаково громко — по данным Яндекса и YouTube. SoundCloud и VK такие данные не дают.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            androidx.compose.material3.Switch(checked = s.normalize, onCheckedChange = { Repo.prefs.setNormalize(it) })
        }
        Column {
            Text("Плавные переходы", style = MaterialTheme.typography.titleSmall)
            Text(
                if (s.fade > 0) "Трек затихает за ${s.fade} с до конца, следующий плавно нарастает" else "Выключены — треки сменяются сразу",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            androidx.compose.material3.Slider(
                value = s.fade.toFloat(),
                onValueChange = { v -> Math.round(v).let { if (it != s.fade) Repo.prefs.setFade(it) } },
                valueRange = 0f..10f,
                steps = 9,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Эквалайзер", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Настраивает звук всех сервисов. Выключен — звук без изменений.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            androidx.compose.material3.Switch(checked = s.eqOn, onCheckedChange = { Repo.prefs.setEq(it, s.eqPreset, s.eqGains) })
        }
        if (s.eqOn) {
            androidx.compose.foundation.layout.FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                org.nyao.music.playback.EqPresets.ALL.forEach { (id, name, gains) ->
                    org.nyao.music.ui.components.PillChip(name, s.eqPreset == id, { Repo.prefs.setEq(true, id, gains) })
                }
                if (s.eqPreset == "custom") org.nyao.music.ui.components.PillChip("Свой", true, {})
            }
            org.nyao.music.playback.EqPresets.BANDS.forEachIndexed { i, hz ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        org.nyao.music.playback.EqPresets.label(hz),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(width = 40.dp, height = 20.dp),
                    )
                    androidx.compose.material3.Slider(
                        value = s.eqGains[i].toFloat(),
                        onValueChange = { v ->
                            val g = s.eqGains.toMutableList().also { it[i] = Math.round(v) }
                            if (g != s.eqGains) Repo.prefs.setEq(true, "custom", g)
                        },
                        valueRange = -12f..12f,
                        steps = 23,
                        modifier = Modifier.weight(1f),
                    )
                    val g = s.eqGains[i]
                    Text(
                        (if (g > 0) "+" else "") + g,
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(start = 8.dp).size(width = 32.dp, height = 20.dp),
                    )
                }
            }
        }
    }
}

/** Кэш прослушанного: сколько занято и кнопка очистки */
@Composable
private fun CacheCard() {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var used by remember { mutableStateOf<Long?>(null) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        used = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { org.nyao.music.playback.PlaybackCache.sizeBytes(context) }
    }
    Text("Кэш", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val mb = (used ?: 0L) / (1024 * 1024)
        Text(if (used == null) "Считаю…" else "Занято $mb МБ из ${org.nyao.music.playback.PlaybackCache.MAX_BYTES / (1024 * 1024)} МБ", style = MaterialTheme.typography.titleSmall)
        Text(
            "Прослушанные треки сохраняются на телефон: повторно они играют с диска и без интернета. Старые удаляются сами, когда место кончается.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = {
            scope.launch {
                kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { org.nyao.music.playback.PlaybackCache.clear(context) }
                used = 0L
            }
        }, enabled = (used ?: 0L) > 0L) { Text("Очистить кэш") }
    }
}

/**
 * Центр обновлений: сравнивает номер сборки с последним релизом на GitHub.
 * APK скачивается браузером — после загрузки Android сам предложит установить его поверх.
 */
@Composable
private fun UpdateCard(model: AppModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var checking by remember { mutableStateOf(false) }
    var info by remember { mutableStateOf<org.nyao.music.data.UpdateInfo?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    fun check() {
        checking = true
        error = null
        scope.launch {
            try {
                info = org.nyao.music.data.Updates.check(BuildConfig.VERSION_CODE)
            } catch (e: Exception) {
                error = e.message
            }
            checking = false
        }
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { check() }
    Text("Обновления", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 4.dp, top = 8.dp))
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        val i = info
        Text(
            when {
                checking -> "Проверяю обновления…"
                error != null -> "Не получилось: $error"
                i != null && i.available -> "Доступна версия ${i.label} · ${i.apkSize / (1024 * 1024)} МБ"
                i != null -> "Установлена последняя версия" + (i.label?.let { " ($it)" } ?: "")
                else -> "Сейчас: ${BuildConfig.VERSION_NAME}"
            },
            style = MaterialTheme.typography.titleSmall,
        )
        Text("Сейчас установлена ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (i != null && i.available && i.notes.isNotBlank()) {
            Text(i.notes.take(400), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (i != null && i.available && i.apkUrl != null) {
                Button(onClick = {
                    context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(i.apkUrl)))
                    model.message("APK скачивается в браузере — открой его, чтобы установить")
                }) { Text("Скачать ${i.label}") }
            } else {
                OutlinedButton(onClick = { check() }, enabled = !checking) { Text("Проверить") }
            }
            if (i?.pageUrl != null) TextButton(onClick = {
                context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(i.pageUrl)))
            }) { Text("Релизы") }
        }
    }
}
