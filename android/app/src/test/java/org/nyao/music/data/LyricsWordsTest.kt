package org.nyao.music.data

import org.junit.Assert.*
import org.junit.Test

class LyricsWordsTest {
    @Test fun parsesWordTimingsWithEnds() {
        val lines = LyricsApi.parseWordLrc("[00:10.00] <00:10.00>Раз <00:10.50>два <00:11.20>\n[00:12.00] Без разметки\n[00:20.00] <00:20.00>аааааааааа")
        assertEquals(3, lines.size)
        val w = lines[0].words!!
        assertEquals(listOf("Раз", "два"), w.map { it.text })
        assertEquals(10.5, w[0].end, 1e-9)
        assertEquals(11.2, w[1].end, 1e-9)
        assertEquals("Раз два", lines[0].text)
        assertNull(lines[1].words)
        assertEquals("Без разметки", lines[1].text)
        val long = lines[2].words!![0]
        assertTrue(long.end - long.time > 1.0)
    }

    @Test fun lastWordStopsBeforeNextLine() {
        val lines = LyricsApi.parseWordLrc("[00:01.00] <00:01.00>длинноеслово\n[00:01.40] дальше")
        assertEquals(1.4, lines[0].words!![0].end, 1e-9)
    }
}
