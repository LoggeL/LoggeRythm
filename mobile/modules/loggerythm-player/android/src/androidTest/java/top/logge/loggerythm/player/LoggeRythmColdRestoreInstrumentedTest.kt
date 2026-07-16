package top.logge.loggerythm.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaBrowser
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.nio.charset.StandardCharsets
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Device proof that a new service instance can restore Auto-facing state without React/Activity. */
@RunWith(AndroidJUnit4::class)
class LoggeRythmColdRestoreInstrumentedTest {
  private lateinit var instrumentation: android.app.Instrumentation
  private lateinit var context: Context
  private lateinit var serviceIntent: Intent

  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:900002",
    origin = SYNTHETIC_ORIGIN,
  )

  @Before
  fun setUp() {
    instrumentation = InstrumentationRegistry.getInstrumentation()
    context = instrumentation.targetContext.applicationContext
    serviceIntent = Intent(context, LoggeRythmMediaLibraryService::class.java)
    context.stopService(serviceIntent)
    clearTestState()
  }

  @After
  fun tearDown() {
    context.stopService(serviceIntent)
    clearTestState()
  }

  @Test
  fun coldServiceBrowserRestoresEncryptedSameAccountBrowseTreeQueueAndPolicy() {
    val first = connectBrowser("ColdRestoreFixtureWriter")
    try {
      bindPersistenceOnMain(binding)
      val queue = LoggeRythmPlayerRuntime.installQueue(
        listOf(
          PlayerItemSpec(
            id = QUEUE_ID,
            url = QUEUE_URL,
            title = "Encrypted queue fixture",
            artist = "Instrumentation",
            album = "Cold restore",
            artworkUrl = null,
            durationMs = 180_000L,
            cookie = QUEUE_COOKIE,
            extrasJson = "{}",
          ),
        ),
      )
      onLooper(first.handler) {
        first.browser.setMediaItems(queue, 0, QUEUE_POSITION_MS)
        first.browser.repeatMode = Player.REPEAT_MODE_ONE
      }
      awaitQueue(first)
      persistBrowseAndPolicyOnMain()

      val encrypted = requireNotNull(LoggeRythmEncryptedAndroidBlobFile(context).read())
      val durableText = String(encrypted, StandardCharsets.ISO_8859_1)
      assertFalse(durableText.contains(binding.accountScope))
      assertFalse(durableText.contains(binding.origin))
      assertFalse(durableText.contains(QUEUE_COOKIE))
      assertFalse(durableText.contains(BROWSE_COOKIE))
      assertFalse(durableText.contains(QUEUE_URL))
      assertFalse(durableText.contains(BROWSE_URL))
    } finally {
      first.close()
    }

    context.stopService(serviceIntent)
    awaitServiceStopped()
    assertNull(LoggeRythmPlayerRuntime.currentSessionBinding())
    assertNull(LoggeRythmPlayerRuntime.browseItem(BROWSE_ID))

    val restored = connectBrowser("ColdRestoreFixtureReader")
    try {
      val root = onLooper(restored.handler) {
        restored.browser.getLibraryRoot(null)
      }.get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS).value
      assertNotNull(root)
      assertEquals(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID, root?.mediaId)

      val rootChildren = onLooper(restored.handler) {
        restored.browser.getChildren(checkNotNull(root).mediaId, 0, 100, null)
      }.get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS).value
      assertEquals(listOf(CONTAINER_ID), rootChildren?.map(MediaItem::mediaId))

      val browseChildren = onLooper(restored.handler) {
        restored.browser.getChildren(CONTAINER_ID, 0, 100, null)
      }.get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS).value
      assertEquals(listOf(BROWSE_ID), browseChildren?.map(MediaItem::mediaId))
      assertFalse(checkNotNull(browseChildren).single().toString().contains(BROWSE_COOKIE))

      awaitQueue(restored)
      assertEquals(binding, LoggeRythmPlayerRuntime.currentSessionBinding())
      assertEquals(BROWSE_COOKIE, LoggeRythmPlayerRuntime.cookieFor(BROWSE_URL))
      assertEquals(QUEUE_COOKIE, LoggeRythmPlayerRuntime.cookieFor(QUEUE_URL))
      assertEquals(
        REMOTE_CAPABILITIES,
        LoggeRythmPersistedServiceBridge.publicState().remoteCapabilities,
      )
    } finally {
      restored.close()
    }
  }

  private fun persistBrowseAndPolicyOnMain() {
    val completed = CountDownLatch(1)
    val outcome = AtomicReference<Result<Unit>>()
    instrumentation.runOnMainSync {
      LoggeRythmMediaSessionServiceBridge.installRemoteCommands(REMOTE_CAPABILITIES) { policy ->
        policy.fold(
          onSuccess = {
            LoggeRythmPlayerRuntime.installBrowseTree(privateBrowseTree())
            LoggeRythmPersistedServiceBridge.onBrowseTreeInstalled { result ->
              outcome.set(result)
              completed.countDown()
            }
          },
          onFailure = {
            outcome.set(Result.failure(it))
            completed.countDown()
          },
        )
      }
    }
    assertTrue(completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
    outcome.get().getOrThrow()
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
    assertTrue(completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
    outcome.get().getOrThrow()
    assertTrue(LoggeRythmPersistedServiceBridge.isReady())
  }

  private fun connectBrowser(threadName: String): ConnectedBrowser {
    val thread = HandlerThread(threadName).apply { start() }
    val handler = Handler(thread.looper)
    val token = SessionToken(
      context,
      ComponentName(context, LoggeRythmMediaLibraryService::class.java),
    )
    val browser = MediaBrowser.Builder(context, token)
      .setApplicationLooper(thread.looper)
      .buildAsync()
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    return ConnectedBrowser(thread, handler, browser)
  }

  private fun awaitQueue(controller: ConnectedBrowser) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEVICE_TIMEOUT_SECONDS)
    while (System.nanoTime() < deadline) {
      val snapshot = onLooper(controller.handler) {
        QueueSnapshot(
          count = controller.browser.mediaItemCount,
          mediaId = controller.browser.currentMediaItem?.mediaId,
          positionMs = controller.browser.currentPosition,
          repeatMode = controller.browser.repeatMode,
          playWhenReady = controller.browser.playWhenReady,
        )
      }
      if (
        snapshot.count == 1 &&
        snapshot.mediaId == QUEUE_ID &&
        snapshot.positionMs == QUEUE_POSITION_MS &&
        snapshot.repeatMode == Player.REPEAT_MODE_ONE &&
        !snapshot.playWhenReady
      ) return
      Thread.sleep(POLL_INTERVAL_MS)
    }
    throw AssertionError("cold-restore-queue-timeout")
  }

  private fun awaitServiceStopped() {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEVICE_TIMEOUT_SECONDS)
    while (System.nanoTime() < deadline) {
      if (
        !LoggeRythmPersistedServiceBridge.isReady() &&
        LoggeRythmPlayerRuntime.currentSessionBinding() == null
      ) return
      Thread.sleep(POLL_INTERVAL_MS)
    }
    throw AssertionError("cold-restore-service-stop-timeout")
  }

  private fun privateBrowseTree() = BrowseTreeSpec(
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
          id = CONTAINER_ID,
          title = "Cold restore fixtures",
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
              id = BROWSE_ID,
              title = "Encrypted browse fixture",
              subtitle = null,
              artist = "Instrumentation",
              album = "Cold restore",
              artworkUrl = null,
              durationMs = 180_000L,
              playable = true,
              url = BROWSE_URL,
              cookie = BROWSE_COOKIE,
              children = emptyList(),
            ),
          ),
        ),
      ),
    ),
  )

  private fun clearTestState() {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    LoggeRythmEncryptedAndroidKeyStoreCipher().clearKey()
    LoggeRythmEncryptedAndroidBlobFile(context).clear()
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
    if (!completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) throw TimeoutException()
    failure.get()?.let { throw it }
    return value.get()
  }

  private data class ConnectedBrowser(
    val thread: HandlerThread,
    val handler: Handler,
    val browser: MediaBrowser,
  ) {
    fun close() {
      val completed = CountDownLatch(1)
      handler.post {
        try {
          browser.release()
        } finally {
          completed.countDown()
        }
      }
      assertTrue(completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
      thread.quitSafely()
      thread.join(DEVICE_TIMEOUT_SECONDS * 1_000L)
    }
  }

  private data class QueueSnapshot(
    val count: Int,
    val mediaId: String?,
    val positionMs: Long,
    val repeatMode: Int,
    val playWhenReady: Boolean,
  )

  private companion object {
    const val SYNTHETIC_ORIGIN = "https://example.invalid"
    const val QUEUE_ID = "instrumentation:cold-queue"
    const val CONTAINER_ID = "instrumentation:cold-container"
    const val BROWSE_ID = "instrumentation:cold-browse"
    const val QUEUE_URL = "$SYNTHETIC_ORIGIN/cold-queue.mp3"
    const val BROWSE_URL = "$SYNTHETIC_ORIGIN/cold-browse.mp3"
    const val QUEUE_COOKIE = "fixture_queue_session=encrypted-only"
    const val BROWSE_COOKIE = "fixture_browse_session=encrypted-only"
    const val QUEUE_POSITION_MS = 7_654L
    const val DEVICE_TIMEOUT_SECONDS = 10L
    const val POLL_INTERVAL_MS = 50L
    val REMOTE_CAPABILITIES = setOf(
      RemotePlayerCapability.PLAY_PAUSE,
      RemotePlayerCapability.NEXT,
      RemotePlayerCapability.PREVIOUS,
      RemotePlayerCapability.SEEK,
    )
  }
}
