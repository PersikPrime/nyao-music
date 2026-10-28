package org.nyao.music.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.nyao.music.data.Repo
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.theme.Accent
import org.nyao.music.ui.theme.AccentPalette

/**
 * «Приколы» раздела «Разработчик» (как на ПК, src/renderer/pranks.js): ломают вид, но приложение работает.
 * Только в памяти: перезапуск приложения или кнопка «Сбросить приколы» — всё как было.
 */
object Pranks {
    val LIST = listOf(
        Triple("comic", "Рукописный шрифт", "Весь текст — от руки"),
        Triple("flip", "Вверх ногами", "Кнопки работают, просто наоборот"),
        Triple("mirror", "Зеркало", "Всё отражено слева направо"),
        Triple("drunk", "Пьяный режим", "Интерфейс покачивается"),
        Triple("rainbow", "Радуга", "Акцент бесконечно переливается"),
        Triple("giant", "Гигант", "Всё в полтора раза крупнее"),
        Triple("ant", "Муравей", "Всё мелкое"),
        Triple("chipmunk", "Бурундук", "Музыка в 1,5 раза быстрее и выше"),
        Triple("vader", "Дарт Вейдер", "Музыка медленнее и ниже"),
        Triple("cat", "Котики вместо обложек", "У всех треков одна обложка"),
    )
    private val PAIRS = mapOf("flip" to "mirror", "mirror" to "flip", "giant" to "ant", "ant" to "giant", "chipmunk" to "vader", "vader" to "chipmunk")

    val on = mutableStateListOf<String>()
    fun has(id: String) = id in on

    fun toggle(id: String) {
        if (id in on) on.remove(id) else {
            PAIRS[id]?.let { on.remove(it) }
            on.add(id)
        }
        applySpeed()
        if (id == "rainbow" && id !in on) restoreAccent()
    }

    fun resetAll() {
        val hadRainbow = "rainbow" in on
        on.clear()
        applySpeed()
        if (hadRainbow) restoreAccent()
    }

    private fun applySpeed() {
        val speed = when { has("chipmunk") -> 1.5f; has("vader") -> 0.75f; else -> 1f }
        PlayerConnection.setSpeed(speed, speed)
    }

    private fun restoreAccent() {
        val a = Repo.prefs.settings.value.accent
        if (a != "cover") Accent.palette = AccentPalette.preset(a)
    }

    /** Типографика целиком рукописным шрифтом */
    fun cursive(t: Typography): Typography {
        val f = FontFamily.Cursive
        return t.copy(
            displayLarge = t.displayLarge.copy(fontFamily = f), displayMedium = t.displayMedium.copy(fontFamily = f), displaySmall = t.displaySmall.copy(fontFamily = f),
            headlineLarge = t.headlineLarge.copy(fontFamily = f), headlineMedium = t.headlineMedium.copy(fontFamily = f), headlineSmall = t.headlineSmall.copy(fontFamily = f),
            titleLarge = t.titleLarge.copy(fontFamily = f), titleMedium = t.titleMedium.copy(fontFamily = f), titleSmall = t.titleSmall.copy(fontFamily = f),
            bodyLarge = t.bodyLarge.copy(fontFamily = f), bodyMedium = t.bodyMedium.copy(fontFamily = f), bodySmall = t.bodySmall.copy(fontFamily = f),
            labelLarge = t.labelLarge.copy(fontFamily = f), labelMedium = t.labelMedium.copy(fontFamily = f), labelSmall = t.labelSmall.copy(fontFamily = f),
        )
    }
}

private fun hsv(h: Float, s: Float, v: Float) = Color(android.graphics.Color.HSVToColor(floatArrayOf(h % 360f, s, v)))

/** Обёртка над всем приложением: поворот, качка, масштаб, радуга и кнопка сброса */
@Composable
fun PrankFrame(content: @Composable () -> Unit) {
    val flip = Pranks.has("flip")
    val mirror = Pranks.has("mirror")
    val drunk = Pranks.has("drunk")
    val scale = when { Pranks.has("giant") -> 1.5f; Pranks.has("ant") -> 0.6f; else -> 1f }
    val t = rememberInfiniteTransition(label = "prank")
    val sway by t.animateFloat(-1.4f, 1.4f, infiniteRepeatable(tween(1600), RepeatMode.Reverse), label = "sway")
    if (Pranks.has("rainbow")) {
        LaunchedEffect(Unit) {
            var h = 0f
            while (true) {
                h = (h + 6f) % 360f
                Accent.palette = AccentPalette(hsv(h, 0.35f, 1f), hsv(h, 0.9f, 0.25f), hsv(h, 0.55f, 0.45f), hsv(h, 0.15f, 0.95f), hsv(h, 0.55f, 0.4f), hsv(h, 0.3f, 0.2f))
                delay(80)
            }
        }
    }
    val d = LocalDensity.current
    Box(Modifier.fillMaxSize()) {
    CompositionLocalProvider(LocalDensity provides Density(d.density * scale, d.fontScale)) {
        Box(
            Modifier.fillMaxSize().graphicsLayer {
                rotationZ = (if (flip) 180f else 0f) + (if (drunk) sway else 0f)
                scaleX = if (mirror) -1f else 1f
                translationX = if (drunk) sway * 6f else 0f
            },
        ) { content() }
    }
    if (Pranks.on.isNotEmpty()) {
        Box(Modifier.fillMaxSize().statusBarsPadding().padding(12.dp), contentAlignment = Alignment.TopStart) {
            Button(onClick = { Pranks.resetAll() }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFF5C7A), contentColor = Color.White)) {
                Text("Сбросить приколы")
            }
        }
    }
    }
}
