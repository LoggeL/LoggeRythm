package top.logge.loggerythm.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.Process
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.util.concurrent.CountDownLatch
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
  /** `null` preserves the fail-closed distinction between unconfigured and configured-empty. */
  val remoteCapabilities: Set<RemotePlayerCapability>? = null,
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

/** One in-flight result callback that ignores duplicate/late completions and settles on close. */
internal class LoggeRythmPendingResult<T> {
  private var callback: ((Result<T>) -> Unit)? = null
  private var closed = false

  fun register(value: (Result<T>) -> Unit): Boolean {
    if (closed || callback != null) return false
    callback = value
    return true
  }

  fun finish(result: Result<T>) {
    val admitted = callback ?: return
    callback = null
    runCatching { admitted(result) }
  }

  fun close(error: Throwable) {
    if (closed) return
    closed = true
    finish(Result.failure(error))
  }
}

/**
 * Keeps an externally publishable command policy separate from a snapshot that is only staged on
 * the persistence executor. A staged widening is never returned by [publishableCapabilities], and
 * an interrupted write remains unsafe until either its committed rollback or a destructive clear
 * has completed.
 */
internal class LoggeRythmRemotePolicyDurability {
  private data class StagedUpdate(
    val ticket: Long,
    val capabilities: Set<RemotePlayerCapability>,
  )

  private var generation = 0L
  private var committed: Set<RemotePlayerCapability>? = null
  private var staged: StagedUpdate? = null
  private var unsafeDurableWrite = false

  fun hasStagedUpdate(): Boolean = staged != null

  fun beginUpdate(capabilities: Set<RemotePlayerCapability>): Long {
    check(staged == null) { "remote-policy-update-active" }
    generation = nextGeneration(generation)
    staged = StagedUpdate(generation, capabilities.toSet())
    unsafeDurableWrite = true
    return generation
  }

  fun completeUpdate(ticket: Long, succeeded: Boolean): Boolean {
    val active = staged ?: return false
    if (active.ticket != ticket || generation != ticket) return false
    staged = null
    if (succeeded) {
      committed = active.capabilities.toSet()
      unsafeDurableWrite = false
    }
    return true
  }

  /** Invalidates the staged callback and returns the ticket for its FIFO committed-state rollback. */
  fun cancelUpdateForRollback(): Long? {
    if (staged == null) return null
    generation = nextGeneration(generation)
    staged = null
    unsafeDurableWrite = true
    return generation
  }

  fun completeRollback(ticket: Long, succeeded: Boolean): Boolean {
    if (generation != ticket || staged != null) return false
    if (succeeded) unsafeDurableWrite = false
    return true
  }

  /** Invalidates every staged/rollback completion while preserving whether a write was unsafe. */
  fun beginDestructiveBoundary() {
    generation = nextGeneration(generation)
    staged = null
  }

  fun markDurableState(capabilities: Set<RemotePlayerCapability>?) {
    generation = nextGeneration(generation)
    committed = capabilities?.toSet()
    staged = null
    unsafeDurableWrite = false
  }

  fun capabilitiesForPersistence(): Set<RemotePlayerCapability>? =
    (staged?.capabilities ?: committed)?.toSet()

  /** `null` is deliberately fail-closed while a candidate or rollback is still in flight. */
  fun publishableCapabilities(): Set<RemotePlayerCapability>? =
    if (unsafeDurableWrite) null else committed?.toSet()

  fun requiresClearOnClose(): Boolean = unsafeDurableWrite

  private fun nextGeneration(value: Long): Long =
    if (value == Long.MAX_VALUE) 1L else value + 1L
}

/**
 * Serializes the two entry points that can establish the persisted account boundary.
 *
 * The service-only restore cannot know its binding until authenticated ciphertext has been
 * decoded. Exact React binds that arrive meanwhile are therefore retained here and reconciled
 * before the restore is published to any browser waiter. The class is Android-free so the race
 * contract can be exercised deterministically in local JVM tests.
 */
