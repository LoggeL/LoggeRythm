package top.logge.loggerythm.player

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.ReactNativeHost
import com.facebook.react.bridge.ReactContext
import com.facebook.react.internal.featureflags.ReactNativeNewArchitectureFeatureFlags
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal enum class LoggeRythmPlaybackJournalWorkSlot {
  A,
  B,
}

/**
 * The only information allowed to cross the WorkManager boundary is the existence and timing of
 * an opaque "the encrypted journal may be nonempty" signal. Work requests deliberately use empty
 * input data and carry no account, event, media, URL, header, or cookie value.
 */
internal interface LoggeRythmPlaybackJournalWorkBackend {
  fun replace(
    slot: LoggeRythmPlaybackJournalWorkSlot,
    delayMs: Long,
    callback: (kotlin.Result<Unit>) -> Unit,
  )
  fun cancel()
}

/**
 * Bounds scheduling to the running worker plus at most one independently replaceable successor.
 *
 * Replacing the running WorkSpec would stop the worker between authenticated restore and the
 * Headless task. The opposite slot can instead be moved to an earlier deadline without touching
 * the running slot. Both slot tags are implementation-only constants, never application data.
 */
internal class LoggeRythmPlaybackJournalWorkArbiter {
  private var activeSlot: LoggeRythmPlaybackJournalWorkSlot? = null

  @Synchronized
  fun workerStarted(slot: LoggeRythmPlaybackJournalWorkSlot): Boolean {
    if (activeSlot != null) return false
    activeSlot = slot
    return true
  }

  @Synchronized
  fun workerFinished(slot: LoggeRythmPlaybackJournalWorkSlot) {
    if (activeSlot == slot) activeSlot = null
  }

  @Synchronized
  fun isWorkerRunning(): Boolean = activeSlot != null

  fun schedule(
    backend: LoggeRythmPlaybackJournalWorkBackend,
    delayMs: Long,
    callback: (kotlin.Result<Unit>) -> Unit = {},
  ) {
    require(delayMs >= 0L) { "playback-journal-work-delay-invalid" }
    val target = synchronized(this) {
      when (activeSlot) {
        LoggeRythmPlaybackJournalWorkSlot.A -> LoggeRythmPlaybackJournalWorkSlot.B
        LoggeRythmPlaybackJournalWorkSlot.B -> LoggeRythmPlaybackJournalWorkSlot.A
        null -> LoggeRythmPlaybackJournalWorkSlot.A
      }
    }
    backend.replace(target, delayMs, callback)
  }

  fun cancel(backend: LoggeRythmPlaybackJournalWorkBackend) {
    backend.cancel()
  }
}

/** Pure ordering contract used by every encrypted candidate that retains at least one event. */
internal object LoggeRythmPlaybackJournalDurableAdmission {
  fun admit(
    candidateNonempty: Boolean,
    prearm: ((kotlin.Result<Unit>) -> Unit) -> Unit,
    persist: () -> Unit,
    reject: (Throwable) -> Unit,
  ) {
    if (!candidateNonempty) {
      persist()
      return
    }
    prearm { result ->
      result.fold(
        onSuccess = { persist() },
        onFailure = reject,
      )
    }
  }
}

