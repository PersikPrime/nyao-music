package org.nyao.music.playback

import android.media.audiofx.Equalizer
import android.util.Log
import kotlin.math.abs
import kotlin.math.ln

/** Полосы и пресеты — те же, что у эквалайзера на ПК (src/renderer/eq.js) */
object EqPresets {
    val BANDS = listOf(31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000)

    val ALL = listOf(
        Triple("flat", "Ровно", listOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 0)),
        Triple("bass", "Бас", listOf(6, 5, 4, 2, 0, 0, 0, 0, 0, 0)),
        Triple("vocal", "Вокал", listOf(-2, -1, 0, 2, 4, 4, 3, 1, 0, -1)),
        Triple("treble", "Высокие", listOf(0, 0, 0, 0, 0, 1, 2, 4, 5, 6)),
        Triple("rock", "Рок", listOf(4, 3, 2, 0, -1, -1, 1, 2, 3, 4)),
        Triple("electronic", "Электроника", listOf(5, 4, 1, 0, -2, 1, 0, 2, 4, 5)),
        Triple("acoustic", "Акустика", listOf(3, 2, 1, 1, 2, 2, 2, 3, 2, 1)),
        Triple("night", "Тихо ночью", listOf(-4, -3, -2, 0, 1, 2, 2, 1, -1, -3)),
    )

    fun label(hz: Int): String = if (hz >= 1000) "${hz / 1000}к" else hz.toString()

    /** Усиление на произвольной частоте: линейно по логарифму частоты между нашими 10 полосами */
    fun gainAt(gains: List<Int>, hz: Double): Double {
        val x = ln(hz.coerceIn(BANDS.first().toDouble(), BANDS.last().toDouble()))
        for (i in 0 until BANDS.size - 1) {
            val a = ln(BANDS[i].toDouble())
            val b = ln(BANDS[i + 1].toDouble())
            if (x <= b) return gains[i] + (gains[i + 1] - gains[i]) * ((x - a) / (b - a))
        }
        return gains.last().toDouble()
    }
}

/**
 * Системный эквалайзер Android на звуковой сессии плеера.
 * У телефонов разное число полос (обычно 5) — наши 10 полос пересчитываются на их частоты.
 */
class NyaoEqualizer {
    private var eq: Equalizer? = null
    private var session = 0

    fun attach(sessionId: Int, on: Boolean, gains: List<Int>) {
        if (sessionId == 0) return
        if (sessionId != session) {
            release()
            session = sessionId
            eq = runCatching { Equalizer(0, sessionId) }.onFailure { Log.w("Nyao", "эквалайзер недоступен: ${it.message}") }.getOrNull()
        }
        apply(on, gains)
    }

    fun apply(on: Boolean, gains: List<Int>) {
        val e = eq ?: return
        runCatching {
            if (!on) {
                e.enabled = false
                return
            }
            val range = e.bandLevelRange // миллибелы, обычно -1500..1500
            val min = range[0].toInt()
            val max = range[1].toInt()
            for (b in 0 until e.numberOfBands) {
                val hz = e.getCenterFreq(b.toShort()) / 1000.0
                val mb = (EqPresets.gainAt(gains, hz) * 100).toInt().coerceIn(min, max)
                e.setBandLevel(b.toShort(), mb.toShort())
            }
            e.enabled = gains.any { abs(it) > 0 }
        }.onFailure { Log.w("Nyao", "эквалайзер: ${it.message}") }
    }

    fun release() {
        runCatching { eq?.release() }
        eq = null
        session = 0
    }
}