internal class LoggeRythmPersistedBoundaryGate {
  internal enum class BindAdmission { START_EXACT, JOINED_EXACT, DEFERRED_TO_RESTORE }
  internal enum class RestoreAdmission { START_SERVICE_RESTORE, JOINED_EXACT, JOINED_RESTORE }

  private enum class Mode { IDLE, EXACT_BIND, SERVICE_RESTORE, CLOSED }

  private var mode = Mode.IDLE
  private var exactBinding: LoggeRythmPersistedSessionBinding? = null
  private var deferredBinding: LoggeRythmPersistedSessionBinding? = null
  private val exactBindCallbacks = mutableListOf<(Result<Unit>) -> Unit>()
  private val deferredBindCallbacks = mutableListOf<(Result<Unit>) -> Unit>()
  private val restoreCallbacks = mutableListOf<(Result<Boolean>) -> Unit>()

  fun managesActiveBoundary(): Boolean = mode == Mode.EXACT_BIND || mode == Mode.SERVICE_RESTORE

  fun admitBind(
    binding: LoggeRythmPersistedSessionBinding,
    callback: (Result<Unit>) -> Unit,
  ): Result<BindAdmission> = when (mode) {
    Mode.IDLE -> {
      mode = Mode.EXACT_BIND
      exactBinding = binding
      exactBindCallbacks += callback
      Result.success(BindAdmission.START_EXACT)
    }
    Mode.EXACT_BIND -> if (exactBinding == binding) {
      exactBindCallbacks += callback
      Result.success(BindAdmission.JOINED_EXACT)
    } else {
      gateFailure("player-session-binding-active")
    }
    Mode.SERVICE_RESTORE -> if (deferredBinding == null || deferredBinding == binding) {
      deferredBinding = binding
      deferredBindCallbacks += callback
      Result.success(BindAdmission.DEFERRED_TO_RESTORE)
    } else {
      gateFailure("player-session-binding-active")
    }
    Mode.CLOSED -> gateFailure("player-persistence-closed")
  }

  fun admitRestore(callback: (Result<Boolean>) -> Unit): Result<RestoreAdmission> = when (mode) {
    Mode.IDLE -> {
      mode = Mode.SERVICE_RESTORE
      restoreCallbacks += callback
      Result.success(RestoreAdmission.START_SERVICE_RESTORE)
    }
    Mode.EXACT_BIND -> {
      restoreCallbacks += callback
      Result.success(RestoreAdmission.JOINED_EXACT)
    }
    Mode.SERVICE_RESTORE -> {
      restoreCallbacks += callback
      Result.success(RestoreAdmission.JOINED_RESTORE)
    }
    Mode.CLOSED -> gateFailure("player-persistence-closed")
  }

  fun deferredServiceBinding(): LoggeRythmPersistedSessionBinding? =
    deferredBinding.takeIf { mode == Mode.SERVICE_RESTORE }

  fun finishExact(result: Result<Unit>, restored: Boolean) {
    if (mode != Mode.EXACT_BIND) return
    val binds = exactBindCallbacks.toList()
    val restores = restoreCallbacks.toList()
    resetToIdle()
    binds.forEach { callback -> runCatching { callback(result) } }
    val restoreResult = result.map { restored }
    restores.forEach { callback -> runCatching { callback(restoreResult) } }
  }

  fun finishService(result: Result<Boolean>, deferredResult: Result<Unit>) {
    if (mode != Mode.SERVICE_RESTORE) return
    val binds = deferredBindCallbacks.toList()
    val restores = restoreCallbacks.toList()
    resetToIdle()
    binds.forEach { callback -> runCatching { callback(deferredResult) } }
    restores.forEach { callback -> runCatching { callback(result) } }
  }

