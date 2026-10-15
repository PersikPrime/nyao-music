@file:OptIn(ExperimentalTextApi::class)

package org.nyao.music.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.nyao.music.R

/**
 * Акцентный цвет (как в Android 16): Лаванда, Коралл, Мята, Солнце или «Из обложки».
 * a — основной, onA — текст на нём, container/onContainer — тональные кнопки, hero — крупные плашки, tonal — выбранное.
 */
data class AccentPalette(
    val a: Color,
    val onA: Color,
    val container: Color,
    val onContainer: Color,
    val hero: Color,
    val tonal: Color,
) {
    companion object {
        val Lavender = AccentPalette(Color(0xFFCBB8FF), Color(0xFF21005D), Color(0xFF4F378B), Color(0xFFEADDFF), Color(0xFF3E2F7A), Color(0xFF2B2638))
        val Coral = AccentPalette(Color(0xFFFFB4A8), Color(0xFF561E16), Color(0xFF73342A), Color(0xFFFFDAD4), Color(0xFF6B2A20), Color(0xFF3A2522))
        val Mint = AccentPalette(Color(0xFF83D5BC), Color(0xFF00382C), Color(0xFF005141), Color(0xFFA0F2D8), Color(0xFF0F4A3C), Color(0xFF1F2E29))
        val Sun = AccentPalette(Color(0xFFF0CC2E), Color(0xFF3A3000), Color(0xFF544600), Color(0xFFFFE16D), Color(0xFF4A3D00), Color(0xFF2F2B1C))

        fun preset(id: String): AccentPalette = when (id) {
            "coral" -> Coral
            "mint" -> Mint
            "sun" -> Sun
            else -> Lavender
        }
    }
}

/** Текущая палитра. Читается из NyaoColors — экраны перерисовываются сами, когда она меняется */
object Accent {
    var palette by mutableStateOf(AccentPalette.Lavender)
    val ids = listOf("lavender" to "Лаванда", "coral" to "Коралл", "mint" to "Мята", "sun" to "Солнце", "cover" to "Из обложки")
}

/** Палитра из макетов «Android · Material Expressive» */
object NyaoColors {
    val Bg = Color(0xFF141218)
    val S1 = Color(0xFF1D1B25)
    val S2 = Color(0xFF211F26)
    val S3 = Color(0xFF2B2930)
    val Tonal: Color get() = Accent.palette.tonal
    val Lavender: Color get() = Accent.palette.a
    val OnLavender: Color get() = Accent.palette.onA
    val Primary: Color get() = Accent.palette.container
    val OnPrimary: Color get() = Accent.palette.onContainer
    val Hero: Color get() = Accent.palette.hero
    val Text = Color(0xFFE6E0E9)
    val Muted = Color(0xFFCAC4D0)
    val Outline = Color(0xFF958DA5)
    val Ya = Color(0xFFFFD60A)
    val Yt = Color(0xFFFF6A5C)
    val YtBadge = Color(0xFFE5281F)
    val Sc = Color(0xFFFF5500)
    val Vk = Color(0xFF0077FF)
    val Ink = Color(0xFF13111C)
}

private fun unbounded(w: Int) = Font(R.font.unbounded, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
private fun onest(w: Int) = Font(R.font.onest, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))

val Unbounded = FontFamily(unbounded(600), unbounded(700), unbounded(800))
val Onest = FontFamily(onest(400), onest(500), onest(600), onest(700))

private fun display(size: Int, w: Int = 800) = TextStyle(fontFamily = Unbounded, fontWeight = FontWeight(w), fontSize = size.sp, lineHeight = (size * 1.05f).sp, letterSpacing = (-0.02f * size).sp)
private fun body(size: Int, w: Int = 400, lh: Float = 1.4f) = TextStyle(fontFamily = Onest, fontWeight = FontWeight(w), fontSize = size.sp, lineHeight = (size * lh).sp)

private val NyaoType = Typography(
    displayLarge = display(42),
    displayMedium = display(34),
    displaySmall = display(30),
    headlineLarge = display(30),
    headlineMedium = display(26, 700),
    headlineSmall = display(20, 700),
    titleLarge = body(18, 700, 1.3f),
    titleMedium = body(16, 700, 1.3f),
    titleSmall = body(14, 700, 1.3f),
    bodyLarge = body(16),
    bodyMedium = body(14),
    bodySmall = body(12),
    labelLarge = body(14, 700, 1.2f),
    labelMedium = body(12, 700, 1.2f),
    labelSmall = body(11, 600, 1.2f),
)

private fun scheme(p: AccentPalette) = darkColorScheme(
    primary = p.a,
    onPrimary = p.onA,
    primaryContainer = p.container,
    onPrimaryContainer = p.onContainer,
    secondary = p.a,
    onSecondary = p.onA,
    secondaryContainer = p.tonal,
    onSecondaryContainer = NyaoColors.Text,
    tertiary = Color(0xFFFFB4A8),
    onTertiary = Color(0xFF561E16),
    background = NyaoColors.Bg,
    onBackground = NyaoColors.Text,
    surface = NyaoColors.Bg,
    onSurface = NyaoColors.Text,
    surfaceVariant = NyaoColors.S3,
    onSurfaceVariant = NyaoColors.Muted,
    surfaceContainerLowest = Color(0xFF0F0D13),
    surfaceContainerLow = NyaoColors.S1,
    surfaceContainer = NyaoColors.S2,
    surfaceContainerHigh = NyaoColors.S3,
    surfaceContainerHighest = Color(0xFF36343B),
    outline = NyaoColors.Outline,
    outlineVariant = Color(0xFF49454F),
)

private val NyaoShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(28.dp),
    extraLarge = RoundedCornerShape(36.dp),
)

/** Тема из макетов: палитра акцентного цвета, Unbounded для заголовков и Onest для текста */
@Composable
fun NyaoTheme(content: @Composable () -> Unit) {
    val p = Accent.palette
    val colors = remember(p) { scheme(p) }
    MaterialTheme(colorScheme = colors, typography = NyaoType, shapes = NyaoShapes, content = content)
}

val TextStyle.tabular: TextStyle get() = copy(fontFeatureSettings = "tnum")
