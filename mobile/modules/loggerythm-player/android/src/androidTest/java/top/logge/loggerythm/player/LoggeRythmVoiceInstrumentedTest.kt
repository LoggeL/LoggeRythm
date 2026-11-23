package top.logge.loggerythm.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.provider.MediaStore
import androidx.media3.common.Player
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.session.legacy.MediaBrowserCompat as MediaBrowser
import androidx.media3.session.legacy.MediaControllerCompat
import androidx.media3.session.legacy.MediaSessionCompat
import androidx.media3.session.legacy.PlaybackStateCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
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
 * End-to-end device test for Track A:
 * 1. Android Auto / legacy MediaBrowser live catalog `onSearch` + `onGetSearchResult` merging
 *    local + live catalog hits, deduplicating by Deezer track ID, and tapping a live result.
 * 2. Structured `MediaStore` voice `playFromSearch` / `prepareFromSearch` (local-first, live
 *    catalog fallback, fail-loud `401` -> `SIGNED_OUT`, `500` -> `SEARCH_NETWORK_ERROR`, `[]` ->
 *    `SEARCH_NO_MATCH`).
 * 3. Shared [LoggeRythmVoiceBridge] (`playMusic`, `getNowPlaying`, `controlPlayback`, gapless
 *    `queueMusic` NEXT & END verified against live `ExoPlayer` via [LoggeRythmExoPlayerObservationHook],
 *    durable `setCurrentTrackFavorite`, and cold-start after `stopService`).
 */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
@RunWith(AndroidJUnit4::class)
class LoggeRythmVoiceInstrumentedTest {
  private lateinit var instrumentation: android.app.Instrumentation
  private lateinit var context: Context
  private lateinit var serviceIntent: Intent
  private lateinit var thread: HandlerThread
  private lateinit var handler: Handler
  private var activity: android.app.Activity? = null
  private var browser: MediaBrowser? = null
  private var controller: MediaController? = null
  private var compatController: MediaControllerCompat? = null
  private val errorMessages = CopyOnWriteArrayList<String>()
  private val recordedApiPaths = CopyOnWriteArrayList<String>()
  private val catalogMode = AtomicReference(CatalogMode.OK)

  private enum class CatalogMode {
    OK,
    EMPTY,
    UNAUTHORIZED,
    SERVER_ERROR,
  }

