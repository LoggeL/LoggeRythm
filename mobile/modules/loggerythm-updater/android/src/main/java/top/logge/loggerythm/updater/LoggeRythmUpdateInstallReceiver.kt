package top.logge.loggerythm.updater

import android.Manifest
import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.util.Log
import android.widget.Toast
import java.util.Locale

/**
 * A non-success end of an update installation session, as the JS updater
 * reads it back. [sessionId] is the PackageInstaller session it ended;
 * [versionName] and [versionCode] name the release the session installed and
 * are null only for a session created without them.
 */
data class InstallOutcome(
  val code: String,
  val message: String,
  val sessionId: Int,
  val versionName: String?,
  val versionCode: Long?,
)

internal class InvalidInstallOutcomeException(message: String) : Exception(message)

/**
 * The last non-success installation outcome, persisted so it survives a dead
 * JS runtime, a killed process and a dropped background Toast. The JS updater
 * reads and clears it (`consumeInstallOutcome`); a successful install or a new
 * session clears it too.
 */
internal object InstallOutcomeStore {
  private const val PREFERENCES = "loggerythm_updater_install_outcome"
  private const val KEY_CODE = "code"
  private const val KEY_MESSAGE = "message"
  private const val KEY_SESSION_ID = "sessionId"
  private const val KEY_VERSION_NAME = "versionName"
  private const val KEY_VERSION_CODE = "versionCode"

  private fun preferences(context: Context) =
    context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  @Synchronized
  fun save(context: Context, outcome: InstallOutcome) {
    val editor = preferences(context).edit()
      .clear()
      .putString(KEY_CODE, outcome.code)
      .putString(KEY_MESSAGE, outcome.message)
      .putInt(KEY_SESSION_ID, outcome.sessionId)
    outcome.versionName?.let { editor.putString(KEY_VERSION_NAME, it) }
    outcome.versionCode?.let { editor.putLong(KEY_VERSION_CODE, it) }
    // commit(), not apply(): this receiver's process may die right after.
    if (!editor.commit()) {
      throw UpdaterException(
        "updater-install-outcome-unsaved",
        "Android could not persist the update outcome ${outcome.code}",
      )
    }
  }

  @Synchronized
  fun clear(context: Context) {
    if (!preferences(context).edit().clear().commit()) {
      throw UpdaterException(
        "updater-install-outcome-unsaved",
        "Android could not clear the stored update outcome",
      )
    }
  }

  /** Reads and clears the stored outcome; null when there is none. */
  @Synchronized
  fun consume(context: Context): InstallOutcome? {
    val stored = preferences(context)
    if (stored.all.isEmpty()) return null
    val code = stored.getString(KEY_CODE, null)
    val message = stored.getString(KEY_MESSAGE, null)
    val sessionId = if (stored.contains(KEY_SESSION_ID)) stored.getInt(KEY_SESSION_ID, 0) else null
    val versionName = stored.getString(KEY_VERSION_NAME, null)
    val versionCode = if (stored.contains(KEY_VERSION_CODE)) {
      stored.getLong(KEY_VERSION_CODE, 0L)
    } else {
      null
    }
    // Cleared before validating: a corrupt record must fail once, loudly,
    // instead of failing every later start.
    clear(context)
    if (
      code.isNullOrBlank() ||
      message.isNullOrBlank() ||
      sessionId == null ||
      sessionId <= 0 ||
      (versionCode != null && versionCode <= 0L)
    ) {
      throw InvalidInstallOutcomeException(
        "Stored update outcome is corrupt (code=$code, message=$message, sessionId=$sessionId, " +
          "versionCode=$versionCode)",
      )
    }
    return InstallOutcome(code, message, sessionId, versionName, versionCode)
  }
}

/**
 * The PackageInstaller session the updater committed last. The install
 * receiver reports only outcomes of this session; every other one belongs to
 * an abandoned or superseded attempt.
 */
