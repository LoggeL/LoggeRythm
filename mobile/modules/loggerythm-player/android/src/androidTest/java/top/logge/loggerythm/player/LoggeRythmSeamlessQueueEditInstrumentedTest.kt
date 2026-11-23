package top.logge.loggerythm.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Callable
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs
import kotlin.math.sin
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Real-ExoPlayer device proof (via [LoggeRythmMediaLibraryService] + [MediaController]) that
 * every queue-edit operation keeps the active track playing seamlessly — zero buffering
 * transitions, zero position discontinuities, zero spurious media-item transitions, zero
 * `isPlaying` drops — both while PLAYING and while PAUSED, while active-item removal performs
 * an intentional track change.
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class LoggeRythmSeamlessQueueEditInstrumentedTest {
  private lateinit var instrumentation: android.app.Instrumentation
  private lateinit var context: Context
  private lateinit var serviceIntent: Intent
  private lateinit var audioDir: File

  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:900099",
    origin = "https://example.invalid",
  )

  @Before
  fun setUp() {
    instrumentation = InstrumentationRegistry.getInstrumentation()
    context = instrumentation.targetContext.applicationContext
    serviceIntent = Intent(context, LoggeRythmMediaLibraryService::class.java)
    context.stopService(serviceIntent)
    awaitServiceStopped()
    LoggeRythmEncryptedAndroidKeyStoreCipher().clearKey()
    LoggeRythmEncryptedAndroidBlobFile(context).clear()
    audioDir = File(context.filesDir, "seamless_queue_test_audio").apply {
      deleteRecursively()
      mkdirs()
    }
  }

  @After
  fun tearDown() {
    context.stopService(serviceIntent)
    awaitServiceStopped()
    LoggeRythmEncryptedAndroidKeyStoreCipher().clearKey()
    LoggeRythmEncryptedAndroidBlobFile(context).clear()
    audioDir.deleteRecursively()
  }

  @Test
  fun queueEditsDuringPlayingAndPausedKeepActiveTrackSeamlessWhileActiveRemovalTransitions() {
    val wavA = createWavFixture("track_a.wav", durationSec = 25, hz = 220.0)
    val wavB = createWavFixture("track_b.wav", durationSec = 25, hz = 261.63)
    val wavC = createWavFixture("track_c.wav", durationSec = 25, hz = 329.63)
    val wavD = createWavFixture("track_d.wav", durationSec = 25, hz = 392.0)
    val wavNext = createWavFixture("track_next.wav", durationSec = 25, hz = 440.0)
    val wavTail = createWavFixture("track_tail.wav", durationSec = 25, hz = 493.88)

    val connected = connectController()
    try {
      bindPersistenceOnMain(binding)

      val initialSpecs = listOf(
        localSpec("queue:a", wavA, origin = "context", contextOrder = 0),
        localSpec("queue:b", wavB, origin = "context", contextOrder = 1),
        localSpec("queue:c", wavC, origin = "context", contextOrder = 2),
        localSpec("queue:d", wavD, origin = "context", contextOrder = 3),
      )

      // Start playing track_b (index 1) so we can exercise edits both BEFORE and AFTER active.
      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.SetQueue(initialSpecs, startIndex = 1, startPositionMs = 0L),
        )
        applyPlayerCommand(connected.controller, PlayerCommand.Play)
      }
      awaitPlayingAtLeast(connected, expectedMediaId = "queue:b", minPosMs = 800L)

      val controllerObserver = ContinuityObserver()
      val exoObserver = ContinuityObserver()
      val audioObserver = AudioPipelineObserver()
      onLooper(connected.handler) {
        connected.controller.addListener(controllerObserver)
      }
      instrumentation.runOnMainSync {
        assertTrue(
          "Expected live service ExoPlayer to be attached for direct observation",
          LoggeRythmExoPlayerObservationHook.addListeners(exoObserver, audioObserver),
        )
      }

      // 1. PLAYING: Play Next (insert manual item carrying inherited playlist context — matching JS controller)
      val posBeforePlayNext = currentPosition(connected)
      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.AddQueueItems(
            index = 2,
            items = listOf(localSpec("next:1", wavNext, origin = "manual", contextOrder = null)),
          ),
        )
      }
      awaitQueueIds(connected, listOf("queue:a", "queue:b", "next:1", "queue:c", "queue:d"))
      // Verify JS's follow-up setQueuePersistenceState + debounced encrypted save accept manual
      // items with inherited context without failing closed or wiping the queue.
      instrumentation.runOnMainSync {
        LoggeRythmPersistedServiceBridge.applyAuxiliaryCommand(
          PlayerCommand.SetQueuePersistenceState(
            contextShuffleEnabled = false,
            contextShuffleRestoreOrder = emptyList(),
          ),
        )
      }
      Thread.sleep(400L)
      val posAfterPlayNext = currentPosition(connected)
      assertTrue(
        "Play Next rewound playhead: $posBeforePlayNext -> $posAfterPlayNext",
        posAfterPlayNext >= posBeforePlayNext,
      )

      // 2. PLAYING: Add to Queue (append at end)
      val posBeforeAdd = currentPosition(connected)
      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.AddQueueItems(
            index = 5,
            items = listOf(localSpec("added:1", wavTail, origin = "manual", contextOrder = null)),
          ),
        )
      }
      awaitQueueIds(connected, listOf("queue:a", "queue:b", "next:1", "queue:c", "queue:d", "added:1"))
      Thread.sleep(300L)
      val posAfterAdd = currentPosition(connected)
      assertTrue(
        "Add to Queue rewound playhead: $posBeforeAdd -> $posAfterAdd",
        posAfterAdd >= posBeforeAdd,
      )

      // 3. PLAYING: Reorder ("Umsortieren": move queue:d from index 4 to index 3)
      val posBeforeMove = currentPosition(connected)
      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.MoveQueueItem(fromIndex = 4, toIndex = 3),
        )
      }
      awaitQueueIds(connected, listOf("queue:a", "queue:b", "next:1", "queue:d", "queue:c", "added:1"))
      Thread.sleep(300L)
      val posAfterMove = currentPosition(connected)
      assertTrue(
        "Reorder rewound playhead: $posBeforeMove -> $posAfterMove",
        posAfterMove >= posBeforeMove,
      )

      // 4. PLAYING: Remove non-active track AFTER active (remove queue:c at index 4)
      val posBeforeRemoveAfter = currentPosition(connected)
      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.RemoveQueueItems(fromIndex = 4, toIndex = 5),
        )
      }
      awaitQueueIds(connected, listOf("queue:a", "queue:b", "next:1", "queue:d", "added:1"))
      Thread.sleep(300L)
      val posAfterRemoveAfter = currentPosition(connected)
      assertTrue(
        "Remove upcoming rewound playhead: $posBeforeRemoveAfter -> $posAfterRemoveAfter",
        posAfterRemoveAfter >= posBeforeRemoveAfter,
      )

      // 5. PLAYING: Remove non-active track BEFORE active (remove queue:a at index 0 -> active shifts 1 -> 0)
      val posBeforeRemoveBefore = currentPosition(connected)
      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.RemoveQueueItems(fromIndex = 0, toIndex = 1),
        )
      }
      awaitQueueIds(connected, listOf("queue:b", "next:1", "queue:d", "added:1"))
      Thread.sleep(300L)
      val posAfterRemoveBefore = currentPosition(connected)
      assertTrue(
        "Remove history track rewound playhead: $posBeforeRemoveBefore -> $posAfterRemoveBefore",
        posAfterRemoveBefore >= posBeforeRemoveBefore,
      )

      // 6. PLAYING: Active-preserving ReplaceQueue (party sync scenario)
      val posBeforePartySync = currentPosition(connected)
      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.ReplaceQueue(
            items = listOf(
              localSpec("queue:a", wavA, origin = "context", contextOrder = 0),
              localSpec("queue:b", wavB, origin = "context", contextOrder = 1),
              localSpec("queue:c", wavC, origin = "context", contextOrder = 2),
            ),
            startIndex = 1,
            startPositionMs = 0L,
            resume = false,
          ),
        )
      }
      awaitQueueIds(connected, listOf("queue:a", "queue:b", "queue:c"))
      Thread.sleep(300L)
      val posAfterPartySync = currentPosition(connected)
      assertTrue(
        "Active-preserving ReplaceQueue rewound playhead: $posBeforePartySync -> $posAfterPartySync",
        posAfterPartySync >= posBeforePartySync,
      )

      // Assert ZERO playback glitches across ALL 6 live playing queue edits on BOTH real ExoPlayer
      // (including AudioSink/AudioTrack lifecycle!) and MediaController!
      val playingState = readPlayerState(connected)
      assertEquals("queue:b", playingState.mediaId)
      assertEquals(1, playingState.index)
      assertTrue("Expected player to remain playing", playingState.isPlaying)
      assertEquals(Player.STATE_READY, playingState.playbackState)
      assertNull(playingState.error)
      assertEquals(
        "Expected 0 ExoPlayer buffering transitions during live queue edits, saw ${exoObserver.bufferingCount.get()}",
        0,
        exoObserver.bufferingCount.get(),
      )
      assertEquals(
        "Expected 0 ExoPlayer position discontinuities during live queue edits, saw ${exoObserver.discontinuityReasons}",
        0,
        exoObserver.discontinuityReasons.size,
      )
      assertEquals(
        "Expected 0 ExoPlayer media item transitions during live queue edits, saw ${exoObserver.transitionIds}",
        0,
        exoObserver.transitionIds.size,
      )
      assertEquals(
        "Expected 0 ExoPlayer isPlaying=false drops during live queue edits",
        0,
        exoObserver.isPlayingFalseCount.get(),
      )
      assertEquals(
        "Expected 0 AudioTrack releases during live queue edits",
        0,
        audioObserver.audioTrackReleasedCount.get(),
      )
      assertEquals(
        "Expected 0 AudioTrack re-initializations during live queue edits",
        0,
        audioObserver.audioTrackInitializedCount.get(),
      )
      assertEquals(0, controllerObserver.bufferingCount.get())
      assertTrue(
        "MediaController must never transition away from active queue:b, saw ${controllerObserver.transitionIds}",
        controllerObserver.transitionIds.all { it == "queue:b" },
      )
      assertEquals(0, controllerObserver.isPlayingFalseCount.get())

      // 7. PAUSED: pause playback, reset observers, and run Add + Move + Remove non-active.
      onLooper(connected.handler) {
        applyPlayerCommand(connected.controller, PlayerCommand.Pause)
      }
      awaitPaused(connected)
      Thread.sleep(250L)
      controllerObserver.reset()
      exoObserver.reset()
      audioObserver.reset()
      val pausedPosBefore = currentPosition(connected)

      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.AddQueueItems(
            index = 2,
            items = listOf(localSpec("paused:next", wavNext, origin = "manual", contextOrder = null)),
          ),
        )
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.MoveQueueItem(fromIndex = 3, toIndex = 2),
        )
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.RemoveQueueItems(fromIndex = 0, toIndex = 1),
        )
      }
      awaitQueueIds(connected, listOf("queue:b", "queue:c", "paused:next"))
      Thread.sleep(400L)

      val pausedState = readPlayerState(connected)
      assertEquals("queue:b", pausedState.mediaId)
      assertEquals(0, pausedState.index)
      assertFalse("Paused edits must never resume playWhenReady", pausedState.playWhenReady)
      assertFalse("Paused edits must never start playing", pausedState.isPlaying)
      assertEquals(Player.STATE_READY, pausedState.playbackState)
      assertTrue(
        "Paused position shifted: before=$pausedPosBefore after=${pausedState.positionMs}",
        abs(pausedState.positionMs - pausedPosBefore) <= 50L,
      )
      assertEquals(0, exoObserver.bufferingCount.get())
      assertEquals(0, exoObserver.discontinuityReasons.size)
      assertEquals(0, exoObserver.transitionIds.size)
      assertEquals(0, audioObserver.audioTrackReleasedCount.get())
      assertEquals(0, audioObserver.audioTrackInitializedCount.get())
      assertEquals(0, controllerObserver.bufferingCount.get())
      assertTrue(
        "MediaController must never transition away from active queue:b while paused, saw ${controllerObserver.transitionIds}",
        controllerObserver.transitionIds.all { it == "queue:b" },
      )

      // 8. INTENTIONAL TRACK CHANGE: remove the currently active track ("queue:b" at index 0).
      onLooper(connected.handler) {
        applyPlayerCommand(connected.controller, PlayerCommand.Play)
      }
      awaitPlayingAtLeast(connected, expectedMediaId = "queue:b", minPosMs = pausedPosBefore)
      controllerObserver.reset()
      exoObserver.reset()
      audioObserver.reset()

      onLooper(connected.handler) {
        applyPlayerCommand(
          connected.controller,
          PlayerCommand.RemoveQueueItems(fromIndex = 0, toIndex = 1),
        )
      }
      awaitPlayingAtLeast(connected, expectedMediaId = "queue:c", minPosMs = 150L)
      val afterActiveRemove = readPlayerState(connected)
      assertEquals("queue:c", afterActiveRemove.mediaId)
      assertEquals(0, afterActiveRemove.index)
      assertTrue(
        "Removing active track must emit an intentional ExoPlayer transition to queue:c",
        exoObserver.transitionIds.contains("queue:c"),
      )
      assertTrue(
        "Removing active track must emit an intentional ExoPlayer DISCONTINUITY_REASON_REMOVE",
        exoObserver.discontinuityReasons.contains(Player.DISCONTINUITY_REASON_REMOVE),
      )

      onLooper(connected.handler) {
        connected.controller.removeListener(controllerObserver)
      }
      instrumentation.runOnMainSync {
        LoggeRythmExoPlayerObservationHook.removeListeners(exoObserver, audioObserver)
      }
    } finally {
      try {
        clearBoundPlayerTestState(instrumentation)
      } finally {
        connected.close()
      }
    }
  }

  private fun localSpec(
    id: String,
    wav: File,
    origin: String = "context",
    contextOrder: Int? = 0,
  ): PlayerItemSpec {
    val orderFragment = if (contextOrder != null) ""","queueOriginalContextOrder":$contextOrder""" else ""
    return PlayerItemSpec(
      id = id,
      url = wav.canonicalFile.toURI().toASCIIString(),
      title = "Track $id",
      artist = "Instrumentation",
      album = "Seamless Queue",
      artworkUrl = null,
      durationMs = 25_000L,
      cookie = null,
      extrasJson = """{"track":{"id":"${id.hashCode().let { abs(it) }}","title":"Track $id","artist":"Instrumentation","artists":[]},"queueOrigin":"$origin","queueContextType":"playlist","queueContextId":"playlist-1","queueContextLabel":"Late Night Drive"$orderFragment,"queueStableId":"stable:$id"}""",
    )
  }

  private fun createWavFixture(name: String, durationSec: Int, hz: Double): File {
    val sampleRate = 16_000
    val numSamples = sampleRate * durationSec
    val dataSize = numSamples * 2
    val out = ByteArrayOutputStream(44 + dataSize)
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray(Charsets.US_ASCII))
    header.putInt(36 + dataSize)
    header.put("WAVE".toByteArray(Charsets.US_ASCII))
    header.put("fmt ".toByteArray(Charsets.US_ASCII))
    header.putInt(16)
    header.putShort(1) // PCM
    header.putShort(1) // mono
    header.putInt(sampleRate)
    header.putInt(sampleRate * 2)
    header.putShort(2)
    header.putShort(16)
    header.put("data".toByteArray(Charsets.US_ASCII))
    header.putInt(dataSize)
    out.write(header.array())
    val pcm = ByteBuffer.allocate(dataSize).order(ByteOrder.LITTLE_ENDIAN)
    val twoPi = 2.0 * Math.PI
    for (i in 0 until numSamples) {
      val sample = (sin(twoPi * hz * i / sampleRate) * 6_000.0).toInt().toShort()
      pcm.putShort(sample)
    }
    out.write(pcm.array())
    return File(audioDir, name).apply { writeBytes(out.toByteArray()) }
  }

  private fun bindPersistenceOnMain(exactBinding: LoggeRythmPersistedSessionBinding) {
    val completed = CountDownLatch(1)
    val outcome = AtomicReference<Result<Unit>>()
    instrumentation.runOnMainSync {
      LoggeRythmPersistedServiceBridge.bindSession(exactBinding) { result ->
        outcome.set(result)
        completed.countDown()
      }
    }
    assertTrue(completed.await(TIMEOUT_SECONDS, TimeUnit.SECONDS))
    outcome.get().getOrThrow()
  }

  private fun connectController(): ConnectedController {
    val thread = HandlerThread("SeamlessQueueTestController").apply { start() }
    val handler = Handler(thread.looper)
    val token = SessionToken(
      context,
      ComponentName(context, LoggeRythmMediaLibraryService::class.java),
    )
    val controller = MediaController.Builder(context, token)
      .setApplicationLooper(thread.looper)
      .buildAsync()
      .get(TIMEOUT_SECONDS, TimeUnit.SECONDS)
    return ConnectedController(thread, handler, controller)
  }

  private fun currentPosition(connected: ConnectedController): Long =
    onLooper(connected.handler) { connected.controller.currentPosition }

  private fun readPlayerState(connected: ConnectedController): PlayerSnapshot =
    onLooper(connected.handler) {
      PlayerSnapshot(
        ids = List(connected.controller.mediaItemCount) { idx ->
          connected.controller.getMediaItemAt(idx).mediaId
        },
        index = connected.controller.currentMediaItemIndex,
        mediaId = connected.controller.currentMediaItem?.mediaId,
        positionMs = connected.controller.currentPosition,
        playbackState = connected.controller.playbackState,
        playWhenReady = connected.controller.playWhenReady,
        isPlaying = connected.controller.isPlaying,
        error = connected.controller.playerError,
      )
    }

  private fun awaitPlayingAtLeast(
    connected: ConnectedController,
    expectedMediaId: String,
    minPosMs: Long,
  ) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS)
    var last: PlayerSnapshot? = null
    while (System.nanoTime() < deadline) {
      val state = readPlayerState(connected)
      last = state
      if (
        state.mediaId == expectedMediaId &&
        state.playbackState == Player.STATE_READY &&
        state.isPlaying &&
        state.positionMs >= minPosMs
      ) {
        return
      }
      Thread.sleep(POLL_MS)
    }
    throw AssertionError("Timed out waiting for $expectedMediaId >= ${minPosMs}ms; last=$last")
  }

  private fun awaitPaused(connected: ConnectedController) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS)
    while (System.nanoTime() < deadline) {
      val state = readPlayerState(connected)
      if (!state.isPlaying && !state.playWhenReady && state.playbackState == Player.STATE_READY) {
        return
      }
      Thread.sleep(POLL_MS)
    }
    throw AssertionError("Timed out waiting for paused state: ${readPlayerState(connected)}")
  }

  private fun awaitQueueIds(connected: ConnectedController, expected: List<String>) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS)
    var last = emptyList<String>()
    while (System.nanoTime() < deadline) {
      last = readPlayerState(connected).ids
      if (last == expected) return
      Thread.sleep(POLL_MS)
    }
    throw AssertionError("Timed out waiting for queue $expected; got $last")
  }

  private fun awaitServiceStopped() {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(TIMEOUT_SECONDS)
    while (System.nanoTime() < deadline) {
      if (
        !LoggeRythmPersistedServiceBridge.isReady() &&
        LoggeRythmPlayerRuntime.currentSessionBinding() == null
      ) return
      Thread.sleep(POLL_MS)
    }
  }

  private fun <T> onLooper(handler: Handler, callable: Callable<T>): T {
    val completed = CountDownLatch(1)
    val value = AtomicReference<T>()
    val failure = AtomicReference<Throwable>()
    handler.post {
      try {
        value.set(callable.call())
      } catch (error: Throwable) {
        failure.set(error)
      } finally {
        completed.countDown()
      }
    }
    if (!completed.await(TIMEOUT_SECONDS, TimeUnit.SECONDS)) throw TimeoutException()
    failure.get()?.let { throw it }
    return value.get()
  }

  private class ContinuityObserver : Player.Listener {
    val bufferingCount = AtomicInteger(0)
    val isPlayingFalseCount = AtomicInteger(0)
    val discontinuityReasons = CopyOnWriteArrayList<Int>()
    val transitionIds = CopyOnWriteArrayList<String>()

    fun reset() {
      bufferingCount.set(0)
      isPlayingFalseCount.set(0)
      discontinuityReasons.clear()
      transitionIds.clear()
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_BUFFERING) bufferingCount.incrementAndGet()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (!isPlaying) isPlayingFalseCount.incrementAndGet()
    }

    override fun onPositionDiscontinuity(
      oldPosition: Player.PositionInfo,
      newPosition: Player.PositionInfo,
      reason: Int,
    ) {
      discontinuityReasons += reason
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      transitionIds += (mediaItem?.mediaId ?: "<null>")
    }
  }

  private class AudioPipelineObserver : AnalyticsListener {
    val audioTrackInitializedCount = AtomicInteger(0)
    val audioTrackReleasedCount = AtomicInteger(0)

    fun reset() {
      audioTrackInitializedCount.set(0)
      audioTrackReleasedCount.set(0)
    }

    override fun onAudioTrackInitialized(
      eventTime: AnalyticsListener.EventTime,
      audioTrackConfig: AudioSink.AudioTrackConfig,
    ) {
      audioTrackInitializedCount.incrementAndGet()
    }

    override fun onAudioTrackReleased(
      eventTime: AnalyticsListener.EventTime,
      audioTrackConfig: AudioSink.AudioTrackConfig,
    ) {
      audioTrackReleasedCount.incrementAndGet()
    }
  }

  private data class ConnectedController(
    val thread: HandlerThread,
    val handler: Handler,
    val controller: MediaController,
  ) {
    fun close() {
      val completed = CountDownLatch(1)
      handler.post {
        try {
          controller.release()
        } finally {
          completed.countDown()
        }
      }
      assertTrue(completed.await(TIMEOUT_SECONDS, TimeUnit.SECONDS))
      thread.quitSafely()
      thread.join(TIMEOUT_SECONDS * 1_000L)
    }
  }

  private data class PlayerSnapshot(
    val ids: List<String>,
    val index: Int,
    val mediaId: String?,
    val positionMs: Long,
    val playbackState: Int,
    val playWhenReady: Boolean,
    val isPlaying: Boolean,
    val error: Throwable?,
  )

  private companion object {
    const val TIMEOUT_SECONDS = 15L
    const val POLL_MS = 50L
  }
}
