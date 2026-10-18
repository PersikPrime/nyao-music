package org.nyao.music.ui.theme

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.nyao.music.ui.components.PolarShape
import org.nyao.music.ui.components.rememberPlayShape

/** Большая кнопка «играть» (волна): печенька, которая на паузе морфится в квадрат, круг или скруглённый квадрат */
@Composable
fun playButtonShape(active: Boolean): Shape = when (Look.current.buttons) {
    "circle" -> CircleShape
    "square" -> RoundedCornerShape(28)
    else -> rememberPlayShape(active)
}

/** Небольшие круглые кнопки (мини-плеер и т. п.) в той же форме, что и большие */
fun smallButtonShape(): Shape = when (Look.current.buttons) {
    "circle" -> CircleShape
    "square" -> RoundedCornerShape(16.dp)
    else -> PolarShape(9, 0.08f)
}

/** Форма обложек в лентах и сетках */
fun coverShape(radius: Dp): Shape = when (Look.current.covers) {
    "square" -> RoundedCornerShape(6.dp)
    "cookie" -> PolarShape(9, 0.05f)
    else -> RoundedCornerShape(radius)
}
