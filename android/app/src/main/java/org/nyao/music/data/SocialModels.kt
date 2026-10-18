package org.nyao.music.data

/** Мини-соцсеть Nyao: модели ответа сервера */

/** Пользователь в списках: друзья, заявки, поиск */
data class UserCard(val id: String, val nick: String, val name: String, val picture: String?) {
    val display: String get() = name.ifBlank { "@$nick" }
}

/** Что сейчас слушает друг */
data class FriendNow(val track: Track, val playing: Boolean, val updatedAt: Long)

data class Friend(val user: UserCard, val now: FriendNow?, val online: Boolean)

/** none | outgoing | incoming | friends | blocked | self */
data class SearchUser(val user: UserCard, val relation: String)

/** Свой профиль с настройками приватности */
data class MyProfile(
    val nick: String,
    val nickSet: Boolean,
    val bio: String,
    val visibility: String,
    val showNow: Boolean,
    val showStats: Boolean,
    val showLikes: Boolean,
    val invisible: Boolean,
    /** Друзья могут смотреть совпадение вкусов и включать «Микс на двоих» */
    val allowDuo: Boolean = true,
)

data class TopArtist(val name: String, val plays: Int)

data class UserStats(val minutes: Int, val plays: Int, val topArtists: List<TopArtist>, val topTracks: List<Pair<Track, Int>>)

/** Чужой (или свой) профиль глазами смотрящего */
data class PublicProfile(
    val user: UserCard,
    val relation: String,
    val private: Boolean,
    val bio: String = "",
    val friends: Int = 0,
    val now: FriendNow? = null,
    val stats: UserStats? = null,
    val badges: List<Badge> = emptyList(),
    /** Он разрешил друзьям совпадение вкусов и «Микс на двоих» */
    val duo: Boolean = true,
)

data class Badge(val id: String, val emoji: String, val title: String)

/** Совпадение вкусов с другом */
data class TasteMatch(val percent: Int, val commonArtists: List<String>, val enough: Boolean)

/** Входящие: track | room | react */
data class InboxItem(
    val id: String,
    val kind: String,
    val from: UserCard,
    val track: Track?,
    val emoji: String?,
    val code: String?,
    val createdAt: Long,
    val read: Boolean,
)

data class Invite(val code: String, val url: String, val expiresAt: Long)
