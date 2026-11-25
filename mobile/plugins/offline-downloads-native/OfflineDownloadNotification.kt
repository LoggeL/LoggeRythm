package __PACKAGE__

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo

/**
 * Foreground notification builder for background WorkManager playlist downloads so downloads
 * survive screen-off and app backgrounding under Android 12–16 foreground service limits.
 */
internal object OfflineDownloadNotification {
  const val CHANNEL_ID = "loggerythm_offline_downloads"
  const val NOTIFICATION_ID = 0x4C5202

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Offline Downloads",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shows progress while saving tracks for offline playback."
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  fun buildNotification(
    context: Context,
    done: Int,
    total: Int,
    wifiOnly: Boolean,
  ): Notification {
    ensureChannel(context)
    val safeTotal = total.coerceAtLeast(1)
    val safeDone = done.coerceIn(0, safeTotal)
    val title = if (safeDone >= safeTotal) {
      "Finishing offline download"
    } else {
      "Downloading tracks ($safeDone/$safeTotal)"
    }
    val subtitle = if (wifiOnly) "Wi-Fi only enabled" else "Saving for offline playback"
    val iconRes = context.resources.getIdentifier("ic_stat_music", "drawable", context.packageName)
      .takeIf { it != 0 }
      ?: android.R.drawable.stat_sys_download
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(iconRes)
      .setContentTitle(title)
      .setContentText(subtitle)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setProgress(safeTotal, safeDone, total <= 0)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .build()
  }

  fun foregroundInfo(
    context: Context,
    done: Int,
    total: Int,
    wifiOnly: Boolean,
  ): ForegroundInfo {
    val notification = buildNotification(context, done, total, wifiOnly)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      ForegroundInfo(NOTIFICATION_ID, notification)
    }
  }

  fun updateProgress(context: Context, done: Int, total: Int, wifiOnly: Boolean) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    runCatching {
      manager.notify(NOTIFICATION_ID, buildNotification(context, done, total, wifiOnly))
    }
  }

  fun cancel(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    runCatching { manager.cancel(NOTIFICATION_ID) }
  }
}