  fun close() {
    if (mode == Mode.CLOSED) return
    val binds = (exactBindCallbacks + deferredBindCallbacks).toList()
    val restores = restoreCallbacks.toList()
    exactBindCallbacks.clear()
    deferredBindCallbacks.clear()
    restoreCallbacks.clear()
    exactBinding = null
    deferredBinding = null
    mode = Mode.CLOSED
    val error = LoggeRythmPersistedPlayerException("player-persistence-closed")
    binds.forEach { callback -> runCatching { callback(Result.failure(error)) } }
    restores.forEach { callback -> runCatching { callback(Result.failure(error)) } }
  }

  private fun resetToIdle() {
    exactBindCallbacks.clear()
    deferredBindCallbacks.clear()
    restoreCallbacks.clear()
    exactBinding = null
    deferredBinding = null
    mode = Mode.IDLE
  }

  private fun <T> gateFailure(code: String): Result<T> =
    Result.failure(LoggeRythmPersistedPlayerException(code))
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
  fun onBrowseTreeInstalled(callback: (Result<Unit>) -> Unit)
  fun onRemoteCommandsInstalled(
    capabilities: Set<RemotePlayerCapability>,
    callback: (Result<Unit>) -> Unit,
  )
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

  fun onBrowseTreeInstalled(callback: (Result<Unit>) -> Unit) {
    val active = synchronized(lock) { control }
    if (active == null) {
      callback(Result.failure(LoggeRythmPersistedPlayerException("player-persistence-unavailable")))
    } else {
      active.onBrowseTreeInstalled(callback)
    }
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
  private val boundaryGate = LoggeRythmPersistedBoundaryGate()

  private var persistence: LoggeRythmEncryptedPersistence? = null
  private var binding: LoggeRythmPersistedSessionBinding? = null
  private var ready = false
  private var boundaryActive = false
  private var closed = false
  private var contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
  private var sleep: LoggeRythmPersistedSleepState? = null
  private val remotePolicyDurability = LoggeRythmRemotePolicyDurability()
  private var lastKnownIndex = C.INDEX_UNSET
  private var fadeBaseVolume: Float? = null
  private val pendingClear = LoggeRythmPendingResult<LoggeRythmCacheClearResult>()

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
    if (ready && this.binding == binding) {
      callback(Result.success(Unit))
      return
    }

    if (boundaryActive && !boundaryGate.managesActiveBoundary()) {
      callback(failure("player-session-binding-active"))
      return
    }
    val admission = boundaryGate.admitBind(binding, callback)
    if (admission.isFailure) {
      callback(Result.failure(checkNotNull(admission.exceptionOrNull())))
      return
    }
    when (admission.getOrThrow()) {
      LoggeRythmPersistedBoundaryGate.BindAdmission.JOINED_EXACT,
      LoggeRythmPersistedBoundaryGate.BindAdmission.DEFERRED_TO_RESTORE -> return
      LoggeRythmPersistedBoundaryGate.BindAdmission.START_EXACT -> Unit
    }

    val previousBinding = this.binding
    val previousPersistence = persistence
    val ticket = try {
      beginBoundary(binding)
    } catch (error: Exception) {
      boundaryActive = false
      boundaryGate.finishExact(Result.failure(error), restored = false)
      return
    }
    if (previousBinding != null && previousBinding != binding) {
      clearEncryptedAndCache(previousPersistence) { result ->
        if (!generation.isCurrent(ticket) || closed) return@clearEncryptedAndCache
        result.fold(
          onSuccess = {
            createEmptyBaseline(ticket, binding) { created ->
              boundaryGate.finishExact(created, restored = false)
            }
          },
          onFailure = {
            failSetup(ticket, it) { failed ->
              boundaryGate.finishExact(failed, restored = false)
            }
          },
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
          onSuccess = { outcome ->
            completeLoad(ticket, binding, outcome) { completed, restored ->
              boundaryGate.finishExact(completed, restored)
            }
          },
          onFailure = { error ->
            failSetup(ticket, error) { failed ->
              boundaryGate.finishExact(failed, restored = false)
            }
          },
        )
      }
    }
  }

