package org.nyao.music.data

import org.junit.Assert.*
import org.junit.Test

class WavePolicyTest {
    private fun track(id: String, source: String = "ya", artist: String = "Artist $id", title: String = "Song $id", duration: Int = 200) =
        Track("$source:$id", source, id, title, artist, duration = duration)
    private fun candidates(n: Int, kind: String, source: String = "ya") = (0 until n).map {
        WaveCandidate(track("$kind$it", source), kind != "related", if (kind == "recent") 0.9 else 0.05)
    }
    private fun random(): () -> Double {
        var state = 1L
        return { state = (state * 1664525 + 1013904223) and 0xffffffffL; state.toDouble() / 4294967296.0 }
    }
    @Test fun recentLikesControlTheWholeFavoriteWave() {
        val p = WavePolicy(random())
        val input = candidates(100, "recent") + candidates(100, "library") + candidates(100, "related")
        assertEquals(100, p.select(input, "favorite", 100, size = 100).size)
        assertTrue(p.kinds.getValue("recent") in 65..75)
        assertTrue(p.kinds.getValue("library") >= 15)
        assertTrue(p.kinds.getValue("related") <= 15)
    }
    @Test fun providerQuotasSurviveSingleItemBatches() {
        val p = WavePolicy(random())
        val input = listOf("ya", "yt", "sc", "vk", "sp").flatMap { source ->
            (0 until 100).map { WaveCandidate(track("$source$it", source), true, 0.05) }
        }
        repeat(100) { p.select(input, "favorite", 0, 40, 1) }
        assertTrue(kotlin.math.abs(p.sources.getValue("ya") - 60) <= 5)
        for (source in listOf("yt", "sc", "vk", "sp")) assertTrue(p.sources.getValue(source) >= 5)
    }
    @Test fun duplicateRecordingsAreMergedButVersionsAreNot() {
        val a = track("a"); val b = a.copy(id = "yt:b", source = "yt", duration = 202)
        assertTrue(WavePolicy.sameRecording(a, b))
        assertFalse(WavePolicy.sameRecording(a, b.copy(title = a.title + " (Live)")))
        assertFalse(WavePolicy.sameRecording(a, b.copy(title = a.title + " (Remix)")))
        assertFalse(WavePolicy.sameRecording(a, b.copy(duration = 250)))
        assertEquals(1, WavePolicy().select(listOf(WaveCandidate(a), WaveCandidate(b))).size)
    }
    @Test fun historyAndDislikesApplyAcrossCatalogs() {
        val a = track("a"); val b = a.copy(id = "yt:b", source = "yt"); val c = track("c")
        val p = WavePolicy()
        assertEquals(c.id, p.select(listOf(WaveCandidate(b), WaveCandidate(c)), size = 1, history = listOf(a))[0].id)
        p.block(a)
        assertTrue(p.select(listOf(WaveCandidate(b))).isEmpty())
    }
    @Test fun exhaustedQueueDoesNotRepeatTheSameTracks() {
        val p = WavePolicy(); val input = candidates(10, "library")
        assertEquals(10, p.select(input, size = 10).size)
        assertTrue(p.select(input).isEmpty())
    }
    @Test fun discoveryExcludesLikes() {
        val out = WavePolicy(random()).select(candidates(8, "library") + candidates(10, "related"), "discover")
        assertTrue(out.all { it.id.contains("related") })
    }
    @Test fun likeDatesTakePrecedenceOverProviderRank() {
        val now = System.currentTimeMillis()
        assertTrue(WavePolicy.recentAffinity(track("a").copy(likedAt = now - 86400000), 200, 300, now) > 0.9)
        assertTrue(WavePolicy.recentAffinity(track("b").copy(likedAt = now - 365L * 86400000), 0, 300, now) < 0.01)
        assertTrue(WavePolicy.recentAffinity(track("c"), 200, 300, now) < 0.01)
    }
    @Test fun cooldownDoesNotEraseFreshness() {
        val recent = candidates(100, "recent")
        val p = WavePolicy(random())
        p.select(recent + candidates(100, "library") + candidates(100, "related"), "favorite", 100, size = 100, recentIds = recent.map { it.track.id }.toSet())
        assertTrue(p.kinds.getValue("recent") >= 65)
    }
    @Test fun discoveryExcludesUnlikedCopyOfLikedRecording() {
        val a = track("a"); val copy = a.copy(id = "yt:b", source = "yt")
        assertTrue(WavePolicy().select(listOf(WaveCandidate(a, true), WaveCandidate(copy)), "discover").isEmpty())
    }
    @Test fun matchesDesktopDeterministicFixture() {
        var seed = 42L
        val random = { seed = (seed * 1664525 + 1013904223) and 0xffffffffL; seed.toDouble() / 4294967296.0 }
        val sources = listOf("ya", "yt", "sc", "vk", "sp")
        val input = (0 until 120).map { i -> WaveCandidate(track(i.toString(), sources[i % 5], "Артист "+i%8), i < 80, if (i < 40) 0.9 else 0.05) }
        val expected = listOf("sp:9", "ya:5", "ya:75", "vk:23", "ya:0", "yt:81", "ya:30", "sc:2", "ya:40", "ya:15", "sc:22", "ya:35", "yt:66", "ya:25", "ya:20", "ya:80", "sp:19", "vk:18", "ya:45", "vk:38")
        assertEquals(expected, WavePolicy(random).select(input, "favorite", 100, 40, 20).map { it.id })
    }
}
