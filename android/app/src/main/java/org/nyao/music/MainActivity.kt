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
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

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
            NyaoTheme { org.nyao.music.ui.PrankFrame { NyaoRoot() } }
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
        // виджет «Моя волна», пока музыка не играла: открыли приложение — сразу запускаем волну
        if (intent.action == org.nyao.music.playback.NyaoWidget.ACTION_OPEN_WAVE) {
            intent.action = null
            lifecycleScope.launch {
                runCatching { PlayerConnection.startWave() }
                    .onFailure { org.nyao.music.playback.PlaybackEvents.emit(it.message ?: "Волна не запустилась") }
            }
            return
        }
        var uri = intent.data
        if (uri == null && intent.action == android.nfc.NfcAdapter.ACTION_NDEF_DISCOVERED) {
            @Suppress("DEPRECATION")
            val msgs = intent.getParcelableArrayExtra(android.nfc.NfcAdapter.EXTRA_NDEF_MESSAGES)
            uri = msgs?.filterIsInstance<android.nfc.NdefMessage>()?.flatMap { it.records.toList() }?.firstNotNullOfOrNull { runCatching { it.toUri() }.getOrNull() }
        }
        // ответ входа в Spotify
        if (org.nyao.music.spotify.Spotify.auth.isRedirect(uri)) {
            val u = uri!!
            intent.data = null
            lifecycleScope.launch {
                runCatching {
                    org.nyao.music.spotify.Spotify.auth.handleRedirect(u)
                    org.nyao.music.spotify.Spotify.blocked = null
                    Repo.refreshAccounts()
                }.onSuccess { org.nyao.music.playback.PlaybackEvents.emit("Spotify подключён") }
                    .onFailure { org.nyao.music.playback.PlaybackEvents.emit(it.message ?: "Не удалось войти в Spotify") }
            }
            return
        }
        org.nyao.music.ui.screens.inviteCode(uri)?.let { org.nyao.music.playback.Friends.inviteLinks.value = it }
        // комната, профиль, трек из ссылки «Поделиться» (music.withnyao.app/share/… или nyao://…)
        org.nyao.music.ui.screens.roomCode(uri)?.let { org.nyao.music.playback.Friends.roomLinks.value = it to null }
        org.nyao.music.ui.screens.profileNick(uri)?.let { org.nyao.music.playback.Friends.profileLinks.value = it }
        org.nyao.music.ui.screens.sharedTrack(uri)?.let { org.nyao.music.playback.Friends.trackLinks.value = it }
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
