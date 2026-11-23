package top.logge.loggerythm.player

import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import java.lang.reflect.Proxy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * JVM regression suite proving that granular queue edits (`AddQueueItems`, `MoveQueueItem`,
 * `RemoveQueueItems`, `ReplaceQueueItem`, `SkipToIndex`, and active-preserving `ReplaceQueue`)
 * never invoke `setMediaItems` or `prepare` on an active track (playing OR paused), while
 * preserving strict validation, sidecar staging resilience against racing timeline updates,
 * and intentional transitions when removing the currently active track.
 */
class LoggeRythmSeamlessQueueEditTest {
  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:515",
    origin = "https://loggerythm.logge.top",
  )

  @Before
  fun setUp() {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    LoggeRythmPlayerRuntime.bindSession(binding)
  }

  @After
  fun tearDown() {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
  }

  @Test
  fun addPlayNextMoveAndRemoveNonActiveNeverCallSetMediaItemsPrepareSeekOrPlay() {
    val fake = RecordingFakePlayer(
      initialItems = LoggeRythmPlayerRuntime.installQueue(
        listOf(spec("a"), spec("b"), spec("c")),
      ),
      activeIndex = 1,
      playbackState = Player.STATE_READY,
      playWhenReady = true,
      positionMs = 14_320L,
    )

    // Play Next (insert immediately after active index 1)
    applyPlayerCommand(fake.proxy, PlayerCommand.AddQueueItems(index = 2, items = listOf(spec("next"))))
    // Add to Queue (append at end)
    applyPlayerCommand(fake.proxy, PlayerCommand.AddQueueItems(index = 4, items = listOf(spec("tail"))))
    // Insert before active (shifts active index 1 -> 2 seamlessly)
    applyPlayerCommand(fake.proxy, PlayerCommand.AddQueueItems(index = 0, items = listOf(spec("head"))))
    // Reorder upcoming items (move "tail" before "c")
    applyPlayerCommand(fake.proxy, PlayerCommand.MoveQueueItem(fromIndex = 5, toIndex = 4))
    // Remove a history track before active ("head" at 0 -> active shifts 2 -> 1)
    applyPlayerCommand(fake.proxy, PlayerCommand.RemoveQueueItems(fromIndex = 0, toIndex = 1))
    // Remove an upcoming non-active track ("c" at 4)
    applyPlayerCommand(fake.proxy, PlayerCommand.RemoveQueueItems(fromIndex = 4, toIndex = 5))

    assertEquals(listOf("a", "b", "next", "tail"), fake.ids())
    assertEquals(1, fake.activeIndex)
    assertEquals("b", fake.items[fake.activeIndex].mediaId)
    assertEquals(14_320L, fake.positionMs)
    assertTrue(fake.playWhenReady)
    assertEquals(0, fake.setMediaItemsCalls)
    assertEquals(0, fake.prepareCalls)
    assertEquals(0, fake.playCalls)
    assertEquals(0, fake.seekCalls)
    assertEquals(
      listOf(
        "addMediaItems(2,[next])",
        "addMediaItems(4,[tail])",
        "addMediaItems(0,[head])",
        "moveMediaItem(5,4)",
        "removeMediaItems(0,1)",
        "removeMediaItems(4,5)",
      ),
      fake.calls,
    )
  }

  @Test
  fun pausedQueueEditsKeepPausedStateExactPositionAndNeverPrepareOrPlay() {
    val fake = RecordingFakePlayer(
      initialItems = LoggeRythmPlayerRuntime.installQueue(
        listOf(spec("a"), spec("b"), spec("c")),
      ),
      activeIndex = 1,
      playbackState = Player.STATE_READY,
      playWhenReady = false,
      positionMs = 21_500L,
    )

    applyPlayerCommand(fake.proxy, PlayerCommand.AddQueueItems(index = 2, items = listOf(spec("next"))))
    applyPlayerCommand(fake.proxy, PlayerCommand.MoveQueueItem(fromIndex = 3, toIndex = 2))
    applyPlayerCommand(fake.proxy, PlayerCommand.RemoveQueueItems(fromIndex = 0, toIndex = 1))

    assertEquals(listOf("b", "c", "next"), fake.ids())
    assertEquals(0, fake.activeIndex)
    assertEquals("b", fake.items[fake.activeIndex].mediaId)
    assertFalse(fake.playWhenReady)
    assertEquals(21_500L, fake.positionMs)
    assertEquals(0, fake.setMediaItemsCalls)
    assertEquals(0, fake.prepareCalls)
    assertEquals(0, fake.playCalls)
    assertEquals(0, fake.seekCalls)
  }

  @Test
  fun removingActiveItemTransitionsIntentionallyAndClearingAllStopsToIdle() {
    val fake = RecordingFakePlayer(
      initialItems = LoggeRythmPlayerRuntime.installQueue(
        listOf(spec("a"), spec("b"), spec("c")),
      ),
      activeIndex = 1,
      playbackState = Player.STATE_READY,
      playWhenReady = true,
      positionMs = 9_000L,
    )

    // Remove active middle item "b" -> transitions to "c" at index 1, position 0.
    applyPlayerCommand(fake.proxy, PlayerCommand.RemoveQueueItems(fromIndex = 1, toIndex = 2))
    assertEquals(listOf("a", "c"), fake.ids())
    assertEquals(1, fake.activeIndex)
    assertEquals("c", fake.items[fake.activeIndex].mediaId)
    assertEquals(0L, fake.positionMs)
    assertEquals(0, fake.setMediaItemsCalls)

    // Remove active tail item "c" with REPEAT_MODE_OFF -> seeks to new last item "a" at 0ms.
    applyPlayerCommand(fake.proxy, PlayerCommand.RemoveQueueItems(fromIndex = 1, toIndex = 2))
    assertEquals(listOf("a"), fake.ids())
    assertEquals(0, fake.activeIndex)
    assertEquals(0L, fake.positionMs)
    assertTrue(fake.calls.contains("seekTo(0,0)"))

    // Remove final remaining item -> stops & clears queue headers cleanly.
    applyPlayerCommand(fake.proxy, PlayerCommand.RemoveQueueItems(fromIndex = 0, toIndex = 1))
    assertTrue(fake.items.isEmpty())
    assertEquals(Player.STATE_IDLE, fake.playbackState)
    assertNull(LoggeRythmPlayerRuntime.cookieFor("https://loggerythm.logge.top/api/tracks/a/stream"))
  }

  @Test
  fun replaceQueueSplicesInPlaceWhenActiveItemIdentityUrlAndCookieMatch() {
    val initialSpecs = listOf(spec("a", "sf=same"), spec("b", "sf=same"), spec("c", "sf=same"))
    val liveUrlById = initialSpecs.associate { it.id to it.url }
    val fake = RecordingFakePlayer(
      initialItems = LoggeRythmPlayerRuntime.installQueue(initialSpecs),
      activeIndex = 1,
      playbackState = Player.STATE_READY,
      playWhenReady = true,
      positionMs = 17_800L,
    )

    applyPlayerCommand(
      fake.proxy,
      PlayerCommand.ReplaceQueue(
        items = listOf(spec("x", "sf=same"), spec("b", "sf=same"), spec("y", "sf=same"), spec("z", "sf=same")),
        startIndex = 1,
        startPositionMs = 17_000L,
        resume = false,
      ),
      liveUrlOf = { liveUrlById[it.mediaId] },
    )

    assertEquals(listOf("x", "b", "y", "z"), fake.ids())
    assertEquals(1, fake.activeIndex)
    assertEquals("b", fake.items[fake.activeIndex].mediaId)
    assertEquals(17_800L, fake.positionMs)
    assertEquals(0, fake.setMediaItemsCalls)
    assertEquals(0, fake.prepareCalls)
    assertEquals(0, fake.seekCalls)
    assertEquals(
      listOf(
        "removeMediaItems(2,3)",
        "removeMediaItems(0,1)",
        "addMediaItems(0,[x])",
        "addMediaItems(2,[y,z])",
      ),
      fake.calls,
    )
  }

  @Test
  fun replaceQueueItemForRecoveryPreparesOnlyActiveErroredItemAndNeverTouchesActiveForNonActiveReplace() {
    val fake = RecordingFakePlayer(
      initialItems = LoggeRythmPlayerRuntime.installQueue(listOf(spec("a"), spec("b"))),
      activeIndex = 0,
      playbackState = Player.STATE_READY,
      playWhenReady = true,
      positionMs = 5_000L,
    )

    // Non-active replacement never prepares or resets active playback.
    applyPlayerCommand(
      fake.proxy,
      PlayerCommand.ReplaceQueueItem(
        index = 1,
        item = spec("b", cookie = "sf=refreshed", urlSuffix = "?lr_recovery=1"),
      ),
    )
    assertEquals(0, fake.prepareCalls)
    assertEquals(5_000L, fake.positionMs)

    // Active recovery replacement when errored/idle prepares the refreshed item.
    fake.playbackState = Player.STATE_IDLE
    fake.hasError = true
    applyPlayerCommand(
      fake.proxy,
      PlayerCommand.ReplaceQueueItem(
        index = 0,
        item = spec("a", cookie = "sf=refreshed", urlSuffix = "?lr_recovery=2"),
      ),
    )
    assertEquals(1, fake.prepareCalls)
    assertEquals(0, fake.setMediaItemsCalls)
  }

  @Test
  fun stagedSidecarsSurviveSpontaneousTimelineChangedBeforeMediaSessionAppliesAddOrReplace() {
    val initialSpecs = listOf(spec("a", "sf=1"), spec("b", "sf=1"))
    LoggeRythmPlayerRuntime.installQueue(initialSpecs)
    val addedSpec = spec("c", "sf=1")
    LoggeRythmPlayerRuntime.stageAddedQueueItems(
      existingIds = setOf("a", "b"),
      items = listOf(addedSpec),
    )
    val initialEntries = initialSpecs.map { it.id to it.url }
    val addedEntries = listOf(addedSpec.id to addedSpec.url)
    // Spontaneous duration-resolved EVENT_TIMELINE_CHANGED arrives with OLD timeline [a, b].
    val capturedBeforeApply = LoggeRythmPlayerRuntime.captureQueueEntries(initialEntries)
    assertEquals(listOf("a", "b"), capturedBeforeApply.map(PlayerItemSpec::id))
    // Pending cookie & extras for "c" must remain intact until MediaSession applies addMediaItems.
    assertEquals(
      "sf=1",
      LoggeRythmPlayerRuntime.cookieFor("https://loggerythm.logge.top/api/tracks/c/stream"),
    )
    assertTrue(LoggeRythmPlayerRuntime.extrasFor("c").contains("\"id\":\"c\""))

    // MediaSession applies addMediaItems and fires EVENT_TIMELINE_CHANGED with [a, b, c].
    val capturedAfterApply = LoggeRythmPlayerRuntime.captureQueueEntries(initialEntries + addedEntries)
    assertEquals(listOf("a", "b", "c"), capturedAfterApply.map(PlayerItemSpec::id))

    // Unstaged hostile item must still fail closed.
    val error = assertThrows(PlayerProtocolException::class.java) {
      LoggeRythmPlayerRuntime.captureQueueEntries(
        initialEntries + addedEntries + ("smuggled" to "https://loggerythm.logge.top/api/tracks/999/stream"),
      )
    }
    assertEquals("player-source-sidecar-missing", error.code)
  }

  @Test
  fun outOfBoundsAndDuplicateGranularQueueMutationsFailLoudlyWithoutTouchingPlayer() {
    val fake = RecordingFakePlayer(
      initialItems = LoggeRythmPlayerRuntime.installQueue(listOf(spec("a"), spec("b"))),
      activeIndex = 0,
      playbackState = Player.STATE_READY,
      playWhenReady = true,
      positionMs = 3_000L,
    )

    assertEquals(
      "queue-index-invalid",
      assertThrows(PlayerProtocolException::class.java) {
        applyPlayerCommand(fake.proxy, PlayerCommand.AddQueueItems(index = 3, items = listOf(spec("c"))))
      }.code,
    )
    assertEquals(
      "queue-item-id-duplicate",
      assertThrows(PlayerProtocolException::class.java) {
        applyPlayerCommand(fake.proxy, PlayerCommand.AddQueueItems(index = 1, items = listOf(spec("a"))))
      }.code,
    )
    assertEquals(
      "move-index-invalid",
      assertThrows(PlayerProtocolException::class.java) {
        applyPlayerCommand(fake.proxy, PlayerCommand.MoveQueueItem(fromIndex = 0, toIndex = 2))
      }.code,
    )
    assertEquals(
      "remove-range-invalid",
      assertThrows(PlayerProtocolException::class.java) {
        applyPlayerCommand(fake.proxy, PlayerCommand.RemoveQueueItems(fromIndex = 1, toIndex = 3))
      }.code,
    )
    assertEquals(
      "skip-index-invalid",
      assertThrows(PlayerProtocolException::class.java) {
        applyPlayerCommand(fake.proxy, PlayerCommand.SkipToIndex(index = 2))
      }.code,
    )
    assertTrue(fake.calls.isEmpty())
    assertEquals(listOf("a", "b"), fake.ids())
  }

  private fun spec(id: String, cookie: String = "sf=session", urlSuffix: String = "") =
    PlayerItemSpec(
      id = id,
      url = "https://loggerythm.logge.top/api/tracks/$id/stream$urlSuffix",
      title = "Track $id",
      artist = "Artist",
      album = "Album",
      artworkUrl = null,
      durationMs = 180_000L,
      cookie = cookie,
      extrasJson = """{"track":{"id":"$id"},"queueStableId":"stable:$id"}""",
    )

  private class RecordingFakePlayer(
    initialItems: List<MediaItem>,
    var activeIndex: Int,
    var playbackState: Int,
    var playWhenReady: Boolean,
    var positionMs: Long,
    var repeatMode: Int = Player.REPEAT_MODE_OFF,
    var hasError: Boolean = false,
  ) {
    val items = initialItems.toMutableList()
    val calls = mutableListOf<String>()
    var setMediaItemsCalls = 0
    var prepareCalls = 0
    var playCalls = 0
    var seekCalls = 0

    fun ids(): List<String> = items.map(MediaItem::mediaId)

    @Suppress("UNCHECKED_CAST")
    val proxy: Player = Proxy.newProxyInstance(
      Player::class.java.classLoader,
      arrayOf(Player::class.java),
    ) { _, method, args ->
      when (method.name) {
        "getMediaItemCount" -> items.size
        "getCurrentMediaItemIndex" -> activeIndex
        "getMediaItemAt" -> items[args[0] as Int]
        "getCurrentMediaItem" -> items.getOrNull(activeIndex)
        "getPlaybackState" -> playbackState
        "getPlayWhenReady" -> playWhenReady
        "getRepeatMode" -> repeatMode
        "getPlayerError" -> if (hasError) PlaybackException("boom", null, 1000) else null
        "setMediaItems" -> {
          setMediaItemsCalls += 1
          calls += "setMediaItems"
          items.clear()
          items.addAll(args[0] as List<MediaItem>)
          activeIndex = args[1] as Int
          positionMs = args[2] as Long
          null
        }
        "addMediaItems" -> {
          val index = args[0] as Int
          val added = args[1] as List<MediaItem>
          calls += "addMediaItems($index,[${added.joinToString(",") { it.mediaId }}])"
          items.addAll(index, added)
          if (items.size == added.size) activeIndex = 0
          else if (index <= activeIndex) activeIndex += added.size
          null
        }
        "moveMediaItem" -> {
          val from = args[0] as Int
          val to = args[1] as Int
          calls += "moveMediaItem($from,$to)"
          val activeId = items.getOrNull(activeIndex)?.mediaId
          val moved = items.removeAt(from)
          items.add(to, moved)
          if (activeId != null) activeIndex = items.indexOfFirst { it.mediaId == activeId }
          null
        }
        "removeMediaItems" -> {
          val from = args[0] as Int
          val to = args[1] as Int
          calls += "removeMediaItems($from,$to)"
          val activeId = items.getOrNull(activeIndex)?.mediaId
          val removingActive = activeIndex in from until to
          items.subList(from, to).clear()
          if (items.isEmpty()) {
            activeIndex = 0
            playbackState = Player.STATE_ENDED
          } else if (removingActive) {
            positionMs = 0L
            if (from < items.size) {
              activeIndex = from
            } else if (repeatMode == Player.REPEAT_MODE_ALL) {
              activeIndex = 0
            } else {
              activeIndex = 0
              playbackState = Player.STATE_ENDED
            }
          } else if (activeId != null) {
            activeIndex = items.indexOfFirst { it.mediaId == activeId }
          }
          null
        }
        "replaceMediaItem" -> {
          val index = args[0] as Int
          val replacement = args[1] as MediaItem
          calls += "replaceMediaItem($index,${replacement.mediaId})"
          items[index] = replacement
          if (index == activeIndex) positionMs = 0L
          null
        }
        "seekTo" -> {
          seekCalls += 1
          if (args.size == 2) {
            val index = args[0] as Int
            val pos = args[1] as Long
            calls += "seekTo($index,$pos)"
            activeIndex = index
            positionMs = pos
          } else {
            val pos = args[0] as Long
            calls += "seekTo($pos)"
            positionMs = pos
          }
          null
        }
        "prepare" -> {
          prepareCalls += 1
          calls += "prepare"
          hasError = false
          if (playbackState == Player.STATE_IDLE && items.isNotEmpty()) {
            playbackState = Player.STATE_READY
          }
          null
        }
        "play" -> {
          playCalls += 1
          calls += "play"
          playWhenReady = true
          null
        }
        "pause" -> {
          calls += "pause"
          playWhenReady = false
          null
        }
        "stop" -> {
          calls += "stop"
          playbackState = Player.STATE_IDLE
          null
        }
        "clearMediaItems" -> {
          calls += "clearMediaItems"
          items.clear()
          activeIndex = 0
          null
        }
        else -> throw AssertionError("Unexpected Player method: ${method.name}")
      }
    } as Player
  }
}
