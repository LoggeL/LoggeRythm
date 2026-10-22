package top.logge.loggerythm.player

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.os.IBinder
import android.os.Process
import android.provider.MediaStore
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.FutureCallback
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.google.common.util.concurrent.SettableFuture

internal data class ControllerTrustSignals(
  val self: Boolean,
  val mediaNotification: Boolean,
  val trusted: Boolean,
  val automotive: Boolean,
  val autoCompanion: Boolean,
  val systemUid: Boolean,
  val trustedLegacyMediaButton: Boolean,
)

internal enum class LoggeRythmPlatformProbePhase {
  ARMED,
  RAW_BIND_STARTED,
  LOOKUP_RECORDED,
  NULL_BIND_CONFIRMED,
  NULL_BIND_WITHOUT_LOOKUP,
  LIVE_BINDER_RETURNED,
  BIND_FAILED,
}

internal data class LoggeRythmPlatformProbeControllerObservation(
  val uid: Int,
  val packageName: String,
  val controllerVersion: Int,
  val trusted: Boolean,
  /** Whether this identity was admitted as a controller. A framework bootstrap never is. */
  val allowed: Boolean,
  /** Whether the lookup was Media3's identity-free legacy browser bootstrap placeholder. */
  val frameworkBootstrap: Boolean = false,
)

internal data class LoggeRythmPlatformProbeObservation(
  val requestId: String,
  val phase: LoggeRythmPlatformProbePhase,
  val matchedRawBindCount: Int,
  val uncorrelatedRawBindCount: Int,
  val lookupCount: Int,
  val matchedController: LoggeRythmPlatformProbeControllerObservation?,
  val connectDecisionCount: Int = 0,
  val connectDecision: LoggeRythmPlatformProbeControllerObservation? = null,
)

/**
 * Process-only instrumentation evidence for Media3's legacy service lookup and the following real
 * controller admission. A random request ID is observed around the unchanged
 * [MediaLibraryService.onBind] implementation and, for `onConnect`, in the connecting browser's
 * root hints; it never changes the selected session, returned binder, controller policy, or
 * admission result. Unarmed requests and requests without the exact request ID are no-ops.
 */
internal object LoggeRythmPlatformProbeObservationHook {
  const val REQUEST_ID_EXTRA_KEY = "top.logge.loggerythm.player.test.PLATFORM_PROBE_NONCE"
  const val PLATFORM_BROWSER_SERVICE_ACTION = "android.media.browse.MediaBrowserService"

  private data class ArmedProbe(
    val requestId: String,
    var phase: LoggeRythmPlatformProbePhase = LoggeRythmPlatformProbePhase.ARMED,
    var matchedRawBindCount: Int = 0,
    var uncorrelatedRawBindCount: Int = 0,
    var lookupCount: Int = 0,
    var matchedController: LoggeRythmPlatformProbeControllerObservation? = null,
    var trackedBindActive: Boolean = false,
    var connectDecisionCount: Int = 0,
    var connectDecision: LoggeRythmPlatformProbeControllerObservation? = null,
  )

  private var armedProbe: ArmedProbe? = null

  @Synchronized
  fun arm(requestId: String) {
    require(requestId.isNotBlank() && requestId.length <= MAX_REQUEST_ID_LENGTH)
    armedProbe = ArmedProbe(requestId)
  }

  @Synchronized
  fun beginRawBind(action: String?, suppliedRequestId: String?): Boolean {
    val probe = armedProbe ?: return false
    if (action != PLATFORM_BROWSER_SERVICE_ACTION || suppliedRequestId == null) return false
    if (suppliedRequestId != probe.requestId) {
      probe.uncorrelatedRawBindCount += 1
      return false
    }
    probe.matchedRawBindCount += 1
    probe.trackedBindActive = true
    probe.phase = LoggeRythmPlatformProbePhase.RAW_BIND_STARTED
    return true
  }

  @UnstableApi
  fun recordLookup(
    controller: MediaSession.ControllerInfo,
    allowed: Boolean,
    frameworkBootstrap: Boolean,
  ) {
    recordLookup(observe(controller, allowed, frameworkBootstrap))
  }

  @UnstableApi
  fun recordConnectDecision(controller: MediaSession.ControllerInfo, allowed: Boolean) {
    recordConnectDecision(
      suppliedRequestId = controller.connectionHints.getString(REQUEST_ID_EXTRA_KEY),
      controller = observe(controller, allowed, frameworkBootstrap = false),
    )
  }

  @Synchronized
  internal fun recordConnectDecision(
    suppliedRequestId: String?,
    controller: LoggeRythmPlatformProbeControllerObservation,
  ) {
    val probe = armedProbe ?: return
    if (suppliedRequestId == null || suppliedRequestId != probe.requestId) return
    probe.connectDecisionCount += 1
    probe.connectDecision = controller
  }

  @UnstableApi
  private fun observe(
    controller: MediaSession.ControllerInfo,
    allowed: Boolean,
    frameworkBootstrap: Boolean,
  ) = LoggeRythmPlatformProbeControllerObservation(
    uid = controller.uid,
    packageName = controller.packageName,
    controllerVersion = controller.controllerVersion,
    trusted = controller.isTrusted,
    allowed = allowed,
    frameworkBootstrap = frameworkBootstrap,
  )

