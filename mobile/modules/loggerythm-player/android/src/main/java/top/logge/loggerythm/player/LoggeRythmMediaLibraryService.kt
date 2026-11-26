package top.logge.loggerythm.player

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Process
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime
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
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

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
    automotive || autoCompanion -> RemoteControllerProfile.CAR
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

/**
 * Process-local read-only observation hook used by instrumentation tests to attach [Player.Listener]
 * and [AnalyticsListener] directly to the service's live [ExoPlayer] (bypassing client-side
 * [MediaController] masking) without altering playback or security behavior.
 */
@UnstableApi
internal object LoggeRythmExoPlayerObservationHook {
  private var livePlayer: ExoPlayer? = null

  fun attach(player: ExoPlayer) {
    livePlayer = player
  }

  fun detach(player: ExoPlayer) {
    if (livePlayer === player) livePlayer = null
  }

  fun addListeners(playerListener: Player.Listener, analyticsListener: AnalyticsListener): Boolean {
    val active = livePlayer ?: return false
    active.addListener(playerListener)
    active.addAnalyticsListener(analyticsListener)
    return true
  }

  fun removeListeners(playerListener: Player.Listener, analyticsListener: AnalyticsListener) {
    val active = livePlayer ?: return
    active.removeListener(playerListener)
    active.removeAnalyticsListener(analyticsListener)
  }
}

/**
 * Process-local instrumentation seam allowing device tests to supply a TLS-pinned local
 * `MockWebServer` [LoggeRythmVoiceCatalogClient] without relaxing production redirect/TLS rules.
 */
internal object LoggeRythmVoiceCatalogClientHook {
  private val lock = Any()
  private var overrideClient: LoggeRythmVoiceCatalogClient? = null

  fun setForTests(client: LoggeRythmVoiceCatalogClient?) = synchronized(lock) {
    overrideClient = client
  }

  fun current(defaultClient: LoggeRythmVoiceCatalogClient): LoggeRythmVoiceCatalogClient =
    synchronized(lock) { overrideClient } ?: defaultClient
}