internal class LoggeRythmPlaybackJournalScheduler(
  context: Context,
  private val backend: LoggeRythmPlaybackJournalWorkBackend =
    AndroidPlaybackJournalWorkBackend(context.applicationContext),
) {
  private val mainHandler = Handler(Looper.getMainLooper())

  fun schedule(delayMs: Long) {
    RUNTIME.schedule(backend, delayMs)
  }

  /**
   * Completes only after WorkManager has committed the opaque WorkSpec to its own database.
   * Callers use this as the first half of the journal acceptance protocol: a spurious wake after
   * a later encrypted-save abort is safe, while an encrypted event without this signal is not.
   */
  fun prearm(callback: (kotlin.Result<Unit>) -> Unit) {
    val settled = AtomicBoolean(false)
    val timeout = Runnable {
      if (settled.compareAndSet(false, true)) {
        callback(
          kotlin.Result.failure(
            LoggeRythmPersistedPlayerException("playback-journal-work-commit-timeout"),
          ),
        )
      }
    }
    mainHandler.postDelayed(timeout, WORK_COMMIT_TIMEOUT_MS)
    try {
      RUNTIME.schedule(backend, 0L) { result ->
        mainHandler.post {
          if (!settled.compareAndSet(false, true)) return@post
          mainHandler.removeCallbacks(timeout)
          callback(result)
        }
      }
    } catch (error: Exception) {
      mainHandler.removeCallbacks(timeout)
      if (settled.compareAndSet(false, true)) callback(kotlin.Result.failure(error))
    }
  }

  fun cancel() {
    RUNTIME.cancel(backend)
  }

  fun workerStarted(slot: LoggeRythmPlaybackJournalWorkSlot): Boolean =
    RUNTIME.workerStarted(slot)

  fun workerFinished(slot: LoggeRythmPlaybackJournalWorkSlot) {
    RUNTIME.workerFinished(slot)
  }

  fun isWorkerRunning(): Boolean = RUNTIME.isWorkerRunning()

  private class AndroidPlaybackJournalWorkBackend(
    context: Context,
  ) : LoggeRythmPlaybackJournalWorkBackend {
    private val workManager = WorkManager.getInstance(context)

    override fun replace(
      slot: LoggeRythmPlaybackJournalWorkSlot,
      delayMs: Long,
      callback: (kotlin.Result<Unit>) -> Unit,
    ) {
      val operation = workManager.enqueueUniqueWork(
        workName(slot),
        ExistingWorkPolicy.REPLACE,
        request(slot, delayMs),
      )
      val result = operation.result
      result.addListener(
        {
          callback(
            try {
              result.get()
              kotlin.Result.success(Unit)
            } catch (error: Exception) {
              kotlin.Result.failure(error)
            },
          )
        },
        DIRECT_EXECUTOR,
      )
    }

    override fun cancel() {
      workManager.cancelUniqueWork(WORK_NAME_A)
      workManager.cancelUniqueWork(WORK_NAME_B)
    }

    private fun request(
      slot: LoggeRythmPlaybackJournalWorkSlot,
      delayMs: Long,
    ): OneTimeWorkRequest =
      OneTimeWorkRequest.Builder(LoggeRythmPlaybackJournalWorker::class.java)
        .addTag(workTag(slot))
        .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
        .setBackoffCriteria(
          BackoffPolicy.EXPONENTIAL,
          MIN_BACKOFF_MS,
          TimeUnit.MILLISECONDS,
        )
        .build()
  }

  companion object {
    internal const val WORK_NAME_A =
      "top.logge.loggerythm.player.PLAYBACK_JOURNAL_MAY_BE_NONEMPTY_A"
    internal const val WORK_NAME_B =
      "top.logge.loggerythm.player.PLAYBACK_JOURNAL_MAY_BE_NONEMPTY_B"
    internal const val WORK_TAG_A =
      "top.logge.loggerythm.player.PLAYBACK_JOURNAL_SLOT_A"
    internal const val WORK_TAG_B =
      "top.logge.loggerythm.player.PLAYBACK_JOURNAL_SLOT_B"
    internal const val MIN_BACKOFF_MS = 30_000L
    internal const val WORK_COMMIT_TIMEOUT_MS = 10_000L
    private val RUNTIME = LoggeRythmPlaybackJournalWorkArbiter()
    private val DIRECT_EXECUTOR = java.util.concurrent.Executor { command -> command.run() }

    internal fun workName(slot: LoggeRythmPlaybackJournalWorkSlot): String = when (slot) {
      LoggeRythmPlaybackJournalWorkSlot.A -> WORK_NAME_A
      LoggeRythmPlaybackJournalWorkSlot.B -> WORK_NAME_B
    }

    internal fun workTag(slot: LoggeRythmPlaybackJournalWorkSlot): String = when (slot) {
      LoggeRythmPlaybackJournalWorkSlot.A -> WORK_TAG_A
      LoggeRythmPlaybackJournalWorkSlot.B -> WORK_TAG_B
    }
  }
}

internal enum class LoggeRythmPlaybackJournalWakeDecision {
  EMPTY,
  WAITING,
  DISPATCH,
}

