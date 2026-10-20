package org.nyao.music.data

import org.junit.Test
import org.junit.Assert.*
import kotlinx.coroutines.*

class ServicesTest {
    @Test fun latestIntentSurvivesInFlightSend() = runBlocking {
        var saved = emptySet<String>()
        val box = PendingLikes({ saved }, { saved = it }, { "one" })
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val sent = mutableListOf<Boolean>()
        box.enqueue("42", true)
        val running = async {
            box.flush { item ->
                sent += item.on
                if (sent.size == 1) { entered.complete(Unit); release.await() }
            }
        }
        entered.await()
        box.enqueue("42", false)
        release.complete(Unit)
        assertEquals(0, running.await().left)
        assertEquals(listOf(true, false), sent)
    }

    @Test fun failuresPersistAndAccountsAreIsolated() = runBlocking {
        var saved = emptySet<String>()
        var account = "one"
        val box = PendingLikes({ saved }, { saved = it }, { account })
        box.enqueue("42", true)
        assertEquals(1, box.flush { throw java.io.IOException("403") }.left)
        account = "two"
        assertEquals(0, box.flush { fail("wrong account") }.sent)
        assertEquals(1, saved.size)
        account = "one"
        val restored = PendingLikes({ saved }, { saved = it }, { account })
        assertEquals(1, restored.flush { }.sent)
        assertTrue(saved.isEmpty())
    }

    @Test fun cancellationKeepsPendingOperation() = runBlocking {
        var saved = emptySet<String>()
        val box = PendingLikes({ saved }, { saved = it }, { "one" })
        box.enqueue("42", true)
        try { box.flush { throw CancellationException() }; fail("cancellation swallowed") }
        catch (_: CancellationException) { }
        assertEquals(1, saved.size)
    }

    @Test fun diagnosticsRemoveSecrets() {
        for (s in listOf("Authorization: Bearer SECRET", "Cookie: oauth_token=SECRET", """{"access_token":"SECRET"}""", "https://test/SECRET?key=SECRET")) {
            assertFalse(Diagnostics.safe(s).contains("SECRET"))
        }
    }

    @Test fun differentRecordingsDoNotMatch() {
        val t = Track("sp:1", "sp", "1", "Song", "Artist", duration = 180)
        for (title in listOf("Song (Live)", "Song (Remix)", "Song (Acoustic)", "Song (Slowed)")) {
            assertEquals(0.0, Match.similarity(t, t.copy(title = title)), 0.0)
        }
        assertEquals(1.0, Match.similarity(t, t), 0.0)
    }
}
