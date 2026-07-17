package top.logge.loggerythm.updater

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
        context.startActivity(confirmation)
      }
      PackageInstaller.STATUS_SUCCESS -> {
        Log.i(TAG, "Verified LoggeRythm update installed")
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