@UnstableApi
class LoggeRythmMediaLibraryService :
  MediaLibraryService(),
  LoggeRythmMediaSessionServiceControl {
  private lateinit var player: ExoPlayer
  private lateinit var sessionPlayer: LoggeRythmSessionPlayer
  private lateinit var librarySession: MediaLibrarySession
  private lateinit var playerCache: LoggeRythmPlayerCache
  private lateinit var persistedCoordinator: LoggeRythmPersistedPlayerCoordinator
  private lateinit var remoteCommandInstaller: LoggeRythmDurableRemoteCommandInstaller
  private lateinit var sessionActivity: PendingIntent
  private lateinit var crossfadeController: LoggeRythmDualPlayerCrossfadeController
  private lateinit var djController: LoggeRythmDjTransitionController
  private lateinit var visualizerController: LoggeRythmAudioVisualizerController
  private val audioEffects = LoggeRythmAudioEffectsController()
  private val mainHandler = Handler(Looper.getMainLooper())
  private val voiceSearchExecutor: ExecutorService = Executors.newSingleThreadExecutor { task ->
    Thread(
      {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
        task.run()
      },
      "LoggeRythmVoiceCatalog",
    )
  }
  private val defaultVoiceCatalogClient = LoggeRythmVoiceCatalogClient()
  private val voiceItemSequence = AtomicLong(0)
  private val failedLegacySearchErrors = linkedMapOf<String, LoggeRythmCarError>()
  private val remoteCommandPolicy = LoggeRythmRemoteCommandPolicy()
  private val notificationFavorite = LoggeRythmNotificationFavoriteCoordinator()
  private var remotePolicyExplicitlyReset = false
  private var serviceDestroyed = false
  private var idleNotificationSuppressed = false
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

    override fun clearRollingCacheOnly(callback: (Result<LoggeRythmCacheClearResult>) -> Unit) {
      playerCache.clearRollingCacheOnly(callback)
    }

    override fun cacheMetrics(): LoggeRythmRollingCacheMetrics = playerCache.cacheMetrics()
  }
  private val audioCraftControl = object : LoggeRythmAudioCraftServiceControl {
    override fun getAudioSessionId(): Int = player.audioSessionId

    override fun getEqualizerState(): LoggeRythmEqualizerState {
      syncAudioSessionId(player.audioSessionId)
      return audioEffects.getEqualizerState()
    }

    override fun setEqualizerEnabled(enabled: Boolean): LoggeRythmEqualizerState {
      syncAudioSessionId(player.audioSessionId)
      return audioEffects.setEqualizerEnabled(enabled)
    }

    override fun setEqualizerBandLevel(bandIndex: Int, levelMb: Int): LoggeRythmEqualizerState {
      syncAudioSessionId(player.audioSessionId)
      return audioEffects.setEqualizerBandLevel(bandIndex, levelMb)
    }

    override fun setEqualizerBandLevels(levelsMb: List<Int>): LoggeRythmEqualizerState {
      syncAudioSessionId(player.audioSessionId)
      return audioEffects.setEqualizerBandLevels(levelsMb)
    }

    override fun setEqualizerPreset(presetName: String): LoggeRythmEqualizerState {
      syncAudioSessionId(player.audioSessionId)
      return audioEffects.setEqualizerPreset(presetName)
    }

    override fun getBassBoostState(): LoggeRythmBassBoostState {
      syncAudioSessionId(player.audioSessionId)
      return audioEffects.getBassBoostState()
    }

    override fun setBassBoost(enabled: Boolean, strength: Int): LoggeRythmBassBoostState {
      syncAudioSessionId(player.audioSessionId)
      return audioEffects.setBassBoost(enabled, strength)
    }

    override fun getLoudnessConfig(): LoggeRythmLoudnessState = audioEffects.getLoudnessState()

    override fun setLoudnessConfig(enabled: Boolean, preset: String): LoggeRythmLoudnessState {
      syncAudioSessionId(player.audioSessionId)
      val activeExtras = player.currentMediaItem?.mediaId?.let(LoggeRythmPlayerRuntime::extrasFor) ?: "{}"
      val isFading = persistedCoordinator.isSleepFading()
      val (state, volumeScale) = audioEffects.setLoudnessConfig(
        enabled = enabled,
        presetName = preset,
        activeExtrasJson = activeExtras,
        isSleepFading = isFading,
      )
      if (
        !isFading &&
        !crossfadeController.isCrossfadeActive() &&
        !djController.ownsPrimaryVolume() &&
        player.volume != volumeScale
      ) {
        player.volume = volumeScale
      }
      return state
    }

    override fun getPlaybackSpeed(): LoggeRythmPlaybackSpeedState = LoggeRythmPlaybackSpeedState(
      speed = player.playbackParameters.speed,
      pitch = player.playbackParameters.pitch,
    )

    override fun setPlaybackSpeed(speed: Float, pitch: Float): LoggeRythmPlaybackSpeedState {
      LoggeRythmAudioEffectsController.validatePlaybackParameters(speed, pitch)
      player.playbackParameters = PlaybackParameters(speed, pitch)
      return getPlaybackSpeed()
    }

    override fun getCrossfadeConfig(): LoggeRythmCrossfadeConfig = crossfadeController.currentConfig()

    override fun setCrossfadeConfig(
      enabled: Boolean,
      durationSec: Double,
    ): LoggeRythmCrossfadeConfig {
      val validated = LoggeRythmCrossfadeConfig.validated(enabled, durationSec)
      crossfadeController.setConfig(validated)
      return validated
    }

    override fun getDjTransitionsEnabled(): Boolean = djController.isEnabled()

    override fun setDjTransitionsEnabled(enabled: Boolean): Boolean {
      djController.setEnabled(enabled)
      return djController.isEnabled()
    }

    override fun setRemoteVolumeControl(
      active: Boolean,
      currentVolume: Int,
      maxVolume: Int,
      muted: Boolean,
    ): LoggeRythmRemoteVolumeState {
      val updated = sessionPlayer.setRemoteVolumeControl(
        active = active,
        currentVolume = currentVolume,
        maxVolume = maxVolume,
        muted = muted,
      )
      runCatching(::refreshConnectedControllerCommands)
      return updated
    }

    override fun getRemoteVolumeState(): LoggeRythmRemoteVolumeState =
      sessionPlayer.remoteVolumeState()

    override fun setVisualizerEnabled(enabled: Boolean): LoggeRythmVisualizerState {
      syncAudioSessionId(player.audioSessionId)
      return visualizerController.setEnabled(enabled)
    }

    override fun getVisualizerState(): LoggeRythmVisualizerState {
      syncAudioSessionId(player.audioSessionId)
      return visualizerController.state()
    }

    override fun resetForAccountBoundary() {
      if (serviceDestroyed) return
      crossfadeController.setConfig(crossfadeController.currentConfig().copy(enabled = false))
      djController.setEnabled(false)
      visualizerController.setEnabled(false)
      sessionPlayer.setRemoteVolumeControl(
        active = false,
        currentVolume = 50,
        maxVolume = 100,
        muted = false,
      )
      runCatching(::refreshConnectedControllerCommands)
      LoggeRythmWidgetUpdater.clearForAccountBoundary(this@LoggeRythmMediaLibraryService)
    }
  }
  private val audioSessionAnalyticsListener = object : AnalyticsListener {
    override fun onAudioSessionIdChanged(eventTime: EventTime, audioSessionId: Int) {
      syncAudioSessionId(audioSessionId)
    }
  }
  private val voiceServiceControl = object : LoggeRythmVoiceServiceControl {
    override fun executePlayMusic(
      request: LoggeRythmVoiceQuery,
      callback: (Result<LoggeRythmVoicePlayResult>) -> Unit,
    ) = handleVoicePlayMusic(request, callback)

    override fun executeControlPlayback(
      action: LoggeRythmVoicePlaybackAction,
      callback: (Result<LoggeRythmVoiceNowPlaying>) -> Unit,
    ) = handleVoiceControlPlayback(action, callback)

    override fun executeQueueMusic(
      request: LoggeRythmVoiceQuery,
      position: LoggeRythmVoiceQueuePosition,
      callback: (Result<LoggeRythmVoiceQueueResult>) -> Unit,
    ) = handleVoiceQueueMusic(request, position, callback)

    override fun executeSetCurrentTrackFavorite(
      liked: Boolean,
      callback: (Result<LoggeRythmVoiceFavoriteResult>) -> Unit,
    ) = handleVoiceSetCurrentTrackFavorite(liked, callback)

    override fun executeGetNowPlaying(
      callback: (Result<LoggeRythmVoiceNowPlaying>) -> Unit,
    ) = handleVoiceGetNowPlaying(callback)

    override fun executeStartRadio(
      moodOrGenre: String?,
      callback: (Result<LoggeRythmVoicePlayResult>) -> Unit,
    ) = handleVoiceStartRadio(moodOrGenre, callback)

    override fun executeSetSleepTimer(
      minutes: Int,
      callback: (Result<LoggeRythmVoiceSleepTimerResult>) -> Unit,
    ) = handleVoiceSetSleepTimer(minutes, callback)
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
      if (
        events.contains(Player.EVENT_TIMELINE_CHANGED) ||
        events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) ||
        events.contains(Player.EVENT_IS_PLAYING_CHANGED) ||
        events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)
      ) {
        publishWidgetSnapshot()
      }
      if (
        idleNotificationSuppressed &&
        events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED) &&
        player.playbackState != Player.STATE_IDLE
      ) {
        // Playback was prepared again after a closed session: restore Media3's default so a
        // later stop or error keeps its retry notification.
        idleNotificationSuppressed = false
        setShowNotificationForIdlePlayer(SHOW_NOTIFICATION_FOR_IDLE_PLAYER_AFTER_STOP_OR_ERROR)
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
    player.addAnalyticsListener(audioSessionAnalyticsListener)
    sessionPlayer = LoggeRythmSessionPlayer(player)
    visualizerController = LoggeRythmAudioVisualizerController(this)
    syncAudioSessionId(player.audioSessionId)
    persistedCoordinator = LoggeRythmPersistedPlayerCoordinator(
      context = this,
      player = player,
      clearCache = playerCache::clearCache,
      onFavoriteStateChanged = ::syncAndRefreshNotificationFavoriteButtons,
      onFavoriteSyncFailed = ::reportCarFavoriteUpdateFailed,
      applyLoudnessForMediaId = { mediaId, isSleepFading ->
        val extras = mediaId?.let(LoggeRythmPlayerRuntime::extrasFor) ?: "{}"
        audioEffects.applyTrackLoudness(extras, isSleepFading)
      },
      onSleepFadeStarted = {
        // the DJ deck must hand the audio back before the fade reads the primary's volume
        djController.abortForSleepFade()
        audioEffects.resetLoudnessBoostForFade()
      },
    )
    val loudnessPlanForMediaId: (String?) -> LoggeRythmLoudnessPlan = { mediaId ->
      val extras = mediaId?.let(LoggeRythmPlayerRuntime::extrasFor) ?: "{}"
      LoggeRythmLoudnessNormalization.computePlan(
        extrasJson = extras,
        enabled = audioEffects.getLoudnessState().enabled,
        preset = LoggeRythmLoudnessPreset.parse(audioEffects.getLoudnessState().preset),
      )
    }
    val loudnessScaleForMediaId: (String?) -> Float = { mediaId -> loudnessPlanForMediaId(mediaId).volumeScale }
    djController = LoggeRythmDjTransitionController(
      context = this,
      primaryPlayer = player,
      audioAttributes = audioAttributes,
      isSleepFading = persistedCoordinator::isSleepFading,
      sleepsAfterCurrentItem = persistedCoordinator::sleepsAfterCurrentItem,
      isCrossfadeActive = { crossfadeController.isCrossfadeActive() },
      loudnessPlanForMediaId = loudnessPlanForMediaId,
      restorePrimaryLoudness = persistedCoordinator::refreshLoudnessGain,
    )
    persistedCoordinator.primaryVolumeOwnedElsewhere = djController::ownsPrimaryVolume
    crossfadeController = LoggeRythmDualPlayerCrossfadeController(
      context = this,
      primaryPlayer = player,
      playerCache = playerCache,
      audioAttributes = audioAttributes,
      isSleepFading = persistedCoordinator::isSleepFading,
      loudnessScaleForMediaId = loudnessScaleForMediaId,
      restorePrimaryLoudness = persistedCoordinator::refreshLoudnessGain,
      isTransitionClaimed = djController::claimsTransition,
    )
    sessionActivity = LoggeRythmSessionActivity.pendingIntent(this)
    librarySession = MediaLibrarySession.Builder(this, sessionPlayer, LibraryCallback())
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
    LoggeRythmVoiceServiceBridge.attach(voiceServiceControl)
    LoggeRythmAudioCraftServiceBridge.attach(audioCraftControl)
    LoggeRythmExoPlayerObservationHook.attach(player)
    cacheControl.onQueueGenerationChanged(LoggeRythmPlayerRuntime.currentQueueGeneration())
    publishWidgetSnapshot()
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
    failedLegacySearchErrors.clear()
    voiceSearchExecutor.shutdownNow()
    LoggeRythmExoPlayerObservationHook.detach(player)
    LoggeRythmAudioCraftServiceBridge.detach(audioCraftControl)
    LoggeRythmVoiceServiceBridge.detach(voiceServiceControl)
    LoggeRythmMediaSessionServiceBridge.detach(this)
    LoggeRythmPersistedServiceBridge.detach(persistedCoordinator)
    LoggeRythmCacheServiceBridge.detach(cacheControl)
    // Coordinator.close() clears the runtime tree; the session is being released, so detach first.
    LoggeRythmBrowseTreeServiceBridge.detach(browseTreeObserver)
    crossfadeController.release()
    djController.release()
    visualizerController.release()
    audioEffects.release()
    remoteCommandInstaller.close()
    persistedCoordinator.close()
    serviceOnlyRestoreState = ServiceOnlyRestoreState.FAILED
    finishServiceOnlyRestoreWaiters()
    player.removeAnalyticsListener(audioSessionAnalyticsListener)
    player.removeListener(preloadListener)
    librarySession.release()
    player.release()
    playerCache.close()
    super.onDestroy()
  }

  private fun syncAudioSessionId(sessionId: Int) {
    audioEffects.onAudioSessionIdChanged(sessionId)
    if (::visualizerController.isInitialized) {
      visualizerController.onAudioSessionIdChanged(sessionId)
    }
  }

  private fun publishWidgetSnapshot() {
    if (serviceDestroyed || !::player.isInitialized) return
    val activeItem = player.currentMediaItem
    val activeMediaId = activeItem?.mediaId
    val trackId = if (activeMediaId != null && ::persistedCoordinator.isInitialized) {
      persistedCoordinator.resolveTrackIdForMediaId(activeMediaId)
        ?: extractTrackIdFromExtras(LoggeRythmPlayerRuntime.extrasFor(activeMediaId))
    } else {
      null
    }
    if (::persistedCoordinator.isInitialized) syncNotificationFavoriteProjection()
    val favorite = notificationFavorite.stateFor(activeMediaId, trackId)
    runCatching {
      LoggeRythmWidgetUpdater.publishSnapshot(
        this,
        LoggeRythmWidgetSnapshot(
          hasActiveTrack = activeItem != null,
          title = activeItem?.mediaMetadata?.title?.toString(),
          artist = activeItem?.mediaMetadata?.artist?.toString(),
          artworkUrl = activeItem?.mediaMetadata?.artworkUri?.toString(),
          isPlaying = player.isPlaying,
          liked = favorite?.liked,
        ),
      )
    }
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
    notificationFavorite.clearAll()
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

  /**
   * The app UI is gone (task swiped away, activity destroyed). Ongoing playback continues in the
   * background. Otherwise the session is closed: the app's own controller keeps this service
   * bound inside the process, so Media3's stopSelf() alone would leave the paused session and its
   * non-dismissible media notification (and OEM mini players built on it) alive indefinitely.
   * Stopping keeps the queue and position; they stay persisted and playable.
   */
  override fun closeSessionUnlessPlaying() {
    if (serviceDestroyed) return
    if (
      LoggeRythmSessionClosePolicy.keepsSessionWithoutUi(
        playWhenReady = player.playWhenReady,
        playbackState = player.playbackState,
      )
    ) {
      return
    }
    idleNotificationSuppressed = true
    // An idle player then has no notification, which also ends Media3's paused foreground hold.
    setShowNotificationForIdlePlayer(SHOW_NOTIFICATION_FOR_IDLE_PLAYER_NEVER)
    // A finished queue still has playWhenReady set; a later prepare must not start on its own.
    player.pause()
    player.stop()
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

  private fun syncNotificationFavoriteProjection() {
    if (!::persistedCoordinator.isInitialized) return
    val (likedIds, pending) = persistedCoordinator.currentFavoriteProjection()
    notificationFavorite.syncAuthoritativeState(likedIds, pending)
  }

  private fun syncAndRefreshNotificationFavoriteButtons() {
    if (serviceDestroyed || !::librarySession.isInitialized) return
    syncNotificationFavoriteProjection()
    refreshNotificationFavoriteButtons()
    publishWidgetSnapshot()
  }

  private fun reportCarFavoriteUpdateFailed() {
    if (serviceDestroyed || !::librarySession.isInitialized) return
    val sessionError = carSessionError(LoggeRythmCarError.FAVORITE_UPDATE_FAILED, null)
    val platformMirror = librarySession.mediaNotificationControllerInfo
    if (platformMirror != null) {
      librarySession.sendError(platformMirror, sessionError)
    }
    librarySession.connectedControllers.forEach { controller ->
      val profile = controllerProfile(librarySession, controller)
      val legacy = controller.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION
      if (!legacy && profile == RemoteControllerProfile.CAR && controller != platformMirror) {
        librarySession.sendError(controller, sessionError)
      } else if (legacy && platformMirror == null && profile == RemoteControllerProfile.CAR) {
        librarySession.sendError(controller, sessionError)
      }
    }
  }

  private fun refreshConnectedControllerCommands() {
    syncNotificationFavoriteProjection()
    val remoteVolumeActive = sessionPlayer.remoteVolumeState().active
    librarySession.connectedControllers.forEach { controller ->
      val profile = controllerProfile(librarySession, controller)
      val basePlayerCommands = remoteCommandPolicy.playerCommands(profile)
      val playerCommands = if (remoteVolumeActive) {
        basePlayerCommands.buildUpon()
          .add(Player.COMMAND_GET_DEVICE_VOLUME)
          .add(Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS)
          .add(Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS)
          .build()
      } else {
        basePlayerCommands
      }
      librarySession.setAvailableCommands(
        controller,
        remoteCommandPolicy.sessionCommands(profile),
        playerCommands,
      )
      if (
        profile.supportsFavorite &&
        controller.controllerVersion != MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION
      ) {
        librarySession.setMediaButtonPreferences(
          controller,
          notificationFavoriteButtons(profile),
        )
      }
    }
  }

  private fun notificationFavoriteButtons(profile: RemoteControllerProfile): List<CommandButton> {
    if (!profile.supportsFavorite) return emptyList()
    syncNotificationFavoriteProjection()
    val activeMediaId = player.currentMediaItem?.mediaId
    val activeTrackId = activeMediaId?.let(persistedCoordinator::resolveTrackIdForMediaId)
    return notificationFavorite.buttonFor(activeMediaId, activeTrackId)
  }

  private fun refreshNotificationFavoriteButtons(
    callback: ((Result<Unit>) -> Unit)? = null,
  ) {
    val futures = librarySession.connectedControllers.mapNotNull { controller ->
      val profile = controllerProfile(librarySession, controller)
      // Platform car controllers read the notification controller's mirrored PlaybackState.
      // Only Media3 controllers receive their own preference updates.
      if (
        !profile.supportsFavorite ||
        controller.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION
      ) {
        return@mapNotNull null
      }
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
   * Resolves a car/library play request from IDs or a voice query against the local browse tree
   * first, then explicitly falls back to authenticated live catalog search when a session cookie
   * is vaulted. Caller-supplied URIs, metadata, start index and position are never used.
   */
  private fun resolveLibraryPlayRequestAsync(
    profile: RemoteControllerProfile,
    mediaItems: List<MediaItem>,
  ): ListenableFuture<MediaItemsWithStartPosition> {
    return try {
      when (profile) {
        RemoteControllerProfile.NOTIFICATION ->
          throw LoggeRythmCarRequestException(LoggeRythmCarError.UNSUPPORTED_REQUEST)
        RemoteControllerProfile.CAR, RemoteControllerProfile.TRUSTED_BROWSER ->
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
        val localBrowse = LoggeRythmPlayerRuntime.playableBrowseSiblings(mediaId)
          ?: LoggeRythmPlayerRuntime.playableBrowseChildren(mediaId)
        if (localBrowse != null) {
          return Futures.immediateFuture(validatedCarSelection(localBrowse))
        }
        val voiceSearch = LoggeRythmPlayerRuntime.playableVoiceSearchSelection(mediaId)
          ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.MEDIA_ITEM_UNAVAILABLE)
        return Futures.immediateFuture(
          MediaItemsWithStartPosition(voiceSearch.mediaItems, voiceSearch.startIndex, 0L),
        )
      }

      val voiceQuery = LoggeRythmVoiceQuery.fromMedia3(
        searchQuery = requested.requestMetadata.searchQuery,
        extras = requested.requestMetadata.extras,
      )
      if (requested.requestMetadata.searchQuery == null && voiceQuery.isBlank()) {
        throw LoggeRythmCarRequestException(LoggeRythmCarError.UNSUPPORTED_REQUEST)
      }
      if (voiceQuery.isBlank()) {
        return Futures.immediateFuture(resumableQueue())
      }

      val tree = LoggeRythmPlayerRuntime.browseTree()
      val localSelection = LoggeRythmLibrarySearch.resolveStructuredLocalPlay(tree, voiceQuery)
      if (localSelection != null) {
        return Futures.immediateFuture(validatedCarSelection(localSelection))
      }

      val future = SettableFuture.create<MediaItemsWithStartPosition>()
      resolveLiveCatalogPlaySelection(
        request = voiceQuery,
        tree = tree,
        mediaIdPrefix = "voice:car:${voiceItemSequence.incrementAndGet()}",
      ) { result ->
        result.fold(
          onSuccess = { selection ->
            try {
              requireQueueReplacementAdmitted()
              val stagedItems = LoggeRythmPlayerRuntime.stageVoiceSelection(selection.items)
              future.set(MediaItemsWithStartPosition(stagedItems, selection.startIndex, 0L))
            } catch (error: Throwable) {
              future.setException(error)
            }
          },
          onFailure = { error ->
            future.setException(mapVoiceErrorToCarException(error, voiceQuery.effectiveQuery()))
          },
        )
      }
      future
    } catch (error: Throwable) {
      Futures.immediateFailedFuture(error)
    }
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

  private fun voiceCatalogClient(): LoggeRythmVoiceCatalogClient =
    LoggeRythmVoiceCatalogClientHook.current(defaultVoiceCatalogClient)

  private fun resolveLiveCatalogPlaySelection(
    request: LoggeRythmVoiceQuery,
    tree: RuntimeBrowseTree,
    mediaIdPrefix: String,
    callback: (Result<LoggeRythmVoiceCatalogSelection>) -> Unit,
  ) {
    val originalBinding = LoggeRythmPlayerRuntime.currentSessionBinding()
    if (originalBinding == null) {
      callback(
        Result.failure(
          LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, "voice-signed-out"),
        ),
      )
      return
    }
    val auth = try {
      LoggeRythmPlayerRuntime.sessionCookieForCurrentOrigin()
    } catch (error: Exception) {
      callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
      return
    }
    if (auth == null) {
      val hasLocalPlayableItems = tree.nodes.values.any { it.source != null }
      val code = if (hasLocalPlayableItems) {
        LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH
      } else {
        LoggeRythmVoiceErrorCode.AUTH_REQUIRED
      }
      callback(Result.failure(LoggeRythmVoiceException(code, "voice-no-remote-session")))
      return
    }
    val (origin, cookie) = auth
    val client = voiceCatalogClient()
    try {
      voiceSearchExecutor.execute {
        val result = runCatching {
          client.resolveForPlayback(
            origin = origin,
            cookie = cookie,
            request = request,
            mediaIdPrefix = mediaIdPrefix,
          )
        }
        mainHandler.post {
          if (serviceDestroyed) {
            callback(
              Result.failure(
                LoggeRythmVoiceException(
                  LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
                  "voice-service-destroyed",
                ),
              ),
            )
            return@post
          }
          if (LoggeRythmPlayerRuntime.currentSessionBinding() != originalBinding) {
            callback(
              Result.failure(
                LoggeRythmVoiceException(
                  LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
                  "voice-session-changed",
                ),
              ),
            )
            return@post
          }
          callback(result)
        }
      }
    } catch (error: Exception) {
      callback(
        Result.failure(
          LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
            "voice-executor-unavailable",
            error,
          ),
        ),
      )
    }
  }

  private fun executeLiveBrowseSearch(
    query: String,
    callback: (Result<List<MediaItem>>) -> Unit,
  ) {
    val normalizedKey = LoggeRythmLibrarySearch.normalize(query)
    if (normalizedKey.isEmpty()) {
      callback(Result.success(emptyList()))
      return
    }
    val originalBinding = LoggeRythmPlayerRuntime.currentSessionBinding()
    if (originalBinding == null) {
      callback(
        Result.failure(
          LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, "search-signed-out"),
        ),
      )
      return
    }
    val auth = try {
      LoggeRythmPlayerRuntime.sessionCookieForCurrentOrigin()
    } catch (error: Exception) {
      callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
      return
    }
    if (auth == null) {
      val hasLocalPlayableItems = LoggeRythmPlayerRuntime.browseTree().nodes.values.any { it.source != null }
      if (hasLocalPlayableItems) {
        callback(Result.success(emptyList()))
      } else {
        callback(
          Result.failure(
            LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, "search-no-remote-session"),
          ),
        )
      }
      return
    }
    val (origin, cookie) = auth
    val client = voiceCatalogClient()
    val prefix = "voice:search:${voiceItemSequence.incrementAndGet()}"
    try {
      voiceSearchExecutor.execute {
        val fetched = runCatching {
          client.searchTracksForBrowse(
            origin = origin,
            cookie = cookie,
            query = query,
            mediaIdPrefix = prefix,
          )
        }
        mainHandler.post {
          if (serviceDestroyed || LoggeRythmPlayerRuntime.currentSessionBinding() != originalBinding) {
            callback(
              Result.failure(
                LoggeRythmVoiceException(
                  LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
                  "search-session-changed",
                ),
              ),
            )
            return@post
          }
          callback(
            fetched.mapCatching { specs ->
              LoggeRythmPlayerRuntime.installVoiceSearchResults(normalizedKey, specs)
            },
          )
        }
      }
    } catch (error: Exception) {
      callback(
        Result.failure(
          LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
            "search-executor-unavailable",
            error,
          ),
        ),
      )
    }
  }

  private fun mergeLocalAndLiveSearchResults(
    tree: RuntimeBrowseTree,
    localIds: List<String>,
    liveItems: List<MediaItem>,
  ): List<MediaItem> {
    val merged = mutableListOf<MediaItem>()
    val seenTrackIds = mutableSetOf<String>()
    localIds.forEach { id ->
      val node = tree.nodes[id] ?: return@forEach
      merged += node.mediaItem
      node.source?.let { source ->
        extractTrackIdFromExtras(source.extrasJson)?.let(seenTrackIds::add)
      }
    }
    liveItems.forEach { item ->
      val trackId = extractTrackIdFromExtras(LoggeRythmPlayerRuntime.extrasFor(item.mediaId))
      if (trackId == null || seenTrackIds.add(trackId)) {
        merged += item
      }
    }
    return merged
  }

  private fun extractTrackIdFromExtras(extrasJson: String): String? = try {
    JSONObject(extrasJson).optJSONObject("track")?.optString("id")?.takeIf(String::isNotBlank)
  } catch (_: Exception) {
    null
  }

  private fun mapVoiceErrorToCarException(
    error: Throwable,
    queryArgument: String?,
  ): LoggeRythmCarRequestException = when (error) {
    is LoggeRythmCarRequestException -> error
    is LoggeRythmVoiceException -> when (error.code) {
      LoggeRythmVoiceErrorCode.AUTH_REQUIRED ->
        LoggeRythmCarRequestException(LoggeRythmCarError.SIGNED_OUT)
      LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH ->
        LoggeRythmCarRequestException(LoggeRythmCarError.SEARCH_NO_MATCH, queryArgument)
      LoggeRythmVoiceErrorCode.NETWORK_ERROR ->
        LoggeRythmCarRequestException(LoggeRythmCarError.SEARCH_NETWORK_ERROR)
      LoggeRythmVoiceErrorCode.BUSY ->
        LoggeRythmCarRequestException(LoggeRythmCarError.QUEUE_COMMIT_ACTIVE)
      LoggeRythmVoiceErrorCode.CONTROLS_NOT_READY ->
        LoggeRythmCarRequestException(LoggeRythmCarError.CONTROLS_NOT_READY)
      LoggeRythmVoiceErrorCode.NOTHING_TO_PLAY ->
        LoggeRythmCarRequestException(LoggeRythmCarError.NOTHING_TO_PLAY)
      else -> LoggeRythmCarRequestException(LoggeRythmCarError.SESSION_NOT_READY)
    }
    else -> LoggeRythmCarRequestException(LoggeRythmCarError.SEARCH_NETWORK_ERROR)
  }

  private fun buildNowPlayingSnapshot(): LoggeRythmVoiceNowPlaying {
    syncNotificationFavoriteProjection()
    val count = player.mediaItemCount
    val rawIndex = player.currentMediaItemIndex
    val activeItem = player.currentMediaItem
    val validIndex = if (count > 0 && activeItem != null && rawIndex in 0 until count) rawIndex else null
    val activeMediaId = activeItem?.mediaId
    val trackId = activeMediaId?.let { id ->
      persistedCoordinator.resolveTrackIdForMediaId(id)
        ?: extractTrackIdFromExtras(LoggeRythmPlayerRuntime.extrasFor(id))
    }
    val favoriteState = notificationFavorite.stateFor(activeMediaId, trackId)
    val durationMs = player.duration.takeIf { it != C.TIME_UNSET && it >= 0L }
      ?: activeItem?.mediaMetadata?.durationMs?.takeIf { it >= 0L }
    val summary = if (activeItem != null) {
      trackSummaryFromMediaItem(activeItem, trackId, durationMs)
    } else {
      null
    }
    val state = when (player.playbackState) {
      Player.STATE_BUFFERING -> LoggeRythmVoicePlaybackState.BUFFERING
      Player.STATE_READY -> LoggeRythmVoicePlaybackState.READY
      Player.STATE_ENDED -> LoggeRythmVoicePlaybackState.ENDED
      else -> LoggeRythmVoicePlaybackState.IDLE
    }
    return LoggeRythmVoiceNowPlaying(
      hasActiveTrack = summary != null,
      track = summary,
      isPlaying = player.isPlaying,
      playWhenReady = player.playWhenReady,
      playbackState = state,
      positionMs = player.currentPosition.coerceAtLeast(0L),
      durationMs = durationMs,
      liked = favoriteState?.liked,
      queueSize = count,
      currentIndex = validIndex,
    )
  }

  private fun trackSummaryFromMediaItem(
    item: MediaItem,
    trackId: String?,
    fallbackDurationMs: Long? = null,
  ): LoggeRythmVoiceTrackSummary = LoggeRythmVoiceTrackSummary(
    mediaId = item.mediaId,
    trackId = trackId,
    title = item.mediaMetadata.title?.toString().orEmpty(),
    artist = item.mediaMetadata.artist?.toString().orEmpty(),
    album = item.mediaMetadata.albumTitle?.toString().orEmpty(),
    durationMs = item.mediaMetadata.durationMs?.takeIf { it >= 0L } ?: fallbackDurationMs,
    artworkUrl = item.mediaMetadata.artworkUri?.toString(),
  )

  private fun trackSummaryFromSpec(spec: PlayerItemSpec): LoggeRythmVoiceTrackSummary =
    LoggeRythmVoiceTrackSummary(
      mediaId = spec.id,
      trackId = extractTrackIdFromExtras(spec.extrasJson),
      title = spec.title.orEmpty(),
      artist = spec.artist.orEmpty(),
      album = spec.album.orEmpty(),
      durationMs = spec.durationMs,
      artworkUrl = spec.artworkUrl,
    )

  private fun specsFromLocalBrowseSelection(
    selection: RuntimeBrowseSelection,
    uniquePrefix: String,
  ): List<PlayerItemSpec> {
    val tree = LoggeRythmPlayerRuntime.browseTree()
    return selection.mediaItems.mapIndexed { index, item ->
      val source = tree.nodes[item.mediaId]?.source
        ?: throw LoggeRythmCarRequestException(LoggeRythmCarError.MEDIA_ITEM_UNAVAILABLE)
      if (!LoggeRythmCarLibraryState.hasPhoneTrackMetadata(source.extrasJson)) {
        throw LoggeRythmCarRequestException(LoggeRythmCarError.LIBRARY_REFRESH_REQUIRED)
      }
      val trackId = extractTrackIdFromExtras(source.extrasJson) ?: "item"
      source.copy(id = "$uniquePrefix:$index:$trackId")
    }
  }

  private fun runAfterRestoreForVoice(
    onFailure: (LoggeRythmVoiceException) -> Unit,
    onReady: () -> Unit,
  ) {
    Futures.addCallback(
      afterServiceOnlyRestore { Unit },
      object : FutureCallback<Unit> {
        override fun onSuccess(ignored: Unit?) {
          if (serviceDestroyed) {
            onFailure(
              LoggeRythmVoiceException(
                LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
                "voice-service-destroyed",
              ),
            )
            return
          }
          onReady()
        }

        override fun onFailure(error: Throwable) {
          onFailure(
            LoggeRythmVoiceException(
              LoggeRythmVoiceBridge.mapCarError(notReadyError()),
              notReadyError().code,
              error,
            ),
          )
        }
      },
      MoreExecutors.directExecutor(),
    )
  }

  private fun handleVoiceGetNowPlaying(
    callback: (Result<LoggeRythmVoiceNowPlaying>) -> Unit,
  ) {
    runAfterRestoreForVoice(onFailure = { callback(Result.failure(it)) }) {
      val unavailable = rootUnavailable()
      if (unavailable != null) {
        callback(
          Result.failure(
            LoggeRythmVoiceException(
              LoggeRythmVoiceBridge.mapCarError(unavailable),
              unavailable.code,
            ),
          ),
        )
        return@runAfterRestoreForVoice
      }
      if (!persistedCoordinator.isReady()) {
        val error = notReadyError()
        callback(
          Result.failure(
            LoggeRythmVoiceException(LoggeRythmVoiceBridge.mapCarError(error), error.code),
          ),
        )
        return@runAfterRestoreForVoice
      }
      callback(Result.success(buildNowPlayingSnapshot()))
    }
  }

  private fun handleVoiceControlPlayback(
    action: LoggeRythmVoicePlaybackAction,
    callback: (Result<LoggeRythmVoiceNowPlaying>) -> Unit,
  ) {
    runAfterRestoreForVoice(onFailure = { callback(Result.failure(it)) }) {
      try {
        rootUnavailable()?.let { throw LoggeRythmCarRequestException(it) }
        if (playerCache.isClearing()) throw LoggeRythmCarRequestException(LoggeRythmCarError.CACHE_CLEARING)
        if (!persistedCoordinator.isReady()) throw LoggeRythmCarRequestException(notReadyError())
        when (action) {
          LoggeRythmVoicePlaybackAction.PLAY -> {
            if (player.mediaItemCount == 0) {
              requireQueueReplacementAdmitted()
              val queue = resumableQueue()
              player.setMediaItems(queue.mediaItems, queue.startIndex, queue.startPositionMs)
              player.prepare()
            } else {
              if (player.playbackState == Player.STATE_ENDED) {
                player.seekToDefaultPosition()
              }
              if (
                LoggeRythmSessionClosePolicy.requiresPrepareBeforePlay(
                  playbackState = player.playbackState,
                  hasPlayerError = player.playerError != null,
                  mediaItemCount = player.mediaItemCount,
                )
              ) {
                player.prepare()
              }
            }
            player.play()
          }
          LoggeRythmVoicePlaybackAction.PAUSE -> {
            if (player.mediaItemCount == 0) {
              throw LoggeRythmVoiceException(
                LoggeRythmVoiceErrorCode.NO_ACTIVE_TRACK,
                "voice-no-active-track",
              )
            }
            player.pause()
          }
          LoggeRythmVoicePlaybackAction.NEXT -> {
            if (!player.hasNextMediaItem()) {
              throw LoggeRythmVoiceException(
                LoggeRythmVoiceErrorCode.QUEUE_UNAVAILABLE,
                "voice-no-next-track",
              )
            }
            player.seekToNextMediaItem()
          }
          LoggeRythmVoicePlaybackAction.PREVIOUS -> {
            when {
              player.hasPreviousMediaItem() -> player.seekToPreviousMediaItem()
              player.mediaItemCount > 0 -> player.seekTo(0L)
              else -> throw LoggeRythmVoiceException(
                LoggeRythmVoiceErrorCode.NO_ACTIVE_TRACK,
                "voice-no-active-track",
              )
            }
          }
          LoggeRythmVoicePlaybackAction.STOP -> {
            player.stop()
          }
        }
        callback(Result.success(buildNowPlayingSnapshot()))
      } catch (error: Throwable) {
        callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
      }
    }
  }

  private fun handleVoicePlayMusic(
    request: LoggeRythmVoiceQuery,
    callback: (Result<LoggeRythmVoicePlayResult>) -> Unit,
  ) {
    runAfterRestoreForVoice(onFailure = { callback(Result.failure(it)) }) {
      try {
        rootUnavailable()?.let { throw LoggeRythmCarRequestException(it) }
        requireQueueReplacementAdmitted()
        if (request.isBlank()) {
          if (player.mediaItemCount > 0) {
            if (player.playbackState == Player.STATE_ENDED) {
              player.seekToDefaultPosition()
            }
            if (
              LoggeRythmSessionClosePolicy.requiresPrepareBeforePlay(
                playbackState = player.playbackState,
                hasPlayerError = player.playerError != null,
                mediaItemCount = player.mediaItemCount,
              )
            ) {
              player.prepare()
            }
            player.play()
            val snapshot = buildNowPlayingSnapshot()
            callback(
              Result.success(
                LoggeRythmVoicePlayResult(
                  source = "resume",
                  matchedTitle = snapshot.track?.title.orEmpty(),
                  queuedCount = snapshot.queueSize,
                  nowPlaying = snapshot,
                ),
              ),
            )
            return@runAfterRestoreForVoice
          }
          val queue = resumableQueue()
          player.setMediaItems(queue.mediaItems, queue.startIndex, queue.startPositionMs)
          player.prepare()
          player.play()
          val snapshot = buildNowPlayingSnapshot()
          callback(
            Result.success(
              LoggeRythmVoicePlayResult(
                source = "library",
                matchedTitle = snapshot.track?.title.orEmpty(),
                queuedCount = queue.mediaItems.size,
                nowPlaying = snapshot,
              ),
            ),
          )
          return@runAfterRestoreForVoice
        }

        val tree = LoggeRythmPlayerRuntime.browseTree()
        val local = LoggeRythmLibrarySearch.resolveStructuredLocalPlay(tree, request)
        if (local != null) {
          val prefix = "voice:play:${voiceItemSequence.incrementAndGet()}"
          val specs = specsFromLocalBrowseSelection(local, prefix)
          val mediaItems = LoggeRythmPlayerRuntime.installQueue(specs)
          player.setMediaItems(mediaItems, local.startIndex, 0L)
          player.prepare()
          player.play()
          val snapshot = buildNowPlayingSnapshot()
          callback(
            Result.success(
              LoggeRythmVoicePlayResult(
                source = "library",
                matchedTitle = specs[local.startIndex].title.orEmpty(),
                queuedCount = specs.size,
                nowPlaying = snapshot,
              ),
            ),
          )
          return@runAfterRestoreForVoice
        }

        resolveLiveCatalogPlaySelection(
          request = request,
          tree = tree,
          mediaIdPrefix = "voice:play:${voiceItemSequence.incrementAndGet()}",
        ) { resolved ->
          resolved.fold(
            onSuccess = { selection ->
              try {
                requireQueueReplacementAdmitted()
                val mediaItems = LoggeRythmPlayerRuntime.installQueue(selection.items)
                player.setMediaItems(mediaItems, selection.startIndex, 0L)
                player.prepare()
                player.play()
                val snapshot = buildNowPlayingSnapshot()
                callback(
                  Result.success(
                    LoggeRythmVoicePlayResult(
                      source = "catalog",
                      matchedTitle = selection.matchedTitle,
                      queuedCount = selection.items.size,
                      nowPlaying = snapshot,
                    ),
                  ),
                )
              } catch (error: Throwable) {
                callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
              }
            },
            onFailure = { error ->
              callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
            },
          )
        }
      } catch (error: Throwable) {
        callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
      }
    }
  }

  private fun handleVoiceQueueMusic(
    request: LoggeRythmVoiceQuery,
    position: LoggeRythmVoiceQueuePosition,
    callback: (Result<LoggeRythmVoiceQueueResult>) -> Unit,
  ) {
    runAfterRestoreForVoice(onFailure = { callback(Result.failure(it)) }) {
      try {
        if (request.isBlank()) {
          throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.INVALID_ARGUMENT,
            "voice-queue-query-blank",
          )
        }
        rootUnavailable()?.let { throw LoggeRythmCarRequestException(it) }
        requireQueueReplacementAdmitted()

        fun insertGaplessly(source: String, specs: List<PlayerItemSpec>) {
          requireQueueReplacementAdmitted()
          if (specs.isEmpty()) {
            throw LoggeRythmVoiceException(
              LoggeRythmVoiceErrorCode.SEARCH_NO_MATCH,
              "voice-queue-no-match",
            )
          }
          val count = player.mediaItemCount
          val insertIndex = when (position) {
            LoggeRythmVoiceQueuePosition.NEXT ->
              if (count == 0) 0 else (player.currentMediaItemIndex + 1).coerceIn(0, count)
            LoggeRythmVoiceQueuePosition.END -> count
          }
          val limited = specs.take(
            (LoggeRythmPlayerProtocol.MAX_QUEUE_ITEMS - count).coerceAtLeast(0),
          )
          if (limited.isEmpty()) {
            throw LoggeRythmVoiceException(
              LoggeRythmVoiceErrorCode.QUEUE_UNAVAILABLE,
              "voice-queue-full",
            )
          }
          // Reuse gapless in-place AddQueueItems so active playback never stutters or re-prepares.
          applyPlayerCommand(
            player,
            PlayerCommand.AddQueueItems(index = insertIndex, items = limited),
          )
          val snapshot = buildNowPlayingSnapshot()
          callback(
            Result.success(
              LoggeRythmVoiceQueueResult(
                source = source,
                position = position,
                addedCount = limited.size,
                firstAdded = trackSummaryFromSpec(limited.first()),
                nowPlaying = snapshot,
              ),
            ),
          )
        }

        val tree = LoggeRythmPlayerRuntime.browseTree()
        val local = LoggeRythmLibrarySearch.resolveStructuredLocalPlay(tree, request)
        if (local != null) {
          val prefix = "voice:queue:${voiceItemSequence.incrementAndGet()}"
          val allLocal = specsFromLocalBrowseSelection(local, prefix)
          // For a single-song/any track match, queue the matched track (not the entire library).
          val toQueue = when (request.mediaFocus) {
            LoggeRythmVoiceMediaFocus.ALBUM,
            LoggeRythmVoiceMediaFocus.PLAYLIST,
            LoggeRythmVoiceMediaFocus.ARTIST,
            -> allLocal
            LoggeRythmVoiceMediaFocus.TRACK,
            LoggeRythmVoiceMediaFocus.ANY,
            -> listOf(allLocal[local.startIndex])
          }
          insertGaplessly("library", toQueue)
          return@runAfterRestoreForVoice
        }

        resolveLiveCatalogPlaySelection(
          request = request,
          tree = tree,
          mediaIdPrefix = "voice:queue:${voiceItemSequence.incrementAndGet()}",
        ) { resolved ->
          resolved.fold(
            onSuccess = { selection ->
              try {
                val toQueue = when (request.mediaFocus) {
                  LoggeRythmVoiceMediaFocus.ALBUM,
                  LoggeRythmVoiceMediaFocus.PLAYLIST,
                  LoggeRythmVoiceMediaFocus.ARTIST,
                  -> selection.items
                  LoggeRythmVoiceMediaFocus.TRACK,
                  LoggeRythmVoiceMediaFocus.ANY,
                  -> listOf(selection.items[selection.startIndex])
                }
                insertGaplessly("catalog", toQueue)
              } catch (error: Throwable) {
                callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
              }
            },
            onFailure = { error ->
              callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
            },
          )
        }
      } catch (error: Throwable) {
        callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
      }
    }
  }

  private fun handleVoiceSetCurrentTrackFavorite(
    liked: Boolean,
    callback: (Result<LoggeRythmVoiceFavoriteResult>) -> Unit,
  ) {
    runAfterRestoreForVoice(onFailure = { callback(Result.failure(it)) }) {
      try {
        rootUnavailable()?.let { throw LoggeRythmCarRequestException(it) }
        if (playerCache.isClearing()) throw LoggeRythmCarRequestException(LoggeRythmCarError.CACHE_CLEARING)
        if (!persistedCoordinator.isReady()) throw LoggeRythmCarRequestException(notReadyError())
        syncNotificationFavoriteProjection()
        val activeItem = player.currentMediaItem
          ?: throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.NO_ACTIVE_TRACK,
            "voice-no-active-track",
          )
        val activeMediaId = activeItem.mediaId
        val track = persistedCoordinator.resolveTrackMetadataForMediaId(activeMediaId)
        val current = notificationFavorite.stateFor(activeMediaId, track?.id)
        if (track == null || current == null) {
          throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.FAVORITE_UNAVAILABLE,
            LoggeRythmCarError.FAVORITE_UNAVAILABLE.code,
          )
        }
        val summary = trackSummaryFromMediaItem(activeItem, track.id)
        if (current.liked == liked) {
          callback(
            Result.success(
              LoggeRythmVoiceFavoriteResult(track = summary, liked = liked, changed = false),
            ),
          )
          return@runAfterRestoreForVoice
        }
        persistedCoordinator.enqueueFavoriteToggle(
          mediaId = activeMediaId,
          track = track,
          requestedLiked = liked,
        ) { enqueued ->
          enqueued.fold(
            onSuccess = {
              syncAndRefreshNotificationFavoriteButtons()
              callback(
                Result.success(
                  LoggeRythmVoiceFavoriteResult(track = summary, liked = liked, changed = true),
                ),
              )
            },
            onFailure = { error ->
              callback(
                Result.failure(
                  LoggeRythmVoiceException(
                    LoggeRythmVoiceErrorCode.FAVORITE_UPDATE_FAILED,
                    LoggeRythmCarError.FAVORITE_UPDATE_FAILED.code,
                    error,
                  ),
                ),
              )
            },
          )
        }
      } catch (error: Throwable) {
        callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
      }
    }
  }

  private fun handleVoiceStartRadio(
    moodOrGenre: String?,
    callback: (Result<LoggeRythmVoicePlayResult>) -> Unit,
  ) {
    runAfterRestoreForVoice(onFailure = { callback(Result.failure(it)) }) {
      try {
        rootUnavailable()?.let { throw LoggeRythmCarRequestException(it) }
        requireQueueReplacementAdmitted()
        val originalBinding = LoggeRythmPlayerRuntime.currentSessionBinding()
          ?: throw LoggeRythmVoiceException(LoggeRythmVoiceErrorCode.AUTH_REQUIRED, "radio-signed-out")
        val auth = LoggeRythmPlayerRuntime.sessionCookieForCurrentOrigin()
          ?: throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
            "radio-no-remote-session",
          )
        val activeMediaId = player.currentMediaItem?.mediaId
        val seedTrackId = activeMediaId?.let { id ->
          persistedCoordinator.resolveTrackIdForMediaId(id)
            ?: extractTrackIdFromExtras(LoggeRythmPlayerRuntime.extrasFor(id))
        }
        val (origin, cookie) = auth
        val client = voiceCatalogClient()
        val prefix = "voice:radio:${voiceItemSequence.incrementAndGet()}"
        voiceSearchExecutor.execute {
          val resolved = runCatching {
            client.resolveRadio(
              origin = origin,
              cookie = cookie,
              moodOrGenre = moodOrGenre,
              seedTrackId = seedTrackId,
              mediaIdPrefix = prefix,
            )
          }
          mainHandler.post {
            if (serviceDestroyed) {
              callback(
                Result.failure(
                  LoggeRythmVoiceException(
                    LoggeRythmVoiceErrorCode.SERVICE_UNAVAILABLE,
                    "radio-service-destroyed",
                  ),
                ),
              )
              return@post
            }
            if (LoggeRythmPlayerRuntime.currentSessionBinding() != originalBinding) {
              callback(
                Result.failure(
                  LoggeRythmVoiceException(
                    LoggeRythmVoiceErrorCode.AUTH_REQUIRED,
                    "radio-session-changed",
                  ),
                ),
              )
              return@post
            }
            resolved.fold(
              onSuccess = { selection ->
                try {
                  requireQueueReplacementAdmitted()
                  val mediaItems = LoggeRythmPlayerRuntime.installQueue(selection.items)
                  player.setMediaItems(mediaItems, selection.startIndex, 0L)
                  player.prepare()
                  player.play()
                  val snapshot = buildNowPlayingSnapshot()
                  callback(
                    Result.success(
                      LoggeRythmVoicePlayResult(
                        source = if (moodOrGenre.isNullOrBlank()) "radio:personal" else "radio:mood",
                        matchedTitle = selection.matchedTitle,
                        queuedCount = selection.items.size,
                        nowPlaying = snapshot,
                      ),
                    ),
                  )
                } catch (error: Throwable) {
                  callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
                }
              },
              onFailure = { error ->
                callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
              },
            )
          }
        }
      } catch (error: Throwable) {
        callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
      }
    }
  }

  private fun handleVoiceSetSleepTimer(
    minutes: Int,
    callback: (Result<LoggeRythmVoiceSleepTimerResult>) -> Unit,
  ) {
    runAfterRestoreForVoice(onFailure = { callback(Result.failure(it)) }) {
      try {
        rootUnavailable()?.let { throw LoggeRythmCarRequestException(it) }
        if (playerCache.isClearing()) throw LoggeRythmCarRequestException(LoggeRythmCarError.CACHE_CLEARING)
        if (!persistedCoordinator.isReady()) throw LoggeRythmCarRequestException(notReadyError())
        if (minutes < 0 || minutes > LoggeRythmVoiceBridge.MAX_SLEEP_TIMER_MINUTES) {
          throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.INVALID_ARGUMENT,
            "voice-sleep-minutes-invalid",
          )
        }
        if (minutes == 0) {
          persistedCoordinator.applyAuxiliaryCommand(PlayerCommand.CancelSleepTimer)
          callback(
            Result.success(
              LoggeRythmVoiceSleepTimerResult(
                active = false,
                minutesRequested = 0,
                remainingMs = 0L,
                fadeOutMs = 0L,
              ),
            ),
          )
          return@runAfterRestoreForVoice
        }
        if (player.mediaItemCount == 0) {
          throw LoggeRythmVoiceException(
            LoggeRythmVoiceErrorCode.NO_ACTIVE_TRACK,
            "voice-sleep-empty-queue",
          )
        }
        val durationMs = minutes.toLong() * 60_000L
        val fadeOutMs = 15_000L.coerceAtMost(durationMs)
        persistedCoordinator.applyAuxiliaryCommand(
          PlayerCommand.SleepAfterTime(durationMs = durationMs, fadeOutMs = fadeOutMs),
        )
        callback(
          Result.success(
            LoggeRythmVoiceSleepTimerResult(
              active = true,
              minutesRequested = minutes,
              remainingMs = durationMs,
              fadeOutMs = fadeOutMs,
            ),
          ),
        )
      } catch (error: Throwable) {
        callback(Result.failure(LoggeRythmVoiceBridge.asVoiceException(error)))
      }
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
        !controllerProfile(session, controller).supportsFavorite ||
        customCommand.customAction != LoggeRythmNotificationFavoriteContract.ACTION
      ) {
        return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
      }
      val resultFuture = SettableFuture.create<SessionResult>()
      Futures.addCallback(
        afterServiceOnlyRestore { Unit },
        object : FutureCallback<Unit> {
          override fun onSuccess(ignored: Unit?) {
            handleFavoriteToggleCommand(session, controller, resultFuture)
          }

          override fun onFailure(error: Throwable) {
            reportCarError(session, controller, notReadyError())
            resultFuture.set(SessionResult(SessionError.ERROR_INVALID_STATE))
          }
        },
        MoreExecutors.directExecutor(),
      )
      return resultFuture
    }

    private fun handleFavoriteToggleCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      resultFuture: SettableFuture<SessionResult>,
    ) {
      if (serviceDestroyed) {
        resultFuture.set(SessionResult(SessionError.ERROR_INVALID_STATE))
        return
      }
      if (playerCache.isClearing() || !persistedCoordinator.isReady()) {
        reportCarError(session, controller, notReadyError())
        resultFuture.set(SessionResult(SessionError.ERROR_INVALID_STATE))
        return
      }
      syncNotificationFavoriteProjection()
      val activeMediaId = player.currentMediaItem?.mediaId
      val track = activeMediaId?.let(persistedCoordinator::resolveTrackMetadataForMediaId)
      val current = notificationFavorite.stateFor(activeMediaId, track?.id)
      if (activeMediaId == null || track == null || current == null) {
        reportCarError(session, controller, LoggeRythmCarError.FAVORITE_UNAVAILABLE)
        resultFuture.set(SessionResult(SessionError.ERROR_INVALID_STATE))
        return
      }
      val requestedLiked = !current.liked
      persistedCoordinator.enqueueFavoriteToggle(
        mediaId = activeMediaId,
        track = track,
        requestedLiked = requestedLiked,
      ) { enqueued ->
        enqueued.fold(
          onSuccess = {
            syncAndRefreshNotificationFavoriteButtons()
            resultFuture.set(SessionResult(SessionResult.RESULT_SUCCESS))
          },
          onFailure = {
            reportCarError(session, controller, LoggeRythmCarError.FAVORITE_UPDATE_FAILED)
            resultFuture.set(SessionResult(SessionError.ERROR_INVALID_STATE))
          },
        )
      }
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
      if (
        sessionPlayer.remoteVolumeState().active && (
          playerCommand == Player.COMMAND_GET_DEVICE_VOLUME ||
            playerCommand == Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS ||
            playerCommand == Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS
          )
      ) {
        return SessionResult.RESULT_SUCCESS
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
      val rootParams = LibraryParams.Builder()
        .setExtras(LoggeRythmCarBrowseMetadata.rootLibraryExtras(params?.extras))
        .apply {
          if (params != null) {
            setRecent(params.isRecent)
            setOffline(params.isOffline)
            setSuggested(params.isSuggested)
          }
        }
        .build()
      return Futures.immediateFuture(LibraryResult.ofItem(root, rootParams))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      return afterServiceOnlyRestore {
        val item = LoggeRythmPlayerRuntime.browseItem(mediaId)
          ?: LoggeRythmPlayerRuntime.voiceSearchItem(mediaId)
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
      val resultFuture = SettableFuture.create<LibraryResult<Void>>()
      val normalizedKey = LoggeRythmLibrarySearch.normalize(query)
      fun failSearch(carError: LoggeRythmCarError) {
        if (carError == LoggeRythmCarError.SIGNED_OUT) {
          LoggeRythmPlayerRuntime.clearVoiceSearchCache()
        } else if (normalizedKey.isNotEmpty()) {
          LoggeRythmPlayerRuntime.removeVoiceSearchQuery(normalizedKey)
        }
        val legacy = browser.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION
        if (legacy) {
          // Media3's MediaLibraryServiceLegacyStub ignores onSearch's return future and holds the
          // platform MediaBrowser.search() Result open until notifySearchResultChanged triggers
          // onGetSearchResult. Record the error and wake onGetSearchResult so Android Auto gets
          // SearchCallback.onError immediately instead of spinning forever.
          failedLegacySearchErrors[normalizedKey] = carError
          session.notifySearchResultChanged(browser, query, 0, params)
          resultFuture.set(carLibraryError(carError))
        } else {
          resultFuture.set(failLibraryRequest(session, browser, carError))
        }
      }
      Futures.addCallback(
        afterServiceOnlyRestore { Unit },
        object : FutureCallback<Unit> {
          override fun onSuccess(ignored: Unit?) {
            failedLegacySearchErrors.remove(normalizedKey)
            val unavailable = rootUnavailable()
            if (unavailable != null) {
              failSearch(unavailable)
              return
            }
            val tree = LoggeRythmPlayerRuntime.browseTree()
            val localIds = LoggeRythmLibrarySearch.search(tree, query)
            executeLiveBrowseSearch(query) { liveResult ->
              liveResult.fold(
                onSuccess = { liveItems ->
                  val merged = mergeLocalAndLiveSearchResults(
                    LoggeRythmPlayerRuntime.browseTree(),
                    localIds,
                    liveItems,
                  )
                  // Legacy hosts register the request before this callback and fetch results on notify.
                  session.notifySearchResultChanged(browser, query, merged.size, params)
                  resultFuture.set(LibraryResult.ofVoid(params))
                },
                onFailure = { error ->
                  val voiceError = error as? LoggeRythmVoiceException
                  val isAuthFailure = voiceError?.code == LoggeRythmVoiceErrorCode.AUTH_REQUIRED
                  if (!isAuthFailure && localIds.isNotEmpty()) {
                    if (normalizedKey.isNotEmpty()) {
                      LoggeRythmPlayerRuntime.removeVoiceSearchQuery(normalizedKey)
                    }
                    session.notifySearchResultChanged(browser, query, localIds.size, params)
                    resultFuture.set(LibraryResult.ofVoid(params))
                  } else {
                    failSearch(mapVoiceErrorToCarException(error, query).error)
                  }
                },
              )
            }
          }

          override fun onFailure(error: Throwable) {
            failSearch(notReadyError())
          }
        },
        MoreExecutors.directExecutor(),
      )
      return resultFuture
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
      val resultFuture = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()
      Futures.addCallback(
        afterServiceOnlyRestore { Unit },
        object : FutureCallback<Unit> {
          override fun onSuccess(ignored: Unit?) {
            val normalizedKey = LoggeRythmLibrarySearch.normalize(query)
            val legacy = browser.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION
            if (legacy) {
              val recordedFailure = failedLegacySearchErrors.remove(normalizedKey)
              if (recordedFailure != null) {
                resultFuture.set(failLibraryRequest(session, browser, recordedFailure))
                return
              }
            }
            val unavailable = rootUnavailable()
            if (unavailable != null) {
              resultFuture.set(failLibraryRequest(session, browser, unavailable))
              return
            }
            val tree = LoggeRythmPlayerRuntime.browseTree()
            val localIds = LoggeRythmLibrarySearch.search(tree, query)
            val cachedLive = LoggeRythmPlayerRuntime.cachedVoiceSearchResults(normalizedKey)
            fun deliver(liveItems: List<MediaItem>) {
              val merged = mergeLocalAndLiveSearchResults(
                LoggeRythmPlayerRuntime.browseTree(),
                localIds,
                liveItems,
              )
              val range = checkNotNull(LoggeRythmBrowsePaging.range(merged.size, page, pageSize))
              // No match is an empty result per Media3's search contract, not an error.
              resultFuture.set(LibraryResult.ofItemList(ImmutableList.copyOf(merged.slice(range)), params))
            }
            if (cachedLive != null || normalizedKey.isEmpty()) {
              deliver(cachedLive.orEmpty())
              return
            }
            executeLiveBrowseSearch(query) { liveResult ->
              liveResult.fold(
                onSuccess = ::deliver,
                onFailure = { error ->
                  val voiceError = error as? LoggeRythmVoiceException
                  val isAuthFailure = voiceError?.code == LoggeRythmVoiceErrorCode.AUTH_REQUIRED
                  if (!isAuthFailure && localIds.isNotEmpty()) {
                    deliver(emptyList())
                  } else {
                    if (isAuthFailure) LoggeRythmPlayerRuntime.clearVoiceSearchCache()
                    val carError = mapVoiceErrorToCarException(error, query).error
                    resultFuture.set(failLibraryRequest(session, browser, carError))
                  }
                },
              )
            }
          }

          override fun onFailure(error: Throwable) {
            resultFuture.set(failLibraryRequest(session, browser, notReadyError()))
          }
        },
        MoreExecutors.directExecutor(),
      )
      return resultFuture
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
      val resultFuture = SettableFuture.create<MediaItemsWithStartPosition>()
      Futures.addCallback(
        afterServiceOnlyRestore { Unit },
        object : FutureCallback<Unit> {
          override fun onSuccess(ignored: Unit?) {
            val profile = controllerProfile(mediaSession, controller)
            try {
              requireQueueReplacementAdmitted()
              if (
                profile == RemoteControllerProfile.INTERNAL &&
                mediaItems.all { it.localConfiguration != null }
              ) {
                resultFuture.set(MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs))
                return
              }
              // A browse/voice request selects one published ID or query. Every caller-owned
              // URI/metadata field is ignored; native library + authenticated catalog supply items.
              Futures.addCallback(
                resolveLibraryPlayRequestAsync(profile, mediaItems),
                object : FutureCallback<MediaItemsWithStartPosition> {
                  override fun onSuccess(result: MediaItemsWithStartPosition) {
                    resultFuture.set(result)
                  }

                  override fun onFailure(error: Throwable) {
                    if (error is LoggeRythmCarRequestException) {
                      reportCarError(mediaSession, controller, error.error, error.messageArgument)
                    }
                    resultFuture.setException(error)
                  }
                },
                MoreExecutors.directExecutor(),
              )
            } catch (error: LoggeRythmCarRequestException) {
              reportCarError(mediaSession, controller, error.error, error.messageArgument)
              resultFuture.setException(error)
            } catch (error: Throwable) {
              resultFuture.setException(error)
            }
          }

          override fun onFailure(error: Throwable) {
            val notReady = LoggeRythmCarRequestException(notReadyError())
            reportCarError(mediaSession, controller, notReady.error)
            resultFuture.setException(notReady)
          }
        },
        MoreExecutors.directExecutor(),
      )
      return resultFuture
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
