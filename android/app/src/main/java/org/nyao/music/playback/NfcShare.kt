package org.nyao.music.playback

import android.nfc.NdefMessage
import android.nfc.NdefRecord
import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * «Приложи телефон»: пока открыт экран «Поделиться профилем», телефон отвечает как NFC-метка
 * (NDEF Type 4) со ссылкой-приглашением. Другой телефон читает её как обычную метку: Android с Nyao
 * открывает профиль сразу, без Nyao — страницу приглашения (iPhone тоже умеет читать такие метки).
 * В остальное время служба молчит — никаких случайных срабатываний.
 */
object NfcShare {
    @Volatile private var ndef: ByteArray? = null
    @Volatile private var until = 0L
    @Volatile var onRead: (() -> Unit)? = null

    fun start(url: String, seconds: Int = 120) {
        val msg = NdefMessage(arrayOf(NdefRecord.createUri(url), NdefRecord.createApplicationRecord("org.nyao.music")))
        ndef = msg.toByteArray()
        until = System.currentTimeMillis() + seconds * 1000L
    }

    fun stop() {
        ndef = null
        until = 0L
    }

    /** NDEF-файл: 2 байта длины + сообщение. null — сейчас ничем не делимся */
    internal fun file(): ByteArray? {
        val m = ndef ?: return null
        if (System.currentTimeMillis() > until) {
            stop()
            return null
        }
        return byteArrayOf((m.size shr 8).toByte(), (m.size and 0xFF).toByte()) + m
    }
}

class NfcShareService : HostApduService() {
    private enum class Sel { NONE, CC, NDEF }
    private var selected = Sel.NONE
    private var appSelected = false

    private val ok = byteArrayOf(0x90.toByte(), 0x00)
    private val notFound = byteArrayOf(0x6A.toByte(), 0x82.toByte())
    private val wrong = byteArrayOf(0x6D.toByte(), 0x00)

    // Capability Container: версия 2.0, MLe/MLc, файл NDEF E104 до 4 КБ, только чтение
    private val cc = byteArrayOf(
        0x00, 0x0F, 0x20, 0x00, 0x3B, 0x00, 0x34,
        0x04, 0x06, 0xE1.toByte(), 0x04, 0x10, 0x00, 0x00, 0xFF.toByte(),
    )

    override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
        if (apdu.size < 4) return wrong
        val ins = apdu[1].toInt() and 0xFF
        val p1 = apdu[2].toInt() and 0xFF
        return when (ins) {
            0xA4 -> select(apdu, p1)
            0xB0 -> read(apdu)
            else -> wrong
        }
    }

    private fun select(apdu: ByteArray, p1: Int): ByteArray {
        if (p1 == 0x04) {
            // выбор приложения NDEF по AID D2760000850101 — отвечаем, только если сейчас делимся
            val aid = byteArrayOf(0xD2.toByte(), 0x76, 0x00, 0x00, 0x85.toByte(), 0x01, 0x01)
            val lc = if (apdu.size > 4) apdu[4].toInt() and 0xFF else 0
            val got = if (apdu.size >= 5 + lc) apdu.copyOfRange(5, 5 + lc) else byteArrayOf()
            appSelected = got.contentEquals(aid) && NfcShare.file() != null
            selected = Sel.NONE
            return if (appSelected) ok else notFound
        }
        if (!appSelected || apdu.size < 7) return notFound
        val id = ((apdu[5].toInt() and 0xFF) shl 8) or (apdu[6].toInt() and 0xFF)
        selected = when (id) {
            0xE103 -> Sel.CC
            0xE104 -> Sel.NDEF
            else -> Sel.NONE
        }
        return if (selected == Sel.NONE) notFound else ok
    }

    private fun read(apdu: ByteArray): ByteArray {
        val data = when (selected) {
            Sel.CC -> cc
            Sel.NDEF -> NfcShare.file() ?: return notFound
            Sel.NONE -> return notFound
        }
        val offset = ((apdu[2].toInt() and 0xFF) shl 8) or (apdu[3].toInt() and 0xFF)
        val le = if (apdu.size > 4) (apdu[4].toInt() and 0xFF).let { if (it == 0) 256 else it } else 256
        if (offset > data.size) return byteArrayOf(0x6B, 0x00)
        val end = minOf(data.size, offset + le)
        if (selected == Sel.NDEF && end == data.size && offset > 0) NfcShare.onRead?.invoke()
        return data.copyOfRange(offset, end) + ok
    }

    override fun onDeactivated(reason: Int) {
        selected = Sel.NONE
        appSelected = false
    }
}
