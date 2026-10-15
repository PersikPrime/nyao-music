package org.nyao.music.data

/**
 * Радио по треку — перенос src/main/radio.js.
 * Яндекс — станция track:ID, YouTube Music — радио трека, SoundCloud — «похожие», VK — треки того же исполнителя.
 */
class Radio(private val ya: YandexApi, private val yt: YtMusicApi, private val sc: ScApi, private val vk: VkApi, private val isDown: (String) -> Boolean) {
    private var seed: Track? = null
    private val seen = HashSet<String>()
    private val played = ArrayList<Track>()

    private suspend fun fetchFor(t: Track, first: Boolean, queueIds: List<String>): List<Track> = when (t.source) {
        SOURCE_YA -> if (first) ya.radioStart(t.srcId) else ya.radioMore(queueIds)
        SOURCE_YT -> yt.radio(t.srcId)
        SOURCE_SC -> sc.related(t.srcId)
        SOURCE_VK -> vk.search(LastFm.mainArtist(t.artist))
        else -> emptyList()
    }

    private fun take(list: List<Track>): List<Track> {
        val out = list.filter { it.available && seen.add(it.id) }
        played += out
        return out
    }

    /** Первым — сам трек, за ним похожее */
    suspend fun start(t: Track): List<Track> {
        if (isDown(t.source)) throw ApiException("Этот сервис сейчас не отвечает — радио по треку недоступно")
        seed = t
        seen.clear()
        played.clear()
        seen += t.id
        played += t
        return listOf(t) + take(fetchFor(t, true, emptyList()))
    }

    /** Ещё треков: для YouTube и SoundCloud — «похожее» на случайный трек этого радио, чтобы подборка не замыкалась */
    suspend fun more(queueIds: List<String>): List<Track> {
        val s = seed ?: return emptyList()
        val same = queueIds.filter { it.startsWith(s.source + ":") }
        var from = if (s.source == SOURCE_YT || s.source == SOURCE_SC) played.filter { it.source == s.source }.randomOrNull() ?: s else s
        repeat(3) {
            val list = take(runCatching { fetchFor(from, false, same) }.getOrDefault(emptyList()))
            if (list.isNotEmpty()) return list
            from = played.randomOrNull() ?: s
        }
        return emptyList()
    }
}