internal object InstallSessionStore {
  private const val PREFERENCES = "loggerythm_updater_install_session"
  private const val KEY_SESSION_ID = "currentSessionId"

  private fun preferences(context: Context) =
    context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  @Synchronized
  fun setCurrent(context: Context, sessionId: Int) {
    // commit(), not apply(): the receiver may read it right after the commit.
    if (!preferences(context).edit().putInt(KEY_SESSION_ID, sessionId).commit()) {
      throw UpdaterException(
        "updater-install-outcome-unsaved",
        "Android could not persist the current update session $sessionId",
      )
    }
  }

  @Synchronized
  fun clear(context: Context) {
    if (!preferences(context).edit().clear().commit()) {
      throw UpdaterException(
        "updater-install-outcome-unsaved",
        "Android could not clear the current update session",
      )
    }
  }

  /** The current session id, or null when no session is current. */
  @Synchronized
  fun current(context: Context): Int? {
    val stored = preferences(context)
    return if (stored.contains(KEY_SESSION_ID)) stored.getInt(KEY_SESSION_ID, 0) else null
  }
}

/**
 * The language the app shows, chosen inside the app (JS `activateLocale`,
 * stored in AsyncStorage), not the system language. JS hands it over with
 * `setAppLocale` every time it activates a locale, so the install receiver's
 * toasts and notifications speak the app's language even in a fresh
 * background process.
 */
internal object AppLocaleStore {
  private const val TAG = "LoggeRythmUpdater"
  private const val PREFERENCES = "loggerythm_updater_app_locale"
  private const val KEY_LOCALE = "locale"

  /**
   * The app's own default language (`DEFAULT_APP_LOCALE` in
   * src/localization). Used, and logged, only while JS has not handed over a
   * language yet, e.g. when an installer status arrives before the app ran
   * once after this update.
   */
  const val APP_DEFAULT_LOCALE = "de"
  private val SUPPORTED_LOCALES = setOf("de", "en")

  private fun preferences(context: Context) =
    context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  @Synchronized
  fun set(context: Context, locale: String) {
    if (locale !in SUPPORTED_LOCALES) {
      throw UpdaterException(
        "updater-locale-invalid",
        "App language \"$locale\" is not one of ${SUPPORTED_LOCALES.joinToString()}",
      )
    }
    // commit(), not apply(): an installer status may start a fresh process
    // that reads it right after.
    if (!preferences(context).edit().putString(KEY_LOCALE, locale).commit()) {
      throw UpdaterException(
        "updater-locale-unsaved",
        "Android could not persist the app language $locale for update notices",
      )
    }
  }

  /** The app's language; [APP_DEFAULT_LOCALE] (logged) before JS stored one. */
  @Synchronized
  fun current(context: Context): String {
    val stored = preferences(context).getString(KEY_LOCALE, null)
    if (stored == null) {
      Log.i(
        TAG,
        "No app language stored yet (the app has not run since this update); " +
          "update notices use the app default $APP_DEFAULT_LOCALE",
      )
      return APP_DEFAULT_LOCALE
    }
    if (stored !in SUPPORTED_LOCALES) {
      throw IllegalStateException(
        "updater-locale-invalid: stored app language \"$stored\" is not one of ${SUPPORTED_LOCALES.joinToString()}",
      )
    }
    return stored
  }

  /** [context] with the app's language, for reading the updater's string resources. */
  fun localizedContext(context: Context): Context {
    val configuration = Configuration(context.resources.configuration)
    configuration.setLocale(Locale.forLanguageTag(current(context)))
    return context.createConfigurationContext(configuration)
  }
}

