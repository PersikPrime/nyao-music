@file:OptIn(ExperimentalTextApi::class)

package org.nyao.music.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
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

/** Палитра из макетов «Android · Material Expressive» */
object NyaoColors {
    val Bg = Color(0xFF141218)
    val S1 = Color(0xFF1D1B25)
    val S2 = Color(0xFF211F26)
    val S3 = Color(0xFF2B2930)
    val Tonal = Color(0xFF2B2638)
    val Lavender = Color(0xFFCBB8FF)
    val OnLavender = Color(0xFF21005D)
    val Primary = Color(0xFF4F378B)
    val OnPrimary = Color(0xFFEADDFF)
    val Hero = Color(0xFF3E2F7A)
    val Text = Color(0xFFE6E0E9)
    val Muted = Color(0xFFCAC4D0)
    val Outline = Color(0xFF958DA5)
    val Ya = Color(0xFFFFD60A)
    val Yt = Color(0xFFFF6A5C)
    val YtBadge = Color(0xFFE5281F)
    val Sc = Color(0xFFFF5500)
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

private val Scheme = darkColorScheme(
    primary = NyaoColors.Lavender,
    onPrimary = NyaoColors.OnLavender,
    primaryContainer = NyaoColors.Primary,
    onPrimaryContainer = NyaoColors.OnPrimary,
    secondary = NyaoColors.Lavender,
    onSecondary = NyaoColors.OnLavender,
    secondaryContainer = NyaoColors.Tonal,
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

/** Тема из макетов: фиксированная лавандовая палитра, Unbounded для заголовков и Onest для текста */
@Composable
fun NyaoTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, typography = NyaoType, shapes = NyaoShapes, content = content)
}

val TextStyle.tabular: TextStyle get() = copy(fontFeatureSettings = "tnum")