  @Synchronized
  internal fun recordLookup(controller: LoggeRythmPlatformProbeControllerObservation) {
    val probe = armedProbe ?: return
    if (!probe.trackedBindActive) return
    probe.lookupCount += 1
    probe.matchedController = controller
    probe.phase = LoggeRythmPlatformProbePhase.LOOKUP_RECORDED
  }

  @Synchronized
  fun completeRawBind(tracked: Boolean, binderReturned: Boolean) {
    if (!tracked) return
    val probe = armedProbe ?: return
    if (!probe.trackedBindActive) return
    probe.trackedBindActive = false
    probe.phase = when {
      binderReturned -> LoggeRythmPlatformProbePhase.LIVE_BINDER_RETURNED
      probe.lookupCount == 0 -> LoggeRythmPlatformProbePhase.NULL_BIND_WITHOUT_LOOKUP
      else -> LoggeRythmPlatformProbePhase.NULL_BIND_CONFIRMED
    }
  }

  @Synchronized
  fun failRawBind(tracked: Boolean) {
    if (!tracked) return
    val probe = armedProbe ?: return
    probe.trackedBindActive = false
    probe.phase = LoggeRythmPlatformProbePhase.BIND_FAILED
  }

  @Synchronized
  fun drain(requestId: String): LoggeRythmPlatformProbeObservation? {
    val probe = armedProbe ?: return null
    if (requestId != probe.requestId) return null
    armedProbe = null
    return LoggeRythmPlatformProbeObservation(
      requestId = probe.requestId,
      phase = probe.phase,
      matchedRawBindCount = probe.matchedRawBindCount,
      uncorrelatedRawBindCount = probe.uncorrelatedRawBindCount,
      lookupCount = probe.lookupCount,
      matchedController = probe.matchedController,
      connectDecisionCount = probe.connectDecisionCount,
      connectDecision = probe.connectDecision,
    )
  }

  private const val MAX_REQUEST_ID_LENGTH = 256
}

private enum class ServiceOnlyRestoreState {
  IDLE,
  RUNNING,
  RESTORED,
  EMPTY,
  FAILED,
}

@UnstableApi
internal object LoggeRythmControllerPolicy {
  fun accepts(signals: ControllerTrustSignals): Boolean =
    signals.self ||
      signals.mediaNotification ||
      signals.trusted

  fun isSelf(controller: MediaSession.ControllerInfo, appUid: Int, appPackage: String): Boolean =
    isSelfIdentity(
      controllerUid = controller.uid,
      controllerPackage = controller.packageName,
      controllerVersion = controller.controllerVersion,
      appUid = appUid,
      appPackage = appPackage,
    )

  /** Legacy package placeholders are self only when Media3 also preserves the exact app UID. */
  fun isSelfIdentity(
    controllerUid: Int,
    controllerPackage: String,
    controllerVersion: Int,
    appUid: Int,
    appPackage: String,
  ): Boolean = controllerUid == appUid && (
    controllerPackage == appPackage ||
      (
        controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION &&
          controllerPackage == MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME
        )
    )

  fun commandProfile(
    self: Boolean,
    mediaNotification: Boolean,
    automotive: Boolean = false,
    autoCompanion: Boolean = false,
  ): RemoteControllerProfile = when {
    // Android Auto may also identify as Media3's media-notification controller or with the app's
    // own UID via legacy browser bridging. Treat the automotive identity first or Auto receives an
    // internal/notification command shape without library browse/selection support.
    automotive || autoCompanion -> RemoteControllerProfile.TRUSTED_BROWSER
    mediaNotification -> RemoteControllerProfile.NOTIFICATION
    self -> RemoteControllerProfile.INTERNAL
    else -> RemoteControllerProfile.TRUSTED_BROWSER
  }

  fun requiresServiceOnlyRestore(profile: RemoteControllerProfile): Boolean =
    profile != RemoteControllerProfile.INTERNAL

  fun isAllowed(
    session: MediaSession,
    controller: MediaSession.ControllerInfo,
    appUid: Int,
    appPackage: String,
  ): Boolean = accepts(
    ControllerTrustSignals(
      self = isSelf(controller, appUid, appPackage),
      mediaNotification = session.isMediaNotificationController(controller),
      trusted = controller.isTrusted,
      automotive = session.isAutomotiveController(controller),
      autoCompanion = session.isAutoCompanionController(controller),
      systemUid = controller.uid == Process.SYSTEM_UID,
      trustedLegacyMediaButton =
        controller.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION &&
          controller.packageName == MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME &&
          controller.isTrusted,
    ),
  )
}

