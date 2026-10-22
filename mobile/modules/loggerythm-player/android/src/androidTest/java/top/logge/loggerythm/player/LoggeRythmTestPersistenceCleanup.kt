package top.logge.loggerythm.player

import android.app.Instrumentation
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Drain the service's admitted writes before a fixture deletes the shared file/key.
 * stopService() is asynchronous, and coordinator.close() permits admitted saves
 * to finish. Deleting raw artifacts first can let an old fixture overwrite the
 * next test's encrypted state with a different account binding.
 */
internal fun clearBoundPlayerTestState(instrumentation: Instrumentation) {
  val completed = CountDownLatch(1)
  val failure = AtomicReference<Throwable>()
  instrumentation.runOnMainSync {
    if (!LoggeRythmPersistedServiceBridge.isReady()) {
      // The fixture never bound an account, or already awaited its logout clear.
      completed.countDown()
    } else {
      LoggeRythmPersistedServiceBridge.clearPersistedState { result ->
        result.exceptionOrNull()?.let(failure::set)
        completed.countDown()
      }
    }
  }
  check(completed.await(10, TimeUnit.SECONDS)) { "test-persistence-clear-timeout" }
  failure.get()?.let { throw AssertionError("test-persistence-clear-failed", it) }
  check(!LoggeRythmPersistedServiceBridge.isReady()) { "test-persistence-still-ready" }
  check(LoggeRythmPlayerRuntime.currentSessionBinding() == null) { "test-session-still-bound" }
}
