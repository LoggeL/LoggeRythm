package top.logge.loggerythm.player

import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * The one explicit activity target exposed by the Media3 session.
 *
 * Media notifications and Android's native media controls launch this pending intent. Keeping its
 * construction here prevents notification-specific launch behavior from leaking into the player
 * service and guarantees that the target always belongs to the installed application package.
 */
internal object LoggeRythmSessionActivity {
  fun pendingIntent(context: Context): PendingIntent {
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: throw IllegalStateException("player-session-activity-launcher-missing")
    val component = launchIntent.component
      ?: throw IllegalStateException("player-session-activity-component-missing")
    check(component.packageName == context.packageName) {
      "player-session-activity-package-mismatch"
    }

    val explicitIntent = Intent(launchIntent)
      .setComponent(component)
      .setPackage(context.packageName)
      .addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP,
      )

    return PendingIntent.getActivity(
      context,
      REQUEST_CODE,
      explicitIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private const val REQUEST_CODE = 0x4C52
}
