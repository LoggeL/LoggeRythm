package top.logge.loggerythm.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import androidx.media3.session.legacy.MediaBrowserCompat as MediaBrowser
import androidx.media3.session.legacy.MediaControllerCompat
import androidx.media3.session.legacy.PlaybackStateCompat
import androidx.media3.session.legacy.MediaSessionCompat
import android.media.session.MediaController
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Callable
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
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

/**
 * Device regression for the platform `android.media.browse.MediaBrowserService` bridge that
 * Android Auto, Automotive OS and other legacy hosts use. Before the repair, Media3's
 * identity-free legacy bind lookup was rejected, the framework received a null binder, and every
 * legacy browser failed to connect. This test drives the Media3 legacy MediaBrowserCompat (including its platform binder) and
 * the real platform MediaController (same app UID, so the internal profile) through connect, paged browse,
 * search, play-from-ID, voice search, rejected URI injection, and actionable car errors.
 */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
@RunWith(AndroidJUnit4::class)
class LoggeRythmLegacyBrowserInstrumentedTest {
  private lateinit var instrumentation: android.app.Instrumentation
  private lateinit var context: Context
  private lateinit var serviceIntent: Intent
  private lateinit var thread: HandlerThread
  private lateinit var handler: Handler
  private var activity: android.app.Activity? = null
  private var browser: MediaBrowser? = null
  private var controller: MediaController? = null
  private var compatController: MediaControllerCompat? = null
  private val compatCallback = object : MediaControllerCompat.Callback() {
    override fun onPlaybackStateChanged(state: PlaybackStateCompat?) {
      state?.errorMessage?.toString()?.let(errorMessages::add)
    }
  }
  private val errorMessages = CopyOnWriteArrayList<String>()
  private val controllerCallback = object : MediaController.Callback() {
    override fun onPlaybackStateChanged(state: PlaybackState?) {
      state?.errorMessage?.toString()?.let(errorMessages::add)
    }
  }

  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:900003",
    origin = SYNTHETIC_ORIGIN,
  )

  @Before
  fun setUp() {
    instrumentation = InstrumentationRegistry.getInstrumentation()
    context = instrumentation.targetContext.applicationContext
    serviceIntent = Intent(context, LoggeRythmMediaLibraryService::class.java)
    context.stopService(serviceIntent)
    clearTestState()
    thread = HandlerThread("LegacyPlatformBrowser").apply { start() }
    handler = Handler(thread.looper)
    activity = instrumentation.startActivitySync(
      Intent(context, LoggeRythmPlayerTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
  }

  @After
  fun tearDown() {
    clearBoundPlayerTestState(instrumentation)
    controller?.let { active -> runCatching { active.unregisterCallback(controllerCallback) } }
    compatController?.unregisterCallback(compatCallback)
    browser?.let { active -> runCatching { onLooper { active.disconnect() } } }
    thread.quitSafely()
    thread.join(DEVICE_TIMEOUT_SECONDS * 1_000L)
    context.stopService(serviceIntent)
    clearTestState()
    fixtureDirectory().deleteRecursively()
    instrumentation.runOnMainSync { activity?.finish() }
  }

  @Test
  fun platformBrowserBridgeServesLibrarySearchVoiceAndActionableErrors() {
    val connected = connectPlatformBrowser()
    assertEquals(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID, connected.root)
    assertTrue(connected.extras.getBoolean(SEARCH_SUPPORTED_ROOT_EXTRA))

    // No account is bound in this process yet: the car receives an explicit error, not a blank.
    assertNull(loadChildren(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID))

    bindPersistenceOnMain()
    installPolicyAndTreeOnMain()

    val rootChildren = requireNotNull(loadChildren(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID))
    assertEquals(listOf(LIKED_ID, PLAYLISTS_ID), rootChildren.map { it.mediaId })
    assertTrue(rootChildren.all { it.isBrowsable && !it.isPlayable })

    val secondPage = requireNotNull(
      loadChildren(
        LIKED_ID,
        Bundle().apply {
          putInt(MediaBrowser.EXTRA_PAGE, 1)
          putInt(MediaBrowser.EXTRA_PAGE_SIZE, 2)
        },
      ),
    )
    assertEquals(LIKED_TRACK_IDS.subList(2, 4), secondPage.map { it.mediaId })
    assertTrue(secondPage.all { it.isPlayable && it.description.mediaUri == null })
    assertTrue(secondPage.none { it.description.extras?.containsKey("track") == true })
    val beyondEnd = requireNotNull(
      loadChildren(
        LIKED_ID,
        Bundle().apply {
          putInt(MediaBrowser.EXTRA_PAGE, 9)
          putInt(MediaBrowser.EXTRA_PAGE_SIZE, 2)
        },
      ),
    )
    assertTrue(beyondEnd.isEmpty())
    // A list that is not (or no longer) published fails explicitly.
    assertNull(loadChildren("playlist:deleted"))

    val searchResults = requireNotNull(search("third"))
    assertEquals(listOf(LIKED_TRACK_IDS[2]), searchResults.map { it.mediaId })
    assertTrue(requireNotNull(search("no such title anywhere")).isEmpty())

    val platformController = connectController(connected)
    awaitActions(
      PlaybackState.ACTION_PLAY or
        PlaybackState.ACTION_PLAY_PAUSE or
        PlaybackState.ACTION_STOP or
        PlaybackState.ACTION_PLAY_FROM_MEDIA_ID or
        PlaybackState.ACTION_PLAY_FROM_SEARCH or
        PlaybackState.ACTION_PREPARE_FROM_MEDIA_ID or
        PlaybackState.ACTION_PREPARE_FROM_SEARCH,
    )

    // An old persisted tree from 1.0.13 has no Track sidecars. Selecting it must
    // request a phone refresh rather than create a queue the phone UI cannot render.
    fun withoutPrivateExtras(node: BrowseNodeSpec): BrowseNodeSpec = node.copy(
      extrasJson = "{}", children = node.children.map(::withoutPrivateExtras),
    )
    installPolicyAndTreeOnMain(BrowseTreeSpec(withoutPrivateExtras(libraryTree().root)))
    platformController.transportControls.prepareFromMediaId(LIKED_TRACK_IDS[0], null)
    awaitErrorMessage(context.getString(R.string.loggerythm_player_car_error_refresh_required))
    assertTrue(LoggeRythmPlayerRuntime.queueSources().isEmpty())
    installPolicyAndTreeOnMain()

    // The standard Play button can start the available library even with an empty queue.
    platformController.transportControls.play()
    awaitQueue(LIKED_TRACK_IDS, currentId = LIKED_TRACK_IDS[0])
    awaitState(PlaybackState.STATE_PLAYING)
    awaitActions(PlaybackState.ACTION_PAUSE)
    platformController.transportControls.pause()
    awaitState(PlaybackState.STATE_PAUSED)

    // Selecting a playlist track queues its ordered playable siblings, starting at the selection.
    platformController.transportControls.prepareFromMediaId(LIKED_TRACK_IDS[3], null)
    awaitQueue(LIKED_TRACK_IDS, currentId = LIKED_TRACK_IDS[3])
    assertFalse(platformController.playbackState?.state == PlaybackState.STATE_PLAYING)

    // Voice: an exact list title queues that list from its first track.
    platformController.transportControls.prepareFromSearch("Roadtrip", null)
    awaitQueue(ROADTRIP_TRACK_IDS, currentId = ROADTRIP_TRACK_IDS[0])

    // Exercise real ExoPlayer audio decoding and platform transport commands, not just prepare.
    platformController.transportControls.playFromMediaId(LIKED_TRACK_IDS[1], null)
    awaitQueue(LIKED_TRACK_IDS, currentId = LIKED_TRACK_IDS[1])
    awaitState(PlaybackState.STATE_PLAYING)
    poll("playback-position-did-not-advance") {
      (platformController.playbackState?.position ?: 0L) > 100L
    }
    platformController.transportControls.pause()
    awaitState(PlaybackState.STATE_PAUSED)
    platformController.transportControls.seekTo(5_000L)
    poll("seek-not-applied") {
      (platformController.playbackState?.position ?: 0L) in 4_900L..5_200L
    }
    platformController.transportControls.skipToNext()
    awaitQueue(LIKED_TRACK_IDS, currentId = LIKED_TRACK_IDS[2])
    platformController.transportControls.skipToPrevious()
    awaitQueue(LIKED_TRACK_IDS, currentId = LIKED_TRACK_IDS[1])
    platformController.transportControls.playFromSearch("Roadtrip", null)
    awaitQueue(ROADTRIP_TRACK_IDS, currentId = ROADTRIP_TRACK_IDS[0])
    awaitState(PlaybackState.STATE_PLAYING)
    platformController.transportControls.stop()
    // Media3 maps Player.STATE_IDLE after stop to the platform STATE_NONE.
    awaitState(PlaybackState.STATE_NONE)
    platformController.transportControls.playFromSearch("", null)
    awaitState(PlaybackState.STATE_PLAYING)
    awaitQueue(ROADTRIP_TRACK_IDS, currentId = ROADTRIP_TRACK_IDS[0])
    platformController.transportControls.pause()
    awaitState(PlaybackState.STATE_PAUSED)

    // Voice without a match is an actionable, localized car error; the queue is unchanged.
    val missingQuery = "zzz missing"
    platformController.transportControls.prepareFromSearch(missingQuery, null)
    awaitErrorMessage(
      context.getString(R.string.loggerythm_player_car_error_search_no_match, missingQuery),
    )
    awaitQueue(ROADTRIP_TRACK_IDS, currentId = ROADTRIP_TRACK_IDS[0])

    // Caller URIs are never accepted, even from the app's own platform controller.
    platformController.transportControls.prepareFromUri(Uri.parse(ATTACKER_URL), null)
    awaitErrorMessage(context.getString(R.string.loggerythm_player_car_error_unsupported))
    awaitQueue(ROADTRIP_TRACK_IDS, currentId = ROADTRIP_TRACK_IDS[0])
    assertTrue(LoggeRythmPlayerRuntime.queueSources().none { it.url == ATTACKER_URL })

    // A queue created by the car retains private Track metadata across a service restart.
    // The phone requires extras.track when it renders/reconciles these queue entries.
    assertEquals("Highway 1", org.json.JSONObject(
      LoggeRythmPlayerRuntime.extrasFor(ROADTRIP_TRACK_IDS[0]),
    ).getJSONObject("track").getString("title"))
    platformController.unregisterCallback(controllerCallback)
    compatController?.unregisterCallback(compatCallback)
    onLooper { requireNotNull(browser).disconnect() }
    browser = null
    context.stopService(serviceIntent)
    poll("car-service-not-stopped") { LoggeRythmPlayerRuntime.currentSessionBinding() == null }
    val restored = connectPlatformBrowser()
    assertNotNull(loadChildren(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID))
    connectController(restored)
    awaitQueue(ROADTRIP_TRACK_IDS, currentId = ROADTRIP_TRACK_IDS[0])
    assertEquals("Highway 1", org.json.JSONObject(
      LoggeRythmPlayerRuntime.extrasFor(ROADTRIP_TRACK_IDS[0]),
    ).getJSONObject("track").getString("title"))
    assertFalse(controller?.playbackState?.state == PlaybackState.STATE_PLAYING)

    // Logout: the car root reports the sign-in action instead of stale or empty content.
    clearPersistedStateOnMain()
    assertNull(loadChildren(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID))
    awaitErrorMessage(context.getString(R.string.loggerythm_player_car_error_signed_out))
  }

  private data class ConnectedPlatformBrowser(
    val root: String,
    val extras: Bundle,
    val token: android.media.session.MediaSession.Token,
    val compatToken: MediaSessionCompat.Token,
  )

  private fun connectPlatformBrowser(): ConnectedPlatformBrowser {
    val completed = CountDownLatch(1)
    val outcome = AtomicReference<String>()
    onLooper {
      val created = MediaBrowser(
        context,
        ComponentName(context, LoggeRythmMediaLibraryService::class.java),
        object : MediaBrowser.ConnectionCallback() {
          override fun onConnected() {
            outcome.compareAndSet(null, "connected")
            completed.countDown()
          }

          override fun onConnectionFailed() {
            outcome.compareAndSet(null, "failed")
            completed.countDown()
          }

          override fun onConnectionSuspended() {
            outcome.compareAndSet(null, "suspended")
            completed.countDown()
          }
        },
        null,
      )
      browser = created
      created.connect()
    }
    assertTrue(
      "The legacy MediaBrowserService bind produced no connection callback",
      completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS),
    )
    assertEquals(
      "The legacy MediaBrowserService bridge must accept this app's own browser",
      "connected",
      outcome.get(),
    )
    val active = requireNotNull(browser)
    return onLooper {
      ConnectedPlatformBrowser(active.root, active.extras ?: Bundle.EMPTY, active.sessionToken.token as android.media.session.MediaSession.Token, active.sessionToken)
    }
  }

  private fun connectController(connected: ConnectedPlatformBrowser): MediaController {
    val created = MediaController(context, connected.token)
    created.registerCallback(controllerCallback, handler)
    controller = created
    // Media3 sends nonfatal errors as one-shot compat events. The platform may
    // coalesce its immediately-cleared PlaybackState; Auto's compat binder retains the event.
    compatController = onLooper {
      MediaControllerCompat(context, connected.compatToken).also {
        it.registerCallback(compatCallback, handler)
      }
    }
    poll("compat-session-not-ready") { compatController?.isSessionReady == true }
    return created
  }

  private fun loadChildren(parentId: String, options: Bundle? = null): List<MediaBrowser.MediaItem>? {
    val completed = CountDownLatch(1)
    val children = AtomicReference<List<MediaBrowser.MediaItem>>()
    val failed = AtomicBoolean(false)
    val callback = object : MediaBrowser.SubscriptionCallback() {
      override fun onChildrenLoaded(parentId: String?, loaded: List<MediaBrowser.MediaItem>?) {
        children.compareAndSet(null, requireNotNull(loaded).toList())
        completed.countDown()
      }

      override fun onChildrenLoaded(
        parentId: String?,
        loaded: List<MediaBrowser.MediaItem>?,
        options: Bundle?,
      ) {
        children.compareAndSet(null, requireNotNull(loaded).toList())
        completed.countDown()
      }

      override fun onError(parentId: String?) {
        failed.set(true)
        completed.countDown()
      }

      override fun onError(parentId: String?, options: Bundle?) {
        failed.set(true)
        completed.countDown()
      }
    }
    val active = requireNotNull(browser)
    onLooper {
      active.subscribe(parentId, options ?: Bundle(), callback)
    }
    try {
      assertTrue(
        "No browse result for $parentId",
        completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS),
      )
    } finally {
      onLooper { active.unsubscribe(parentId) }
    }
    return if (failed.get()) null else children.get()
  }

  private fun search(query: String): List<MediaBrowser.MediaItem>? {
    val completed = CountDownLatch(1)
    val results = AtomicReference<List<MediaBrowser.MediaItem>>()
    val failed = AtomicBoolean(false)
    val active = requireNotNull(browser)
    onLooper {
      active.search(
        query,
        null,
        object : MediaBrowser.SearchCallback() {
          override fun onSearchResult(
            query: String,
            extras: Bundle?,
            items: List<MediaBrowser.MediaItem>,
          ) {
            results.compareAndSet(null, items.toList())
            completed.countDown()
          }

          override fun onError(query: String, extras: Bundle?) {
            failed.set(true)
            completed.countDown()
          }
        },
      )
    }
    assertTrue(
      "No search result for $query",
      completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS),
    )
    return if (failed.get()) null else results.get()
  }

  private fun awaitState(expected: Int) {
    poll("playback-state-timeout: expected=$expected actual=${controller?.playbackState}") {
      controller?.playbackState?.state == expected
    }
  }

  private fun awaitActions(required: Long) {
    poll("platform-actions-timeout") {
      val actions = requireNotNull(controller).playbackState?.actions ?: 0L
      actions and required == required
    }
  }

  private fun awaitQueue(expectedIds: List<String>, currentId: String) {
    poll("legacy-selection-queue-timeout") {
      val queueIds = LoggeRythmPlayerRuntime.queueSources().map(PlayerItemSpec::id)
      val metadataId = requireNotNull(controller).metadata
        ?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)
      queueIds == expectedIds && metadataId == currentId
    }
  }

  private fun awaitErrorMessage(expected: String) {
    poll("car-error-message-timeout: $expected") { errorMessages.contains(expected) }
  }

  private fun poll(failure: String, condition: () -> Boolean) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEVICE_TIMEOUT_SECONDS)
    while (System.nanoTime() < deadline) {
      if (condition()) return
      Thread.sleep(POLL_INTERVAL_MS)
    }
    throw AssertionError(failure)
  }

  private fun bindPersistenceOnMain() {
    val completed = CountDownLatch(1)
    val outcome = AtomicReference<Result<Unit>>()
    instrumentation.runOnMainSync {
      LoggeRythmPersistedServiceBridge.bindSession(binding) { result ->
        outcome.set(result)
        completed.countDown()
      }
    }
    assertTrue(completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
    outcome.get().getOrThrow()
    assertTrue(LoggeRythmPersistedServiceBridge.isReady())
  }

  private fun installPolicyAndTreeOnMain(tree: BrowseTreeSpec = libraryTree()) {
    val completed = CountDownLatch(1)
    val outcome = AtomicReference<Result<Unit>>()
    instrumentation.runOnMainSync {
      LoggeRythmMediaSessionServiceBridge.installRemoteCommands(APP_CAPABILITIES) { policy ->
        policy.fold(
          onSuccess = {
            LoggeRythmPlayerRuntime.installBrowseTree(tree)
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

  private fun clearPersistedStateOnMain() {
    val completed = CountDownLatch(1)
    val outcome = AtomicReference<Result<LoggeRythmCacheClearResult>>()
    instrumentation.runOnMainSync {
      LoggeRythmPersistedServiceBridge.clearPersistedState { result ->
        outcome.set(result)
        completed.countDown()
      }
    }
    assertTrue(completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
    assertNotNull(outcome.get().getOrThrow())
    assertNull(LoggeRythmPlayerRuntime.currentSessionBinding())
  }

  private fun libraryTree(): BrowseTreeSpec {
    val liked = LIKED_TRACK_IDS.mapIndexed { index, id ->
      track(id, LIKED_TITLES[index], fixtureUrl("liked-$index.wav"))
    }
    val roadtrip = ROADTRIP_TRACK_IDS.mapIndexed { index, id ->
      track(id, "Highway ${index + 1}", fixtureUrl("roadtrip-$index.wav"))
    }
    return BrowseTreeSpec(
      container(
        LoggeRythmPlayerRuntime.BROWSE_ROOT_ID,
        "LoggeRythm",
        listOf(
          container(LIKED_ID, "Liked Songs", liked),
          container(
            PLAYLISTS_ID,
            "Playlists",
            listOf(container(ROADTRIP_ID, "Roadtrip", roadtrip)),
          ),
        ),
      ),
    )
  }

  private fun container(id: String, title: String, children: List<BrowseNodeSpec>) =
    BrowseNodeSpec(
      id = id,
      title = title,
      subtitle = null,
      artist = null,
      album = null,
      artworkUrl = null,
      durationMs = null,
      playable = false,
      url = null,
      cookie = null,
      children = children,
    )

  private fun track(id: String, title: String, url: String) = BrowseNodeSpec(
    id = id,
    title = title,
    subtitle = null,
    artist = "Instrumentation",
    album = "Legacy bridge",
    artworkUrl = null,
    durationMs = FIXTURE_DURATION_MS,
    playable = true,
    url = url,
    cookie = null,
    children = emptyList(),
    extrasJson = org.json.JSONObject().put("track", org.json.JSONObject()
      .put("id", id.substringAfterLast(':'))
      .put("title", title)
      .put("artist", "Instrumentation")
      .put("artists", org.json.JSONArray())
    ).put("radio", false).toString(),
  )

  /** A short silent PCM WAV in app-private storage, so prepare succeeds without network. */
  private fun fixtureUrl(name: String): String {
    val directory = fixtureDirectory().apply { mkdirs() }
    val file = File(directory, name)
    if (!file.exists()) file.writeBytes(silentWav())
    return file.canonicalFile.toURI().toASCIIString()
  }

  private fun fixtureDirectory() = File(context.filesDir, "legacy-browser-fixtures")

  private fun silentWav(): ByteArray {
    val sampleRate = 8_000
    val dataBytes = sampleRate * 2 * FIXTURE_DURATION_MS.toInt() / 1_000
    return ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray(Charsets.US_ASCII))
      putInt(36 + dataBytes)
      put("WAVE".toByteArray(Charsets.US_ASCII))
      put("fmt ".toByteArray(Charsets.US_ASCII))
      putInt(16)
      putShort(1) // PCM
      putShort(1) // mono
      putInt(sampleRate)
      putInt(sampleRate * 2)
      putShort(2)
      putShort(16)
      put("data".toByteArray(Charsets.US_ASCII))
      putInt(dataBytes)
    }.array()
  }

  private fun clearTestState() {
    check(LoggeRythmPlayerRuntime.currentSessionBinding() == null) { "previous-test-session-still-bound" }
    LoggeRythmEncryptedAndroidKeyStoreCipher().clearKey()
    LoggeRythmEncryptedAndroidBlobFile(context).clear()
  }

  private fun <T> onLooper(callable: Callable<T>): T {
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

  private companion object {
    const val SYNTHETIC_ORIGIN = "https://example.invalid"
    const val ATTACKER_URL = "https://attacker.invalid/not-a-library-track"
    /** `MediaBrowserServiceCompat.BROWSER_SERVICE_EXTRAS_KEY_SEARCH_SUPPORTED`. */
    const val SEARCH_SUPPORTED_ROOT_EXTRA = "android.media.browse.SEARCH_SUPPORTED"
    const val LIKED_ID = "library:liked"
    const val PLAYLISTS_ID = "library:playlists"
    const val ROADTRIP_ID = "playlist:roadtrip"
    const val FIXTURE_DURATION_MS = 20_000L
    const val DEVICE_TIMEOUT_SECONDS = 10L
    const val POLL_INTERVAL_MS = 50L
    val LIKED_TITLES = listOf("First", "Second", "Third", "Fourth", "Fifth")
    val LIKED_TRACK_IDS = LIKED_TITLES.indices.map { "liked:$it:track-$it" }
    val ROADTRIP_TRACK_IDS = (0 until 3).map { "playlist:roadtrip:$it:road-$it" }
    val APP_CAPABILITIES = setOf(
      RemotePlayerCapability.PLAY_PAUSE,
      RemotePlayerCapability.STOP,
      RemotePlayerCapability.NEXT,
      RemotePlayerCapability.PREVIOUS,
      RemotePlayerCapability.SEEK,
    )
  }
}
