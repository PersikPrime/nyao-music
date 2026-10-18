package org.nyao.music.playback

import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.nyao.music.data.Repo

/**
 * Push от сервера Nyao (Firebase): заявки, приглашения в комнату, треки и реакции друзей,
 * когда приложение закрыто. Сервер шлёт только data — уведомление рисуем сами.
 */
class NyaoPushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        NyaoPush.send(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        Repo.init(applicationContext)
        Friends.init(applicationContext)
        // приложение открыто — то же событие уже пришло живым каналом, второй раз не показываем
        if (Live.uiVisible) return
        Friends.notifyPush(message.data)
    }
}

object NyaoPush {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile private var sent: String? = null

    /** Вышел из аккаунта — после нового входа токен надо отправить заново */
    fun reset() {
        sent = null
    }

    /** Отдать токен устройства серверу (после входа и при каждом запуске — вдруг сменился) */
    fun register() {
        if (!Repo.cloud.loggedIn) return
        runCatching {
            FirebaseMessaging.getInstance().token.addOnSuccessListener { send(it) }
        }
    }

    fun send(token: String) {
        if (!Repo.cloud.loggedIn || token == sent) return
        scope.launch {
            runCatching { Repo.cloud.setPushToken(token) }.onSuccess { sent = token }
        }
    }
}