@UnstableApi
class LoggeRythmMediaLibraryService :
  MediaLibraryService(),
  LoggeRythmMediaSessionServiceControl {
  private lateinit var player: ExoPlayer
  private lateinit var librarySession: MediaLibrarySession
  private lateinit var playerCache: LoggeRythmPlayerCache
  private lateinit var persistedCoordinator: LoggeRythmPersistedPlayerCoordinator
  private lateinit var remoteCommandInstaller: LoggeRythmDurableRemoteCommandInstaller
  private lateinit var sessionActivity: PendingIntent
  private val remoteCommandPolicy = LoggeRythmRemoteCommandPolicy()
  private val notificationFavorite = LoggeRythmNotificationFavoriteCoordinator()
  private var remotePolicyExplicitlyReset = false
  private var serviceDestroyed = false
  private var serviceOnlyRestoreState = ServiceOnlyRestoreState.IDLE
  private val serviceOnlyRestoreWaiters = mutableListOf<() -> Unit>()
  private val browseTreeObserver = object : LoggeRythmBrowseTreeObserver {
    override fun onBrowseTreeChanged(change: RuntimeBrowseTreeChange) {
      notifyBrowseTreeChanged(change)
    }
  }
  private val cacheControl = object : LoggeRythmCacheServiceControl {
    override fun onQueueGenerationChanged(generation: Long) {
      playerCache.onQueueGenerationChanged(generation)
    }

    override fun cancelPreloadAndAwait(callback: (Result<Unit>) -> Unit) {
      playerCache.cancelPreloadAndAwait(callback)
    }

    override fun clearCache(callback: (Result<LoggeRythmCacheClearResult>) -> Unit) {
      player.stop()
      player.clearMediaItems()
      playerCache.clearCache(callback)
    }
  }
  private val preloadListener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      if (
        events.contains(Player.EVENT_TIMELINE_CHANGED) ||
        events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) ||
        events.contains(Player.EVENT_REPEAT_MODE_CHANGED) ||
        events.contains(Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED)
      ) {
        scheduleNextPreload()
      }
      if (
        events.contains(Player.EVENT_TIMELINE_CHANGED) ||
        events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION)
      ) {
        refreshNotificationFavoriteButtons()
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    playerCache = LoggeRythmPlayerCache(this)
    val mediaSourceFactory = DefaultMediaSourceFactory(playerCache.playbackDataSourceFactory())
    val audioAttributes = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
      .build()
    player = ExoPlayer.Builder(this)
      .setMediaSourceFactory(mediaSourceFactory)
      .setAudioAttributes(audioAttributes, true)
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()
    player.addListener(preloadListener)
    persistedCoordinator = LoggeRythmPersistedPlayerCoordinator(
      context = this,
      player = player,
      clearCache = playerCache::clearCache,
    )
    sessionActivity = LoggeRythmSessionActivity.pendingIntent(this)
    librarySession = MediaLibrarySession.Builder(this, player, LibraryCallback())
      .setSessionActivity(sessionActivity)
      .build()
    remoteCommandInstaller = LoggeRythmDurableRemoteCommandInstaller(
      resetPolicy = remoteCommandPolicy::reset,
      installPolicy = { capabilities ->
        remotePolicyExplicitlyReset = false
        remoteCommandPolicy.install(capabilities)
      },
      refreshConnectedControllers = ::refreshConnectedControllerCommands,
      persist = persistedCoordinator::onRemoteCommandsInstalled,
    )
    LoggeRythmBrowseTreeServiceBridge.attach(browseTreeObserver)
    LoggeRythmCacheServiceBridge.attach(cacheControl)
    LoggeRythmPersistedServiceBridge.attach(persistedCoordinator)
    LoggeRythmMediaSessionServiceBridge.attach(this)
    cacheControl.onQueueGenerationChanged(LoggeRythmPlayerRuntime.currentQueueGeneration())
  }

  override fun onBind(intent: Intent?): IBinder? {
    val tracked = LoggeRythmPlatformProbeObservationHook.beginRawBind(
      action = intent?.action,
      suppliedRequestId = intent?.getStringExtra(
        LoggeRythmPlatformProbeObservationHook.REQUEST_ID_EXTRA_KEY,
      ),
    )
    return try {
      super.onBind(intent).also { binder ->
        LoggeRythmPlatformProbeObservationHook.completeRawBind(
          tracked = tracked,
          binderReturned = binder != null,
        )
      }
    } catch (error: Throwable) {
      LoggeRythmPlatformProbeObservationHook.failRawBind(tracked)
      throw error
    }
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? {
    val lookup = LoggeRythmSessionLookupPolicy.classify(
      uid = controllerInfo.uid,
      packageName = controllerInfo.packageName,
      controllerVersion = controllerInfo.controllerVersion,
      trusted = controllerInfo.isTrusted,
    )
    if (lookup == LoggeRythmSessionLookup.FRAMEWORK_LEGACY_BROWSER_BOOTSTRAP) {
      // A platform MediaBrowserService bind (Android Auto, Automotive OS, legacy hosts) carries no
      // caller identity here, and Android caches the returned binder for every later legacy bind.
      // Returning null would lock out every legacy host until the service dies. Hand over the
      // legacy browser binder; Media3 then admits each real browser in onConnect (from onGetRoot,
      // with its platform-verified package/UID and trust) and each platform controller command
      // through onConnect as well. Restore waits for that admitted identity.
      LoggeRythmPlatformProbeObservationHook.recordLookup(
        controllerInfo,
        allowed = false,
        frameworkBootstrap = true,
      )
      return librarySession
    }
    val allowed = LoggeRythmControllerPolicy.isAllowed(
      librarySession,
      controllerInfo,
      applicationInfo.uid,
      packageName,
    )
    LoggeRythmPlatformProbeObservationHook.recordLookup(
      controllerInfo,
      allowed = allowed,
      frameworkBootstrap = false,
    )
    if (!allowed) {
      logRejectedController(controllerInfo)
      return null
    }
    val profile = controllerProfile(librarySession, controllerInfo)
    if (LoggeRythmControllerPolicy.requiresServiceOnlyRestore(profile)) ensureServiceOnlyRestore()
    return librarySession
  }

  override fun onDestroy() {
    serviceDestroyed = true
    LoggeRythmMediaSessionServiceBridge.detach(this)
    LoggeRythmPersistedServiceBridge.detach(persistedCoordinator)
    LoggeRythmCacheServiceBridge.detach(cacheControl)
    // Coordinator.close() clears the runtime tree; the session is being released, so detach first.
    LoggeRythmBrowseTreeServiceBridge.detach(browseTreeObserver)
    remoteCommandInstaller.close()
    persistedCoordinator.close()
    serviceOnlyRestoreState = ServiceOnlyRestoreState.FAILED
    finishServiceOnlyRestoreWaiters()
    player.removeListener(preloadListener)
    librarySession.release()
    player.release()
    playerCache.close()
    super.onDestroy()
  }

  override fun installRemoteCommands(
    capabilities: Set<RemotePlayerCapability>,
    callback: (Result<Unit>) -> Unit,
  ) {
    if (!persistedCoordinator.isReady()) {
      callback(Result.failure(LoggeRythmPersistedPlayerException("player-session-not-ready")))
      return
    }
    remoteCommandInstaller.install(capabilities, callback)
  }

  override fun resetRemoteCommands() {
    remotePolicyExplicitlyReset = true
    // Invalidate the service publisher before its old persistence completion can run, then queue
    // the coordinator's committed-policy rollback behind that already-admitted write.
    persistedCoordinator.cancelPendingRemoteCommandUpdate()
    remoteCommandInstaller.reset()
    notificationFavorite.publish(null, null)
    refreshNotificationFavoriteButtons()
  }

  override fun publishNotificationFavorite(
    mediaId: String?,
    liked: Boolean?,
    callback: (Result<Unit>) -> Unit,
  ) {
    notificationFavorite.publish(mediaId, liked)
    refreshNotificationFavoriteButtons(callback)
  }

  private fun notifyBrowseTreeChanged(change: RuntimeBrowseTreeChange) {
    if (!::librarySession.isInitialized) return
    change.childCountByParentId.forEach { (parentId, childCount) ->
      // Library invalidation is best-effort and must never undo a completed credential/tree clear.
      runCatching { librarySession.notifyChildrenChanged(parentId, childCount, null) }
    }
  }

  private fun scheduleNextPreload() {
    val nextIndex = player.nextMediaItemIndex
    val nextUrl = if (nextIndex == C.INDEX_UNSET) {
      null
    } else {
      player.getMediaItemAt(nextIndex).localConfiguration?.uri?.toString()
    }
    playerCache.scheduleNext(LoggeRythmPlayerRuntime.currentQueueGeneration(), nextUrl)
  }

  private fun controllerProfile(
    session: MediaSession,
    controller: MediaSession.ControllerInfo,
  ): RemoteControllerProfile = LoggeRythmControllerPolicy.commandProfile(
    self = LoggeRythmControllerPolicy.isSelf(
      controller,
      applicationInfo.uid,
      packageName,
    ),
    mediaNotification = session.isMediaNotificationController(controller),
    automotive = session.isAutomotiveController(controller),
    autoCompanion = session.isAutoCompanionController(controller),
  )

  private fun refreshConnectedControllerCommands() {
    librarySession.connectedControllers.forEach { controller ->
      val profile = controllerProfile(librarySession, controller)
      librarySession.setAvailableCommands(
        controller,
        remoteCommandPolicy.sessionCommands(profile),
        remoteCommandPolicy.playerCommands(profile),
      )
      librarySession.setMediaButtonPreferences(
        controller,
        notificationFavoriteButtons(profile),
      )
    }
  }

  private fun notificationFavoriteButtons(profile: RemoteControllerProfile): List<CommandButton> =
    if (profile == RemoteControllerProfile.NOTIFICATION) {
      notificationFavorite.buttonFor(player.currentMediaItem?.mediaId)
    } else {
      emptyList()
    }

  private fun refreshNotificationFavoriteButtons(
    callback: ((Result<Unit>) -> Unit)? = null,
  ) {
    val futures = librarySession.connectedControllers.mapNotNull { controller ->
      val profile = controllerProfile(librarySession, controller)
      if (profile != RemoteControllerProfile.NOTIFICATION) return@mapNotNull null
      librarySession.setMediaButtonPreferences(
        controller,
        notificationFavoriteButtons(profile),
      )
    }
    if (futures.isEmpty()) {
      callback?.invoke(Result.success(Unit))
      return
    }
    Futures.addCallback(
      Futures.allAsList(futures),
      object : FutureCallback<List<SessionResult>> {
        override fun onSuccess(results: List<SessionResult>) {
          val failure = notificationFavoriteLayoutFailure(results)
          if (failure == null) {
            callback?.invoke(Result.success(Unit))
          } else {
            val error = IllegalStateException(
              "notification-favorite-layout-rejected:${failure.resultCode}",
            )
            if (callback == null) throw error else callback.invoke(Result.failure(error))
          }
        }

        override fun onFailure(error: Throwable) {
          if (callback == null) throw IllegalStateException(
            "notification-favorite-layout-failed",
            error,
          ) else callback.invoke(Result.failure(error))
        }
      },
      MoreExecutors.directExecutor(),
    )
  }

  private fun ensureServiceOnlyRestore() {
    // A failed restore has already failed closed (durable state discarded). A later admitted car
    // request may retry once more instead of leaving this service instance permanently unusable.
    val retryable = serviceOnlyRestoreState == ServiceOnlyRestoreState.IDLE ||
      (serviceOnlyRestoreState == ServiceOnlyRestoreState.FAILED && !serviceDestroyed)
    if (!retryable) return
    serviceOnlyRestoreState = ServiceOnlyRestoreState.RUNNING
    persistedCoordinator.restoreServiceOnly { result ->
      result.fold(
        onSuccess = { restored ->
          if (restored) {
            val capabilities = publishableRestoredRemoteCapabilities(
              explicitlyReset = remotePolicyExplicitlyReset,
              committedCapabilities = persistedCoordinator.publicState().remoteCapabilities,
            )
            if (capabilities == null) remoteCommandPolicy.reset()
            else remoteCommandPolicy.install(capabilities)
            serviceOnlyRestoreState = ServiceOnlyRestoreState.RESTORED
          } else {
            remoteCommandPolicy.reset()
            serviceOnlyRestoreState = ServiceOnlyRestoreState.EMPTY
          }
        },
        onFailure = { error ->
          Log.e(TAG, "Cold service restore failed: ${diagnosticCode(error)}")
          remoteCommandPolicy.reset()
          serviceOnlyRestoreState = ServiceOnlyRestoreState.FAILED
        },
      )
      runCatching(::refreshConnectedControllerCommands)
      finishServiceOnlyRestoreWaiters()
    }
  }

  private fun logRejectedController(controller: MediaSession.ControllerInfo) {
    // Package names and UIDs are public platform identities, not secrets. This makes a rejected
    // car host diagnosable from logcat without weakening admission.
    Log.w(
      TAG,
      "Rejected media controller package=${controller.packageName} uid=${controller.uid} " +
        "version=${controller.controllerVersion} trusted=${controller.isTrusted}. " +
        "Only this app, its media notification, or a platform-trusted media controller " +
        "(MEDIA_CONTENT_CONTROL, enabled notification listener, or system) may connect.",
    )
  }

  private fun rootUnavailable(): LoggeRythmCarError? = LoggeRythmCarLibraryState.rootUnavailable(
    bound = LoggeRythmPlayerRuntime.currentSessionBinding() != null,
    coldRestoreFailed = serviceOnlyRestoreState == ServiceOnlyRestoreState.FAILED,
  )

  private fun notReadyError(): LoggeRythmCarError = when {
    playerCache.isClearing() -> LoggeRythmCarError.CACHE_CLEARING
    serviceOnlyRestoreState == ServiceOnlyRestoreState.RUNNING ->
      LoggeRythmCarError.SESSION_NOT_READY
    else -> rootUnavailable() ?: LoggeRythmCarError.SESSION_NOT_READY
  }

  private fun carSessionError(error: LoggeRythmCarError, argument: String?): SessionError {
    val message = if (argument == null) {
      getString(error.messageRes)
    } else {
      getString(error.messageRes, argument.take(MAX_ERROR_ARGUMENT_LENGTH))
    }
    return SessionError(error.sessionErrorCode, message, carResolutionExtras(error))
  }

  private fun carResolutionExtras(error: LoggeRythmCarError): Bundle = Bundle().apply {
    if (error.offersOpenApp) {
      putString(
        MediaConstants.EXTRAS_KEY_ERROR_RESOLUTION_ACTION_LABEL_COMPAT,
        getString(R.string.loggerythm_player_car_action_open_app),
      )
      putParcelable(MediaConstants.EXTRAS_KEY_ERROR_RESOLUTION_ACTION_INTENT_COMPAT, sessionActivity)
    }
  }

  private fun <V : Any> carLibraryError(error: LoggeRythmCarError, argument: String? = null) =
    LibraryResult.ofError<V>(
      carSessionError(error, argument),
      LibraryParams.Builder().setExtras(carResolutionExtras(error)).build(),
    )

  /**
   * Shows [error] to the person in the car. Media3 mirrors errors sent to the media notification
   * controller (or a platform controller) into the platform `PlaybackState`, which Android Auto
   * and Automotive OS render. Media3 controllers additionally receive `Listener.onError`. The app's
   * own in-process controller is never targeted: its command promise already reports the failure.
   */
  private fun reportCarError(
    session: MediaSession,
    controller: MediaSession.ControllerInfo,
    error: LoggeRythmCarError,
    argument: String? = null,
    fromLibraryResult: Boolean = false,
  ) {
    val legacy = controller.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION
    if (!legacy && controllerProfile(session, controller) == RemoteControllerProfile.INTERNAL) return
    // Media3 already replicates an authentication LibraryResult to legacy hosts persistently.
    if (
      fromLibraryResult &&
      legacy &&
      error.sessionErrorCode == SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED
    ) {
      return
    }
    val sessionError = carSessionError(error, argument)
    val platformMirror = session.mediaNotificationControllerInfo
    if (platformMirror != null) session.sendError(platformMirror, sessionError)
    if (!legacy && controller != platformMirror) session.sendError(controller, sessionError)
    if (legacy && platformMirror == null) session.sendError(controller, sessionError)
  }

  private fun <V : Any> failLibraryRequest(
    session: MediaSession,
    controller: MediaSession.ControllerInfo,
    error: LoggeRythmCarError,
    argument: String? = null,
  ): LibraryResult<V> {
    reportCarError(session, controller, error, argument, fromLibraryResult = true)
    return carLibraryError<V>(error, argument)
  }

  /** Mutable-queue admission shared by every external and internal queue replacement. */
  private fun requireQueueReplacementAdmitted() {
    if (playerCache.isClearing()) {
      throw LoggeRythmCarRequestException(LoggeRythmCarError.CACHE_CLEARING)
    }
    if (!persistedCoordinator.isReady()) throw LoggeRythmCarRequestException(notReadyError())
    if (persistedCoordinator.isQueueMutationBlocked()) {
      throw LoggeRythmCarRequestException(LoggeRythmCarError.QUEUE_COMMIT_ACTIVE)
    }
  }

  /**
   * Resolves a car/library play request from IDs or a voice query against the native tree only.
   * Caller-supplied URIs, metadata, start index and position are never used.
   */
  private fun resolveLibraryPlayRequest(
    profile: RemoteControllerProfile,
    mediaItems: List<MediaItem>,
  ): MediaItemsWithStartPosition {
    when (profile) {
      RemoteControllerProfile.NOTIFICATION ->
        throw LoggeRythmCarRequestException(LoggeRythmCarError.UNSUPPORTED_REQUEST)
      RemoteControllerProfile.TRUSTED_BROWSER ->
        if (!remoteCommandPolicy.permits(profile, Player.COMMAND_SET_MEDIA_ITEM)) {
          throw LoggeRythmCarRequestException(LoggeRythmCarError.CONTROLS_NOT_READY)
        }
      RemoteControllerProfile.INTERNAL -> Unit
    }
    val requested = mediaItems.singleOrNull()
      ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.UNSUPPORTED_REQUEST)
    rootUnavailable()?.let { throw LoggeRythmCarRequestException(it) }

    val mediaId = requested.mediaId
    if (mediaId != MediaItem.DEFAULT_MEDIA_ID) {
      val selection = LoggeRythmPlayerRuntime.playableBrowseSiblings(mediaId)
        ?: LoggeRythmPlayerRuntime.playableBrowseChildren(mediaId)
        ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.MEDIA_ITEM_UNAVAILABLE)
      return validatedCarSelection(selection)
    }

    val query = requested.requestMetadata.searchQuery
      ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.UNSUPPORTED_REQUEST)
    val tree = LoggeRythmPlayerRuntime.browseTree()
    val target = if (query.isBlank()) {
      return resumableQueue()
    } else {
      val playlistFocus = requested.requestMetadata.extras
        ?.getString(MediaStore.EXTRA_MEDIA_FOCUS) == MediaStore.Audio.Playlists.ENTRY_CONTENT_TYPE
      LoggeRythmLibrarySearch.resolvePlayRequest(tree, query, preferContainers = playlistFocus)
        ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.SEARCH_NO_MATCH, query)
    }
    val selection = when (target) {
      is LoggeRythmLibraryTarget.Leaf -> LoggeRythmPlayerRuntime.playableBrowseSiblings(target.mediaId)
      is LoggeRythmLibraryTarget.Container ->
        LoggeRythmPlayerRuntime.playableBrowseChildren(target.mediaId)
    } ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.MEDIA_ITEM_UNAVAILABLE)
    return validatedCarSelection(selection)
  }

  private fun validatedCarSelection(selection: RuntimeBrowseSelection): MediaItemsWithStartPosition {
    val tree = LoggeRythmPlayerRuntime.browseTree()
    if (selection.mediaItems.any { item ->
        val source = tree.nodes[item.mediaId]?.source
        source == null || !LoggeRythmCarLibraryState.hasPhoneTrackMetadata(source.extrasJson)
      }) {
      // Do not create a queue that will crash the phone's Track rendering after an upgrade.
      // Opening the phone refreshes the library with the backward-compatible private sidecars.
      throw LoggeRythmCarRequestException(LoggeRythmCarError.LIBRARY_REFRESH_REQUIRED)
    }
    return MediaItemsWithStartPosition(selection.mediaItems, selection.startIndex, 0L)
  }

  /** Standard car Play and an empty voice query use the same account-bound native sources. */
  private fun resumableQueue(): MediaItemsWithStartPosition {
    rootUnavailable()?.let { throw LoggeRythmCarRequestException(it) }
    if (player.mediaItemCount > 0) {
      return MediaItemsWithStartPosition(
        List(player.mediaItemCount, player::getMediaItemAt),
        player.currentMediaItemIndex,
        player.currentPosition,
      )
    }
    val target = LoggeRythmLibrarySearch.firstPlayableContainer(LoggeRythmPlayerRuntime.browseTree())
      ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.NOTHING_TO_PLAY)
    val selection = LoggeRythmPlayerRuntime.playableBrowseChildren(target.mediaId)
      ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.MEDIA_ITEM_UNAVAILABLE)
    return validatedCarSelection(selection)
  }

  private fun finishServiceOnlyRestoreWaiters() {
    val admitted = serviceOnlyRestoreWaiters.toList()
    serviceOnlyRestoreWaiters.clear()
    admitted.forEach { waiter -> runCatching(waiter) }
  }

  private fun <T> afterServiceOnlyRestore(action: () -> T): ListenableFuture<T> {
    ensureServiceOnlyRestore()
    if (serviceOnlyRestoreState != ServiceOnlyRestoreState.RUNNING) {
      return try {
        Futures.immediateFuture(action())
      } catch (error: Exception) {
        Futures.immediateFailedFuture(error)
      }
    }
    val future = SettableFuture.create<T>()
    serviceOnlyRestoreWaiters += {
      if (!future.isCancelled) {
        try {
          future.set(action())
        } catch (error: Exception) {
          future.setException(error)
        }
      }
    }
    return future
  }

  private inner class LibraryCallback : MediaLibrarySession.Callback {
    override fun onConnect(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
    ): MediaSession.ConnectionResult {
      val allowed = LoggeRythmControllerPolicy.isAllowed(
        session,
        controller,
        applicationInfo.uid,
        packageName,
      )
      LoggeRythmPlatformProbeObservationHook.recordConnectDecision(controller, allowed)
      if (!allowed) {
        logRejectedController(controller)
        return MediaSession.ConnectionResult.reject()
      }
      val profile = controllerProfile(session, controller)
      if (LoggeRythmControllerPolicy.requiresServiceOnlyRestore(profile)) ensureServiceOnlyRestore()
      return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
        .setAvailableSessionCommands(remoteCommandPolicy.sessionCommands(profile))
        .setAvailablePlayerCommands(remoteCommandPolicy.playerCommands(profile))
        .setMediaButtonPreferences(notificationFavoriteButtons(profile))
        .build()
    }

    override fun onCustomCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      customCommand: androidx.media3.session.SessionCommand,
      args: Bundle,
    ): ListenableFuture<SessionResult> {
      if (
        controllerProfile(session, controller) != RemoteControllerProfile.NOTIFICATION ||
        customCommand.customAction != LoggeRythmNotificationFavoriteContract.ACTION
      ) {
        return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
      }
      val result = notificationFavorite.requestToggle(
        player.currentMediaItem?.mediaId,
        LoggeRythmNotificationFavoriteEventBridge::emit,
      )
      if (result != LoggeRythmNotificationFavoriteRequestResult.DELIVERED) {
        return Futures.immediateFuture(SessionResult(SessionError.ERROR_INVALID_STATE))
      }
      refreshNotificationFavoriteButtons()
      return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onPlayerCommandRequest(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      playerCommand: Int,
    ): Int {
      val profile = controllerProfile(session, controller)
      if (playerCache.isClearing() || !persistedCoordinator.isReady()) {
        reportCarError(session, controller, notReadyError())
        return SessionResult.RESULT_ERROR_INVALID_STATE
      }
      return if (remoteCommandPolicy.permits(profile, playerCommand)) {
        SessionResult.RESULT_SUCCESS
      } else {
        SessionResult.RESULT_ERROR_PERMISSION_DENIED
      }
    }

    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      // Legacy onGetRoot synchronously waits for this future on the service main thread.
      // Waiting for our asynchronous encrypted restore here deadlocks its main-thread callback.
      // The stable, non-sensitive root is always available; children wait for restore separately.
      ensureServiceOnlyRestore()
      val tree = LoggeRythmPlayerRuntime.browseTree()
      val root = checkNotNull(tree.nodes[tree.rootId]).mediaItem
      return Futures.immediateFuture(LibraryResult.ofItem(root, params))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      return afterServiceOnlyRestore {
        val item = LoggeRythmPlayerRuntime.browseItem(mediaId)
        if (item == null) LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
        else LibraryResult.ofItem(item, null)
      }
    }

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      if (page < 0 || pageSize <= 0) {
        return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
      }
      return afterServiceOnlyRestore {
        val tree = LoggeRythmPlayerRuntime.browseTree()
        val unavailable = if (parentId == tree.rootId) rootUnavailable() else null
        val parent = tree.nodes[parentId]?.takeIf { it.source == null }
        when {
          unavailable != null -> failLibraryRequest(session, browser, unavailable)
          // A stale subscription or a list removed by a newer tree publication.
          parent == null -> failLibraryRequest(session, browser, LoggeRythmCarError.LIST_UNAVAILABLE)
          else -> {
            val range = checkNotNull(LoggeRythmBrowsePaging.range(parent.childIds.size, page, pageSize))
            val children = parent.childIds.slice(range).mapNotNull { tree.nodes[it]?.mediaItem }
            if (parentId == tree.rootId && parent.childIds.isEmpty()) {
              // Truthful empty result plus a visible hint, never a silent blank car screen.
              reportCarError(session, browser, LoggeRythmCarError.LIBRARY_EMPTY)
            }
            LibraryResult.ofItemList(ImmutableList.copyOf(children), params)
          }
        }
      }
    }

    override fun onSearch(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> {
      return afterServiceOnlyRestore {
        val unavailable = rootUnavailable()
        if (unavailable != null) {
          failLibraryRequest(session, browser, unavailable)
        } else {
          val count = LoggeRythmLibrarySearch.search(LoggeRythmPlayerRuntime.browseTree(), query).size
          // Legacy hosts register the request before this callback and fetch results on notify.
          session.notifySearchResultChanged(browser, query, count, params)
          LibraryResult.ofVoid(params)
        }
      }
    }

    override fun onGetSearchResult(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      if (page < 0 || pageSize <= 0) {
        return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
      }
      return afterServiceOnlyRestore {
        val unavailable = rootUnavailable()
        if (unavailable != null) {
          failLibraryRequest(session, browser, unavailable)
        } else {
          val tree = LoggeRythmPlayerRuntime.browseTree()
          val ids = LoggeRythmLibrarySearch.search(tree, query)
          val range = checkNotNull(LoggeRythmBrowsePaging.range(ids.size, page, pageSize))
          val results = ids.slice(range).mapNotNull { tree.nodes[it]?.mediaItem }
          // No match is an empty result per Media3's search contract, not an error.
          LibraryResult.ofItemList(ImmutableList.copyOf(results), params)
        }
      }
    }

    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: List<MediaItem>,
    ): ListenableFuture<List<MediaItem>> {
      return afterServiceOnlyRestore {
        if (playerCache.isClearing()) throw IllegalStateException("player-cache-clearing")
        if (!persistedCoordinator.isReady()) throw IllegalStateException("player-session-not-ready")
        if (persistedCoordinator.isQueueMutationBlocked()) {
          throw IllegalStateException("playback-event-queue-commit-active")
        }
        if (LoggeRythmControllerPolicy.isSelf(
            controller,
            applicationInfo.uid,
            packageName,
          ) && mediaItems.all { it.localConfiguration != null }) {
          mediaItems
        } else {
          mediaItems.map { requested ->
            LoggeRythmPlayerRuntime.browseItem(requested.mediaId)
              ?: throw SecurityException("media-item-not-available")
          }
        }
      }
    }

    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      isForPlayback: Boolean,
    ): ListenableFuture<MediaItemsWithStartPosition> = afterServiceOnlyRestore {
      try {
        requireQueueReplacementAdmitted()
        val profile = controllerProfile(mediaSession, controller)
        if (!remoteCommandPolicy.permits(profile, Player.COMMAND_PLAY_PAUSE)) {
          throw LoggeRythmCarRequestException(LoggeRythmCarError.CONTROLS_NOT_READY)
        }
        resumableQueue()
      } catch (error: LoggeRythmCarRequestException) {
        reportCarError(mediaSession, controller, error.error, error.messageArgument)
        throw error
      }
    }

    override fun onSetMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: List<MediaItem>,
      startIndex: Int,
      startPositionMs: Long,
    ): ListenableFuture<MediaItemsWithStartPosition> {
      return afterServiceOnlyRestore {
        val profile = controllerProfile(mediaSession, controller)
        try {
          requireQueueReplacementAdmitted()
          if (
            profile == RemoteControllerProfile.INTERNAL &&
            mediaItems.all { it.localConfiguration != null }
          ) {
            MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs)
          } else {
            // A browse/voice request selects one published ID or query. Every caller-owned
            // URI/metadata field is ignored; the native tree supplies the queue.
            resolveLibraryPlayRequest(profile, mediaItems)
          }
        } catch (error: LoggeRythmCarRequestException) {
          reportCarError(mediaSession, controller, error.error, error.messageArgument)
          throw error
        }
      }
    }
  }

  private companion object {
    const val TAG = "LoggeRythmMediaService"
    const val MAX_ERROR_ARGUMENT_LENGTH = 80

    /** Stable machine code only; never a message that could carry a URL or credential. */
    fun diagnosticCode(error: Throwable): String = when (error) {
      is LoggeRythmPersistedPlayerException -> error.code
      is PlayerProtocolException -> error.code
      else -> error.javaClass.name
    }
  }
}
