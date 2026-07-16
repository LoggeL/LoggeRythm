package top.logge.loggerythm.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Process
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONObject

internal class LoggeRythmPersistedPlayerException(val code: String) :
  IllegalStateException(code)

internal sealed interface LoggeRythmPersistedSleepSnapshot {
  data class Time(val remainingMs: Long, val fadeOutMs: Long) :
    LoggeRythmPersistedSleepSnapshot

  data class MediaItem(val index: Int) : LoggeRythmPersistedSleepSnapshot
}

internal data class LoggeRythmPersistedPublicState(
  val contextShuffleEnabled: Boolean = false,
  val contextShuffleRestoreOrder: List<String> = emptyList(),
  val sleepTimer: LoggeRythmPersistedSleepSnapshot? = null,
)

/** Applies the compatibility-only global-shuffle disable directly to the service player. */
internal fun applyServiceOwnedGlobalShuffleCommand(
  player: ExoPlayer,
  command: PlayerCommand,
): Boolean {
  if (command !== PlayerCommand.DisableGlobalShuffle) return false
  player.shuffleModeEnabled = false
  return true
}

internal fun LoggeRythmPersistedSleepState?.toPublicSnapshot(
  nowEpochMs: Long,
): LoggeRythmPersistedSleepSnapshot? = when (val value = this) {
  null -> null
  is LoggeRythmPersistedSleepState.Time -> LoggeRythmPersistedSleepSnapshot.Time(
    remainingMs = if (value.triggerAtEpochMs <= nowEpochMs) {
      0L
    } else {
      value.triggerAtEpochMs - nowEpochMs
    },
    fadeOutMs = value.fadeOutMs,
  )
  is LoggeRythmPersistedSleepState.MediaItem ->
    LoggeRythmPersistedSleepSnapshot.MediaItem(value.targetIndex)
}

/** Monotonic lifecycle ticket used to make delayed and I/O callbacks stale after a boundary. */
internal class LoggeRythmPersistedGeneration {
  private var value = 0L

  fun advance(): Long {
    value = if (value == Long.MAX_VALUE) 1L else value + 1L
    return value
  }

  fun current(): Long = value

  fun isCurrent(ticket: Long): Boolean = ticket == value
}

internal interface LoggeRythmPersistedServiceControl {
  fun bindSession(
    binding: LoggeRythmPersistedSessionBinding,
    callback: (Result<Unit>) -> Unit,
  )

  fun isReady(): Boolean
  fun applyAuxiliaryCommand(command: PlayerCommand): Boolean
  fun onCommandApplied(command: PlayerCommand)
  fun onLiveQueueCleared()
  fun publicState(): LoggeRythmPersistedPublicState
  fun clearPersistedState(callback: (Result<LoggeRythmCacheClearResult>) -> Unit)
}

/** In-process bridge only. It never carries state, media URLs, headers, cookies, or account IDs. */
internal object LoggeRythmPersistedServiceBridge {
  private val lock = Any()
  private var control: LoggeRythmPersistedServiceControl? = null

  fun attach(value: LoggeRythmPersistedServiceControl) = synchronized(lock) {
    if (control != null && control !== value) {
      throw LoggeRythmPersistedPlayerException("player-persistence-owner-active")
    }
    control = value
  }

  fun detach(value: LoggeRythmPersistedServiceControl) = synchronized(lock) {
    if (control === value) control = null
  }

  fun bindSession(
    binding: LoggeRythmPersistedSessionBinding,
    callback: (Result<Unit>) -> Unit,
  ) {
    val active = synchronized(lock) { control }
    if (active == null) {
      callback(Result.failure(LoggeRythmPersistedPlayerException("player-persistence-unavailable")))
    } else {
      active.bindSession(binding, callback)
    }
  }

  fun isReady(): Boolean = synchronized(lock) { control }?.isReady() == true

  fun applyAuxiliaryCommand(command: PlayerCommand): Boolean {
    val active = synchronized(lock) { control }
      ?: throw LoggeRythmPersistedPlayerException("player-persistence-unavailable")
    return active.applyAuxiliaryCommand(command)
  }

  fun onCommandApplied(command: PlayerCommand) {
    val active = synchronized(lock) { control }
      ?: throw LoggeRythmPersistedPlayerException("player-persistence-unavailable")
    active.onCommandApplied(command)
  }

