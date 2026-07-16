package top.logge.loggerythm.player

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

internal data class ControllerTrustSignals(
  val self: Boolean,
  val mediaNotification: Boolean,
  val trusted: Boolean,
  val automotive: Boolean,
  val autoCompanion: Boolean,
  val systemUid: Boolean,
  val trustedLegacyMediaButton: Boolean,
)

@UnstableApi
internal object LoggeRythmControllerPolicy {
  fun accepts(signals: ControllerTrustSignals): Boolean =
    signals.self ||
      signals.mediaNotification ||
      signals.trusted

  fun isSelf(controller: MediaSession.ControllerInfo, appUid: Int, appPackage: String): Boolean =
    controller.uid == appUid && controller.packageName == appPackage

  fun commandProfile(self: Boolean, mediaNotification: Boolean): RemoteControllerProfile = when {
    mediaNotification -> RemoteControllerProfile.NOTIFICATION
    self -> RemoteControllerProfile.INTERNAL
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
  private val remoteCommandPolicy = LoggeRythmRemoteCommandPolicy()
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
    librarySession = MediaLibrarySession.Builder(this, player, LibraryCallback()).build()
    LoggeRythmBrowseTreeServiceBridge.attach(browseTreeObserver)
    LoggeRythmCacheServiceBridge.attach(cacheControl)
    LoggeRythmPersistedServiceBridge.attach(persistedCoordinator)
    LoggeRythmMediaSessionServiceBridge.attach(this)
    cacheControl.onQueueGenerationChanged(LoggeRythmPlayerRuntime.currentQueueGeneration())
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? =
    librarySession.takeIf {
      LoggeRythmControllerPolicy.isAllowed(
        it,
        controllerInfo,
        applicationInfo.uid,
        packageName,
      )
    }

  override fun onDestroy() {
    LoggeRythmMediaSessionServiceBridge.detach(this)
    LoggeRythmPersistedServiceBridge.detach(persistedCoordinator)
    LoggeRythmCacheServiceBridge.detach(cacheControl)
    // Coordinator.close() clears the runtime tree; the session is being released, so detach first.
    LoggeRythmBrowseTreeServiceBridge.detach(browseTreeObserver)
    persistedCoordinator.close()
    player.removeListener(preloadListener)
    librarySession.release()
    player.release()
    playerCache.close()
    super.onDestroy()
  }

  override fun installRemoteCommands(capabilities: Set<RemotePlayerCapability>) {
    if (!persistedCoordinator.isReady()) {
      throw LoggeRythmPersistedPlayerException("player-session-not-ready")
    }
    remoteCommandPolicy.install(capabilities)
    try {
      refreshConnectedControllerCommands()
    } catch (error: Exception) {
      // A partially published policy must never outlive a rejected setup command.
      // The request callback below also consults this reset policy, so even a
      // legacy controller with stale advertised buttons cannot execute them.
      remoteCommandPolicy.reset()
      runCatching(::refreshConnectedControllerCommands)
      throw error
    }
  }

  override fun resetRemoteCommands() {
    remoteCommandPolicy.reset()
    // The in-memory policy is already fail-closed even if a legacy controller
    // cannot consume an availability update during teardown.
    runCatching(::refreshConnectedControllerCommands)
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

  private inner class LibraryCallback : MediaLibrarySession.Callback {
    override fun onConnect(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
    ): MediaSession.ConnectionResult {
      if (!LoggeRythmControllerPolicy.isAllowed(
          session,
          controller,
          applicationInfo.uid,
          packageName,
        )) {
        return MediaSession.ConnectionResult.reject()
      }
      val profile = controllerProfile(session, controller)
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
      val tree = LoggeRythmPlayerRuntime.browseTree()
      val root = checkNotNull(tree.nodes[tree.rootId]).mediaItem
      return Futures.immediateFuture(LibraryResult.ofItem(root, params))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val item = LoggeRythmPlayerRuntime.browseItem(mediaId)
        ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
      return Futures.immediateFuture(LibraryResult.ofItem(item, null))
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
      val tree = LoggeRythmPlayerRuntime.browseTree()
      val parent = tree.nodes[parentId]
        ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
      val from = (page.toLong() * pageSize.toLong()).coerceAtMost(parent.childIds.size.toLong()).toInt()
      val to = (from.toLong() + pageSize.toLong()).coerceAtMost(parent.childIds.size.toLong()).toInt()
      val children = parent.childIds.subList(from, to).mapNotNull { tree.nodes[it]?.mediaItem }
      return Futures.immediateFuture(
        LibraryResult.ofItemList(ImmutableList.copyOf(children), params),
      )
    }

    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: List<MediaItem>,
    ): ListenableFuture<List<MediaItem>> {
      if (playerCache.isClearing()) {
        return Futures.immediateFailedFuture(IllegalStateException("player-cache-clearing"))
      }
      if (!persistedCoordinator.isReady()) {
        return Futures.immediateFailedFuture(IllegalStateException("player-session-not-ready"))
      }
      if (LoggeRythmControllerPolicy.isSelf(
          controller,
          applicationInfo.uid,
          packageName,
        ) && mediaItems.all { it.localConfiguration != null }) {
        return Futures.immediateFuture(mediaItems)
      }
      val resolved = mediaItems.map { requested ->
        LoggeRythmPlayerRuntime.browseItem(requested.mediaId)
          ?: return Futures.immediateFailedFuture(SecurityException("media-item-not-available"))
      }
      return Futures.immediateFuture(resolved)
    }

    override fun onSetMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: List<MediaItem>,
      startIndex: Int,
      startPositionMs: Long,
    ): ListenableFuture<MediaItemsWithStartPosition> {
      if (playerCache.isClearing()) {
        return Futures.immediateFailedFuture(IllegalStateException("player-cache-clearing"))
      }
      if (!persistedCoordinator.isReady()) {
        return Futures.immediateFailedFuture(IllegalStateException("player-session-not-ready"))
      }

      val profile = controllerProfile(mediaSession, controller)
      if (
        profile == RemoteControllerProfile.INTERNAL &&
        mediaItems.all { it.localConfiguration != null }
      ) {
        return Futures.immediateFuture(
          MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs),
        )
      }

      // A browse controller may select exactly one published leaf. Ignore every caller-owned
      // URI/metadata field and resolve the direct parent's ordered playable children instead.
      if (
        profile != RemoteControllerProfile.TRUSTED_BROWSER ||
        !remoteCommandPolicy.permits(profile, Player.COMMAND_SET_MEDIA_ITEM) ||
        mediaItems.size != 1
      ) {
        return Futures.immediateFailedFuture(SecurityException("media-item-not-available"))
      }
      val selection = LoggeRythmPlayerRuntime.playableBrowseSiblings(mediaItems.single().mediaId)
        ?: return Futures.immediateFailedFuture(SecurityException("media-item-not-available"))
      return Futures.immediateFuture(
        MediaItemsWithStartPosition(selection.mediaItems, selection.startIndex, 0L),
      )
    }
  }
}
