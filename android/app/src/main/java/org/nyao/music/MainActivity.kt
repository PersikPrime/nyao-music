package org.nyao.music

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import org.nyao.music.data.Repo
import org.nyao.music.playback.PlayerConnection
import org.nyao.music.ui.NyaoRoot
import org.nyao.music.ui.theme.NyaoTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Repo.init(this)
        // служба «Приложи телефон» включается только на время показа экрана (после сбоя могла остаться включённой)
        org.nyao.music.playback.NfcShare.setEnabled(this, false)
        // тема и акцент — до первого кадра, чтобы Mono и Glass не мигали Expressive при запуске
        org.nyao.music.ui.theme.applyLookNow(Repo.prefs.settings.value)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        PlayerConnection.connect(this)
        // Android 13+: без разрешения не будет уведомления с кнопками плеера
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        handleLink(intent)
        setContent {
            org.nyao.music.ui.theme.AccentSync()
            NyaoTheme { NyaoRoot() }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLink(intent)
    }

    /** Приглашение в друзья (ссылка, QR, NFC) или приглашение в комнату из уведомления */
    private fun handleLink(intent: android.content.Intent?) {
        intent ?: return
        var uri = intent.data
        if (uri == null && intent.action == android.nfc.NfcAdapter.ACTION_NDEF_DISCOVERED) {
            @Suppress("DEPRECATION")
            val msgs = intent.getParcelableArrayExtra(android.nfc.NfcAdapter.EXTRA_NDEF_MESSAGES)
            uri = msgs?.filterIsInstance<android.nfc.NdefMessage>()?.flatMap { it.records.toList() }?.firstNotNullOfOrNull { runCatching { it.toUri() }.getOrNull() }
        }
        org.nyao.music.ui.screens.inviteCode(uri)?.let { org.nyao.music.playback.Friends.inviteLinks.value = it }
        // вход в комнату — только после подтверждения: такой intent может прислать любое приложение
        intent.getStringExtra("room")?.takeIf { Regex("^[A-Za-z0-9]{6}$").matches(it) }?.let { org.nyao.music.playback.Friends.roomLinks.value = it to intent.getStringExtra("roomFrom") }
        // ссылку обработали — повторный поворот экрана не должен добавлять друга ещё раз
        intent.data = null
        intent.removeExtra("room")
        intent.removeExtra("roomFrom")
    }

    // пока приложение на экране, оно на связи для Nyao Connect и «Слушать вместе»
    override fun onStart() {
        super.onStart()
        org.nyao.music.playback.Live.hold(this, "ui")
    }

    override fun onStop() {
        org.nyao.music.playback.Live.release("ui")
        super.onStop()
    }
}
