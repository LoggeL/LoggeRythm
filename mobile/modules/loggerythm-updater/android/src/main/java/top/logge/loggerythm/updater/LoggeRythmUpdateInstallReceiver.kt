package top.logge.loggerythm.updater

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import android.widget.Toast

class LoggeRythmUpdateInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(
      PackageInstaller.EXTRA_STATUS,
      PackageInstaller.STATUS_FAILURE,
    )
    when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirmation = confirmationIntent(intent)
          ?: throw IllegalStateException("updater-install-confirmation-missing")
        confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Android 10+ silently drops startActivity from a background app, so
        // the installer confirmation must ride a notification in that case.
        if (appInForeground()) {
          context.startActivity(confirmation)
        } else {
          postNotification(
            context,
            "LoggeRythm update ready",
            "Tap to confirm the installation.",
            activityPendingIntent(context, confirmation),
          )
        }
      }
      PackageInstaller.STATUS_SUCCESS -> {
        Log.i(TAG, "Verified LoggeRythm update installed")
        relaunchApp(context)
      }
      else -> {
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
          ?: "Android package installer returned status $status"
        Log.e(TAG, "Update installation failed: $message")
        Toast.makeText(
          context,
          "LoggeRythm update installation failed: $message",
          Toast.LENGTH_LONG,
        ).show()
      }
    }
  }

  private fun relaunchApp(context: Context) {
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    if (launchIntent == null) {
      Log.e(TAG, "Updated LoggeRythm has no launch activity")
      return
    }
    launchIntent.addFlags(
      Intent.FLAG_ACTIVITY_NEW_TASK or
        Intent.FLAG_ACTIVITY_CLEAR_TASK,
    )
    // The old process died with the self-update, so this receiver runs in a
    // fresh background process: startActivity would be silently dropped on
    // Android 10+. Offer the relaunch through a notification instead.
    if (appInForeground()) {
      try {
        context.startActivity(launchIntent)
        return
      } catch (error: RuntimeException) {
        Log.e(TAG, "Updated LoggeRythm could not be relaunched directly", error)
      }
    }
    postNotification(
      context,
      "LoggeRythm updated",
      "Tap to open the new version.",
      activityPendingIntent(context, launchIntent),
    )
  }

  private fun appInForeground(): Boolean {
    val state = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(state)
    return state.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private fun activityPendingIntent(context: Context, intent: Intent): PendingIntent =
    PendingIntent.getActivity(
      context,
      NOTIFICATION_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun postNotification(
    context: Context,
    title: String,
    text: String,
    contentIntent: PendingIntent,
  ) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          "App updates",
          NotificationManager.IMPORTANCE_HIGH,
        ),
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context).setPriority(Notification.PRIORITY_HIGH)
    }
    val notification = builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentIntent(contentIntent)
      .setAutoCancel(true)
      .build()
    manager.notify(NOTIFICATION_ID, notification)
  }

  @Suppress("DEPRECATION")
  private fun confirmationIntent(source: Intent): Intent? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      source.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
    } else {
      source.getParcelableExtra(Intent.EXTRA_INTENT)
    }

  companion object {
    private const val TAG = "LoggeRythmUpdater"
    private const val REQUEST_CODE = 0x5550
    private const val NOTIFICATION_REQUEST_CODE = 0x5551
    private const val NOTIFICATION_ID = 0x5552
    private const val CHANNEL_ID = "loggerythm-updates"

    fun statusIntent(context: Context): PendingIntent {
      val intent = Intent(context, LoggeRythmUpdateInstallReceiver::class.java)
        .setPackage(context.packageName)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          PendingIntent.FLAG_MUTABLE
        } else {
          0
        }
      return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
    }
  }
}
