package top.logge.loggerythm.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Parcel
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaBrowser
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionToken
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.common.util.concurrent.ListenableFuture
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** On-device proof that an unrelated APK cannot cross the Media3 account/session boundary. */
@RunWith(AndroidJUnit4::class)
class LoggeRythmHostileControllerInstrumentedTest {
  @Test
  fun separateUidUntrustedControllerGetsNoSessionDataCommandsOrMutation() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context = instrumentation.targetContext.applicationContext
    val targetService = ComponentName(context, LoggeRythmMediaLibraryService::class.java)
    val helperService = ComponentName(HELPER_PACKAGE, HELPER_SERVICE_CLASS)
    val helperApplication = context.packageManager.getApplicationInfo(HELPER_PACKAGE, 0)
    val targetApplication = context.packageManager.getApplicationInfo(context.packageName, 0)

    assertNotEquals(context.packageName, HELPER_PACKAGE)
    assertNotEquals(targetApplication.uid, helperApplication.uid)

    clearTestState(context)
    var controllerThread: HandlerThread? = null
    var controllerHandler: Handler? = null
    var controllerFuture: ListenableFuture<MediaBrowser>? = null
    var trustedController: MediaBrowser? = null
    var helperConnection: ProbeServiceConnection? = null
    var helperBound = false
    var armedPlatformProbeNonce: String? = null
    try {
      val binding = LoggeRythmPersistedSessionBinding(
        accountScope = "user:900001",
        origin = SYNTHETIC_ORIGIN,
      )
      assertTrue(LoggeRythmPlayerRuntime.bindSession(binding))

      val activeControllerThread = HandlerThread("TrustedInstrumentationController").apply { start() }
      controllerThread = activeControllerThread
      val activeControllerHandler = Handler(activeControllerThread.looper)
      controllerHandler = activeControllerHandler
      val activeControllerFuture = MediaBrowser.Builder(
        context,
        SessionToken(context, targetService),
      )
        .setApplicationLooper(activeControllerThread.looper)
        .buildAsync()
      controllerFuture = activeControllerFuture
      val activeTrustedController = activeControllerFuture.get(
        DEVICE_TIMEOUT_SECONDS,
        TimeUnit.SECONDS,
      )
      trustedController = activeTrustedController

      bindPersistenceOnMain(instrumentation, binding)
      // The persistence boundary deliberately clears any pre-bind public tree. Publish the
      // synthetic account marker only after the trusted session binding is fully ready.
      LoggeRythmPlayerRuntime.installBrowseTree(privateBrowseTree())
      val privateQueue = LoggeRythmPlayerRuntime.installQueue(
        listOf(
          PlayerItemSpec(
            id = PRIVATE_QUEUE_ID,
            url = "$SYNTHETIC_ORIGIN/private-queue-item.mp3",
            title = "Synthetic private queue item",
            artist = "Instrumentation",
            album = "Boundary fixture",
            artworkUrl = null,
            durationMs = null,
            cookie = null,
            extrasJson = "{}",
          ),
        ),
      )
      onLooper(activeControllerHandler) {
        activeTrustedController.setMediaItems(privateQueue, 0, PRIVATE_POSITION_MS)
        activeTrustedController.repeatMode = Player.REPEAT_MODE_ONE
      }
      awaitControllerState(activeControllerHandler, activeTrustedController)
      val before = onLooper(activeControllerHandler) {
        activeTrustedController.securitySnapshot()
      }
      val media3Before = trustedMedia3PositiveControlSnapshot(
        activeControllerHandler,
        activeTrustedController,
      )
      assertLiveMedia3PositiveControl("before hostile probe", media3Before)

      val activeHelperConnection = ProbeServiceConnection()
      helperConnection = activeHelperConnection
      val bound = context.bindService(
        Intent(HELPER_ACTION).setComponent(helperService),
        activeHelperConnection,
        Context.BIND_AUTO_CREATE,
      )
      helperBound = bound
      assertTrue("The separate hostile-controller APK must be installed", bound)
      val helperBinder = activeHelperConnection.awaitBinder()
      val platformProbeNonce = UUID.randomUUID().toString()
      LoggeRythmPlatformProbeObservationHook.arm(platformProbeNonce)
      armedPlatformProbeNonce = platformProbeNonce
      val probe = runHostileProbe(
        helperBinder,
        targetPackage = context.packageName,
        targetService = targetService.className,
        platformProbeNonce = platformProbeNonce,
      )
      val platformObservation = requireNotNull(
        LoggeRythmPlatformProbeObservationHook.drain(platformProbeNonce),
      )
      armedPlatformProbeNonce = null
      val media3After = trustedMedia3PositiveControlSnapshot(
        activeControllerHandler,
        activeTrustedController,
      )
      assertLiveMedia3PositiveControl("after hostile probe", media3After)

      assertEquals(EXPECTED_PROBE_KEYS, probe.keySet())
      assertEquals(PROBE_SCHEMA_VERSION, probe.getInt("probeSchemaVersion"))
      assertTrue(probe.getBoolean("probeCompleted"))
      assertTrue(probe.getBoolean("probeThreadTerminated"))
      assertEquals(HELPER_PACKAGE, probe.getString("probePackage"))
      assertEquals(helperApplication.uid, probe.getInt("probeUid"))
      assertEquals(targetApplication.uid, probe.getInt("targetUid"))
      assertTrue(probe.getBoolean("probeOwnBinderIdentity"))
      assertEquals(platformProbeNonce, probe.getString("platformProbeRequestId"))
      assertTrue(probe.getBoolean("targetServiceResolved"))
      // The Binder policy itself must reject the client. A manifest permission denial would be a
      // different boundary and could otherwise masquerade as the same SecurityException.
      assertTrue(probe.getBoolean("targetServicePermissionEmpty"))
      assertTrue(probe.getBoolean("separatePackage"))
      assertTrue(probe.getBoolean("separateUid"))
      assertFalse(probe.getBoolean("mediaControlPermissionGranted"))
      assertFalse(probe.getBoolean("platformTrusted"))
      assertEquals("", probe.getString("preflightFailureClass"))
      assertTrue(probe.getBoolean("connectionAttempted"))

      // A timeout or generic bind failure is not security evidence. The stable buildAsync contract
      // reports a rejected session as SecurityException; preflight above rules out manifest denial.
      assertFalse(probe.getBoolean("timedOut"))
      assertEquals("REJECTED_BY_SESSION", probe.getString("connectionOutcome"))
      assertEquals(SecurityException::class.java.name, probe.getString("connectionFailureClass"))
      assertTrue(probe.getBoolean("media3SessionRejectionSignal"))

      // No accepted session means the helper acquired no browse surface and no command set.
      assertFalse(probe.getBoolean("sessionAcquired"))
      assertFalse(probe.getBoolean("rootAccessible"))
      assertFalse(probe.getBoolean("privateItemAccessible"))
      assertFalse(probe.getBoolean("privateMarkerObserved"))
      assertEquals(0, probe.getInt("sessionCommandCount"))
      assertEquals(0, probe.getInt("playerCommandCount"))
      assertFalse(probe.getBoolean("mutationCallsIssued"))

      // The service also advertises the platform MediaBrowserService action used by legacy hosts.
      // The helper's raw bind carries a random request ID only as an Intent extra. The target
      // observes it around the unchanged MediaLibraryService.onBind implementation and must return
      // null after exactly one denied onGetSession lookup. The subsequent real MediaBrowser attempt
      // carries no test extra; on API 36 its complete silent window is only secondary client-surface
      // evidence. The same-Component Media3 browser proves the service remains live before/after.
      assertTrue(probe.getBoolean("legacyServiceBindAttempted"))
      assertTrue(probe.getBoolean("legacyServiceBindAccepted"))
      assertTrue(probe.getBoolean("legacyServiceComponentMatched"))
      assertFalse(probe.getBoolean("legacyServiceBindTimedOut"))
      assertEquals(1, probe.getInt("legacyServiceBindCallbackCount"))
      assertTrue(probe.getBoolean("legacyServiceNullBindingCallback"))
      assertFalse(probe.getBoolean("legacyServiceBinderReached"))
      assertFalse(probe.getBoolean("legacyServiceBinderAlive"))
      assertTrue(probe.getBoolean("legacyRawBindReleasedBeforeBrowser"))
      val rawPlatformNullBindingObserved =
        probe.getBoolean("legacyServiceNullBindingCallback") &&
          probe.getInt("legacyServiceBindCallbackCount") == 1 &&
          !probe.getBoolean("legacyServiceBinderReached") &&
          !probe.getBoolean("legacyServiceBinderAlive")
      assertTrue(probe.getBoolean("legacyConnectionAttempted"))
      assertTrue(probe.getBoolean("legacyConnectDispatchCompleted"))
      assertFalse(probe.getBoolean("legacyConnectedCallback"))
      assertFalse(probe.getBoolean("legacyConnectionSuspendedCallback"))
      assertEquals(LEGACY_OBSERVATION_WINDOW_MS, probe.getLong("legacyObservationWindowMs"))
      assertEquals("", probe.getString("legacyFailureClass"))

      val explicitPlatformRejection =
        probe.getBoolean("legacyConnectionFailedCallback") &&
          probe.getInt("legacyCallbackCount") == 1 &&
          !probe.getBoolean("legacyTimedOut") &&
          !probe.getBoolean("legacyObservationWindowCompleted") &&
          probe.getString("legacyConnectionOutcome") == "REJECTED_BY_BROWSER_CALLBACK"
      val silentPlatformRejection =
        Build.VERSION.SDK_INT == API_36 &&
          !probe.getBoolean("legacyConnectionFailedCallback") &&
          probe.getInt("legacyCallbackCount") == 0 &&
          probe.getBoolean("legacyTimedOut") &&
          probe.getBoolean("legacyObservationWindowCompleted") &&
          probe.getLong("legacyObservedDurationMs") >=
          probe.getLong("legacyObservationWindowMs") &&
          probe.getString("legacyConnectionOutcome") ==
          "NO_CALLBACK_WITHIN_OBSERVATION_WINDOW"
      if (explicitPlatformRejection) {
        assertEquals("CALLBACK_OBSERVED", probe.getString("legacyProbePhase"))
      } else if (silentPlatformRejection) {
        assertEquals("SILENT_WINDOW_COMPLETED", probe.getString("legacyProbePhase"))
      }
      assertTrue(
        "Platform denial must be explicit except for the complete API 36 silent window",
        explicitPlatformRejection || silentPlatformRejection,
      )

      assertEquals(platformProbeNonce, platformObservation.requestId)
      assertEquals(
        LoggeRythmPlatformProbePhase.NULL_BIND_CONFIRMED,
        platformObservation.phase,
      )
      assertEquals(1, platformObservation.matchedRawBindCount)
      assertEquals(0, platformObservation.uncorrelatedRawBindCount)
      assertEquals(1, platformObservation.lookupCount)
      val matchedPlatformController = requireNotNull(platformObservation.matchedController)
      assertEquals(
        MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION,
        matchedPlatformController.controllerVersion,
      )
      assertTrue(
        matchedPlatformController.uid == UNKNOWN_LEGACY_UID ||
          matchedPlatformController.uid == helperApplication.uid,
      )
      assertTrue(
        matchedPlatformController.packageName == MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME ||
          matchedPlatformController.packageName == HELPER_PACKAGE,
      )
      assertFalse(matchedPlatformController.trusted)
      assertFalse(matchedPlatformController.allowed)

      assertFalse(probe.getBoolean("legacyRootAccessible"))
      assertFalse(probe.getBoolean("legacySessionTokenAccessible"))
      assertFalse(probe.getBoolean("legacyPrivateItemAccessible"))
      assertFalse(probe.getBoolean("legacyPrivateItemProbeCompleted"))
      assertFalse(probe.getBoolean("legacyPrivateMarkerObserved"))
      assertFalse(probe.getBoolean("legacyQueueAccessible"))
      assertFalse(probe.getBoolean("legacyMetadataAccessible"))
      assertEquals(0L, probe.getLong("legacyPlaybackActions"))
      assertEquals(0, probe.getInt("legacyCustomActionCount"))
      assertFalse(probe.getBoolean("legacyMutationCallsIssued"))
      val legacyBoundaryClassification = if (
        media3Before.isLive &&
        media3After.isLive &&
        platformObservation.phase == LoggeRythmPlatformProbePhase.NULL_BIND_CONFIRMED &&
        platformObservation.matchedRawBindCount == 1 &&
        platformObservation.uncorrelatedRawBindCount == 0 &&
        platformObservation.lookupCount == 1 &&
        !matchedPlatformController.allowed &&
        rawPlatformNullBindingObserved &&
        (explicitPlatformRejection || silentPlatformRejection) &&
        !probe.getBoolean("legacyRootAccessible") &&
        !probe.getBoolean("legacySessionTokenAccessible")
      ) {
        "NO_SESSION_SURFACE_WITH_LIVE_POSITIVE_CONTROL"
      } else {
        "UNPROVEN"
      }
      assertEquals(
        "NO_SESSION_SURFACE_WITH_LIVE_POSITIVE_CONTROL",
        legacyBoundaryClassification,
      )

      // Allow any illicit asynchronous Binder command to surface before comparing the privileged
      // timeline/session state. Rejection must preserve every security-relevant baseline field.
      Thread.sleep(POST_PROBE_SETTLE_MS)
      val after = onLooper(activeControllerHandler) {
        activeTrustedController.securitySnapshot()
      }
      assertEquals(before, after)
      assertEquals(
        ControllerSecuritySnapshot(
          mediaItemCount = 1,
          currentMediaId = PRIVATE_QUEUE_ID,
          positionMs = PRIVATE_POSITION_MS,
          repeatMode = Player.REPEAT_MODE_ONE,
          playWhenReady = false,
        ),
        after,
      )
      assertTrue(LoggeRythmPlayerRuntime.browseItem(PRIVATE_BROWSE_MEDIA_ID) != null)
      assertTrue(LoggeRythmPlayerRuntime.browseItem(ATTACK_MEDIA_ID) == null)
    } finally {
      armedPlatformProbeNonce?.let(LoggeRythmPlatformProbeObservationHook::drain)
      if (helperBound) {
        helperConnection?.let { connection ->
          runCatching { context.unbindService(connection) }
        }
      }
      val activeController = trustedController
      val activeHandler = controllerHandler
      if (activeController != null && activeHandler != null) {
        runCatching { onLooper(activeHandler) { activeController.release() } }
      } else {
        controllerFuture?.let(androidx.media3.session.MediaController::releaseFuture)
      }
      controllerThread?.let { thread ->
        thread.quitSafely()
        runCatching { thread.join(DEVICE_TIMEOUT_SECONDS * 1_000L) }
      }
      context.stopService(Intent(context, LoggeRythmMediaLibraryService::class.java))
      clearTestState(context)
    }
  }

  private fun bindPersistenceOnMain(
    instrumentation: android.app.Instrumentation,
    binding: LoggeRythmPersistedSessionBinding,
  ) {
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

  private fun awaitControllerState(handler: Handler, controller: MediaBrowser) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(DEVICE_TIMEOUT_SECONDS)
    while (System.nanoTime() < deadline) {
      val snapshot = onLooper(handler) { controller.securitySnapshot() }
      if (
        snapshot.mediaItemCount == 1 &&
        snapshot.currentMediaId == PRIVATE_QUEUE_ID &&
        snapshot.positionMs == PRIVATE_POSITION_MS &&
        snapshot.repeatMode == Player.REPEAT_MODE_ONE
      ) return
      Thread.sleep(CONTROLLER_POLL_MS)
    }
    throw AssertionError("trusted-controller-state-timeout")
  }

  private fun trustedMedia3PositiveControlSnapshot(
    handler: Handler,
    browser: MediaBrowser,
  ): Media3PositiveControlSnapshot {
    val connection = onLooper(handler) {
      Triple(
        browser.isConnected,
        browser.availableSessionCommands.commands.size,
        browser.availableCommands.size(),
      )
    }
    val rootFuture = onLooper(handler) { browser.getLibraryRoot(null) }
    val rootMediaId = rootFuture.get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS).value?.mediaId
    val privateItemFuture = onLooper(handler) { browser.getItem(PRIVATE_BROWSE_MEDIA_ID) }
    val privateItemMediaId = privateItemFuture
      .get(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
      .value
      ?.mediaId
    return Media3PositiveControlSnapshot(
      connected = connection.first,
      rootMediaId = rootMediaId,
      privateItemMediaId = privateItemMediaId,
      sessionCommandCount = connection.second,
      playerCommandCount = connection.third,
    )
  }

  private fun assertLiveMedia3PositiveControl(
    phase: String,
    snapshot: Media3PositiveControlSnapshot,
  ) {
    assertTrue("Media3 positive control must be connected $phase", snapshot.connected)
    assertEquals(LoggeRythmPlayerRuntime.BROWSE_ROOT_ID, snapshot.rootMediaId)
    assertEquals(PRIVATE_BROWSE_MEDIA_ID, snapshot.privateItemMediaId)
    assertTrue(snapshot.sessionCommandCount > 0)
    assertTrue(snapshot.playerCommandCount > 0)
  }

  private fun runHostileProbe(
    binder: IBinder,
    targetPackage: String,
    targetService: String,
    platformProbeNonce: String,
  ): Bundle {
    val request = Parcel.obtain()
    val response = Parcel.obtain()
    try {
      request.writeInterfaceToken(HELPER_BINDER_DESCRIPTOR)
      request.writeString(targetPackage)
      request.writeString(targetService)
      request.writeString(PRIVATE_BROWSE_MEDIA_ID)
      request.writeString(ATTACK_MEDIA_ID)
      request.writeString(platformProbeNonce)
      assertTrue(binder.transact(HELPER_RUN_PROBE_TRANSACTION, request, response, 0))
      response.readException()
      return requireNotNull(response.readBundle(javaClass.classLoader))
    } finally {
      request.recycle()
      response.recycle()
    }
  }

  private fun privateBrowseTree() = BrowseTreeSpec(
    BrowseNodeSpec(
      id = LoggeRythmPlayerRuntime.BROWSE_ROOT_ID,
      title = "Synthetic account root",
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
          id = "instrumentation:private-container",
          title = "Synthetic private container",
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
              id = PRIVATE_BROWSE_MEDIA_ID,
              title = "Synthetic account-private marker",
              subtitle = null,
              artist = "Instrumentation",
              album = "Boundary fixture",
              artworkUrl = null,
              durationMs = null,
              playable = true,
              url = "$SYNTHETIC_ORIGIN/private-browse-item.mp3",
              cookie = null,
              children = emptyList(),
            ),
          ),
        ),
      ),
    ),
  )

  private fun clearTestState(context: Context) {
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    LoggeRythmEncryptedAndroidKeyStoreCipher().clearKey()
    LoggeRythmEncryptedAndroidBlobFile(context).clear()
  }

  private fun MediaBrowser.securitySnapshot() = ControllerSecuritySnapshot(
    mediaItemCount = mediaItemCount,
    currentMediaId = currentMediaItem?.mediaId,
    positionMs = currentPosition,
    repeatMode = repeatMode,
    playWhenReady = playWhenReady,
  )

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

  private data class ControllerSecuritySnapshot(
    val mediaItemCount: Int,
    val currentMediaId: String?,
    val positionMs: Long,
    val repeatMode: Int,
    val playWhenReady: Boolean,
  )

  private data class Media3PositiveControlSnapshot(
    val connected: Boolean,
    val rootMediaId: String?,
    val privateItemMediaId: String?,
    val sessionCommandCount: Int,
    val playerCommandCount: Int,
  ) {
    val isLive: Boolean
      get() =
        connected &&
          rootMediaId == LoggeRythmPlayerRuntime.BROWSE_ROOT_ID &&
          privateItemMediaId == PRIVATE_BROWSE_MEDIA_ID &&
          sessionCommandCount > 0 &&
          playerCommandCount > 0
  }

  private class ProbeServiceConnection : ServiceConnection {
    private val connected = CountDownLatch(1)
    private val binder = AtomicReference<IBinder>()

    override fun onServiceConnected(name: ComponentName, service: IBinder) {
      binder.set(service)
      connected.countDown()
    }

    override fun onServiceDisconnected(name: ComponentName) = Unit

    fun awaitBinder(): IBinder {
      assertTrue(connected.await(DEVICE_TIMEOUT_SECONDS, TimeUnit.SECONDS))
      return requireNotNull(binder.get())
    }
  }

  private companion object {
    const val HELPER_PACKAGE = "top.logge.loggerythm.player.hostilecontroller"
    const val HELPER_SERVICE_CLASS =
      "top.logge.loggerythm.player.hostilecontroller.HostileControllerProbeService"
    const val HELPER_ACTION =
      "top.logge.loggerythm.player.hostilecontroller.RUN_PROBE"
    const val HELPER_BINDER_DESCRIPTOR =
      "top.logge.loggerythm.player.hostilecontroller.IHostileControllerProbe"
    const val HELPER_RUN_PROBE_TRANSACTION = IBinder.FIRST_CALL_TRANSACTION
    const val SYNTHETIC_ORIGIN = "https://example.invalid"
    const val PRIVATE_BROWSE_MEDIA_ID = "instrumentation:account-private-browse-marker"
    const val PRIVATE_QUEUE_ID = "instrumentation:privileged-queue-marker"
    const val ATTACK_MEDIA_ID = "instrumentation:hostile-replacement"
    const val PRIVATE_POSITION_MS = 4_321L
    const val DEVICE_TIMEOUT_SECONDS = 10L
    const val CONTROLLER_POLL_MS = 50L
    const val POST_PROBE_SETTLE_MS = 500L
    const val PROBE_SCHEMA_VERSION = 6
    const val LEGACY_OBSERVATION_WINDOW_MS = 10_000L
    const val UNKNOWN_LEGACY_UID = -1
    const val API_36 = 36

    val EXPECTED_PROBE_KEYS = setOf(
      "probeSchemaVersion",
      "probeCompleted",
      "probeThreadTerminated",
      "probePackage",
      "probeUid",
      "probePid",
      "probeOwnBinderIdentity",
      "platformProbeRequestId",
      "targetPackage",
      "targetUid",
      "targetServiceResolved",
      "targetServicePermissionEmpty",
      "separateUid",
      "separatePackage",
      "mediaControlPermissionGranted",
      "platformTrusted",
      "preflightFailureClass",
      "connectionAttempted",
      "sessionAcquired",
      "rootAccessible",
      "privateItemAccessible",
      "privateMarkerObserved",
      "sessionCommandCount",
      "playerCommandCount",
      "mutationCallsIssued",
      "timedOut",
      "connectionOutcome",
      "connectionFailureClass",
      "media3SessionRejectionSignal",
      "legacyConnectionAttempted",
      "legacyConnectDispatchCompleted",
      "legacyProbePhase",
      "legacyServiceBindAttempted",
      "legacyServiceBindAccepted",
      "legacyServiceBinderReached",
      "legacyServiceBinderAlive",
      "legacyServiceComponentMatched",
      "legacyServiceNullBindingCallback",
      "legacyServiceBindCallbackCount",
      "legacyServiceBindTimedOut",
      "legacyRawBindReleasedBeforeBrowser",
      "legacyConnectedCallback",
      "legacyConnectionFailedCallback",
      "legacyConnectionSuspendedCallback",
      "legacyCallbackCount",
      "legacyObservationWindowMs",
      "legacyObservedDurationMs",
      "legacyObservationWindowCompleted",
      "legacyTimedOut",
      "legacyConnectionOutcome",
      "legacyFailureClass",
      "legacyRootAccessible",
      "legacySessionTokenAccessible",
      "legacyPrivateItemAccessible",
      "legacyPrivateItemProbeCompleted",
      "legacyPrivateMarkerObserved",
      "legacyQueueAccessible",
      "legacyMetadataAccessible",
      "legacyPlaybackActions",
      "legacyCustomActionCount",
      "legacyMutationCallsIssued",
    )
  }
}
