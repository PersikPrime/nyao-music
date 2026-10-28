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

/**
 * Оформление 0.8: готовая тема (Expressive / Mono / Glass) и то, что можно собрать поверх неё —
 * форма кнопок, сетка главной, форма обложек, подписи в панели.
 */
data class UiLook(
    val theme: String = "expressive",
    val buttons: String = "cookie",   // cookie | circle | square
    val grid: String = "carousels",   // carousels | tiles | mosaic
    val covers: String = "rounded",   // rounded | square | cookie
    val navLabels: Boolean = true,
) {
    val mono: Boolean get() = theme == "mono"
    val glass: Boolean get() = theme == "glass"

    companion object {
        /** Что меняет готовая тема, если ничего не собирать самому */
        fun preset(theme: String) = when (theme) {
            "mono" -> UiLook("mono", buttons = "circle", grid = "carousels", covers = "rounded", navLabels = false)
            "glass" -> UiLook("glass", buttons = "circle", grid = "tiles", covers = "rounded", navLabels = true)
            else -> UiLook("expressive")
        }
        val themes = listOf("expressive" to "Expressive", "mono" to "Mono", "glass" to "Glass")
    }
}

/** Фон и поверхности темы (акцент — отдельно, из AccentPalette) */
data class BasePalette(
    val bg: Color, val s1: Color, val s2: Color, val s3: Color,
    val text: Color, val muted: Color, val outline: Color, val outlineVariant: Color, val lowest: Color, val highest: Color,
) {
    companion object {
        val Expressive = BasePalette(Color(0xFF141218), Color(0xFF1D1B25), Color(0xFF211F26), Color(0xFF2B2930), Color(0xFFE6E0E9), Color(0xFFCAC4D0), Color(0xFF958DA5), Color(0xFF49454F), Color(0xFF0F0D13), Color(0xFF36343B))
        val Mono = BasePalette(Color(0xFF0B0B0C), Color(0xFF141416), Color(0xFF1A1A1C), Color(0xFF242427), Color(0xFFF2F2F3), Color(0xFF9A9AA2), Color(0xFF6E6E76), Color(0xFF2E2E32), Color(0xFF060607), Color(0xFF2E2E32))
        // стекло: полупрозрачные поверхности поверх цветного фона
        val Glass = BasePalette(Color(0xFF0E0C16), Color(0x14FFFFFF), Color(0x1AFFFFFF), Color(0x24FFFFFF), Color(0xFFF5F5F7), Color(0xB3F5F5F7), Color(0x80F5F5F7), Color(0x33FFFFFF), Color(0x0AFFFFFF), Color(0x2EFFFFFF))
        fun of(theme: String) = when (theme) { "mono" -> Mono; "glass" -> Glass; else -> Expressive }
    }
}

object Look {
    var current by mutableStateOf(UiLook())
    val base: BasePalette get() = BasePalette.of(current.theme)
}

/** Текущая палитра. Читается из NyaoColors — экраны перерисовываются сами, когда она меняется */
object Accent {
    var palette by mutableStateOf(AccentPalette.Lavender)
    val ids = listOf("lavender" to "Лаванда", "coral" to "Коралл", "mint" to "Мята", "sun" to "Солнце", "cover" to "Из обложки")
}

/** Палитра из макетов «Android · Material Expressive» */
object NyaoColors {
    val Bg: Color get() = Look.base.bg
    val S1: Color get() = Look.base.s1
    val S2: Color get() = Look.base.s2
    val S3: Color get() = Look.base.s3
    // Mono: акцент только точками — выбранное белым, крупные плашки серыми
    val Tonal: Color get() = if (Look.current.mono) Color(0xFF222225) else Accent.palette.tonal
    val Lavender: Color get() = Accent.palette.a
    val OnLavender: Color get() = Accent.palette.onA
    val Primary: Color get() = if (Look.current.mono) Color(0xFFF2F2F3) else Accent.palette.container
    val OnPrimary: Color get() = if (Look.current.mono) Color(0xFF0B0B0C) else Accent.palette.onContainer
    val Hero: Color get() = if (Look.current.mono) Color(0xFF1C1C1E) else Accent.palette.hero
    val Text: Color get() = Look.base.text
    val Muted: Color get() = Look.base.muted
    val Outline: Color get() = Look.base.outline
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

private fun scheme(p: AccentPalette, b: BasePalette, mono: Boolean, glass: Boolean = false) = darkColorScheme(
    primary = p.a,
    onPrimary = p.onA,
    primaryContainer = if (mono) Color(0xFFF2F2F3) else p.container,
    onPrimaryContainer = if (mono) Color(0xFF0B0B0C) else p.onContainer,
    secondary = p.a,
    onSecondary = p.onA,
    secondaryContainer = if (mono) Color(0xFF222225) else p.tonal,
    onSecondaryContainer = b.text,
    tertiary = Color(0xFFFFB4A8),
    onTertiary = Color(0xFF561E16),
    background = b.bg,
    onBackground = b.text,
    surface = b.bg,
    onSurface = b.text,
    surfaceVariant = b.s3,
    onSurfaceVariant = b.muted,
    // Glass: шторки, меню и диалоги почти непрозрачные — иначе текст под ними мешает читать
    surfaceContainerLowest = b.lowest,
    surfaceContainerLow = if (glass) Color(0xF2161320) else b.s1,
    surfaceContainer = if (glass) Color(0xE61C1828) else b.s2,
    surfaceContainerHigh = if (glass) Color(0xF5221E30) else b.s3,
    surfaceContainerHighest = if (glass) Color(0xF52A2638) else b.highest,
    outline = b.outline,
    outlineVariant = b.outlineVariant,
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
    val look = Look.current
    val colors = remember(p, look.theme) { scheme(p, BasePalette.of(look.theme), look.mono, look.glass) }
    // прикол «Рукописный шрифт» из раздела «Разработчик»
    val type = if (org.nyao.music.ui.Pranks.has("comic")) remember { org.nyao.music.ui.Pranks.cursive(NyaoType) } else NyaoType
    MaterialTheme(colorScheme = colors, typography = type, shapes = NyaoShapes, content = content)
}

val TextStyle.tabular: TextStyle get() = copy(fontFeatureSettings = "tnum")