/**
 * Restores the native authority before JavaScript is allowed to observe a claim.
 *
 * WorkManager already owns the process wake lock. The worker binds (rather than starts) the
 * Media3 service, so Android 8-16 background-service start limits are never bypassed. The service
 * remains bound until the empty-payload Headless task finishes.
 */
class LoggeRythmPlaybackJournalWorker(
  appContext: Context,
  workerParameters: WorkerParameters,
) : Worker(appContext, workerParameters) {
  override fun doWork(): Result {
    val slot = when {
      tags.contains(LoggeRythmPlaybackJournalScheduler.WORK_TAG_A) ->
        LoggeRythmPlaybackJournalWorkSlot.A
      tags.contains(LoggeRythmPlaybackJournalScheduler.WORK_TAG_B) ->
        LoggeRythmPlaybackJournalWorkSlot.B
      else -> return Result.failure()
    }
    val scheduler = LoggeRythmPlaybackJournalScheduler(applicationContext)
    if (!scheduler.workerStarted(slot)) return Result.retry()
    var connection: ServiceConnection? = null
    var bound = false
    return try {
      val preparation = bindAndPrepare()
      connection = preparation.connection
      bound = preparation.bound
      if (isStopped) return Result.success()
      preparation.result.fold(
        onSuccess = { decision ->
          when (decision) {
            // Empty cancellation is linearized on the coordinator's main/FIFO journal path.
            // Repeating it here from the worker thread could erase a newer event's prearmed slot.
            LoggeRythmPlaybackJournalWakeDecision.EMPTY -> Result.success()
            LoggeRythmPlaybackJournalWakeDecision.WAITING -> Result.success()
            LoggeRythmPlaybackJournalWakeDecision.DISPATCH -> {
              if (
                LoggeRythmPlaybackEventHeadlessTaskRunner(applicationContext)
                  .runUntilFinished()
              ) {
                Result.success()
              } else {
                Result.retry()
              }
            }
          }
        },
        onFailure = { Result.retry() },
      )
    } finally {
      if (bound && connection != null) {
        runCatching { applicationContext.unbindService(connection) }
      }
      scheduler.workerFinished(slot)
    }
  }

  private fun bindAndPrepare(): BoundPreparation {
    val completed = CountDownLatch(1)
    val settled = AtomicBoolean(false)
    val result = AtomicReference<kotlin.Result<LoggeRythmPlaybackJournalWakeDecision>>()
    fun settle(value: kotlin.Result<LoggeRythmPlaybackJournalWakeDecision>) {
      if (!settled.compareAndSet(false, true)) return
      result.set(value)
      completed.countDown()
    }

    val connection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
        LoggeRythmPersistedServiceBridge.preparePlaybackJournalWake(::settle)
      }

      override fun onServiceDisconnected(name: ComponentName?) {
        settle(failure("playback-journal-service-disconnected"))
      }

      override fun onNullBinding(name: ComponentName?) {
        settle(failure("playback-journal-service-null-binding"))
      }

      override fun onBindingDied(name: ComponentName?) {
        settle(failure("playback-journal-service-binding-died"))
      }
    }
    val intent = Intent(MEDIA_LIBRARY_SERVICE_ACTION).setComponent(
      ComponentName(applicationContext.packageName, MEDIA_LIBRARY_SERVICE_CLASS),
    )
    val bound = try {
      applicationContext.bindService(intent, connection, Context.BIND_AUTO_CREATE)
    } catch (_: Exception) {
      false
    }
    if (!bound) {
      settle(failure("playback-journal-service-bind-failed"))
    }
    try {
      if (!completed.await(SERVICE_PREPARATION_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
        settle(failure("playback-journal-service-restore-timeout"))
      }
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      settle(failure("playback-journal-worker-interrupted"))
    }
    return BoundPreparation(
      connection = connection,
      bound = bound,
      result = result.get() ?: failure("playback-journal-service-restore-failed"),
    )
  }

  private data class BoundPreparation(
    val connection: ServiceConnection,
    val bound: Boolean,
    val result: kotlin.Result<LoggeRythmPlaybackJournalWakeDecision>,
  )

  private fun failure(
    code: String,
  ): kotlin.Result<LoggeRythmPlaybackJournalWakeDecision> =
    kotlin.Result.failure(LoggeRythmPersistedPlayerException(code))

  companion object {
    private const val MEDIA_LIBRARY_SERVICE_ACTION =
      "androidx.media3.session.MediaLibraryService"
    private const val MEDIA_LIBRARY_SERVICE_CLASS =
      "top.logge.loggerythm.player.LoggeRythmMediaLibraryService"
    private const val SERVICE_PREPARATION_TIMEOUT_MS = 30_000L
  }
}

