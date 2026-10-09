package org.nyao.music.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import org.nyao.music.BuildConfig
import org.nyao.music.data.Repo
import org.nyao.music.data.SOURCE_YA
import org.nyao.music.data.SOURCE_YT
import org.nyao.music.ui.AppModel
import org.nyao.music.ui.components.NyaoWaves
import org.nyao.music.ui.components.rememberMorphShape
import org.nyao.music.ui.theme.NyaoColors

private const val STEPS = 4

/** Приветствие при первом запуске: что это → вход в сервисы → характер волны → готово */
@Composable
fun OnboardingScreen(model: AppModel) {
    var step by rememberSaveable { mutableIntStateOf(0) }
    val accounts by Repo.accounts.collectAsState()
    val any = accounts[SOURCE_YA] != null || accounts[SOURCE_YT] != null

    fun finish(startWave: Boolean) {
        Repo.prefs.setOnboarded(true)
        model.accountsChanged()
        if (startWave) model.startWave()
    }

    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AnimatedContent(
            step,
            transitionSpec = {
                val dir = if (targetState > initialState) 1 else -1
                (slideInHorizontally { it / 3 * dir } + fadeIn()) togetherWith (slideOutHorizontally { -it / 3 * dir } + fadeOut())
            },
            modifier = Modifier.weight(1f).widthIn(max = 520.dp).fillMaxWidth(),
            label = "onboarding",
        ) { s ->
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                when (s) {
                    0 -> Welcome()
                    1 -> Accounts(model)
                    2 -> {
                        Title("Настрой «Мою волну»", "Всё это меняется на экране волны в любой момент.")
                        WaveSettings(onChanged = {}, showMood = false, modifier = Modifier.padding(top = 16.dp))
                    }
                    else -> Done(any, onWave = { finish(true) }, onSkip = { finish(false) })
                }
            }
        }
        if (step < STEPS - 1) {
            Row(Modifier.fillMaxWidth().widthIn(max = 520.dp).padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    if (step > 0) TextButton(onClick = { step-- }) { Text("Назад") }
                }
                Dots(step)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    Button(onClick = { step++ }) {
                        Text(
                            when {
                                step == 0 -> "Начать"
                                step == 1 && !any -> "Пропустить"
                                else -> "Дальше"
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Dots(step: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(STEPS) { i ->
            val w by animateDpAsState(if (i == step) 22.dp else 7.dp, label = "dot")
            Box(
                Modifier.height(7.dp).width(w).clip(CircleShape).background(
                    if (i <= step) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                ),
            )
        }
    }
}

@Composable
private fun Logo(size: Int = 148) {
    val shape = rememberMorphShape(true, lobes = 10, maxDepth = 0.05f)
    Box(Modifier.size(size.dp).clip(shape).background(NyaoColors.Ink), contentAlignment = Alignment.Center) {
        NyaoWaves(Modifier.size((size * 0.66f).dp), strokeDp = size / 13f)
    }
}

@Composable
private fun Title(title: String, sub: String) {
    Text(title, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
    Spacer(Modifier.height(8.dp))
    Text(sub, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
}

@Composable
private fun Welcome() {
    Logo()
    Spacer(Modifier.height(28.dp))
    Text("Nyao Music", style = MaterialTheme.typography.displaySmall)
    Spacer(Modifier.height(12.dp))
    Text(
        "Одна «Моя волна» из Яндекс Музыки и YouTube Music. Яндекс подбирает основу, YouTube подмешивает треки, которых там нет.",
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(16.dp))
    Text("версия ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline)
}

@Composable
private fun Accounts(model: AppModel) {
    val accounts by Repo.accounts.collectAsState()
    Title("Подключи сервисы", "Откроется обычная страница входа сервиса. Пароль в Nyao не попадает — сохраняется только токен.")
    Spacer(Modifier.height(20.dp))
    listOf(SOURCE_YA, SOURCE_YT).forEach { svc ->
        val acc = accounts[svc]
        Row(
            Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(28.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ServiceLogo(svc)
            Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                Text(if (svc == SOURCE_YA) "Яндекс Музыка" else "YouTube Music", style = MaterialTheme.typography.titleMedium)
                Text(
                    acc?.let { "Вход выполнен: ${it.name}" }
                        ?: if (svc == SOURCE_YA) "Даёт «Мою волну», лайки и плейлисты" else "Подмешивает треки в волну",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (acc != null) {
                Box(Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Check, "Подключено", tint = MaterialTheme.colorScheme.onPrimary)
                }
            } else {
                FilledTonalButton(onClick = { model.loginFor = svc }) { Text("Войти") }
            }
        }
    }
    Spacer(Modifier.height(10.dp))
    Text(
        "Можно подключить позже в «Настройках». Если Google не пускает во встроенное окно, там же есть вставка cookies вручную.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.outline,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun Done(any: Boolean, onWave: () -> Unit, onSkip: () -> Unit) {
    Logo(120)
    Spacer(Modifier.height(24.dp))
    Title(
        "Готово",
        if (any) "Волна соберётся из подключённых сервисов. Лайки и «не нравится» её подстраивают."
        else "Сервисы не подключены — поиск YouTube уже работает, а для волны войди в аккаунт в «Настройках».",
    )
    Spacer(Modifier.height(28.dp))
    if (any) {
        Button(onClick = onWave, modifier = Modifier.fillMaxWidth().height(56.dp)) { Text("Запустить «Мою волну»") }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onSkip) { Text("Перейти в плеер") }
    } else {
        Button(onClick = onSkip, modifier = Modifier.fillMaxWidth().height(56.dp)) { Text("Перейти в плеер") }
    }
    Spacer(Modifier.height(16.dp))
    Text("версия ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.outline)
}
