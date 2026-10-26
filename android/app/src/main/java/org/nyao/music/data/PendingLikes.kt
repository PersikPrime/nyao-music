package org.nyao.music.data

import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.CancellationException

/** Session-scoped outbox; legacy entries without an owner are never sent. */
class PendingLikes(
    private val read: () -> Set<String>,
    private val write: (Set<String>) -> Unit,
    private val account: () -> String?,
) {
    data class Entry(val account: String, val id: String, val on: Boolean, val revision: String, val tries: Int = 0) {
        fun encode() = "$account|$id|${if (on) 1 else 0}|$revision" + if (tries > 0) "|$tries" else ""
    }
    data class Result(val sent: Int, val left: Int, val error: Exception? = null)
    private val state = Any()
    private val MAX_TRIES = 5
    private val sending = Mutex()
    private fun entries() = read().mapNotNull {
        val p = it.split('|')
        if (p.size != 4 && p.size != 5) null else Entry(p[0], p[1], p[2] == "1", p[3], p.getOrNull(4)?.toIntOrNull() ?: 0)
    }
    private fun persist(items: List<Entry>) {
        val legacy = read().filter { it.split('|').size !in 4..5 }
        write((legacy + items.map { it.encode() }).toSet())
    }
    fun rebind(from: String, to: String) = synchronized(state) {
        persist(entries().map { if (it.account == from) it.copy(account = to) else it })
    }
    fun enqueue(id: String, on: Boolean) = synchronized(state) {
        val owner = account() ?: throw IllegalStateException("Нужен вход в SoundCloud")
        val item = Entry(owner, id, on, UUID.randomUUID().toString())
        persist(entries().filterNot { it.account == owner && it.id == id } + item)
    }
    fun size(): Int = synchronized(state) { entries().count { it.account == account() } }
    suspend fun flush(send: suspend (Entry) -> Unit): Result = sending.withLock {
        val owner = account()
        var sent = 0
        var failure: Exception? = null
        val skip = HashSet<String>() // не прошли в этот раз — повторим потом, но остальные лайки не ждут
        for (n in 0 until 100) {
            if (owner == null || owner != account()) break
            val item = synchronized(state) { entries().firstOrNull { it.account == owner && it.revision !in skip } } ?: break
            try { send(item) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                val code = (e as? ApiException)?.code
                if (code == 403 && item.tries + 1 < MAX_TRIES) {
                    // отказ по одному треку: пропускаем, после 5 попыток — выбрасываем
                    synchronized(state) { persist(entries().map { if (it.revision == item.revision) it.copy(tries = it.tries + 1) else it }) }
                    skip += item.revision
                    failure = e
                    continue
                }
                // трек удалён, запрос заведомо неверный или 403 слишком много раз — выбрасываем;
                // сеть, вход, лимит — общая проблема: остановимся и попробуем позже
                if (code !in setOf(400, 403, 404, 410, 422)) { failure = e; break }
            }
            synchronized(state) { persist(entries().filterNot { it.revision == item.revision }) }
            sent++
        }
        Result(sent, size(), failure)
    }
}
