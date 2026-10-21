package org.nyao.music.playback

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.nyao.music.R
import org.nyao.music.data.Friend
import org.nyao.music.data.InboxItem
import org.nyao.music.data.MyProfile
import org.nyao.music.data.Repo
import org.nyao.music.data.Track
import org.nyao.music.data.UserCard
import org.nyao.music.data.obj
import org.nyao.music.data.str

/** Всплывашка сверху в стиле Nyao: «Takko зовёт слушать вместе» с кнопкой */
data class SocialBanner(
    val kind: String,
    val title: String,
    val body: String,
    val user: UserCard?,
    val track: Track? = null,
    val code: String? = null,
    val id: Long = System.nanoTime(),
)

/**
 * Друзья и входящие: держит списки в памяти, обновляет их по живым событиям сервера
 * и показывает всплывашки (в приложении) или уведомления (когда оно свёрнуто, а музыка играет).
 */
object Friends {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var app: Context

    private val _profile = MutableStateFlow<MyProfile?>(null)
    val profile: StateFlow<MyProfile?> = _profile
    private val _friends = MutableStateFlow<List<Friend>>(emptyList())
    val friends: StateFlow<List<Friend>> = _friends
    private val _incoming = MutableStateFlow<List<UserCard>>(emptyList())
    val incoming: StateFlow<List<UserCard>> = _incoming
    private val _outgoing = MutableStateFlow<List<UserCard>>(emptyList())
    val outgoing: StateFlow<List<UserCard>> = _outgoing
    private val _inbox = MutableStateFlow<List<InboxItem>>(emptyList())
    val inbox: StateFlow<List<InboxItem>> = _inbox
    private val _banners = MutableSharedFlow<SocialBanner>(extraBufferCapacity = 8)
    val banners: SharedFlow<SocialBanner> = _banners
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded

    /** Приглашение из ссылки / QR / касания, пока не вошёл в аккаунт — откроем после входа */
    @Volatile var pendingInvite: String? = null

    /** Ссылки, открытые снаружи (браузер, камера, NFC, уведомление) — их подхватывает интерфейс */
    val inviteLinks = MutableStateFlow<String?>(null)
    /** (код комнаты, кто позвал) — вход только после подтверждения */
    val roomLinks = MutableStateFlow<Pair<String, String?>?>(null)
    /** Профиль по нику из ссылки music.withnyao.app/share/u/… или nyao://u/… */
    val profileLinks = MutableStateFlow<String?>(null)
    /** Трек из ссылки «Поделиться» */
    val trackLinks = MutableStateFlow<org.nyao.music.data.Track?>(null)

    /** «Отправить другу» из любого списка треков — шторку выбора друга рисует интерфейс */
    val shareRequest = MutableStateFlow<Track?>(null)

    val unread: Int get() = _inbox.value.count { !it.read } + _incoming.value.size

    fun init(context: Context) {
        app = context.applicationContext
    }

    fun refreshAsync() {
        scope.launch { runCatching { refresh() } }
    }

    suspend fun refresh() {
        if (!Repo.cloud.loggedIn) return
        _profile.value = Repo.cloud.profile()
        val (f, inc, out) = Repo.cloud.friends()
        _friends.value = f
        _incoming.value = inc
        _outgoing.value = out
        _inbox.value = runCatching { Repo.cloud.inbox() }.getOrDefault(_inbox.value)
        _loaded.value = true
    }

    fun setProfile(p: MyProfile) {
        _profile.value = p
    }

    fun forget() {
        _profile.value = null
        _friends.value = emptyList()
        _incoming.value = emptyList()
        _outgoing.value = emptyList()
        _inbox.value = emptyList()
        _loaded.value = false
        NyaoPush.reset()
    }

    fun markInboxRead() {
        if (_inbox.value.none { !it.read }) return
        _inbox.value = _inbox.value.map { it.copy(read = true) }
        scope.launch { runCatching { Repo.cloud.readInbox() } }
    }