/**
 * Runs the same task key and empty payload as [LoggeRythmPlaybackEventHeadlessService], but without
 * an illegal background `startService` hop. WorkManager owns this bounded execution window.
 */
private class LoggeRythmPlaybackEventHeadlessTaskRunner(
  context: Context,
) : HeadlessJsTaskEventListener {
  private val application = context.applicationContext as? ReactApplication
  private val mainHandler = Handler(Looper.getMainLooper())
  private val completed = CountDownLatch(1)
  private val settled = AtomicBoolean(false)
  private var succeeded = false
  private var taskId = -1
  private var taskContext: HeadlessJsTaskContext? = null
  private var reactHost: ReactHost? = null
  @Suppress("DEPRECATION")
  private var reactNativeHost: ReactNativeHost? = null
  private var instanceListener: ReactInstanceEventListener? = null

  fun runUntilFinished(): Boolean {
    if (application == null) return false
    mainHandler.post(::start)
    try {
      if (!completed.await(TASK_RUNNER_TIMEOUT_MS, TimeUnit.MILLISECONDS)) finish(false)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      finish(false)
    }
    return succeeded
  }

  private fun start() {
    try {
      if (ReactNativeNewArchitectureFeatureFlags.enableBridgelessArchitecture()) {
        val host = checkNotNull(application?.reactHost)
        reactHost = host
        val current = host.currentReactContext
        if (current != null) {
          startTask(current)
        } else {
          val listener = object : ReactInstanceEventListener {
            override fun onReactContextInitialized(context: ReactContext) {
              host.removeReactInstanceEventListener(this)
              instanceListener = null
              startTask(context)
            }
          }
          instanceListener = listener
          host.addReactInstanceEventListener(listener)
          host.start()
        }
      } else {
        @Suppress("DEPRECATION")
        val host = checkNotNull(application?.reactNativeHost)
        reactNativeHost = host
        val manager = host.reactInstanceManager
        val current = manager.currentReactContext
        if (current != null) {
          startTask(current)
        } else {
          val listener = object : ReactInstanceEventListener {
            override fun onReactContextInitialized(context: ReactContext) {
              manager.removeReactInstanceEventListener(this)
              instanceListener = null
              startTask(context)
            }
          }
          instanceListener = listener
          manager.addReactInstanceEventListener(listener)
          manager.createReactContextInBackground()
        }
      }
    } catch (_: Exception) {
      finish(false)
    }
  }

  private fun startTask(context: ReactContext) {
    if (settled.get()) return
    try {
      val active = HeadlessJsTaskContext.getInstance(context)
      taskContext = active
      active.addTaskEventListener(this)
      taskId = active.startTask(LoggeRythmPlaybackEventHeadlessService.taskConfig())
    } catch (_: Exception) {
      finish(false)
    }
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId == this.taskId) finish(true)
  }

  private fun finish(success: Boolean) {
    if (!settled.compareAndSet(false, true)) return
    succeeded = success
    mainHandler.post {
      taskContext?.removeTaskEventListener(this)
      instanceListener?.let { listener ->
        reactHost?.removeReactInstanceEventListener(listener)
        @Suppress("DEPRECATION")
        reactNativeHost?.reactInstanceManager?.removeReactInstanceEventListener(listener)
      }
      instanceListener = null
      completed.countDown()
    }
  }

  companion object {
    // The RN task itself times out at 60 s. Expire first so an ordinary rejected JS Promise is
    // never mistaken for a successful onHeadlessJsTaskFinish timeout callback.
    private const val TASK_RUNNER_TIMEOUT_MS = 55_000L
  }
}