  fun onLiveQueueCleared() {
    synchronized(lock) { control }?.onLiveQueueCleared()
  }

  fun publicState(): LoggeRythmPersistedPublicState =
    synchronized(lock) { control }?.publicState() ?: LoggeRythmPersistedPublicState()

  fun clearPersistedState(callback: (Result<LoggeRythmCacheClearResult>) -> Unit) {
    val active = synchronized(lock) { control }
    if (active == null) {
      callback(Result.failure(LoggeRythmPersistedPlayerException("player-persistence-unavailable")))
    } else {
      active.clearPersistedState(callback)
    }
  }
}

/**
 * Owns the complete process-death lifecycle for the service player. All public methods and player
 * callbacks run on the main looper; KeyStore, codec, and file operations run on one FIFO executor.
 */
internal class LoggeRythmPersistedPlayerCoordinator(
  context: Context,
  private val player: ExoPlayer,
  private val clearCache: ((Result<LoggeRythmCacheClearResult>) -> Unit) -> Unit,
  private val nowEpochMs: () -> Long = System::currentTimeMillis,
) : LoggeRythmPersistedServiceControl {
  private val appContext = context.applicationContext
  private val mainHandler = Handler(Looper.getMainLooper())
  private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor { task ->
    Thread(
      {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
        task.run()
      },
      "LoggeRythmPersistedState",
    )
  }
  private val protocol = LoggeRythmPlayerProtocol(
    listOf(appContext.filesDir, appContext.noBackupFilesDir, appContext.cacheDir),
  )
  private val codec = LoggeRythmPersistedStateCodec(protocol)
  private val generation = LoggeRythmPersistedGeneration()

  private var persistence: LoggeRythmEncryptedPersistence? = null
  private var binding: LoggeRythmPersistedSessionBinding? = null
  private var ready = false
  private var boundaryActive = false
  private var closed = false
  private var contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
  private var sleep: LoggeRythmPersistedSleepState? = null
  private var lastKnownIndex = C.INDEX_UNSET
  private var fadeBaseVolume: Float? = null

  private val saveRunnable = Runnable {
    if (ready && !boundaryActive && !closed) persistNow(generation.current())
  }
  private val heartbeatRunnable = object : Runnable {
    override fun run() {
      if (!ready || boundaryActive || closed || !player.isPlaying) return
      persistNow(generation.current())
      mainHandler.postDelayed(this, POSITION_HEARTBEAT_MS)
    }
  }
  private val sleepRunnable = Runnable { handleTimeSleepTick() }

  private val listener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      if (!ready || boundaryActive || closed) return
      if (events.contains(Player.EVENT_TIMELINE_CHANGED)) normalizeAuxiliaryForTimeline()
      if (events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)) handleMediaItemSleepAtEnd()

      val persistRelevant =
        events.contains(Player.EVENT_TIMELINE_CHANGED) ||
          events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) ||
          events.contains(Player.EVENT_POSITION_DISCONTINUITY) ||
          events.contains(Player.EVENT_REPEAT_MODE_CHANGED) ||
          events.contains(Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED) ||
          events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED) ||
          events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)
      if (persistRelevant) {
        val immediate = !player.playWhenReady ||
          player.playbackState == Player.STATE_IDLE ||
          player.playbackState == Player.STATE_ENDED
        requestSave(immediate)
      }
      updateHeartbeat()
      lastKnownIndex = player.currentMediaItemIndex
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      if (!ready || boundaryActive || closed) return
      handleMediaItemTransition(reason)
      lastKnownIndex = player.currentMediaItemIndex
    }
  }

  init {
    player.addListener(listener)
  }

  override fun bindSession(
    binding: LoggeRythmPersistedSessionBinding,
    callback: (Result<Unit>) -> Unit,
  ) {
    if (closed) {
      callback(failure("player-persistence-closed"))
      return
    }
    try {
      LoggeRythmPersistedSessionBindingPolicy.requireValid(binding)
    } catch (_: Exception) {
      callback(failure("player-session-binding-invalid"))
      return
    }
    if (boundaryActive) {
      callback(failure("player-session-binding-active"))
      return
    }
    if (ready && this.binding == binding) {
      callback(Result.success(Unit))
      return
    }

    val previousBinding = this.binding
    val previousPersistence = persistence
    val ticket = beginBoundary(binding)
    if (previousBinding != null && previousBinding != binding) {
      clearEncryptedAndCache(previousPersistence) { result ->
        if (!generation.isCurrent(ticket) || closed) return@clearEncryptedAndCache
        result.fold(
          onSuccess = { createEmptyBaseline(ticket, binding, callback) },
          onFailure = { failSetup(ticket, it, callback) },
        )
      }
      return
    }

    val activePersistence = createPersistence(binding)
    persistence = activePersistence
    activePersistence.loadOutcome { result ->
      mainHandler.post {
        if (!generation.isCurrent(ticket) || closed) return@post
        result.fold(
          onSuccess = { outcome -> completeLoad(ticket, binding, outcome, callback) },
          onFailure = { error -> failSetup(ticket, error, callback) },
        )
      }
    }
  }

  override fun isReady(): Boolean = ready && !boundaryActive && !closed

  override fun applyAuxiliaryCommand(command: PlayerCommand): Boolean {
    requireReady()
    if (applyServiceOwnedGlobalShuffleCommand(player, command)) return true
    when (command) {
      is PlayerCommand.SetQueuePersistenceState -> {
        val proposed = LoggeRythmPersistedContextShuffle(
          command.contextShuffleEnabled,
          command.contextShuffleRestoreOrder.toList(),
        )
        validateCandidate(contextShuffle = proposed, sleep = sleep)
        contextShuffle = proposed
      }
      is PlayerCommand.SleepAfterTime -> {
        if (player.mediaItemCount == 0) operationFailure("sleep-empty-queue")
        val deadline = try {
          Math.addExact(nowEpochMs(), command.durationMs)
        } catch (_: ArithmeticException) {
          operationFailure("sleep-duration-invalid")
        }
        val proposed = LoggeRythmPersistedSleepState.Time(deadline, command.fadeOutMs)
        validateCandidate(contextShuffle = contextShuffle, sleep = proposed)
        replaceSleep(proposed)
      }
      is PlayerCommand.SleepAfterMediaItemAtIndex -> {
        if (command.index !in 0 until player.mediaItemCount) operationFailure("sleep-index-invalid")
        val proposed = LoggeRythmPersistedSleepState.MediaItem(
          targetIndex = command.index,
          followsCurrentItem = command.index == player.currentMediaItemIndex,
        )
        validateCandidate(contextShuffle = contextShuffle, sleep = proposed)
        replaceSleep(proposed)
      }
      PlayerCommand.CancelSleepTimer -> replaceSleep(null)
      else -> return false
    }
    requestSave(immediate = true)
    return true
  }

  override fun onCommandApplied(command: PlayerCommand) {
    requireReady()
    when (command) {
      is PlayerCommand.SetQueue -> {
        contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
        normalizeAuxiliaryForTimeline()
        requestSave(immediate = false)
      }
      PlayerCommand.ClearQueue -> {
        contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
        replaceSleep(null)
        requestSave(immediate = true)
      }
      PlayerCommand.Pause, PlayerCommand.Stop -> requestSave(immediate = true)
      PlayerCommand.Play,
      is PlayerCommand.SeekTo,
      PlayerCommand.SkipToNext,
      PlayerCommand.SkipToPrevious,
      is PlayerCommand.SetRepeatMode -> requestSave(immediate = false)
      PlayerCommand.DisableGlobalShuffle,
      is PlayerCommand.SetCommands -> Unit
      PlayerCommand.RefreshSnapshot -> Unit
      is PlayerCommand.SetQueuePersistenceState,
      is PlayerCommand.SleepAfterTime,
      is PlayerCommand.SleepAfterMediaItemAtIndex,
      PlayerCommand.CancelSleepTimer -> Unit
    }
  }

  override fun onLiveQueueCleared() {
    if (!isReady()) return
    contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
    replaceSleep(null)
    requestSave(immediate = true)
  }

  override fun publicState(): LoggeRythmPersistedPublicState {
    return LoggeRythmPersistedPublicState(
      contextShuffleEnabled = contextShuffle.enabled,
      contextShuffleRestoreOrder = contextShuffle.restoreOrder.toList(),
      sleepTimer = sleep.toPublicSnapshot(nowEpochMs()),
    )
  }

  override fun clearPersistedState(
    callback: (Result<LoggeRythmCacheClearResult>) -> Unit,
  ) {
    if (closed) {
      callback(failure("player-persistence-closed"))
      return
    }
    if (boundaryActive) {
      callback(failure("player-cleanup-active"))
      return
    }
    val ticket = generation.advance()
    ready = false
    boundaryActive = true
    cancelScheduledWork()
    clearLivePlayer(clearSession = true)
    val toClear = persistence
    persistence = null
    binding = null
    clearEncryptedAndCache(toClear) { result ->
      if (!generation.isCurrent(ticket) || closed) return@clearEncryptedAndCache
      boundaryActive = false
      result.fold(
        onSuccess = { callback(Result.success(it)) },
        onFailure = { callback(Result.failure(it)) },
      )
    }
  }

  fun close() {
    if (closed) return
    closed = true
    generation.advance()
    ready = false
    boundaryActive = true
    cancelScheduledWork()
    player.removeListener(listener)
    restoreFadeVolume()
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    // Let an already admitted save/logout clear finish; lifecycle tickets make its callback stale.
    ioExecutor.shutdown()
  }

  private fun beginBoundary(nextBinding: LoggeRythmPersistedSessionBinding): Long {
    val ticket = generation.advance()
    ready = false
    boundaryActive = true
    cancelScheduledWork()
    clearLivePlayer(clearSession = false)
    LoggeRythmPlayerRuntime.bindSession(nextBinding)
    binding = nextBinding
    persistence = null
    contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
    sleep = null
    return ticket
  }

  private fun completeLoad(
    ticket: Long,
    binding: LoggeRythmPersistedSessionBinding,
    outcome: LoggeRythmEncryptedLoadOutcome,
    callback: (Result<Unit>) -> Unit,
  ) {
    when (outcome) {
      is LoggeRythmEncryptedLoadOutcome.Restored -> {
        try {
          val normalizedExpiredSleep = applyRestoredState(outcome.state)
          markReady(ticket, callback)
          if (normalizedExpiredSleep) requestSave(immediate = true)
        } catch (error: Exception) {
          failSetup(ticket, error, callback)
        }
      }
      LoggeRythmEncryptedLoadOutcome.Absent,
      LoggeRythmEncryptedLoadOutcome.DiscardedInvalid -> {
        clearCache { cacheResult ->
          mainHandler.post {
            if (!generation.isCurrent(ticket) || closed) return@post
            cacheResult.fold(
              onSuccess = { cleared ->
                if (!cleared.verified) {
                  failSetup(ticket, operationError("player-cache-clear-unverified"), callback)
                } else {
                  createEmptyBaseline(ticket, binding, callback)
                }
              },
              onFailure = { failSetup(ticket, it, callback) },
            )
          }
        }
      }
    }
  }

  private fun createEmptyBaseline(
    ticket: Long,
    binding: LoggeRythmPersistedSessionBinding,
    callback: (Result<Unit>) -> Unit,
  ) {
    if (!generation.isCurrent(ticket) || closed) return
    val active = createPersistence(binding)
    persistence = active
    active.save(emptyState(binding)) { result ->
      mainHandler.post {
        if (!generation.isCurrent(ticket) || closed) return@post
        result.fold(
          onSuccess = { markReady(ticket, callback) },
          onFailure = { failSetup(ticket, it, callback) },
        )
      }
    }
  }

  private fun markReady(ticket: Long, callback: (Result<Unit>) -> Unit) {
    if (!generation.isCurrent(ticket) || closed) return
    boundaryActive = false
    ready = true
    lastKnownIndex = player.currentMediaItemIndex
    scheduleSleep()
    updateHeartbeat()
    callback(Result.success(Unit))
  }

  private fun applyRestoredState(state: LoggeRythmPersistedPlayerState): Boolean {
    if (state.sessionBinding != binding) operationFailure("session-binding-mismatch")
    player.pause()
    player.stop()
    player.repeatMode = persistedRepeatMode(state.repeatMode)
    player.shuffleModeEnabled = false
    val mediaItems = LoggeRythmPlayerRuntime.installQueue(
      state.queue.map { it.toPlayerItemSpec() },
    )
    if (mediaItems.isEmpty()) {
      player.clearMediaItems()
    } else {
      player.setMediaItems(mediaItems, checkNotNull(state.activeIndex), state.positionMs)
      player.prepare()
      player.pause()
    }
    contextShuffle = state.contextShuffle
    sleep = state.sleep
    val normalizedExpiredSleep = sleep is LoggeRythmPersistedSleepState.Time &&
      (sleep as LoggeRythmPersistedSleepState.Time).triggerAtEpochMs <= nowEpochMs()
    if (normalizedExpiredSleep) {
      sleep = null
    }
    return normalizedExpiredSleep
  }

  private fun validateCandidate(
    contextShuffle: LoggeRythmPersistedContextShuffle,
    sleep: LoggeRythmPersistedSleepState?,
  ) {
    val encoded = codec.encode(captureState(contextShuffle, sleep))
    encoded.fill(0)
  }

  private fun captureState(
    contextShuffle: LoggeRythmPersistedContextShuffle = this.contextShuffle,
    sleep: LoggeRythmPersistedSleepState? = this.sleep,
  ): LoggeRythmPersistedPlayerState {
    val activeBinding = binding ?: operationFailure("player-session-unbound")
    val timeline = List(player.mediaItemCount, player::getMediaItemAt)
    val sources = LoggeRythmPlayerRuntime.captureQueue(timeline)
    if (sources.isEmpty()) {
      return LoggeRythmPersistedPlayerState(
        sessionBinding = activeBinding,
        queue = emptyList(),
        activeIndex = null,
        positionMs = 0L,
        repeatMode = playerRepeatMode(player.repeatMode),
        contextShuffle = contextShuffle,
        sleep = sleep,
      )
    }
    val activeIndex = player.currentMediaItemIndex
    if (activeIndex !in sources.indices) operationFailure("player-timeline-not-ready")
    return LoggeRythmPersistedPlayerState(
      sessionBinding = activeBinding,
      queue = sources.map(PlayerItemSpec::toPersistedQueueItem),
      activeIndex = activeIndex,
      positionMs = player.currentPosition.coerceAtLeast(0L),
      repeatMode = playerRepeatMode(player.repeatMode),
      contextShuffle = contextShuffle,
      sleep = sleep,
    )
  }

  private fun emptyState(binding: LoggeRythmPersistedSessionBinding) =
    LoggeRythmPersistedPlayerState(
      sessionBinding = binding,
      queue = emptyList(),
      activeIndex = null,
      positionMs = 0L,
      repeatMode = "off",
      contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList()),
      sleep = null,
    )

  private fun requestSave(immediate: Boolean) {
    if (!isReady()) return
    mainHandler.removeCallbacks(saveRunnable)
    if (immediate) mainHandler.post(saveRunnable)
    else mainHandler.postDelayed(saveRunnable, SAVE_DEBOUNCE_MS)
  }

  private fun persistNow(ticket: Long) {
    if (!generation.isCurrent(ticket) || !isReady()) return
    val state = try {
      captureState()
    } catch (error: LoggeRythmPersistedPlayerException) {
      if (error.code == "player-timeline-not-ready") {
        requestSave(immediate = false)
      } else {
        failClosedAfterSave(ticket)
      }
      return
    } catch (_: Exception) {
      failClosedAfterSave(ticket)
      return
    }
    val active = persistence ?: run {
      failClosedAfterSave(ticket)
      return
    }
    active.save(state) { result ->
      mainHandler.post {
        if (!generation.isCurrent(ticket) || closed) return@post
        if (result.isFailure) failClosedAfterSave(ticket)
      }
    }
  }

  private fun failClosedAfterSave(ticket: Long) {
    if (!generation.isCurrent(ticket) || closed) return
    generation.advance()
    ready = false
    boundaryActive = true
    cancelScheduledWork()
    clearLivePlayer(clearSession = true)
    val toClear = persistence
    persistence = null
    binding = null
    clearEncryptedAndCache(toClear) {
      if (!closed) boundaryActive = false
    }
  }

  private fun failSetup(
    ticket: Long,
    cause: Throwable,
    callback: (Result<Unit>) -> Unit,
  ) {
    if (!generation.isCurrent(ticket) || closed) return
    val failure = when (cause) {
      is LoggeRythmPersistedPlayerException -> cause
      is LoggeRythmPersistedStateException -> operationError(cause.code)
      else -> operationError("player-persistence-setup-failed")
    }
    val cleanupTicket = generation.advance()
    ready = false
    boundaryActive = true
    cancelScheduledWork()
    clearLivePlayer(clearSession = true)
    val toClear = persistence
    persistence = null
    binding = null
    clearEncryptedAndCache(toClear) {
      if (!generation.isCurrent(cleanupTicket) || closed) return@clearEncryptedAndCache
      boundaryActive = false
      callback(Result.failure(failure))
    }
  }

  private fun clearEncryptedAndCache(
    activePersistence: LoggeRythmEncryptedPersistence?,
    callback: (Result<LoggeRythmCacheClearResult>) -> Unit,
  ) {
    var encryptedResult: Result<Unit>? = null
    var cacheResult: Result<LoggeRythmCacheClearResult>? = null

    fun finishIfComplete() {
      val encrypted = encryptedResult ?: return
      val cache = cacheResult ?: return
      val combinedFailure = encrypted.exceptionOrNull() ?: cache.exceptionOrNull()
      val cleared = cache.getOrNull()
      when {
        combinedFailure != null -> callback(Result.failure(combinedFailure))
        cleared == null || !cleared.verified ->
          callback(failure("player-cache-clear-unverified"))
        else -> callback(Result.success(cleared))
      }
    }

    val encryptedCallback: (Result<Unit>) -> Unit = { result ->
      mainHandler.post {
        encryptedResult = result
        finishIfComplete()
      }
    }
    if (activePersistence != null) {
      activePersistence.clear(encryptedCallback)
    } else {
      clearRawEncryptedArtifacts(encryptedCallback)
    }
    clearCache { result ->
      mainHandler.post {
        cacheResult = result
        finishIfComplete()
      }
    }
  }

  private fun clearRawEncryptedArtifacts(callback: (Result<Unit>) -> Unit) {
    try {
      ioExecutor.execute {
        var failure: Exception? = null
        try {
          LoggeRythmEncryptedAndroidKeyStoreCipher().clearKey()
        } catch (error: Exception) {
          failure = error
        }
        try {
          LoggeRythmEncryptedAndroidBlobFile(appContext).clear()
        } catch (error: Exception) {
          failure?.addSuppressed(error) ?: run { failure = error }
        }
        callback(failure?.let { Result.failure<Unit>(it) } ?: Result.success(Unit))
      }
    } catch (error: Exception) {
      callback(Result.failure(error))
    }
  }

  private fun clearLivePlayer(clearSession: Boolean) {
    restoreFadeVolume()
    player.pause()
    player.stop()
    player.clearMediaItems()
    if (clearSession) LoggeRythmPlayerRuntime.clearSessionAndAllData()
    else LoggeRythmPlayerRuntime.clearAllHeadersAndBrowseTree()
    contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
    sleep = null
    lastKnownIndex = C.INDEX_UNSET
  }

  private fun normalizeAuxiliaryForTimeline() {
    if (player.mediaItemCount == 0) {
      contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
      replaceSleep(null)
      return
    }
    val activeSleep = sleep
    if (activeSleep is LoggeRythmPersistedSleepState.MediaItem) {
      val normalized = when {
        activeSleep.followsCurrentItem && player.currentMediaItemIndex in 0 until player.mediaItemCount ->
          activeSleep.copy(targetIndex = player.currentMediaItemIndex)
        activeSleep.targetIndex !in 0 until player.mediaItemCount -> null
        else -> activeSleep
      }
      if (normalized != activeSleep) replaceSleep(normalized)
    }
  }

  private fun replaceSleep(value: LoggeRythmPersistedSleepState?) {
    restoreFadeVolume()
    mainHandler.removeCallbacks(sleepRunnable)
    sleep = value
    scheduleSleep()
  }

  private fun scheduleSleep() {
    mainHandler.removeCallbacks(sleepRunnable)
    val active = sleep as? LoggeRythmPersistedSleepState.Time ?: return
    val fadeStart = active.triggerAtEpochMs - active.fadeOutMs
    val delay = (fadeStart - nowEpochMs()).coerceAtLeast(0L)
    mainHandler.postDelayed(sleepRunnable, delay)
  }

  private fun handleTimeSleepTick() {
    if (!isReady()) return
    val active = sleep as? LoggeRythmPersistedSleepState.Time ?: return
    val now = nowEpochMs()
    if (now >= active.triggerAtEpochMs) {
      player.pause()
      restoreFadeVolume()
      sleep = null
      requestSave(immediate = true)
      return
    }
    val fadeStart = active.triggerAtEpochMs - active.fadeOutMs
    if (active.fadeOutMs > 0L && now >= fadeStart) {
      val base = fadeBaseVolume ?: player.volume.also { fadeBaseVolume = it }
      val remaining = (active.triggerAtEpochMs - now).coerceAtLeast(0L)
      val ratio = (remaining.toDouble() / active.fadeOutMs.toDouble()).coerceIn(0.0, 1.0)
      player.volume = (base * ratio.toFloat()).coerceIn(0f, 1f)
      mainHandler.postDelayed(sleepRunnable, SLEEP_FADE_TICK_MS.coerceAtMost(remaining))
    } else {
      mainHandler.postDelayed(sleepRunnable, (fadeStart - now).coerceAtLeast(1L))
    }
  }

  private fun restoreFadeVolume() {
    fadeBaseVolume?.let { player.volume = it }
    fadeBaseVolume = null
  }

  private fun handleMediaItemTransition(reason: Int) {
    val active = sleep as? LoggeRythmPersistedSleepState.MediaItem ?: return
    val automatic = reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO ||
      reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT
    if (automatic && lastKnownIndex == active.targetIndex) {
      player.pause()
      replaceSleep(null)
      requestSave(immediate = true)
      return
    }
    if (active.followsCurrentItem && player.currentMediaItemIndex in 0 until player.mediaItemCount) {
      val updated = active.copy(targetIndex = player.currentMediaItemIndex)
      if (updated != active) {
        sleep = updated
        requestSave(immediate = true)
      }
    }
  }

  private fun handleMediaItemSleepAtEnd() {
    val active = sleep as? LoggeRythmPersistedSleepState.MediaItem ?: return
    if (player.playbackState == Player.STATE_ENDED && player.currentMediaItemIndex == active.targetIndex) {
      player.pause()
      replaceSleep(null)
      requestSave(immediate = true)
    }
  }

  private fun updateHeartbeat() {
    mainHandler.removeCallbacks(heartbeatRunnable)
    if (isReady() && player.isPlaying) {
      mainHandler.postDelayed(heartbeatRunnable, POSITION_HEARTBEAT_MS)
    }
  }

  private fun cancelScheduledWork() {
    mainHandler.removeCallbacks(saveRunnable)
    mainHandler.removeCallbacks(heartbeatRunnable)
    mainHandler.removeCallbacks(sleepRunnable)
    restoreFadeVolume()
  }

  private fun createPersistence(
    expectedBinding: LoggeRythmPersistedSessionBinding,
  ): LoggeRythmEncryptedPersistence = LoggeRythmEncryptedPersistence(
    store = LoggeRythmEncryptedStateStore(
      codec = codec,
      cipher = LoggeRythmEncryptedAndroidKeyStoreCipher(),
      blobFile = LoggeRythmEncryptedAndroidBlobFile(appContext),
      expectedBinding = expectedBinding,
    ),
    ioExecutor = ioExecutor,
  )

  private fun requireReady() {
    if (!isReady()) operationFailure("player-session-not-ready")
  }

  private fun playerRepeatMode(value: Int): String = when (value) {
    Player.REPEAT_MODE_ONE -> "one"
    Player.REPEAT_MODE_ALL -> "all"
    else -> "off"
  }

  private fun persistedRepeatMode(value: String): Int = when (value) {
    "one" -> Player.REPEAT_MODE_ONE
    "all" -> Player.REPEAT_MODE_ALL
    else -> Player.REPEAT_MODE_OFF
  }

  private fun operationError(code: String) = LoggeRythmPersistedPlayerException(code)

  private fun operationFailure(code: String): Nothing = throw operationError(code)

  private fun <T> failure(code: String): Result<T> = Result.failure(operationError(code))

  companion object {
    private const val SAVE_DEBOUNCE_MS = 300L
    private const val POSITION_HEARTBEAT_MS = 15_000L
    private const val SLEEP_FADE_TICK_MS = 250L
  }
}
