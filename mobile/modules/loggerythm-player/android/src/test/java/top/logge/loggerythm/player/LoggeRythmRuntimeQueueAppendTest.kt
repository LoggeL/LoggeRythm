package top.logge.loggerythm.player

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class LoggeRythmRuntimeQueueAppendTest {
  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:441",
    origin = "https://loggerythm.logge.top",
  )

  @After
  fun clearRuntime() {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
  }

  @Test
  fun appendVaultsCookiesAndAdvancesGenerationInOneRuntimeMutation() {
    LoggeRythmPlayerRuntime.bindSession(binding)
    LoggeRythmPlayerRuntime.installQueue(listOf(item("one", "session=old")))
    val before = LoggeRythmPlayerRuntime.currentQueueGeneration()

    val mediaItems = LoggeRythmPlayerRuntime.appendQueue(listOf(item("two", "session=new")))

    assertEquals(before + 1L, LoggeRythmPlayerRuntime.currentQueueGeneration())
    assertEquals(listOf("one", "two"), LoggeRythmPlayerRuntime.queueSources().map { it.id })
    assertEquals("two", mediaItems.single().mediaId)
    assertEquals(
      "session=new",
      LoggeRythmPlayerRuntime.cookieFor("https://loggerythm.logge.top/api/tracks/two/stream"),
    )
  }

  @Test
  fun duplicateAppendFailsBeforePublishingSidecarsOrCookie() {
    LoggeRythmPlayerRuntime.bindSession(binding)
    LoggeRythmPlayerRuntime.installQueue(listOf(item("one", "session=old")))
    val before = LoggeRythmPlayerRuntime.currentQueueGeneration()

    assertThrows(PlayerProtocolException::class.java) {
      LoggeRythmPlayerRuntime.appendQueue(listOf(item("one", "session=private-new")))
    }

    assertEquals(before, LoggeRythmPlayerRuntime.currentQueueGeneration())
    assertEquals(listOf("one"), LoggeRythmPlayerRuntime.queueSources().map { it.id })
    assertNull(
      LoggeRythmPlayerRuntime.cookieFor(
        "https://loggerythm.logge.top/api/tracks/not-published/stream",
      ),
    )
  }

  private fun item(id: String, cookie: String) = PlayerItemSpec(
    id = id,
    url = "https://loggerythm.logge.top/api/tracks/$id/stream",
    title = "Track $id",
    artist = "Artist",
    album = "Album",
    artworkUrl = null,
    durationMs = 180_000L,
    cookie = cookie,
    extrasJson = """{"track":{"id":"$id"},"radio":true}""",
  )
}