  /**
   * Cold service-only restore for a trusted media browser. The account binding is accepted only
   * from AES-GCM-authenticated state; no browser/controller value participates in the decision.
   * A later React bind for another exact account still enters the destructive account boundary.
   */
  fun restoreServiceOnly(callback: (Result<Boolean>) -> Unit) {
    if (closed) {
      callback(failure("player-persistence-closed"))
      return
    }
    if (ready) {
      callback(Result.success(true))
      return
    }

    if (boundaryActive && !boundaryGate.managesActiveBoundary()) {
      callback(failure("player-session-binding-active"))
      return
    }
    val admission = boundaryGate.admitRestore(callback)
    if (admission.isFailure) {
      callback(Result.failure(checkNotNull(admission.exceptionOrNull())))
      return
    }
    when (admission.getOrThrow()) {
      LoggeRythmPersistedBoundaryGate.RestoreAdmission.JOINED_EXACT,
      LoggeRythmPersistedBoundaryGate.RestoreAdmission.JOINED_RESTORE -> return
      LoggeRythmPersistedBoundaryGate.RestoreAdmission.START_SERVICE_RESTORE -> Unit
    }

    val ticket = generation.advance()
    ready = false
    boundaryActive = true
    remotePolicyDurability.beginDestructiveBoundary()
    cancelScheduledWork()
    clearLivePlayer(clearSession = true)
    persistence = null
    binding = null
    val bootstrap = createBootstrapPersistence()
    bootstrap.loadOutcome { result ->
      mainHandler.post {
        if (!generation.isCurrent(ticket) || closed) return@post
        result.fold(
          onSuccess = { outcome ->
            when (outcome) {
              is LoggeRythmEncryptedLoadOutcome.Restored -> {
                try {
                  val restoredBinding = outcome.state.sessionBinding
                  val requestedBinding = boundaryGate.deferredServiceBinding()
                  if (requestedBinding != null && requestedBinding != restoredBinding) {
                    discardServiceRestoreForBinding(ticket, bootstrap, requestedBinding)
                  } else {
                    LoggeRythmPlayerRuntime.bindSession(restoredBinding)
                    binding = restoredBinding
                    persistence = createPersistence(restoredBinding)
                    val normalizedExpiredSleep = applyRestoredState(outcome.state)
                    markReady(ticket) { marked ->
                      if (marked.isSuccess && normalizedExpiredSleep) {
                        requestSave(immediate = true)
                      }
                      boundaryGate.finishService(marked.map { true }, marked)
                    }
                  }
                } catch (error: Exception) {
                  failSetup(ticket, error) { failed ->
                    boundaryGate.finishService(failed.map { false }, failed)
                  }
                }
              }
              LoggeRythmEncryptedLoadOutcome.Absent,
              LoggeRythmEncryptedLoadOutcome.DiscardedInvalid -> {
                clearEncryptedAndCache(bootstrap) { cleared ->
                  if (!generation.isCurrent(ticket) || closed) return@clearEncryptedAndCache
                  val requestedBinding = boundaryGate.deferredServiceBinding()
                  if (cleared.isSuccess && requestedBinding != null) {
                    createServiceEmptyBaseline(ticket, requestedBinding)
                  } else {
                    if (cleared.isSuccess) remotePolicyDurability.markDurableState(null)
                    boundaryActive = false
                    val result = cleared.map { false }
                    boundaryGate.finishService(result, cleared.map { Unit })
                  }
                }
              }
            }
          },
          onFailure = { error ->
            failSetup(ticket, error) { failed ->
              boundaryGate.finishService(failed.map { false }, failed)
            }
          },
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

  override fun onBrowseTreeInstalled(callback: (Result<Unit>) -> Unit) {
    if (!isReady()) {
      callback(failure("player-session-not-ready"))
      return
    }
    mainHandler.removeCallbacks(saveRunnable)
    saveCurrentState(generation.current(), callback)
  }

  override fun onRemoteCommandsInstalled(
    capabilities: Set<RemotePlayerCapability>,
    callback: (Result<Unit>) -> Unit,
  ) {
    if (!isReady()) {
      callback(failure("player-session-not-ready"))
      return
    }
    if (remotePolicyDurability.hasStagedUpdate()) {
      callback(failure("player-command-policy-update-active"))
      return
    }
    val policyTicket = remotePolicyDurability.beginUpdate(capabilities)
    mainHandler.removeCallbacks(saveRunnable)
    saveCurrentState(
      ticket = generation.current(),
      completion = { result ->
        if (!remotePolicyDurability.completeUpdate(policyTicket, result.isSuccess)) {
          callback(failure("player-persistence-stale"))
        } else {
          callback(result)
        }
      },
      failClosedOnTimelineNotReady = true,
    )
  }

  /**
   * Cancels a not-yet-acknowledged command policy and queues the last committed policy behind its
   * already-admitted write on the same FIFO executor. The live policy stays fail-closed until that
   * rollback is durable (or a later acknowledged update supersedes it).
   */
  fun cancelPendingRemoteCommandUpdate() {
    if (closed) return
    val rollbackTicket = remotePolicyDurability.cancelUpdateForRollback() ?: return
    mainHandler.removeCallbacks(saveRunnable)
    saveCurrentState(
      ticket = generation.current(),
      completion = { result ->
        remotePolicyDurability.completeRollback(rollbackTicket, result.isSuccess)
      },
      failClosedOnTimelineNotReady = true,
    )
  }

  override fun publicState(): LoggeRythmPersistedPublicState {
    return LoggeRythmPersistedPublicState(
      contextShuffleEnabled = contextShuffle.enabled,
      contextShuffleRestoreOrder = contextShuffle.restoreOrder.toList(),
      sleepTimer = sleep.toPublicSnapshot(nowEpochMs()),
      remoteCapabilities = remotePolicyDurability.publishableCapabilities(),
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
    if (!pendingClear.register(callback)) {
      callback(failure("player-cleanup-active"))
      return
    }
    val ticket = generation.advance()
    try {
      ready = false
      boundaryActive = true
      remotePolicyDurability.beginDestructiveBoundary()
      cancelScheduledWork()
      clearLivePlayer(clearSession = true)
      val toClear = persistence
      persistence = null
      binding = null
      clearEncryptedAndCache(toClear) { result ->
        if (!generation.isCurrent(ticket) || closed) return@clearEncryptedAndCache
        if (result.isSuccess) remotePolicyDurability.markDurableState(null)
        boundaryActive = false
        pendingClear.finish(result)
      }
    } catch (error: Exception) {
      if (generation.isCurrent(ticket) && !closed) {
        boundaryActive = false
        pendingClear.finish(Result.failure(error))
      }
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
    boundaryGate.close()
    pendingClear.close(operationError("player-persistence-closed"))
    // Admit the clear behind all earlier saves, then wait before onDestroy can expose a new service
    // instance. Thus a policy rejected with `player-persistence-closed` cannot win a cold restore.
    val unsafePolicyClear = if (remotePolicyDurability.requiresClearOnClose()) {
      CountDownLatch(1).also { completed ->
        val completion: (Result<Unit>) -> Unit = { firstAttempt ->
          if (firstAttempt.isFailure) clearRawEncryptedArtifactsSynchronously()
          completed.countDown()
        }
        try {
          val active = persistence
          if (active == null) clearRawEncryptedArtifacts(completion) else active.clear(completion)
        } catch (_: Exception) {
          clearRawEncryptedArtifactsSynchronously()
          completed.countDown()
        }
      }
    } else {
      null
    }
    // Let admitted work finish; lifecycle tickets make every late callback stale.
    ioExecutor.shutdown()
    unsafePolicyClear?.let(::awaitUninterruptibly)
  }

  private fun beginBoundary(nextBinding: LoggeRythmPersistedSessionBinding): Long {
    val ticket = generation.advance()
    ready = false
    boundaryActive = true
    remotePolicyDurability.beginDestructiveBoundary()
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
    callback: (Result<Unit>, Boolean) -> Unit,
  ) {
    when (outcome) {
      is LoggeRythmEncryptedLoadOutcome.Restored -> {
        try {
          val normalizedExpiredSleep = applyRestoredState(outcome.state)
          markReady(ticket) { marked -> callback(marked, true) }
          if (normalizedExpiredSleep) requestSave(immediate = true)
        } catch (error: Exception) {
          failSetup(ticket, error) { failed -> callback(failed, false) }
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
                  failSetup(ticket, operationError("player-cache-clear-unverified")) { failed ->
                    callback(failed, false)
                  }
                } else {
                  createEmptyBaseline(ticket, binding) { created -> callback(created, false) }
                }
              },
              onFailure = {
                failSetup(ticket, it) { failed -> callback(failed, false) }
              },
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
          onSuccess = {
            remotePolicyDurability.markDurableState(null)
            markReady(ticket, callback)
          },
          onFailure = { failSetup(ticket, it, callback) },
        )
      }
    }
  }

  /**
   * An exact React binding that arrived while authenticated restore was reading account A wins
   * before A is installed in the runtime. The old ciphertext/key and cache are destroyed first;
   * only then is an empty baseline for the requested account made ready.
   */
  private fun discardServiceRestoreForBinding(
    ticket: Long,
    bootstrap: LoggeRythmEncryptedPersistence,
    requestedBinding: LoggeRythmPersistedSessionBinding,
  ) {
    clearEncryptedAndCache(bootstrap) { cleared ->
      if (!generation.isCurrent(ticket) || closed) return@clearEncryptedAndCache
      cleared.fold(
        onSuccess = { createServiceEmptyBaseline(ticket, requestedBinding) },
        onFailure = { error ->
          failSetup(ticket, error) { failed ->
            boundaryGate.finishService(failed.map { false }, failed)
          }
        },
      )
    }
  }

  private fun createServiceEmptyBaseline(
    ticket: Long,
    requestedBinding: LoggeRythmPersistedSessionBinding,
  ) {
    if (!generation.isCurrent(ticket) || closed) return
    try {
      LoggeRythmPlayerRuntime.bindSession(requestedBinding)
      binding = requestedBinding
      persistence = null
      contextShuffle = LoggeRythmPersistedContextShuffle(false, emptyList())
      sleep = null
    } catch (error: Exception) {
      failSetup(ticket, error) { failed ->
        boundaryGate.finishService(failed.map { false }, failed)
      }
      return
    }
    createEmptyBaseline(ticket, requestedBinding) { created ->
      boundaryGate.finishService(created.map { false }, created)
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
    state.browseTree?.let(LoggeRythmPlayerRuntime::installBrowseTree)
    remotePolicyDurability.markDurableState(state.remoteCapabilities)
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
        browseTree = LoggeRythmPlayerRuntime.persistedBrowseTree(),
        remoteCapabilities = remotePolicyDurability.capabilitiesForPersistence(),
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
      browseTree = LoggeRythmPlayerRuntime.persistedBrowseTree(),
      remoteCapabilities = remotePolicyDurability.capabilitiesForPersistence(),
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
      browseTree = null,
      remoteCapabilities = null,
    )

  private fun requestSave(immediate: Boolean) {
    if (!isReady()) return
    mainHandler.removeCallbacks(saveRunnable)
    if (immediate) mainHandler.post(saveRunnable)
    else mainHandler.postDelayed(saveRunnable, SAVE_DEBOUNCE_MS)
  }

  private fun persistNow(ticket: Long) {
    saveCurrentState(ticket, completion = null)
  }

  private fun saveCurrentState(
    ticket: Long,
    completion: ((Result<Unit>) -> Unit)?,
    failClosedOnTimelineNotReady: Boolean = false,
  ) {
    if (!generation.isCurrent(ticket) || !isReady()) {
      completion?.invoke(failure("player-persistence-stale"))
      return
    }
    val state = try {
      captureState()
    } catch (error: LoggeRythmPersistedPlayerException) {
      if (error.code == "player-timeline-not-ready" && !failClosedOnTimelineNotReady) {
        requestSave(immediate = false)
        completion?.invoke(failure("player-timeline-not-ready"))
      } else {
        failClosedAfterSave(ticket)
        completion?.invoke(Result.failure(error))
      }
      return
    } catch (_: Exception) {
      failClosedAfterSave(ticket)
      completion?.invoke(failure("player-persistence-save-failed"))
      return
    }
    val active = persistence ?: run {
      failClosedAfterSave(ticket)
      completion?.invoke(failure("player-persistence-unavailable"))
      return
    }
    try {
      active.save(state) { result ->
        mainHandler.post {
          if (!generation.isCurrent(ticket) || closed) {
            completion?.invoke(failure("player-persistence-stale"))
            return@post
          }
          if (result.isFailure) {
            failClosedAfterSave(ticket)
            completion?.invoke(failure("player-persistence-save-failed"))
          } else {
            completion?.invoke(Result.success(Unit))
          }
        }
      }
    } catch (_: Exception) {
      failClosedAfterSave(ticket)
      completion?.invoke(failure("player-persistence-save-failed"))
    }
  }

  private fun failClosedAfterSave(ticket: Long) {
    if (!generation.isCurrent(ticket) || closed) return
    generation.advance()
    ready = false
    boundaryActive = true
    remotePolicyDurability.beginDestructiveBoundary()
    cancelScheduledWork()
    clearLivePlayer(clearSession = true)
    val toClear = persistence
    persistence = null
    binding = null
    clearEncryptedAndCache(toClear) { result ->
      if (result.isSuccess) remotePolicyDurability.markDurableState(null)
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
    remotePolicyDurability.beginDestructiveBoundary()
    cancelScheduledWork()
    clearLivePlayer(clearSession = true)
    val toClear = persistence
    persistence = null
    binding = null
    clearEncryptedAndCache(toClear) { result ->
      if (!generation.isCurrent(cleanupTicket) || closed) return@clearEncryptedAndCache
      if (result.isSuccess) remotePolicyDurability.markDurableState(null)
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
    var completed = false

    fun finishIfComplete() {
      if (completed) return
      val encrypted = encryptedResult ?: return
      val cache = cacheResult ?: return
      completed = true
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
        callback(clearRawEncryptedArtifactsSynchronously())
      }
    } catch (error: Exception) {
      callback(Result.failure(error))
    }
  }

  private fun clearRawEncryptedArtifactsSynchronously(): Result<Unit> {
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
    return failure?.let { Result.failure(it) } ?: Result.success(Unit)
  }

  private fun awaitUninterruptibly(completed: CountDownLatch) {
    var interrupted = false
    while (true) {
      try {
        completed.await()
        break
      } catch (_: InterruptedException) {
        interrupted = true
      }
    }
    if (interrupted) Thread.currentThread().interrupt()
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

  private fun createBootstrapPersistence(): LoggeRythmEncryptedPersistence =
    LoggeRythmEncryptedPersistence(
      store = LoggeRythmEncryptedStateStore(
        codec = codec,
        cipher = LoggeRythmEncryptedAndroidKeyStoreCipher(),
        blobFile = LoggeRythmEncryptedAndroidBlobFile(appContext),
        expectedBinding = null,
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