/**
 * Receives the PackageInstaller session status. Every outcome reaches the
 * user: through the installer dialog, a notification, or, when Android will
 * not show a notification for LoggeRythm, a Toast with the same meaning.
 * A non-success end is also persisted ([InstallOutcomeStore]) and handed to
 * a live updater module, so the app's update card leaves "waiting for
 * confirmation" even when the Toast never appears.
 * Only the current session ([InstallSessionStore]) is reported; an outcome of
 * any other session is logged and dropped.
 * Texts are Android string resources (values/ English, values-de/ German),
 * always read through [AppLocaleStore.localizedContext] (`texts`): they follow
 * the language chosen in the app, never the system language.
 */
class LoggeRythmUpdateInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val status = intent.getIntExtra(
      PackageInstaller.EXTRA_STATUS,
      PackageInstaller.STATUS_FAILURE,
    )
    val sessionId = intent.getIntExtra(EXTRA_SESSION_ID, MISSING_SESSION_ID)
    if (status == PackageInstaller.STATUS_SUCCESS) {
      // Whatever session installed the update, the app is updated now: the
      // relaunch offer is right even for a session without an id (one
      // committed by an app version before session ids existed).
      Log.i(TAG, "Verified LoggeRythm update installed (session $sessionId)")
      InstallOutcomeStore.clear(context)
      if (InstallSessionStore.current(context) == sessionId) InstallSessionStore.clear(context)
      relaunchApp(context, AppLocaleStore.localizedContext(context))
      return
    }
    val current = InstallSessionStore.current(context)
    if (sessionId == MISSING_SESSION_ID || sessionId != current) {
      // An abandoned or superseded attempt: its outcome must not end the
      // current one (or pop up its confirmation). Logged, never reported.
      Log.w(
        TAG,
        "Dropped installer status $status of update session " +
          (if (sessionId == MISSING_SESSION_ID) "<none>" else "$sessionId") +
          ": the current update session is ${current ?: "<none>"}",
      )
      return
    }
    val texts = AppLocaleStore.localizedContext(context)
    when (status) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        val confirmation = confirmationIntent(intent)
        if (confirmation == null) {
          // Previously an IllegalStateException crashed the receiver process
          // with no hint for the user. Report it loudly instead.
          val message = texts.getString(R.string.loggerythm_updater_confirmation_missing)
          showFailure(context, message, texts.getString(R.string.loggerythm_updater_failed_toast, message))
          reportOutcome(context, intent, sessionId, INSTALL_FAILED_CODE, abandonSession(context, sessionId, message))
          return
        }
        confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Android 10+ silently drops startActivity from a background app, so
        // the installer confirmation must ride a notification in that case.
        if (appInForeground()) {
          context.startActivity(confirmation)
        } else {
          val blockedReason = notifyOrToast(
            context,
            texts,
            texts.getString(R.string.loggerythm_updater_ready_title),
            texts.getString(R.string.loggerythm_updater_ready_text),
            activityPendingIntent(context, confirmation),
            // Shown only when the notification is blocked; the session is
            // abandoned then, so the toast must not say "ready".
            texts.getString(R.string.loggerythm_updater_not_confirmed_toast),
          )
          if (blockedReason != null) {
            // Nothing can open the installer confirmation any more: the app is
            // in the background and Android shows no notification. The session
            // is over, so it is abandoned; the app offers the update again.
            reportOutcome(
              context,
              intent,
              sessionId,
              CONFIRMATION_BLOCKED_CODE,
              abandonSession(
                context,
                sessionId,
                "Android could not show the installation confirmation: LoggeRythm was in the " +
                  "background and the update notification is blocked ($blockedReason)",
              ),
            )
          }
        }
      }
      else -> {
        val statusMessage = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        val message = statusMessage
          ?: texts.getString(R.string.loggerythm_updater_failed_status, status)
        val toastText = if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
          // The user cancelled on purpose: no "failed" and no raw (English)
          // status text. The stored outcome and the log keep Android's message.
          texts.getString(R.string.loggerythm_updater_cancelled_toast)
        } else {
          texts.getString(R.string.loggerythm_updater_failed_toast, message)
        }
        showFailure(context, message, toastText)
        val code = when (status) {
          PackageInstaller.STATUS_FAILURE_ABORTED -> INSTALL_ABORTED_CODE
          // Final: the same APK fails the same way on this device every time.
          PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> INSTALL_INCOMPATIBLE_CODE
          PackageInstaller.STATUS_FAILURE_BLOCKED -> INSTALL_BLOCKED_CODE
          PackageInstaller.STATUS_FAILURE_CONFLICT -> INSTALL_CONFLICT_CODE
          // STATUS_FAILURE, STATUS_FAILURE_STORAGE and anything newer: retryable.
          else -> INSTALL_FAILED_CODE
        }
        reportOutcome(
          context,
          intent,
          sessionId,
          code,
          "${statusMessage ?: "Android package installer reported a failure"} (status $status)",
        )
      }
    }
  }

  /**
   * Abandons the current session, which can no longer complete, and returns
   * [message], extended by the reason when Android refused to abandon it.
   * The session stops being current first: abandoning a committed session
   * makes Android send it a STATUS_FAILURE_ABORTED, which must not replace
   * the outcome reported here.
   */
  private fun abandonSession(context: Context, sessionId: Int, message: String): String =
    try {
      InstallSessionStore.clear(context)
      context.packageManager.packageInstaller.abandonSession(sessionId)
      message
    } catch (error: Exception) {
      // Reported with the outcome instead of crashing the receiver before it.
      Log.e(TAG, "Could not abandon update session $sessionId", error)
      "$message (abandoning session $sessionId failed: ${error.javaClass.simpleName}: ${error.message})"
    }

  /**
   * Persists the outcome first, then tells a live updater module about it.
   * The current session has ended, so an "update ready" notification posted
   * for it (app in the background) would open a dead confirmation: removed.
   */
  private fun reportOutcome(context: Context, intent: Intent, sessionId: Int, code: String, message: String) {
    val versionCode = intent.getLongExtra(EXTRA_VERSION_CODE, MISSING_VERSION_CODE)
    val outcome = InstallOutcome(
      code = code,
      message = message,
      sessionId = sessionId,
      versionName = intent.getStringExtra(EXTRA_VERSION_NAME),
      versionCode = versionCode.takeIf { it != MISSING_VERSION_CODE },
    )
    InstallOutcomeStore.save(context, outcome)
    installOutcomeListener?.invoke(outcome)
    cancelUpdateNotification(context)
  }

  /** Logs Android's [message] and shows [toastText], the user-facing text of that end. */
  private fun showFailure(context: Context, message: String, toastText: String) {
    Log.e(TAG, "Update installation failed: $message")
    Toast.makeText(context, toastText, Toast.LENGTH_LONG).show()
  }

  /** [texts] is [context] in the app's language ([AppLocaleStore.localizedContext]). */
  private fun relaunchApp(context: Context, texts: Context) {
    val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
    if (launchIntent == null) {
      // The update itself succeeded; say so instead of only logging.
      Log.e(TAG, "Updated LoggeRythm has no launch activity")
      Toast.makeText(
        context,
        texts.getString(R.string.loggerythm_updater_updated_toast),
        Toast.LENGTH_LONG,
      ).show()
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
    notifyOrToast(
      context,
      texts,
      texts.getString(R.string.loggerythm_updater_updated_title),
      texts.getString(R.string.loggerythm_updater_updated_text),
      activityPendingIntent(context, launchIntent),
      texts.getString(R.string.loggerythm_updater_updated_toast),
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

  /**
   * Posts the notification, or, when Android would drop it without a trace
   * (notifications blocked, POST_NOTIFICATIONS denied, channel turned off),
   * shows [toastText] instead. A Toast cannot be tapped, so its text tells the
   * user what to do without one. [texts] reads the channel name in the app's
   * language. Returns why the notification was blocked, or
   * null when it was posted.
   */
  private fun notifyOrToast(
    context: Context,
    texts: Context,
    title: String,
    text: String,
    contentIntent: PendingIntent,
    toastText: String,
  ): String? {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: throw IllegalStateException("updater-notification-service-missing: Android has no NotificationManager")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
          CHANNEL_ID,
          texts.getString(R.string.loggerythm_updater_channel_name),
          NotificationManager.IMPORTANCE_HIGH,
        ),
      )
    }
    val blockedReason = notificationBlockedReason(context, manager)
    if (blockedReason != null) {
      Log.w(TAG, "Update notification cannot be shown ($blockedReason); showing a Toast instead")
      Toast.makeText(context, toastText, Toast.LENGTH_LONG).show()
      return blockedReason
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
    return null
  }

  /** Why Android would silently drop the update notification, or null if it can be shown. */
  private fun notificationBlockedReason(context: Context, manager: NotificationManager): String? {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      return "POST_NOTIFICATIONS not granted"
    }
    if (!manager.areNotificationsEnabled()) {
      return "notifications disabled for the app"
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = manager.getNotificationChannel(CHANNEL_ID)
        ?: throw IllegalStateException(
          "updater-notification-channel-missing: channel $CHANNEL_ID is missing right after creation",
        )
      if (channel.importance == NotificationManager.IMPORTANCE_NONE) {
        return "update notification channel turned off"
      }
    }
    return null
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
    private const val NOTIFICATION_REQUEST_CODE = 0x5551
    private const val NOTIFICATION_ID = 0x5552
    private const val CHANNEL_ID = "loggerythm-updates"
    private const val EXTRA_VERSION_NAME = "top.logge.loggerythm.updater.VERSION_NAME"
    private const val EXTRA_VERSION_CODE = "top.logge.loggerythm.updater.VERSION_CODE"
    private const val EXTRA_SESSION_ID = "top.logge.loggerythm.updater.SESSION_ID"
    private const val MISSING_VERSION_CODE = -1L
    private const val MISSING_SESSION_ID = -1
    private const val INSTALL_ABORTED_CODE = "updater-install-aborted"
    private const val INSTALL_FAILED_CODE = "updater-install-failed"
    private const val CONFIRMATION_BLOCKED_CODE = "updater-install-confirmation-blocked"
    private const val INSTALL_INCOMPATIBLE_CODE = "updater-install-incompatible"
    private const val INSTALL_BLOCKED_CODE = "updater-install-blocked"
    private const val INSTALL_CONFLICT_CODE = "updater-install-conflict"

    /**
     * The live updater module, if one exists in this process. Set and cleared
     * by [LoggeRythmUpdaterModule]; the receiver runs on the main thread.
     */
    @Volatile
    var installOutcomeListener: ((InstallOutcome) -> Unit)? = null

    /**
     * Removes the updater's notification ("update ready" or "updated"). Called
     * when a new session supersedes the earlier ones and when the current
     * session ends without success: its installer confirmation is dead then.
     */
    internal fun cancelUpdateNotification(context: Context) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        ?: throw IllegalStateException("updater-notification-service-missing: Android has no NotificationManager")
      manager.cancel(NOTIFICATION_ID)
    }

    /**
     * The session's status target; it carries the session and the release it
     * installs. The session id is also the request code, so every session has
     * its own PendingIntent and an earlier session's extras are never replaced.
     */
    fun statusIntent(context: Context, versionName: String, versionCode: Long, sessionId: Int): PendingIntent {
      val intent = Intent(context, LoggeRythmUpdateInstallReceiver::class.java)
        .setPackage(context.packageName)
        .putExtra(EXTRA_SESSION_ID, sessionId)
        .putExtra(EXTRA_VERSION_NAME, versionName)
        .putExtra(EXTRA_VERSION_CODE, versionCode)
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          PendingIntent.FLAG_MUTABLE
        } else {
          0
        }
      return PendingIntent.getBroadcast(context, sessionId, intent, flags)
    }
  }
}
