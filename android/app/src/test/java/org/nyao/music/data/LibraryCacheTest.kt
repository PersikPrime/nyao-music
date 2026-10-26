package org.nyao.music.data

import org.junit.Assert.assertEquals
import org.junit.Test

class LibraryCacheTest {
    private fun t(id: String) = Track(id, id.substringBefore(':'), id.substringAfter(':'), "t", "a")
    private val sources = listOf(SOURCE_YA, SOURCE_YT, SOURCE_SC)

    @Test fun failedServiceTakesItsTracksFromCache() {
        val cached = listOf(t("ya:1"), t("yt:1"), t("sc:1"))
        val fresh = listOf<List<Track>?>(listOf(t("ya:2")), null, listOf(t("sc:2")))
        val got = fillFromCache(fresh, cached, sources) { it.source }
        assertEquals(listOf(listOf(t("ya:2")), listOf(t("yt:1")), listOf(t("sc:2"))), got)
    }

    @Test fun answeredServiceOverridesCacheEvenWhenEmpty() {
        val cached = listOf(t("ya:1"))
        val got = fillFromCache(listOf<List<Track>?>(emptyList(), null, null), cached, sources) { it.source }
        assertEquals(listOf<List<Track>>(emptyList(), emptyList(), emptyList()), got)
    }

    @Test fun noCacheMeansEmptyForFailedService() {
        val got = fillFromCache(listOf<List<Track>?>(null, listOf(t("yt:1")), null), null, sources) { it.source }
        assertEquals(listOf<List<Track>>(emptyList(), listOf(t("yt:1")), emptyList()), got)
    }
}
