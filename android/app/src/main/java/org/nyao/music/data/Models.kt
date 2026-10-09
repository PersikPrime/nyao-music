package org.nyao.music.data

/** Трек любого сервиса. id = "ya:123" или "yt:videoId" — как в десктопной версии. */
data class Track(
    val id: String,
    val source: String,
    val srcId: String,
    val title: String,
    val artist: String,
    val album: String = "",
    val albumId: String? = null,
    val duration: Int = 0,
    val cover: String? = null,
    val available: Boolean = true,
) {
    val isYa: Boolean get() = source == SOURCE_YA
}

data class Playlist(
    val id: String,
    val source: String,
    val title: String,
    val count: Int = 0,
    val cover: String? = null,
    val subtitle: String = "",
)

data class HomeSection(
    val title: String,
    val tracks: List<Track> = emptyList(),
    val playlists: List<Playlist> = emptyList(),
)

data class Account(val name: String, val plus: Boolean? = null, val uid: String? = null)

data class HomeData(
    val yaPlaylists: List<Playlist> = emptyList(),
    val ytSections: List<HomeSection> = emptyList(),
)

data class SearchResult(val ya: List<Track> = emptyList(), val yt: List<Track> = emptyList(), val sc: List<Track> = emptyList())

const val SOURCE_YA = "ya"
const val SOURCE_YT = "yt"
const val SOURCE_SC = "sc"

val ALL_SOURCES = listOf(SOURCE_YA, SOURCE_YT, SOURCE_SC)

fun sourceName(source: String): String = when (source) {
    SOURCE_YA -> "Яндекс Музыка"
    SOURCE_SC -> "SoundCloud"
    else -> "YouTube Music"
}

fun formatTime(sec: Int): String {
    if (sec <= 0) return "0:00"
    val h = sec / 3600
    val m = (sec % 3600) / 60
    val s = sec % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** «3:45» → 225 */
fun parseDuration(text: String?): Int {
    if (text.isNullOrBlank()) return 0
    val parts = text.trim().split(":").mapNotNull { it.toIntOrNull() }
    if (parts.isEmpty() || parts.size > 3) return 0
    return parts.fold(0) { acc, p -> acc * 60 + p }
}

/** Чередует несколько списков: a0, b0, c0, a1, b1, c1, … */
fun <T> alternateAll(vararg lists: List<T>): List<T> {
    val out = ArrayList<T>()
    for (i in 0 until (lists.maxOfOrNull { it.size } ?: 0)) lists.forEach { if (i < it.size) out += it[i] }
    return out
}

/** Чередует два списка: a0, b0, a1, b1, … — чтобы «Мне нравится» не было «сначала весь Яндекс». */
fun <T> alternate(a: List<T>, b: List<T>): List<T> {
    val out = ArrayList<T>(a.size + b.size)
    for (i in 0 until maxOf(a.size, b.size)) {
        if (i < a.size) out += a[i]
        if (i < b.size) out += b[i]
    }
    return out
}
