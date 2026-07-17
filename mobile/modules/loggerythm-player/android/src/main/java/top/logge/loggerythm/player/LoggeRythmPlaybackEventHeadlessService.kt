package top.logge.loggerythm.player

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Runs the bounded JavaScript drain; the encrypted journal remains native-owned. */
class LoggeRythmPlaybackEventHeadlessService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    taskConfig()

  companion object {
    internal const val TASK_KEY = "LoggeRythmPlaybackEventDrain"
    private const val TASK_TIMEOUT_MS = 60_000L

    internal fun taskConfig(): HeadlessJsTaskConfig =
      HeadlessJsTaskConfig(
        TASK_KEY,
        Arguments.createMap(),
        TASK_TIMEOUT_MS,
        true,
      )

    /**
     * Starting a background service can be denied by the platform. Returning false preserves the
     * durable event for the coordinator's next Handler wake instead of treating dispatch as ack.
     */
    internal fun tryStart(context: Context): Boolean = try {
      context.applicationContext.startService(
        Intent(context.applicationContext, LoggeRythmPlaybackEventHeadlessService::class.java),
      ) != null
    } catch (_: IllegalStateException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }
}