  private val controllerCallback = object : MediaController.Callback() {
    override fun onPlaybackStateChanged(state: PlaybackState?) {
      state?.errorMessage?.toString()?.let(errorMessages::add)
    }
  }
  private val compatCallback = object : MediaControllerCompat.Callback() {
    override fun onPlaybackStateChanged(state: PlaybackStateCompat?) {
      state?.errorMessage?.toString()?.let(errorMessages::add)
    }
  }

  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:900099",
    origin = VOICE_ORIGIN,
  )

  @Before
  fun setUp() {
    instrumentation = InstrumentationRegistry.getInstrumentation()
    context = instrumentation.targetContext.applicationContext
    serviceIntent = Intent(context, LoggeRythmMediaLibraryService::class.java)
    context.stopService(serviceIntent)
    LoggeRythmVoiceCatalogClientHook.setForTests(null)
    clearTestState()
    recordedApiPaths.clear()
    errorMessages.clear()
    catalogMode.set(CatalogMode.OK)
    thread = HandlerThread("VoiceInstrumentedTest").apply { start() }
    handler = Handler(thread.looper)
    activity = instrumentation.startActivitySync(
      Intent(context, LoggeRythmPlayerTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    LoggeRythmVoiceCatalogClientHook.setForTests(buildStubCatalogClient())
  }

  @After
  fun tearDown() {
    LoggeRythmVoiceCatalogClientHook.setForTests(null)
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
  fun androidAutoLiveSearchStructuredVoiceAndFailLoudErrorsWorkEndToEnd() {
    val connected = connectPlatformBrowser()
    bindPersistenceOnMain()
    installPolicyAndTreeOnMain(voiceLibraryTree())
    val platformController = connectController(connected)

    // 1. Live onSearch + onGetSearchResult merges local + live catalog and deduplicates track "100".
    val mergedResults = requireNotNull(search("Daft"))
    val resultTitles = mergedResults.mapNotNull { it.description.title?.toString() }
    assertTrue("Expected local track in merged results: $resultTitles", resultTitles.contains("Local Daft Anthem"))
    assertTrue("Expected live-only track in merged results: $resultTitles", resultTitles.contains("Digital Love"))
    // Local track ID "100" also returned by live search must NOT appear twice.
    assertEquals(1, mergedResults.count { it.description.title?.toString()?.contains("Local Daft Anthem") == true })
    val liveResult = mergedResults.first { it.description.title?.toString() == "Digital Love" }
    assertTrue(liveResult.isPlayable)
    assertNull(liveResult.description.mediaUri)
    assertTrue(recordedApiPaths.any { it.startsWith("/api/search?q=Daft&type=track") })

    // Selecting the cached live catalog result via playFromMediaId installs its vaulted spec.
    platformController.transportControls.prepareFromMediaId(liveResult.mediaId, null)
    poll("live-search-item-not-installed") {
      val sources = LoggeRythmPlayerRuntime.queueSources()
      sources.any { it.id == liveResult.mediaId && it.url == "$VOICE_ORIGIN/api/tracks/9001/stream" && it.cookie == VOICE_COOKIE }
    }
    val selectedSource = LoggeRythmPlayerRuntime.queueSources().first { it.id == liveResult.mediaId }
    assertTrue(LoggeRythmCarLibraryState.hasPhoneTrackMetadata(selectedSource.extrasJson))
    awaitJournalIdle()

    // 2. Structured MediaStore PLAYLIST focus resolves locally without hitting the network.
    recordedApiPaths.clear()
    @Suppress("DEPRECATION")
    val playlistExtras = Bundle().apply {
      putString(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Playlists.ENTRY_CONTENT_TYPE)
      putString(MediaStore.EXTRA_MEDIA_PLAYLIST, "Roadtrip")
    }
    platformController.transportControls.playFromSearch("Roadtrip", playlistExtras)
    awaitQueue(ROADTRIP_TRACK_IDS, currentId = ROADTRIP_TRACK_IDS[0])
    awaitState(PlaybackState.STATE_PLAYING)
    assertTrue("Local playlist match should not hit live catalog", recordedApiPaths.isEmpty())
    awaitJournalIdle()

    // 3. Structured MediaStore ALBUM + TITLE focus misses locally and resolves live catalog album.
    //    (Note: platform MediaController.prepareFromSearch drops empty query strings, whereas
    //    playFromSearch forwards empty query + structured extras; test structured extras via playFromSearch.)
    val albumExtras = Bundle().apply {
      putString(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Albums.ENTRY_CONTENT_TYPE)
      putString(MediaStore.EXTRA_MEDIA_ALBUM, "Discovery")
      putString(MediaStore.EXTRA_MEDIA_ARTIST, "Daft Punk")
      putString(MediaStore.EXTRA_MEDIA_TITLE, "Digital Love")
    }
    platformController.transportControls.playFromSearch("", albumExtras)
    poll({
      "live-album-not-queued-at-digital-love: sources=${LoggeRythmPlayerRuntime.queueSources().map { it.url }} " +
        "title=${platformController.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)} " +
        "paths=$recordedApiPaths errors=$errorMessages"
    }) {
      val sources = LoggeRythmPlayerRuntime.queueSources()
      val currentTitle = platformController.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)
      sources.size == 2 &&
        sources[0].url == "$VOICE_ORIGIN/api/tracks/9000/stream" &&
        sources[1].url == "$VOICE_ORIGIN/api/tracks/9001/stream" &&
        currentTitle == "Digital Love"
    }
    assertTrue(recordedApiPaths.any { it.startsWith("/api/search?q=Discovery+Daft+Punk&type=album") })
    assertTrue(recordedApiPaths.contains("/api/albums/302127"))
    awaitJournalIdle()

    // 4. Fail-loud car errors: 500 -> SEARCH_NETWORK_ERROR, 401 -> SIGNED_OUT, [] -> SEARCH_NO_MATCH.
    errorMessages.clear()
    catalogMode.set(CatalogMode.SERVER_ERROR)
    platformController.transportControls.prepareFromSearch("unknown network query", null)
    awaitErrorMessage(context.getString(R.string.loggerythm_player_car_error_search_network_error))

    errorMessages.clear()
    catalogMode.set(CatalogMode.UNAUTHORIZED)
    platformController.transportControls.prepareFromSearch("unknown auth query", null)
    awaitErrorMessage(context.getString(R.string.loggerythm_player_car_error_signed_out))

    // Expired auth must ALSO fail loud on browse search even when a local match exists.
    assertNull(search("Daft"))

    errorMessages.clear()
    catalogMode.set(CatalogMode.EMPTY)
    val missingQuery = "no track matches this"
    platformController.transportControls.prepareFromSearch(missingQuery, null)
    awaitErrorMessage(context.getString(R.string.loggerythm_player_car_error_search_no_match, missingQuery))
  }

  @Test
  fun voiceBridgeControlsPlaybackQueuesGaplesslyTogglesFavoritesAndColdRestores() {
    val connected = connectPlatformBrowser()
    bindPersistenceOnMain()
    installPolicyAndTreeOnMain(voiceLibraryTree())
    syncLikedTrackIdsOnMain(setOf("2001"))
    connectController(connected)

    // 1. playMusic against local playlist starts real audio playback.
    val playResult = LoggeRythmVoiceBridge.playMusic(
      context = context,
      query = "Roadtrip",
      mediaFocus = LoggeRythmVoiceMediaFocus.PLAYLIST,
      playlist = "Roadtrip",
    ).get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertEquals("library", playResult.source)
    assertEquals(2, playResult.queuedCount)
    assertEquals("Highway 1", playResult.matchedTitle)
    awaitState(PlaybackState.STATE_PLAYING)
    poll("position-did-not-advance-after-voice-play") {
      LoggeRythmVoiceBridge.getNowPlaying(context)
        .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS).positionMs > 100L
    }

    val initialNowPlaying = LoggeRythmVoiceBridge.getNowPlaying(context)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertTrue(initialNowPlaying.hasActiveTrack)
    assertEquals("Highway 1", initialNowPlaying.track?.title)
    assertEquals("2000", initialNowPlaying.track?.trackId)
    assertEquals(false, initialNowPlaying.liked)
    assertEquals(2, initialNowPlaying.queueSize)
    assertEquals(0, initialNowPlaying.currentIndex)

    // 2. Gapless queueMusic (NEXT from live catalog + END from local library) while playing:
    //    active track 0 MUST keep playing without re-preparing (zero IDLE/BUFFERING/transition).
    val bufferingOrIdleCount = AtomicInteger(0)
    val transitionCount = AtomicInteger(0)
    val playerListener = object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_BUFFERING || playbackState == Player.STATE_IDLE) {
          bufferingOrIdleCount.incrementAndGet()
        }
      }

      override fun onMediaItemTransition(mediaItem: androidx.media3.common.MediaItem?, reason: Int) {
        transitionCount.incrementAndGet()
      }
    }
    val analyticsListener = object : AnalyticsListener {}
    instrumentation.runOnMainSync {
      assertTrue(LoggeRythmExoPlayerObservationHook.addListeners(playerListener, analyticsListener))
    }
    try {
      val queuedNext = LoggeRythmVoiceBridge.queueMusic(
        context = context,
        query = "Digital Love",
        position = LoggeRythmVoiceQueuePosition.NEXT,
        mediaFocus = LoggeRythmVoiceMediaFocus.TRACK,
        title = "Digital Love",
        artist = "Daft Punk",
      ).get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      assertEquals("catalog", queuedNext.source)
      assertEquals(LoggeRythmVoiceQueuePosition.NEXT, queuedNext.position)
      assertEquals(1, queuedNext.addedCount)
      assertEquals("Digital Love", queuedNext.firstAdded.title)
      assertEquals(3, queuedNext.nowPlaying.queueSize)
      assertEquals(0, queuedNext.nowPlaying.currentIndex)

      val queuedEnd = LoggeRythmVoiceBridge.queueMusic(
        context = context,
        query = "Highway 2",
        position = LoggeRythmVoiceQueuePosition.END,
        mediaFocus = LoggeRythmVoiceMediaFocus.TRACK,
        title = "Highway 2",
      ).get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      assertEquals("library", queuedEnd.source)
      assertEquals(LoggeRythmVoiceQueuePosition.END, queuedEnd.position)
      assertEquals(1, queuedEnd.addedCount)
      assertEquals(4, queuedEnd.nowPlaying.queueSize)

      // Confirm zero re-prepare or track interruption on ExoPlayer.
      poll("gapless-queue-not-captured") { LoggeRythmPlayerRuntime.queueSources().size == 4 }
      Thread.sleep(250L)
      assertEquals(0, bufferingOrIdleCount.get())
      assertEquals(0, transitionCount.get())
      val queueTitles = LoggeRythmPlayerRuntime.queueSources().map { it.title }
      assertEquals(listOf("Highway 1", "Digital Love", "Highway 2", "Highway 2"), queueTitles)
      assertEquals(VOICE_COOKIE, LoggeRythmPlayerRuntime.queueSources()[1].cookie)
    } finally {
      instrumentation.runOnMainSync {
        LoggeRythmExoPlayerObservationHook.removeListeners(playerListener, analyticsListener)
      }
    }

    // Blank queueMusic fails loudly with INVALID_ARGUMENT.
    val invalidQueueErr = assertVoiceFailure {
      LoggeRythmVoiceBridge.queueMusic(context = context, query = "   ")
        .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    }
    assertEquals(LoggeRythmVoiceErrorCode.INVALID_ARGUMENT, invalidQueueErr.code)

    // 3. controlPlayback: PAUSE, PLAY, STOP, blank playMusic resume, NEXT, PREVIOUS.
    val paused = LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.PAUSE)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertFalse(paused.playWhenReady)
    awaitState(PlaybackState.STATE_PAUSED)

    val resumed = LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.PLAY)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertTrue(resumed.playWhenReady)
    awaitState(PlaybackState.STATE_PLAYING)

    val stopped = LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.STOP)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertEquals(LoggeRythmVoicePlaybackState.IDLE, stopped.playbackState)

    val blankResumed = LoggeRythmVoiceBridge.playMusic(context = context, query = null)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertEquals("resume", blankResumed.source)
    assertTrue(blankResumed.nowPlaying.playWhenReady)
    awaitState(PlaybackState.STATE_PLAYING)

    // 4. setCurrentTrackFavorite: Like -> idempotent Like -> Unlike, backed by durable journal.
    val liked = LoggeRythmVoiceBridge.setCurrentTrackFavorite(context, liked = true)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertTrue(liked.liked)
    assertTrue(liked.changed)
    assertEquals("2000", liked.track.trackId)
    val likeClaim = claimFavoriteEventOnMain(expectedTrackId = "2000", expectedLiked = true)
    completeFavoriteEventOnMain(likeClaim.first, likeClaim.second)

    val idempotentLike = LoggeRythmVoiceBridge.setCurrentTrackFavorite(context, liked = true)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertTrue(idempotentLike.liked)
    assertFalse(idempotentLike.changed)

    // Move to last track and verify NEXT at end of queue fails loudly with QUEUE_UNAVAILABLE.
    LoggeRythmVoiceBridge.playMusic(
      context = context,
      query = "Roadtrip",
      mediaFocus = LoggeRythmVoiceMediaFocus.PLAYLIST,
      playlist = "Roadtrip",
    ).get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    val nextTrack = LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.NEXT)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertEquals(1, nextTrack.currentIndex)
    assertEquals("Highway 2", nextTrack.track?.title)
    val noNextErr = assertVoiceFailure {
      LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.NEXT)
        .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    }
    assertEquals(LoggeRythmVoiceErrorCode.QUEUE_UNAVAILABLE, noNextErr.code)

    val prevTrack = LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.PREVIOUS)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertEquals(0, prevTrack.currentIndex)
    assertEquals("Highway 1", prevTrack.track?.title)

    // 5. Cold-start LoggeRythmVoiceBridge.getNowPlaying after stopping the service completely!
    //    Pause first so Media3 releases its active playback foreground hold and let any in-flight
    //    journal commit finish fsyncing before stopService (otherwise coordinator's crash-safety
    //    close() intentionally wipes an uncommitted candidate).
    LoggeRythmVoiceBridge.controlPlayback(context, LoggeRythmVoicePlaybackAction.PAUSE)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    awaitState(PlaybackState.STATE_PAUSED)
    awaitJournalIdle()
    controller?.unregisterCallback(controllerCallback)
    compatController?.unregisterCallback(compatCallback)
    onLooper { requireNotNull(browser).disconnect() }
    browser = null
    controller = null
    compatController = null
    context.stopService(serviceIntent)
    poll("service-not-stopped-for-voice-bridge-cold-start") {
      LoggeRythmVoiceServiceBridge.current() == null &&
        LoggeRythmPlayerRuntime.currentSessionBinding() == null
    }

    val coldRestored = LoggeRythmVoiceBridge.getNowPlaying(context)
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    assertTrue(coldRestored.hasActiveTrack)
    assertEquals("Highway 1", coldRestored.track?.title)
    assertEquals("2000", coldRestored.track?.trackId)
    assertEquals(true, coldRestored.liked)
    assertEquals(2, coldRestored.queueSize)
    assertEquals(0, coldRestored.currentIndex)
    // Confirm the temporary cold-start service binding unbinds and destroys cleanly afterwards.
    poll("cold-bound-service-did-not-unbind") {
      LoggeRythmVoiceServiceBridge.current() == null &&
        !LoggeRythmPersistedServiceBridge.isReady()
    }
  }

  private fun buildStubCatalogClient(): LoggeRythmVoiceCatalogClient {
    val interceptor = Interceptor { chain ->
      val req = chain.request()
      val pathWithQuery = req.url.encodedPath + (req.url.encodedQuery?.let { "?$it" }.orEmpty())
      recordedApiPaths += pathWithQuery
      val cookie = req.header("Cookie")
      if (cookie != VOICE_COOKIE) {
        return@Interceptor jsonResponse(req, 401, """{"detail":"missing-cookie"}""")
      }
      when (catalogMode.get()) {
        CatalogMode.UNAUTHORIZED -> return@Interceptor jsonResponse(req, 401, """{"detail":"expired"}""")
        CatalogMode.SERVER_ERROR -> return@Interceptor jsonResponse(req, 500, """{"detail":"boom"}""")
        CatalogMode.EMPTY -> return@Interceptor jsonResponse(req, 200, "[]")
        CatalogMode.OK -> Unit
      }
      when {
        pathWithQuery.startsWith("/api/search?") && pathWithQuery.contains("type=track") -> {
          val tracks = JSONArray()
            .put(catalogTrackJson("100", "Local Daft Anthem", "Daft Punk", "Discovery"))
            .put(catalogTrackJson("9001", "Digital Love", "Daft Punk", "Discovery"))
          jsonResponse(req, 200, tracks.toString())
        }
        pathWithQuery.startsWith("/api/search?") && pathWithQuery.contains("type=album") -> {
          val albums = JSONArray()
            .put(catalogTrackJson("302127", "Discovery", "Daft Punk", "Discovery", albumId = "302127"))
          jsonResponse(req, 200, albums.toString())
        }
        pathWithQuery == "/api/albums/302127" -> {
          val detail = JSONObject()
            .put("id", "302127")
            .put("title", "Discovery")
            .put(
              "tracks",
              JSONArray()
                .put(catalogTrackJson("9000", "One More Time", "Daft Punk", "Discovery", albumId = "302127"))
                .put(catalogTrackJson("9001", "Digital Love", "Daft Punk", "Discovery", albumId = "302127")),
            )
          jsonResponse(req, 200, detail.toString())
        }
        else -> jsonResponse(req, 200, "[]")
      }
    }
    val client = failClosedMediaHttpClient { addInterceptor(interceptor) }
    return LoggeRythmVoiceCatalogClient(client)
  }

  private fun jsonResponse(request: okhttp3.Request, code: Int, body: String): Response =
    Response.Builder()
      .request(request)
      .protocol(Protocol.HTTP_1_1)
      .code(code)
      .message("Test")
      .body(body.toResponseBody("application/json; charset=utf-8".toMediaType()))
      .build()

  private fun catalogTrackJson(
    id: String,
    title: String,
    artist: String,
    album: String,
    albumId: String = "302127",
  ): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title)
    put("artist", artist)
    put("artist_id", 27)
    put("artists", JSONArray().put(JSONObject().put("id", 27).put("name", artist)))
    put("album", album)
    put("album_id", albumId)
    put("cover", "$VOICE_ORIGIN/api/cover/$id.jpg")
    put("duration_sec", 240.0)
    put("preview_url", JSONObject.NULL)
    put("rank", 900000)
    put("release_date", "2001-03-12")
  }

  private fun assertVoiceFailure(block: () -> Unit): LoggeRythmVoiceException {
    try {
      block()
    } catch (error: ExecutionException) {
      val cause = error.cause
      if (cause is LoggeRythmVoiceException) return cause
      throw AssertionError("Expected LoggeRythmVoiceException cause, got $cause", error)
    } catch (error: LoggeRythmVoiceException) {
      return error
    }
    throw AssertionError("Expected LoggeRythmVoiceException but call succeeded")
  }

  private data class ConnectedPlatformBrowser(
    val root: String,
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
    assertTrue(completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
    assertEquals("connected", outcome.get())
    val active = requireNotNull(browser)
    return onLooper {
      ConnectedPlatformBrowser(
        active.root,
        active.sessionToken.token as android.media.session.MediaSession.Token,
        active.sessionToken,
      )
    }
  }

  private fun connectController(connected: ConnectedPlatformBrowser): MediaController {
    val created = MediaController(context, connected.token)
    created.registerCallback(controllerCallback, handler)
    controller = created
    compatController = onLooper {
      MediaControllerCompat(context, connected.compatToken).also {
        it.registerCallback(compatCallback, handler)
      }
    }
    poll("compat-session-not-ready") { compatController?.isSessionReady == true }
    return created
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
    assertTrue("No search result for $query", completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
    return if (failed.get()) null else results.get()
  }

  private fun awaitState(expected: Int) {
    poll("playback-state-timeout: expected=$expected actual=${controller?.playbackState}") {
      controller?.playbackState?.state == expected
    }
  }

  private fun awaitQueue(expectedIds: List<String>, currentId: String) {
    poll({
      val actualIds = LoggeRythmPlayerRuntime.queueSources().map(PlayerItemSpec::id)
      val actualMeta = controller?.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)
      val actualState = controller?.playbackState
      "queue-timeout: expected=$expectedIds current=$currentId actualIds=$actualIds " +
        "actualMeta=$actualMeta state=$actualState paths=$recordedApiPaths errors=$errorMessages"
    }) {
      val queueIds = LoggeRythmPlayerRuntime.queueSources().map(PlayerItemSpec::id)
      val metadataId = requireNotNull(controller).metadata
        ?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)
      queueIds == expectedIds && metadataId == currentId
    }
  }

  private fun awaitErrorMessage(expected: String) {
    poll("car-error-message-timeout: expected=$expected seen=$errorMessages") {
      errorMessages.contains(expected)
    }
  }

  private fun awaitJournalIdle() {
    // Joining the serial playback-journal queue via claimPlaybackEvents waits strictly behind any
    // in-flight prearm + encrypted fsync, and acking non-FAVORITE events prevents background
    // LoggeRythmPlaybackJournalWorker wakes from holding the service bound during cold-start tests.
    while (true) {
      val claimCompleted = CountDownLatch(1)
      val claimResult = AtomicReference<Result<String>>()
      instrumentation.runOnMainSync {
        LoggeRythmPersistedServiceBridge.claimPlaybackEvents(8, 60_000L) { result ->
          claimResult.set(result)
          claimCompleted.countDown()
        }
      }
      assertTrue("journal-claim-timeout", claimCompleted.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
      val claim = JSONObject(claimResult.get().getOrThrow())
      val leaseId = claim.getString("leaseId")
      val events = claim.getJSONArray("events")
      var ackedAny = false
      for (index in 0 until events.length()) {
        val event = events.getJSONObject(index)
        if (event.getString("type") == "FAVORITE") continue
        val ackDone = CountDownLatch(1)
        val ackOutcome = AtomicReference<Result<Unit>>()
        val eventId = event.getString("eventId")
        instrumentation.runOnMainSync {
          LoggeRythmPersistedServiceBridge.ackPlaybackEvent(leaseId, eventId) { result ->
            ackOutcome.set(result)
            ackDone.countDown()
          }
        }
        assertTrue("journal-ack-timeout", ackDone.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
        ackOutcome.get().getOrThrow()
        ackedAny = true
      }
      if (!ackedAny) break
    }
    poll("journal-commit-did-not-finish") {
      !LoggeRythmPersistedServiceBridge.isQueueMutationBlocked()
    }
  }

  private fun poll(failure: String, condition: () -> Boolean) = poll({ failure }, condition)

  private fun poll(failure: () -> String, condition: () -> Boolean) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEVICE_TIMEOUT_SECONDS)
    while (System.nanoTime() < deadline) {
      if (condition()) return
      Thread.sleep(POLL_INTERVAL_MS)
    }
    throw AssertionError(failure())
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
  }

  private fun installPolicyAndTreeOnMain(tree: BrowseTreeSpec) {
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

  private fun syncLikedTrackIdsOnMain(trackIds: Set<String>?) {
    val completed = CountDownLatch(1)
    val outcome = AtomicReference<Result<Unit>>()
    instrumentation.runOnMainSync {
      LoggeRythmPersistedServiceBridge.syncLikedTrackIds(trackIds) { result ->
        outcome.set(result)
        completed.countDown()
      }
    }
    assertTrue(completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
    outcome.get().getOrThrow()
  }

  private fun claimFavoriteEventOnMain(
    expectedTrackId: String,
    expectedLiked: Boolean,
  ): Pair<String, String> {
    val found = AtomicReference<Pair<String, String>>()
    poll("favorite-event-not-claimed: track=$expectedTrackId liked=$expectedLiked") {
      val completed = CountDownLatch(1)
      val raw = AtomicReference<Result<String>>()
      instrumentation.runOnMainSync {
        LoggeRythmPersistedServiceBridge.claimPlaybackEvents(8, 60_000L) { result ->
          raw.set(result)
          completed.countDown()
        }
      }
      if (!completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) return@poll false
      val claim = JSONObject(raw.get().getOrThrow())
      val leaseId = claim.getString("leaseId")
      val events = claim.getJSONArray("events")
      for (index in 0 until events.length()) {
        val event = events.getJSONObject(index)
        if (event.getString("type") == "FAVORITE") {
          val trackId = event.getJSONObject("track").getString("id")
          if (trackId == expectedTrackId && event.getBoolean("requestedLiked") == expectedLiked) {
            found.set(leaseId to event.getString("eventId"))
            return@poll true
          }
        }
      }
      false
    }
    return requireNotNull(found.get())
  }

  private fun completeFavoriteEventOnMain(leaseId: String, eventId: String) {
    val completed = CountDownLatch(1)
    val outcome = AtomicReference<Result<Unit>>()
    instrumentation.runOnMainSync {
      LoggeRythmPersistedServiceBridge.completeFavoritePlaybackEvent(leaseId, eventId) { result ->
        outcome.set(result)
        completed.countDown()
      }
    }
    assertTrue(completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
    outcome.get().getOrThrow()
  }

  private fun voiceLibraryTree(): BrowseTreeSpec {
    // One authenticated HTTPS track establishes the vaulted session cookie for live catalog search;
    // local file:// WAV tracks support real ExoPlayer decoding without real network access.
    val liked = listOf(
      track(
        id = "liked:100",
        trackId = "100",
        title = "Local Daft Anthem",
        artist = "Daft Punk",
        album = "Homework",
        url = "$VOICE_ORIGIN/api/tracks/100/stream",
        cookie = VOICE_COOKIE,
      ),
    )
    val roadtrip = listOf(
      track(
        id = ROADTRIP_TRACK_IDS[0],
        trackId = "2000",
        title = "Highway 1",
        artist = "Road Band",
        album = "Miles",
        url = fixtureUrl("voice-roadtrip-0.wav"),
        cookie = null,
      ),
      track(
        id = ROADTRIP_TRACK_IDS[1],
        trackId = "2001",
        title = "Highway 2",
        artist = "Road Band",
        album = "Miles",
        url = fixtureUrl("voice-roadtrip-1.wav"),
        cookie = null,
      ),
    )
    return BrowseTreeSpec(
      container(
        LoggeRythmPlayerRuntime.BROWSE_ROOT_ID,
        "LoggeRythm",
        listOf(
          container("library:liked", "Liked Songs", liked),
          container("library:playlists", "Playlists", listOf(container("playlist:roadtrip", "Roadtrip", roadtrip))),
        ),
      ),
    )
  }

  private fun container(id: String, title: String, children: List<BrowseNodeSpec>) = BrowseNodeSpec(
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

  private fun track(
    id: String,
    trackId: String,
    title: String,
    artist: String,
    album: String,
    url: String,
    cookie: String?,
  ) = BrowseNodeSpec(
    id = id,
    title = title,
    subtitle = null,
    artist = artist,
    album = album,
    artworkUrl = null,
    durationMs = FIXTURE_DURATION_MS,
    playable = true,
    url = url,
    cookie = cookie,
    children = emptyList(),
    extrasJson = JSONObject()
      .put(
        "track",
        JSONObject()
          .put("id", trackId)
          .put("title", title)
          .put("artist", artist)
          .put("artists", JSONArray().put(JSONObject().put("id", 1).put("name", artist))),
      )
      .put("radio", false)
      .toString(),
  )

  private fun fixtureUrl(name: String): String {
    val directory = fixtureDirectory().apply { mkdirs() }
    val file = File(directory, name)
    if (!file.exists()) file.writeBytes(silentWav())
    return file.canonicalFile.toURI().toASCIIString()
  }

  private fun fixtureDirectory() = File(context.filesDir, "voice-instrumented-fixtures")

  private fun silentWav(): ByteArray {
    val sampleRate = 8_000
    val dataBytes = sampleRate * 2 * FIXTURE_DURATION_MS.toInt() / 1_000
    return ByteBuffer.allocate(44 + dataBytes).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray(Charsets.US_ASCII))
      putInt(36 + dataBytes)
      put("WAVE".toByteArray(Charsets.US_ASCII))
      put("fmt ".toByteArray(Charsets.US_ASCII))
      putInt(16)
      putShort(1)
      putShort(1)
      putInt(sampleRate)
      putInt(sampleRate * 2)
      putShort(2)
      putShort(16)
      put("data".toByteArray(Charsets.US_ASCII))
      putInt(dataBytes)
    }.array()
  }

  private fun <T> onLooper(block: () -> T): T {
    val completed = CountDownLatch(1)
    val result = AtomicReference<Result<T>>()
    handler.post {
      result.set(runCatching(block))
      completed.countDown()
    }
    if (!completed.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
      throw TimeoutException("voice-test-looper-timeout")
    }
    return result.get().getOrThrow()
  }

  private fun clearTestState() {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    LoggeRythmEncryptedAndroidKeyStoreCipher().clearKey()
    LoggeRythmEncryptedAndroidBlobFile(context).clear()
    File(context.noBackupFilesDir, "loggerythm_player_media_cache").deleteRecursively()
  }

  private companion object {
    const val VOICE_ORIGIN = "https://voice.example.test"
    const val VOICE_COOKIE = "sf_session=test-voice-cookie"
    const val DEVICE_TIMEOUT_SECONDS = 25L
    const val POLL_INTERVAL_MS = 50L
    const val FIXTURE_DURATION_MS = 20_000L
    val ROADTRIP_TRACK_IDS = listOf("playlist:roadtrip:2000", "playlist:roadtrip:2001")
    val APP_CAPABILITIES = setOf(
      RemotePlayerCapability.PLAY_PAUSE,
      RemotePlayerCapability.STOP,
      RemotePlayerCapability.NEXT,
      RemotePlayerCapability.PREVIOUS,
      RemotePlayerCapability.SEEK,
    )
  }
}
