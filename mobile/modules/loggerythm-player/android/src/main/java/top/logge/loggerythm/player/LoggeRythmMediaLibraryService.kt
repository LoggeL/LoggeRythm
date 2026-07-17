package top.logge.loggerythm.player

import android.content.Intent
import android.os.IBinder
import android.os.Process
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
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
  val allowed: Boolean,
)

internal data class LoggeRythmPlatformProbeObservation(
  val requestId: String,
  val phase: LoggeRythmPlatformProbePhase,
  val matchedRawBindCount: Int,
  val uncorrelatedRawBindCount: Int,
  val lookupCount: Int,
  val matchedController: LoggeRythmPlatformProbeControllerObservation?,
)

/**
 * Process-only instrumentation evidence for Media3's legacy service lookup. A random request ID is
 * observed around the unchanged [MediaLibraryService.onBind] implementation; it never changes the
 * selected session, returned binder, controller policy, or admission result. Unarmed requests and
 * binds without the exact request ID are no-ops.
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
  fun recordLookup(controller: MediaSession.ControllerInfo, allowed: Boolean) {
    recordLookup(
      LoggeRythmPlatformProbeControllerObservation(
        uid = controller.uid,
        packageName = controller.packageName,
        controllerVersion = controller.controllerVersion,
        trusted = controller.isTrusted,
        allowed = allowed,
      ),
    )
  }

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
    self -> RemoteControllerProfile.INTERNAL
    // Android Auto may also identify as Media3's media-notification controller. Treat the
    // automotive identity first or it receives the notification-only command set (no library
    // root/children commands), so Auto can display neither the restored queue metadata nor browse.
    automotive || autoCompanion -> RemoteControllerProfile.TRUSTED_BROWSER
    mediaNotification -> RemoteControllerProfile.NOTIFICATION
    else -> RemoteControllerProfile.TRUSTED_BROWSER
  }

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
  private val remoteCommandPolicy = LoggeRythmRemoteCommandPolicy()
  private var remotePolicyExplicitlyReset = false
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
    librarySession = MediaLibrarySession.Builder(this, player, LibraryCallback())
      .setSessionActivity(LoggeRythmSessionActivity.pendingIntent(this))
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
    val allowed = LoggeRythmControllerPolicy.isAllowed(
      librarySession,
      controllerInfo,
      applicationInfo.uid,
      packageName,
    )
    LoggeRythmPlatformProbeObservationHook.recordLookup(controllerInfo, allowed)
    if (!allowed) return null
    if (controllerProfile(librarySession, controllerInfo) == RemoteControllerProfile.TRUSTED_BROWSER) {
      ensureServiceOnlyRestore()
    }
    return librarySession
  }

  override fun onDestroy() {
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
    }
  }

  private fun ensureServiceOnlyRestore() {
    if (serviceOnlyRestoreState != ServiceOnlyRestoreState.IDLE) return
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
        onFailure = {
          remoteCommandPolicy.reset()
          serviceOnlyRestoreState = ServiceOnlyRestoreState.FAILED
        },
      )
      runCatching(::refreshConnectedControllerCommands)
      finishServiceOnlyRestoreWaiters()
    }
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
      if (!allowed) {
        return MediaSession.ConnectionResult.reject()
      }
      val profile = controllerProfile(session, controller)
      if (profile == RemoteControllerProfile.TRUSTED_BROWSER) ensureServiceOnlyRestore()
      return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
        .setAvailableSessionCommands(remoteCommandPolicy.sessionCommands(profile))
        .setAvailablePlayerCommands(remoteCommandPolicy.playerCommands(profile))
        .build()
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onPlayerCommandRequest(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      playerCommand: Int,
    ): Int {
      if (playerCache.isClearing() || !persistedCoordinator.isReady()) {
        return SessionResult.RESULT_ERROR_INVALID_STATE
      }
      val profile = controllerProfile(session, controller)
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
      return afterServiceOnlyRestore {
        val tree = LoggeRythmPlayerRuntime.browseTree()
        val root = checkNotNull(tree.nodes[tree.rootId]).mediaItem
        LibraryResult.ofItem(root, params)
      }
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
        val parent = tree.nodes[parentId]
        if (parent == null) {
          LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
        } else {
          val from = (page.toLong() * pageSize.toLong())
            .coerceAtMost(parent.childIds.size.toLong())
            .toInt()
          val to = (from.toLong() + pageSize.toLong())
            .coerceAtMost(parent.childIds.size.toLong())
            .toInt()
          val children = parent.childIds.subList(from, to).mapNotNull { tree.nodes[it]?.mediaItem }
          LibraryResult.ofItemList(ImmutableList.copyOf(children), params)
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

    override fun onSetMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: List<MediaItem>,
      startIndex: Int,
      startPositionMs: Long,
    ): ListenableFuture<MediaItemsWithStartPosition> {
      return afterServiceOnlyRestore {
        if (playerCache.isClearing()) throw IllegalStateException("player-cache-clearing")
        if (!persistedCoordinator.isReady()) throw IllegalStateException("player-session-not-ready")
        if (persistedCoordinator.isQueueMutationBlocked()) {
          throw IllegalStateException("playback-event-queue-commit-active")
        }

        val profile = controllerProfile(mediaSession, controller)
        if (
          profile == RemoteControllerProfile.INTERNAL &&
          mediaItems.all { it.localConfiguration != null }
        ) {
          MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs)
        } else {
          // A browse controller may select exactly one published leaf. Ignore every caller-owned
          // URI/metadata field and resolve the direct parent's ordered playable children instead.
          if (
            profile != RemoteControllerProfile.TRUSTED_BROWSER ||
            !remoteCommandPolicy.permits(profile, Player.COMMAND_SET_MEDIA_ITEM) ||
            mediaItems.size != 1
          ) {
            throw SecurityException("media-item-not-available")
          }
          val selection = LoggeRythmPlayerRuntime.playableBrowseSiblings(mediaItems.single().mediaId)
            ?: throw SecurityException("media-item-not-available")
          MediaItemsWithStartPosition(selection.mediaItems, selection.startIndex, 0L)
        }
      }
    }
  }
}
