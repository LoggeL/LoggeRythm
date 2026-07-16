package top.logge.loggerythm.player

import java.nio.charset.StandardCharsets
import java.nio.file.Files
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmPersistedStateTest {
  private val privateRoot = Files.createTempDirectory("loggerythm-persisted-state").toFile()
  private val codec = LoggeRythmPersistedStateCodec(LoggeRythmPlayerProtocol(listOf(privateRoot)))
  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:441",
    origin = "https://loggerythm.logge.top",
  )

  @Test
  fun roundTripPreservesExactUrisQueueProductStateAndSleep() {
    val state = sampleState(
      sleep = LoggeRythmPersistedSleepState.Time(
        triggerAtEpochMs = 1_800_000_000_000L,
        fadeOutMs = 5_000L,
      ),
    )

    val restored = codec.decode(codec.encode(state), binding)

    assertEquals(state, restored)
    assertEquals(
      "https://loggerythm.logge.top/api/tracks/one/stream?nonce=a%2Fb&part=1",
      restored.queue.first().url,
    )
    assertEquals("all", restored.repeatMode)
    assertEquals(listOf("stable:one", "stable:two"), restored.contextShuffle.restoreOrder)
    assertEquals(setOf(RemotePlayerCapability.PLAY_PAUSE, RemotePlayerCapability.NEXT), restored.remoteCapabilities)
    assertEquals("track:auto-one", restored.browseTree?.root?.children?.single()?.children?.single()?.id)
    assertFalse(restored.queue.first().toString().contains("sf_session"))
    assertFalse(restored.toString().contains(binding.accountScope))
    assertFalse(restored.toString().contains(binding.origin))
    assertFalse(restored.toString().contains("browse-session"))
    assertFalse(restored.browseTree.toString().contains("browse-session"))
    assertFalse(restored.queue.first().toPlayerItemSpec().toString().contains("sf_session"))
    assertEquals(restored.queue.first(), restored.queue.first().toPlayerItemSpec().toPersistedQueueItem())
  }

  @Test
  fun authenticatedServiceOnlyDecodeUsesEncryptedBindingButExactDecodeStillRejectsOtherAccount() {
    val encoded = codec.encode(sampleState())

    assertEquals(sampleState(), codec.decodeAuthenticatedSelfBound(encoded))
    assertCode("session-binding-mismatch") {
      codec.decode(encoded, binding.copy(accountScope = "user:442"))
    }
  }

  @Test
  fun migratesSchemaV1QueueBindingAndPlaybackStateWithoutInventingBrowseOrCommandPolicy() {
    val state = sampleState()
    val legacy = JSONObject(String(codec.encode(state), StandardCharsets.UTF_8))
      .put("version", 1)
      .apply {
        remove("browseTree")
        remove("remoteCapabilities")
      }
      .toString()
      .toByteArray(StandardCharsets.UTF_8)
    val expected = state.copy(browseTree = null, remoteCapabilities = null)

    assertEquals(expected, codec.decode(legacy, binding))
    assertEquals(expected, codec.decodeAuthenticatedSelfBound(legacy))
  }

  @Test
  fun rejectsCrossOriginBrowseCookiesAndNonCanonicalBrowseRoot() {
    val crossOrigin = sampleState().copy(
      browseTree = sampleBrowseTree(
        url = "https://cdn.example/auto-one",
        cookie = "browse-session=opaque",
      ),
    )
    assertCode("cookie-origin-mismatch") { codec.encode(crossOrigin) }
    assertCode("browse-root-id-invalid") {
      codec.encode(sampleState().copy(
        browseTree = BrowseTreeSpec(sampleBrowseTree().root.copy(id = "other:root")),
      ))
    }
  }

  @Test
  fun roundTripPreservesFollowingMediaItemSleep() {
    val state = sampleState(
      sleep = LoggeRythmPersistedSleepState.MediaItem(
        targetIndex = 1,
        followsCurrentItem = true,
      ),
      activeIndex = 1,
    )

    assertEquals(state, codec.decode(codec.encode(state), binding))
  }

  @Test
  fun rejectsUnknownMalformedUnsupportedAndOversizedJson() {
    val valid = JSONObject(String(codec.encode(sampleState()), StandardCharsets.UTF_8))
    assertCode("unexpected-or-missing-key") {
      codec.decode(valid.put("surprise", true).toString().toByteArray(), binding)
    }
    assertCode("json-invalid") {
      codec.decode("{broken".toByteArray(), binding)
    }
    assertCode("json-invalid") {
      val duplicateVersion = String(codec.encode(sampleState()), StandardCharsets.UTF_8)
        .replaceFirst(
          "\"version\":${LoggeRythmPersistedStateCodec.SCHEMA_VERSION}",
          "\"version\":${LoggeRythmPersistedStateCodec.SCHEMA_VERSION}," +
            "\"version\":${LoggeRythmPersistedStateCodec.SCHEMA_VERSION}",
        )
      codec.decode(duplicateVersion.toByteArray(), binding)
    }
    assertCode("json-depth-invalid") {
      codec.decode(("{\"nested\":" + "[".repeat(33) + "0" + "]".repeat(33) + "}").toByteArray(), binding)
    }
    assertCode("state-version-unsupported") {
      valid.remove("surprise")
      codec.decode(
        valid.put("version", LoggeRythmPersistedStateCodec.SCHEMA_VERSION + 1)
          .toString()
          .toByteArray(),
        binding,
      )
    }
    assertCode("state-size-invalid") {
      codec.decode(ByteArray(LoggeRythmPersistedStateCodec.MAX_STATE_JSON_BYTES + 1), binding)
    }
  }

  @Test
  fun rejectsQueueBoundsDuplicateIdsAndInvalidActiveIndex() {
    val duplicate = sampleState().copy(
      queue = listOf(sampleItem("one", 0), sampleItem("one", 1)),
      contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
    )
    assertCode("queue-queue-item-id-duplicate") { codec.encode(duplicate) }
    assertCode("active-index-invalid") { codec.encode(sampleState().copy(activeIndex = 2)) }

    val tooMany = List(LoggeRythmPersistedStateCodec.MAX_QUEUE_ITEMS + 1) { index ->
      sampleItem("item$index", index)
    }
    assertCode("queue-too-large") {
      codec.encode(
        sampleState().copy(
          queue = tooMany,
          activeIndex = 0,
          contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
        ),
      )
    }
  }

  @Test
  fun rejectsDuplicateShuffleIdsAndDuplicateProductContextIndexes() {
    assertCode("shuffle-id-duplicate") {
      codec.encode(
        sampleState().copy(
          contextShuffle = LoggeRythmPersistedContextShuffle(
            enabled = true,
            restoreOrder = listOf("stable:one", "stable:one"),
          ),
        ),
      )
    }

    assertCode("context-index-duplicate") {
      codec.encode(
        sampleState().copy(
          queue = listOf(sampleItem("one", 0), sampleItem("two", 0)),
          contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
        ),
      )
    }
  }

  @Test
  fun rejectsExplicitNullOrUnknownProductOrigin() {
    assertCode("queue-origin-invalid") {
      codec.encode(
        sampleState().copy(
          queue = listOf(sampleItem("one", 0).copy(extrasJson = """{"queueOrigin":null}""")),
          activeIndex = 0,
          contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
        ),
      )
    }
    assertCode("queue-origin-invalid") {
      codec.encode(
        sampleState().copy(
          queue = listOf(sampleItem("one", 0).copy(extrasJson = """{"queueOrigin":"other"}""")),
          activeIndex = 0,
          contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
        ),
      )
    }
  }

  @Test
  fun bindsRestoreToExactAccountAndCanonicalOrigin() {
    val encoded = codec.encode(sampleState())
    assertCode("session-binding-mismatch") {
      codec.decode(encoded, binding.copy(accountScope = "user:442"))
    }
    assertCode("session-binding-mismatch") {
      codec.decode(encoded, binding.copy(origin = "https://other.example"))
    }
    assertCode("origin-not-canonical") {
      codec.encode(sampleState().copy(sessionBinding = binding.copy(origin = "https://LOGGERYTHM.logge.top")))
    }
    assertCode("origin-invalid") {
      codec.encode(sampleState().copy(sessionBinding = binding.copy(origin = "https://loggerythm.logge.top\r\n")))
    }
    assertCode("origin-invalid") {
      codec.encode(sampleState().copy(sessionBinding = binding.copy(origin = "http://loggerythm.logge.top")))
    }
    assertCode("origin-invalid") {
      codec.encode(sampleState().copy(sessionBinding = binding.copy(origin = "https://loggerythm.logge.top:0")))
    }
    assertCode("origin-not-canonical") {
      codec.encode(sampleState().copy(sessionBinding = binding.copy(origin = "https://loggerythm.logge.top:443")))
    }
  }

  @Test
  fun permitsCookiesOnlyForTheBoundOriginAndRejectsHeaderInjection() {
    assertCode("cookie-origin-mismatch") {
      codec.encode(
        sampleState().copy(
          queue = listOf(sampleItem("one", 0).copy(url = "https://cdn.example/one")),
          activeIndex = 0,
          contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
        ),
      )
    }
    assertCode("queue-header-value-invalid") {
      codec.encode(
        sampleState().copy(
          queue = listOf(sampleItem("one", 0).copy(cookie = "a=b\r\nInjected: yes")),
          activeIndex = 0,
          contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
        ),
      )
    }

    val unauthenticatedCdn = sampleState().copy(
      queue = listOf(sampleItem("one", 0).copy(url = "https://cdn.example/one", cookie = null)),
      activeIndex = 0,
      contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
    )
    assertEquals("https://cdn.example/one", codec.decode(codec.encode(unauthenticatedCdn), binding).queue.single().url)
  }

  @Test
  fun rejectsInvalidSleepStateAndDisabledShuffleResidue() {
    assertCode("sleep-follow-index-invalid") {
      codec.encode(
        sampleState().copy(
          sleep = LoggeRythmPersistedSleepState.MediaItem(1, followsCurrentItem = true),
          activeIndex = 0,
        ),
      )
    }
    assertCode("shuffle-disabled-order-invalid") {
      codec.encode(
        sampleState().copy(
          contextShuffle = LoggeRythmPersistedContextShuffle(false, listOf("stable:one")),
        ),
      )
    }
    assertCode("duration-invalid") {
      codec.encode(
        sampleState().copy(queue = listOf(sampleItem("one", 0).copy(durationMs = Long.MAX_VALUE)), activeIndex = 0,
          contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())),
      )
    }
    assertCode("empty-queue-sleep-invalid") {
      codec.encode(
        sampleState().copy(
          queue = emptyList(), activeIndex = null, positionMs = 0L,
          contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
          sleep = LoggeRythmPersistedSleepState.Time(1_800_000_000_000L, 0L),
        ),
      )
    }
  }

  private fun sampleState(
    sleep: LoggeRythmPersistedSleepState? = null,
    activeIndex: Int = 1,
  ): LoggeRythmPersistedPlayerState = LoggeRythmPersistedPlayerState(
    sessionBinding = binding,
    queue = listOf(sampleItem("one", 0), sampleItem("two", 1)),
    activeIndex = activeIndex,
    positionMs = 42_125L,
    repeatMode = "all",
    contextShuffle = LoggeRythmPersistedContextShuffle(
      enabled = true,
      restoreOrder = listOf("stable:one", "stable:two"),
    ),
    sleep = sleep,
    browseTree = sampleBrowseTree(),
    remoteCapabilities = setOf(
      RemotePlayerCapability.PLAY_PAUSE,
      RemotePlayerCapability.NEXT,
    ),
  )

  private fun sampleBrowseTree(
    url: String = "https://loggerythm.logge.top/api/tracks/auto-one/stream",
    cookie: String? = "browse-session=opaque",
  ): BrowseTreeSpec = BrowseTreeSpec(
    BrowseNodeSpec(
      id = LoggeRythmPlayerRuntime.BROWSE_ROOT_ID,
      title = "LoggeRythm",
      subtitle = null,
      artist = null,
      album = null,
      artworkUrl = null,
      durationMs = null,
      playable = false,
      url = null,
      cookie = null,
      children = listOf(
        BrowseNodeSpec(
          id = "library:liked",
          title = "Liked",
          subtitle = null,
          artist = null,
          album = null,
          artworkUrl = null,
          durationMs = null,
          playable = false,
          url = null,
          cookie = null,
          children = listOf(
            BrowseNodeSpec(
              id = "track:auto-one",
              title = "Auto One",
              subtitle = null,
              artist = "Artist",
              album = "Album",
              artworkUrl = "https://loggerythm.logge.top/art/auto-one.webp",
              durationMs = 180_000L,
              playable = true,
              url = url,
              cookie = cookie,
              children = emptyList(),
            ),
          ),
        ),
      ),
    ),
  )

  private fun sampleItem(id: String, order: Int): LoggeRythmPersistedQueueItem =
    LoggeRythmPersistedQueueItem(
      id = id,
      url = "https://loggerythm.logge.top/api/tracks/$id/stream?nonce=a%2Fb&part=1",
      title = "Track $id",
      artist = "Artist",
      album = "Album",
      artworkUrl = "https://loggerythm.logge.top/art/$id.webp",
      durationMs = 180_000L,
      cookie = "sf_session=opaque-$id",
      extrasJson = JSONObject()
        .put("queueOrigin", "context")
        .put("queueContextType", "playlist")
        .put("queueContextId", "playlist:one")
        .put("queueOriginalContextOrder", order)
        .put("queueStableId", "stable:$id")
        .toString(),
    )

  private fun assertCode(code: String, action: () -> Unit) {
    val error = assertThrows(LoggeRythmPersistedStateException::class.java, action)
    assertEquals(code, error.code)
    assertEquals(code, error.message)
    assertTrue(error.stackTrace.isNotEmpty())
  }
}
