package top.logge.loggerythm.player

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

internal data class LoggeRythmCurrentItemSnapshot(
  val index: Int?,
  val mediaId: String?,
)

/** Canonical v1 current-item fields over Media3's index-0 empty-timeline sentinel. */
internal fun normalizedCurrentItemSnapshot(
  mediaItemCount: Int,
  reportedIndex: Int,
  reportedMediaId: String?,
): LoggeRythmCurrentItemSnapshot {
  if (mediaItemCount < 0) throw PlayerProtocolException("player-timeline-invalid")
  if (mediaItemCount == 0 || reportedMediaId == null) {
    return LoggeRythmCurrentItemSnapshot(index = null, mediaId = null)
  }
  if (reportedIndex !in 0 until mediaItemCount) {
    throw PlayerProtocolException("player-current-item-invalid")
  }
  return LoggeRythmCurrentItemSnapshot(reportedIndex, reportedMediaId)
}

@UnstableApi
class LoggeRythmPlayerModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val worker = Executors.newSingleThreadExecutor()
  private val invalidated = AtomicBoolean(false)
  private val cleanupInProgress = AtomicBoolean(false)
  private val listenerCount = AtomicInteger(0)
  private val protocol = LoggeRythmPlayerProtocol(
    listOf(
      reactContext.filesDir,
      reactContext.noBackupFilesDir,
      reactContext.cacheDir,
    ),
  )
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null
  private var playerListenerAttached = false
  private var progressTickerScheduled = false

  private val progressTicker = object : Runnable {
    override fun run() {
      progressTickerScheduled = false
      val active = controller ?: return
      if (!shouldRunProgressTicker(active)) return
      emitSnapshot(active)
      emitProgress(active)
      updateProgressTicker(active)
    }
  }

  private val playerListener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      emitSnapshot(player)
      updateProgressTicker(player)
    }

    override fun onPlayerError(error: PlaybackException) {
      emitPlayerEvent(JSONObject().apply {
        put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
        put("type", "error")
        put("code", "player-error")
      })
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      emitPlayerEvent(JSONObject().apply {
        put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
        put("type", "media-item-transition")
        put("itemId", mediaItem?.mediaId ?: JSONObject.NULL)
        put("reason", transitionReason(reason))
      })
    }
  }

  override fun getName(): String = NAME

  override fun getConstants(): Map<String, Any> = mapOf(
    "snapshotEvent" to SNAPSHOT_EVENT,
    "playerEvent" to PLAYER_EVENT,
    "progressEvent" to PROGRESS_EVENT,
  )

  @ReactMethod
  fun setup(optionsJson: String, promise: Promise) {
    parseOnWorker(promise, { protocol.parseSetup(optionsJson) }) { setup ->
      withController(promise) { active ->
        LoggeRythmMediaSessionServiceBridge.resetRemoteCommands()
        LoggeRythmPersistedServiceBridge.bindSession(setup.sessionBinding) { result ->
          result.fold(
            onSuccess = { resolveSnapshot(promise, active) },
            onFailure = { reject(promise, it) },
          )
        }
      }
    }
  }

  @ReactMethod
  fun command(name: String, payloadJson: String, promise: Promise) {
    parseOnWorker(promise, { protocol.parseCommand(name, payloadJson) }) { parsed ->
      withController(promise) { active ->
        if (cleanupInProgress.get()) {
          reject(promise, PlayerProtocolException("player-cleanup-active"))
          return@withController
        }
        settleOnMain(promise) {
          if (!LoggeRythmPersistedServiceBridge.isReady()) {
            throw LoggeRythmPersistedPlayerException("player-session-not-ready")
          }
          val handled = if (parsed is PlayerCommand.SetCommands) {
            LoggeRythmMediaSessionServiceBridge.installRemoteCommands(parsed.capabilities)
            true
          } else {
            LoggeRythmPersistedServiceBridge.applyAuxiliaryCommand(parsed)
          }
          if (!handled) {
            applyCommand(active, parsed)
            LoggeRythmPersistedServiceBridge.onCommandApplied(parsed)
          }
          snapshotResult(active)
        }
      }
    }
  }

  @ReactMethod
  fun setBrowseTree(treeJson: String, promise: Promise) {
    parseOnWorker(promise, { protocol.parseBrowseTree(treeJson) }) { tree ->
      if (cleanupInProgress.get()) {
        reject(promise, PlayerProtocolException("player-cleanup-active"))
        return@parseOnWorker
      }
      settleOnMain(promise) {
        if (!LoggeRythmPersistedServiceBridge.isReady()) {
          throw LoggeRythmPersistedPlayerException("player-session-not-ready")
        }
        val installed = LoggeRythmPlayerRuntime.installBrowseTree(tree)
        Arguments.createMap().apply { putDouble("revision", installed.revision.toDouble()) }
      }
    }
  }

  @ReactMethod
  fun clearPersistedState(promise: Promise) {
    withController(promise) { active ->
      if (!cleanupInProgress.compareAndSet(false, true)) {
        reject(promise, PlayerProtocolException("player-cleanup-active"))
        return@withController
      }
      LoggeRythmMediaSessionServiceBridge.resetRemoteCommands()
      try {
        LoggeRythmPersistedServiceBridge.clearPersistedState { result ->
          cleanupInProgress.set(false)
          result.fold(
            onSuccess = { cleared ->
              promise.resolve(snapshotResult(active).apply {
                putBoolean("cleared", true)
                putBoolean("cacheVerified", cleared.verified)
              })
            },
            onFailure = { reject(promise, it) },
          )
        }
      } catch (error: Exception) {
        cleanupInProgress.set(false)
        reject(promise, error)
      }
    }
  }

  @ReactMethod
  fun clearCache(promise: Promise) {
    withController(promise) { active ->
      if (!cleanupInProgress.compareAndSet(false, true)) {
        reject(promise, PlayerProtocolException("player-cleanup-active"))
        return@withController
      }
      try {
        active.stop()
        active.clearMediaItems()
        // Cache invalidation and credential-vault invalidation share this main-thread
        // admission point, so no new playback request can observe stale credentials.
        LoggeRythmPlayerRuntime.clearAllHeadersAndBrowseTree()
        LoggeRythmCacheServiceBridge.clearCache { result ->
          cleanupInProgress.set(false)
          result.fold(
            onSuccess = { cleared ->
              val payload = snapshotResult(active).apply {
                putBoolean("cleared", true)
                putDouble("cacheBytesBefore", cleared.bytesBefore.toDouble())
                putDouble("cacheBytesAfter", cleared.bytesAfter.toDouble())
                putInt("cacheResourcesRemoved", cleared.resourcesRemoved)
                putBoolean("cacheVerified", cleared.verified)
              }
              LoggeRythmPersistedServiceBridge.onLiveQueueCleared()
              promise.resolve(payload)
            },
            onFailure = { reject(promise, it) },
          )
        }
      } catch (error: Exception) {
        cleanupInProgress.set(false)
        reject(promise, error)
      }
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    if (eventName == SNAPSHOT_EVENT || eventName == PLAYER_EVENT || eventName == PROGRESS_EVENT) {
      listenerCount.incrementAndGet()
      mainHandler.post(::updateProgressTicker)
    }
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    val removed = if (count.isFinite()) count.toInt().coerceAtLeast(0) else 0
    listenerCount.updateAndGet { current -> (current - removed).coerceAtLeast(0) }
    mainHandler.post(::updateProgressTicker)
  }

  override fun invalidate() {
    if (!invalidated.compareAndSet(false, true)) return
    mainHandler.post {
      stopProgressTicker()
      controller?.let { active ->
        if (playerListenerAttached) active.removeListener(playerListener)
      }
      playerListenerAttached = false
      controller = null
      controllerFuture?.let { future -> MediaController.releaseFuture(future) }
      controllerFuture = null
    }
    worker.shutdownNow()
    super.invalidate()
  }

  private fun applyCommand(active: MediaController, command: PlayerCommand) {
    when (command) {
      is PlayerCommand.SetQueue -> {
        val mediaItems = LoggeRythmPlayerRuntime.installQueue(command.items)
        if (mediaItems.isEmpty()) {
          active.stop()
          active.clearMediaItems()
        } else {
          active.setMediaItems(mediaItems, command.startIndex, command.startPositionMs)
          active.prepare()
        }
      }
      PlayerCommand.Play -> active.play()
      PlayerCommand.Pause -> active.pause()
      is PlayerCommand.SeekTo -> active.seekTo(command.positionMs)
      PlayerCommand.SkipToNext -> if (active.hasNextMediaItem()) active.seekToNextMediaItem()
      PlayerCommand.SkipToPrevious -> if (active.hasPreviousMediaItem()) active.seekToPreviousMediaItem()
      is PlayerCommand.SetRepeatMode -> active.repeatMode = when (command.mode) {
        "one" -> Player.REPEAT_MODE_ONE
        "all" -> Player.REPEAT_MODE_ALL
        else -> Player.REPEAT_MODE_OFF
      }
      PlayerCommand.Stop -> active.stop()
      PlayerCommand.ClearQueue -> {
        active.stop()
        active.clearMediaItems()
        LoggeRythmPlayerRuntime.clearQueueHeaders()
      }
      PlayerCommand.DisableGlobalShuffle,
      is PlayerCommand.SetQueuePersistenceState,
      is PlayerCommand.SetCommands,
      is PlayerCommand.SleepAfterTime,
      is PlayerCommand.SleepAfterMediaItemAtIndex,
      PlayerCommand.CancelSleepTimer -> Unit
      PlayerCommand.RefreshSnapshot -> Unit
    }
  }

  private fun withController(promise: Promise, action: (MediaController) -> Unit) {
    mainHandler.post {
      if (invalidated.get()) {
        reject(promise, PlayerProtocolException("player-module-invalidated"))
        return@post
      }
      val existing = controller
      if (existing != null) {
        action(existing)
        return@post
      }
      val future = controllerFuture ?: MediaController.Builder(
        reactApplicationContext,
        SessionToken(
          reactApplicationContext,
          ComponentName(reactApplicationContext, LoggeRythmMediaLibraryService::class.java),
        ),
      ).buildAsync().also { controllerFuture = it }
      future.addListener(
        {
          mainHandler.post {
            if (invalidated.get()) {
              MediaController.releaseFuture(future)
              reject(promise, PlayerProtocolException("player-module-invalidated"))
              return@post
            }
            try {
              val connected = Futures.getDone(future)
              controller = connected
              if (!playerListenerAttached) {
                connected.addListener(playerListener)
                playerListenerAttached = true
              }
              updateProgressTicker(connected)
              action(connected)
            } catch (error: Exception) {
              if (controllerFuture === future) controllerFuture = null
              reject(promise, error)
            }
          }
        },
        MoreExecutors.directExecutor(),
      )
    }
  }

  private fun <T> parseOnWorker(
    promise: Promise,
    parse: () -> T,
    action: (T) -> Unit,
  ) {
    if (invalidated.get()) {
      reject(promise, PlayerProtocolException("player-module-invalidated"))
      return
    }
    try {
      worker.execute {
        runCatching(parse).fold(
          onSuccess = { value -> mainHandler.post { action(value) } },
          onFailure = { error -> mainHandler.post { reject(promise, error) } },
        )
      }
    } catch (error: Exception) {
      reject(promise, error)
    }
  }

  private fun settleOnMain(promise: Promise, action: () -> Any?) {
    try {
      val result = action()
      if (result != null) promise.resolve(result)
    } catch (error: Exception) {
      reject(promise, error)
    }
  }

  private fun resolveSnapshot(promise: Promise, active: Player) {
    settleOnMain(promise) { snapshotResult(active) }
  }

  private fun snapshotResult(player: Player) = Arguments.createMap().apply {
    putString("snapshotJson", snapshotJson(player).toString())
  }

  private fun snapshotJson(player: Player): JSONObject = JSONObject().apply {
    put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
    put("playbackState", playbackState(player.playbackState))
    put("playWhenReady", player.playWhenReady)
    put("isPlaying", player.isPlaying)
    put("positionMs", player.currentPosition.coerceAtLeast(0L))
    put("durationMs", nullableTime(player.duration))
    put("bufferedPositionMs", player.bufferedPosition.coerceAtLeast(0L))
    val currentItem = normalizedCurrentItemSnapshot(
      mediaItemCount = player.mediaItemCount,
      reportedIndex = player.currentMediaItemIndex,
      reportedMediaId = player.currentMediaItem?.mediaId,
    )
    put("currentIndex", currentItem.index ?: JSONObject.NULL)
    put("currentItemId", currentItem.mediaId ?: JSONObject.NULL)
    put("repeatMode", repeatMode(player.repeatMode))
    val persistedPublicState = LoggeRythmPersistedServiceBridge.publicState()
    put("queuePersistence", JSONObject().apply {
      put("contextShuffleEnabled", persistedPublicState.contextShuffleEnabled)
      put(
        "contextShuffleRestoreOrder",
        org.json.JSONArray(persistedPublicState.contextShuffleRestoreOrder),
      )
    })
    put("shuffleEnabled", player.shuffleModeEnabled)
    put("sleepTimer", when (val timer = persistedPublicState.sleepTimer) {
      null -> JSONObject.NULL
      is LoggeRythmPersistedSleepSnapshot.Time -> JSONObject().apply {
        put("type", "time")
        put("remainingMs", timer.remainingMs.coerceAtLeast(0L))
        put("fadeOutMs", timer.fadeOutMs)
      }
      is LoggeRythmPersistedSleepSnapshot.MediaItem -> JSONObject().apply {
        put("type", "mediaItem")
        put("index", timer.index)
      }
    })
    put("queue", org.json.JSONArray().apply {
      repeat(player.mediaItemCount) { index ->
        val item = player.getMediaItemAt(index)
        val metadata = item.mediaMetadata
        put(JSONObject().apply {
          put("id", item.mediaId)
          put("title", metadata.title?.toString() ?: JSONObject.NULL)
          put("artist", metadata.artist?.toString() ?: JSONObject.NULL)
          put("album", metadata.albumTitle?.toString() ?: JSONObject.NULL)
          put("artworkUrl", metadata.artworkUri?.toString() ?: JSONObject.NULL)
          put("durationMs", metadata.durationMs ?: JSONObject.NULL)
          put("extras", JSONObject(LoggeRythmPlayerRuntime.extrasFor(item.mediaId)))
        })
      }
    })
    put("errorCode", if (player.playerError == null) JSONObject.NULL else "player-error")
  }

  private fun emitSnapshot(player: Player) {
    if (listenerCount.get() <= 0 || !reactApplicationContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putString("snapshotJson", snapshotJson(player).toString())
    }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(SNAPSHOT_EVENT, payload)
  }

  private fun emitPlayerEvent(eventJson: JSONObject) {
    if (listenerCount.get() <= 0 || !reactApplicationContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply { putString("eventJson", eventJson.toString()) }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(PLAYER_EVENT, payload)
  }

  private fun emitProgress(player: Player) {
    if (listenerCount.get() <= 0 || !reactApplicationContext.hasActiveReactInstance()) return
    val payload = Arguments.createMap().apply {
      putString("snapshotJson", snapshotJson(player).toString())
    }
    reactApplicationContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(PROGRESS_EVENT, payload)
  }

  private fun shouldRunProgressTicker(player: Player): Boolean =
    LoggeRythmProgressTickerPolicy.shouldRun(
      listenerCount = listenerCount.get(),
      isPlaying = player.isPlaying,
      isBuffering = player.playbackState == Player.STATE_BUFFERING,
      playWhenReady = player.playWhenReady,
      invalidated = invalidated.get(),
    )

  private fun updateProgressTicker() {
    updateProgressTicker(controller)
  }

  private fun updateProgressTicker(player: Player?) {
    if (player == null || !shouldRunProgressTicker(player)) {
      stopProgressTicker()
      return
    }
    if (!progressTickerScheduled) {
      progressTickerScheduled = true
      mainHandler.postDelayed(progressTicker, LoggeRythmProgressTickerPolicy.INTERVAL_MS)
    }
  }

  private fun stopProgressTicker() {
    if (!progressTickerScheduled) return
    mainHandler.removeCallbacks(progressTicker)
    progressTickerScheduled = false
  }

  private fun reject(promise: Promise, error: Throwable) {
    val code = when (error) {
      is PlayerProtocolException -> error.code.takeIf(SAFE_CODE::matches)
      is LoggeRythmCacheException -> error.code.takeIf(SAFE_CODE::matches)
      is LoggeRythmPersistedPlayerException -> error.code.takeIf(SAFE_CODE::matches)
      is LoggeRythmPersistedStateException -> error.code.takeIf(SAFE_CODE::matches)
      else -> null
    } ?: "player-operation-failed"
    promise.reject(code, "Player operation failed: $code")
  }

  private fun nullableTime(value: Long): Any =
    if (value == C.TIME_UNSET || value < 0L) JSONObject.NULL else value

  private fun playbackState(value: Int): String = when (value) {
    Player.STATE_BUFFERING -> "buffering"
    Player.STATE_READY -> "ready"
    Player.STATE_ENDED -> "ended"
    else -> "idle"
  }

  private fun repeatMode(value: Int): String = when (value) {
    Player.REPEAT_MODE_ONE -> "one"
    Player.REPEAT_MODE_ALL -> "all"
    else -> "off"
  }

  private fun transitionReason(value: Int): String = when (value) {
    Player.MEDIA_ITEM_TRANSITION_REASON_AUTO -> "auto"
    Player.MEDIA_ITEM_TRANSITION_REASON_SEEK -> "seek"
    Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> "repeat"
    Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED -> "playlist-changed"
    else -> "unknown"
  }

  companion object {
    const val NAME = "LoggeRythmPlayer"
    const val SNAPSHOT_EVENT = "LoggeRythmPlayerSnapshot"
    const val PLAYER_EVENT = "LoggeRythmPlayerEvent"
    const val PROGRESS_EVENT = "LoggeRythmPlayerProgress"
    private const val SNAPSHOT_SCHEMA_VERSION = 1
    private val SAFE_CODE = Regex("[a-z][a-z0-9-]{1,63}")
  }
}
