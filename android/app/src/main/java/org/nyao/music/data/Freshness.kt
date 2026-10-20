package org.nyao.music.data

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.ln

/**
 * «Свежесть» волны: вчерашние лайки весят больше прошлогодних (перенос src/main/freshness.js).
 * Списки лайков у сервисов идут от новых к старым, поэтому вес — по позиции в списке.
 */
object Freshness {
    /** Случайные n элементов, новые чаще: fresh 0 — по всему списку, 100 — почти только последние ~5 */
    fun <T> recencyPick(list: List<T>, n: Int, fresh: Int): List<T> {
        if (list.isEmpty() || n <= 0) return emptyList()
        val f = fresh.coerceIn(0, 100) / 100.0
        val tau = max(5.0, list.size * (1 - f).pow(2) + 5 * f)
        // ключ Эфраимидиса — Спиракиса: random^(1/вес)
        return list.mapIndexed { i, x -> x to ln(Math.random().coerceAtLeast(Double.MIN_VALUE)) * exp(min(700.0, i / tau)) }
            .sortedByDescending { it.second }
            .take(n)
            .map { it.first }
    }

    /** Доля подмеса (любимые исполнители + похожее на свежие лайки), % */
    fun boostShare(fresh: Int, favorites: Int): Int =
        min(45.0, (if (favorites > 0) 18.0 else 0.0) + fresh.coerceIn(0, 100) * 0.27).toInt()
}

/** Любимый исполнитель. ref — главная ссылка (ya:ID или yt:UC…), refsYa/refsYt — где он есть ещё */
data class FavArtist(val ref: String, val refYa: String?, val refYt: String?, val name: String, val cover: String?, val at: Long) {
    fun toJson(): JSONObject = JSONObject().put("ref", ref)
        .put("refs", JSONObject().put("ya", refYa ?: JSONObject.NULL).put("yt", refYt ?: JSONObject.NULL))
        .put("name", name).put("cover", cover ?: JSONObject.NULL).put("at", at)

    fun matches(source: String, id: String?): Boolean {
        val r = "$source:${id ?: ""}"
        return ref == r || refYa == r || refYt == r
    }

    companion object {
        fun fromJson(o: JSONObject): FavArtist? {
            val ref = o.optString("ref").ifBlank { return null }
            val refs = o.optJSONObject("refs")
            return FavArtist(
                ref,
                refs?.str("ya") ?: ref.takeIf { it.startsWith("ya:") },
                refs?.str("yt") ?: ref.takeIf { it.startsWith("yt:") },
                o.optString("name"), o.str("cover"), o.optLong("at"),
            )
        }

        fun listFromJson(a: JSONArray?): List<FavArtist> = a.objects().mapNotNull { fromJson(it) }
        fun listToJson(l: List<FavArtist>): JSONArray = JSONArray().apply { l.forEach { put(it.toJson()) } }

        /** Объединение двух списков по ref: при совпадении берём более свежую запись, новые сверху */
        fun merge(a: List<FavArtist>, b: List<FavArtist>): List<FavArtist> {
            val m = LinkedHashMap<String, FavArtist>()
            for (x in a + b) {
                val cur = m[x.ref]
                if (cur == null || x.at > cur.at) m[x.ref] = x
            }
            return m.values.sortedByDescending { it.at }
        }
    }
}