    /** Живое событие с сервера: { type: "social", kind, … } */
    fun onEvent(e: JSONObject) {
        val cloud = Repo.cloud
        when (e.optString("kind")) {
            "now" -> {
                val id = e.obj("user")?.optString("id") ?: return
                val now = cloud.parseFriendNow(e.obj("now"))
                // now: null — пауза или «невидимка»; online:false — друг спрятался, в сети его не показываем
                val hidden = e.has("online") && !e.optBoolean("online", true)
                _friends.value = _friends.value.map { if (it.user.id == id) it.copy(now = now, online = if (hidden) false else now != null || it.online) else it }
                    .sortedByDescending { it.now?.updatedAt ?: 0L }
            }
            "friend-request" -> {
                val u = cloud.parseCard(e.obj("user")) ?: return
                if (_incoming.value.none { it.id == u.id }) _incoming.value = listOf(u) + _incoming.value
                // повторная заявка от того же человека — без всплывашки
                if (!e.optBoolean("quiet")) show(SocialBanner("friend-request", "Заявка в друзья", "${u.display} хочет дружить", u))
            }
            "friend-accepted" -> {
                val u = cloud.parseCard(e.obj("user")) ?: return
                show(SocialBanner("friend-accepted", "Теперь вы друзья", "${u.display} теперь в друзьях", u))
                refreshAsync()
            }
            "track", "room", "react" -> {
                // id события — номер в очереди устройства, id записи во «Входящих» — inboxId
                val item = cloud.parseInbox(JSONObject(e.toString()).put("id", e.optString("inboxId", e.optString("id")))) ?: return
                _inbox.value = (listOf(item) + _inbox.value.filter { it.id != item.id }).take(100)
                val u = item.from
                when (item.kind) {
                    "track" -> show(SocialBanner("track", "${u.display} прислал трек${item.emoji?.let { " $it" } ?: ""}", item.track?.let { "${it.artist} — ${it.title}" } ?: "", u, track = item.track))
                    "room" -> show(SocialBanner("room", "${u.display} зовёт слушать вместе", "Нажми, чтобы войти в комнату", u, code = item.code))
                    "react" -> show(SocialBanner("react", "${u.display}: ${item.emoji ?: ""}", item.track?.let { "на «${it.title}»" } ?: "на то, что ты слушаешь", u))
                }
            }
        }
    }

    private fun show(b: SocialBanner) {
        if (Live.uiVisible) _banners.tryEmit(b) else notify(b)
    }

    // ---------- Уведомления, когда приложение свёрнуто ----------

    private const val CHANNEL = "social"

    private fun notify(b: SocialBanner) {
        if (!::app.isInitialized) return
        runCatching {
            val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(NotificationChannel(CHANNEL, "Друзья", NotificationManager.IMPORTANCE_HIGH).apply { description = "Заявки, приглашения в комнату и треки от друзей" })
            }
            val open = Intent(app, org.nyao.music.MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("social", b.kind)
                .apply { b.code?.let { putExtra("room", it) }; b.user?.let { putExtra("roomFrom", it.display) } }
            val pi = PendingIntent.getActivity(app, (b.id % Int.MAX_VALUE).toInt(), open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val n = NotificationCompat.Builder(app, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(b.title)
                .setContentText(b.body)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .build()
            nm.notify((b.id % Int.MAX_VALUE).toInt(), n)
        }
    }

    /** Показать уведомление из push (Firebase) — текст уже собран сервером */
    fun notifyPush(data: Map<String, String>) {
        val kind = data["kind"] ?: "social"
        notify(SocialBanner(kind, data["title"] ?: "Nyao Music", data["body"] ?: "", null, code = data["code"]))
        if (Repo.cloud.loggedIn) refreshAsync()
    }

    @Suppress("unused")
    private fun JSONObject.text(key: String): String = str(key) ?: ""
}
