package org.nyao.music.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

/**
 * Пружинное «нажатие»: элемент чуть сжимается под пальцем и отскакивает обратно.
 * Ставится в начало цепочки модификаторов; касание не перехватывает, clickable дальше работает как обычно.
 */
fun Modifier.bouncy(pressedScale: Float = 0.93f): Modifier = composed {
    var pressed by remember { mutableStateOf(false) }
    val s by animateFloatAsState(
        if (pressed) pressedScale else 1f,
        spring(dampingRatio = 0.42f, stiffness = 650f),
        label = "bouncy",
    )
    this
        .graphicsLayer {
            scaleX = s
            scaleY = s
        }
        .pointerInput(Unit) {
            awaitEachGesture {
                awaitFirstDown(requireUnconsumed = false)
                pressed = true
                waitForUpOrCancellation()
                pressed = false
            }
        }
}

/** Появление при первом показе: элемент всплывает снизу с небольшой задержкой по номеру (лесенка) */
fun Modifier.appear(index: Int = 0, offsetDp: Float = 28f): Modifier = composed {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(index.coerceIn(0, 10) * 35L)
        a.animateTo(1f, spring(dampingRatio = 0.75f, stiffness = 260f))
    }
    this.graphicsLayer {
        alpha = a.value.coerceIn(0f, 1f)
        translationY = (1f - a.value) * offsetDp.dp.toPx()
        val sc = 0.96f + 0.04f * a.value
        scaleX = sc
        scaleY = sc
    }
}
