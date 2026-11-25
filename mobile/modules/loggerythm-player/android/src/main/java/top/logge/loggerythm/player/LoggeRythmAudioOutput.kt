package top.logge.loggerythm.player

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRouter2
import android.os.Build
import android.provider.Settings
import android.util.Log

internal class LoggeRythmAudioOutputException(val code: String) : IllegalStateException(code)

internal data class LoggeRythmAudioOutputSwitcherResult(
  val opened: Boolean,
  val method: String,
)

internal data class LoggeRythmAudioOutputDevice(
  val id: String,
  val name: String,
  val type: String,
  val isActive: Boolean,
)

/**
 * Launches Android's native system audio output switcher (`MediaRouter2.showSystemOutputSwitcher`
 * on API 34+, SystemUI media output dialog on API 30-33, Volume Panel on API 29, or Bluetooth
 * settings as last explicit intent) and enumerates current audio output devices.
 *
 * Fails loud with [LoggeRythmAudioOutputException] if no output switcher surface can be opened.
 */
internal object LoggeRythmAudioOutput {
  private const val TAG = "LoggeRythmAudioOutput"
  private const val SYSTEM_UI_PACKAGE = "com.android.systemui"
  private const val ACTION_LAUNCH_MEDIA_OUTPUT_DIALOG =
    "com.android.systemui.action.LAUNCH_MEDIA_OUTPUT_DIALOG"
  private const val ACTION_SETTINGS_MEDIA_OUTPUT =
    "com.android.settings.panel.action.MEDIA_OUTPUT"
  private const val EXTRA_PACKAGE_NAME = "package_name"

  fun openOutputSwitcher(
    context: Context,
    activity: Activity?,
  ): LoggeRythmAudioOutputSwitcherResult {
    // 1. Android 14+ (API 34+): official public MediaRouter2 system output switcher API.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val opened = try {
        MediaRouter2.getInstance(context).showSystemOutputSwitcher()
      } catch (error: Throwable) {
        Log.e(TAG, "MediaRouter2.showSystemOutputSwitcher failed (${error.javaClass.simpleName})")
        false
      }
      if (opened) {
        return LoggeRythmAudioOutputSwitcherResult(
          opened = true,
          method = "media-router2-system-switcher",
        )
      }
    }

    val hostContext: Context = activity ?: context.applicationContext
    val packageManager = hostContext.packageManager

    // 2. Android 11-13: SystemUI Media Output Dialog or Settings Media Output panel.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val settingsMediaOutput = Intent(ACTION_SETTINGS_MEDIA_OUTPUT).apply {
        putExtra(EXTRA_PACKAGE_NAME, hostContext.packageName)
        if (activity == null) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (canResolveActivity(packageManager, settingsMediaOutput)) {
        hostContext.startActivity(settingsMediaOutput)
        return LoggeRythmAudioOutputSwitcherResult(
          opened = true,
          method = "settings-media-output-panel",
        )
      }

      val systemUiDialog = Intent(ACTION_LAUNCH_MEDIA_OUTPUT_DIALOG).apply {
        setPackage(SYSTEM_UI_PACKAGE)
        putExtra(EXTRA_PACKAGE_NAME, hostContext.packageName)
      }
      if (canResolveBroadcast(packageManager, systemUiDialog)) {
        hostContext.sendBroadcast(systemUiDialog)
        return LoggeRythmAudioOutputSwitcherResult(
          opened = true,
          method = "systemui-media-output-dialog",
        )
      }
    }

    // 3. Android 10+: Settings Volume Panel (includes output switcher button on OEM ROMs).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val volumePanel = Intent(Settings.Panel.ACTION_VOLUME).apply {
        if (activity == null) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (canResolveActivity(packageManager, volumePanel)) {
        hostContext.startActivity(volumePanel)
        return LoggeRythmAudioOutputSwitcherResult(
          opened = true,
          method = "settings-volume-panel",
        )
      }
    }

    // 4. Explicit Bluetooth audio settings fallback when no modern panel exists.
    val bluetoothSettings = Intent(Settings.ACTION_BLUETOOTH_SETTINGS).apply {
      if (activity == null) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    if (canResolveActivity(packageManager, bluetoothSettings)) {
      hostContext.startActivity(bluetoothSettings)
      return LoggeRythmAudioOutputSwitcherResult(
        opened = true,
        method = "bluetooth-settings",
      )
    }

    throw LoggeRythmAudioOutputException("audio-output-switcher-unavailable")
  }

  fun listOutputDevices(context: Context): List<LoggeRythmAudioOutputDevice> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val router = MediaRouter2.getInstance(context)
      val activeIds = router.systemController.selectedRoutes.mapTo(mutableSetOf()) { it.id }
      val routes = router.routes.filter { !it.isSystemRoute || it.id in activeIds || it.name.isNotBlank() }
      if (routes.isNotEmpty()) {
        return routes.map { route ->
          val typeName = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            routeTypeName(route.type)
          } else {
            "other"
          }
          LoggeRythmAudioOutputDevice(
            id = route.id,
            name = route.name.toString(),
            type = typeName,
            isActive = route.id in activeIds,
          )
        }
      }
    }
    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      ?: throw LoggeRythmAudioOutputException("audio-manager-unavailable")
    val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    return devices.map { info ->
      LoggeRythmAudioOutputDevice(
        id = info.id.toString(),
        name = info.productName?.toString()?.takeIf(String::isNotBlank) ?: deviceTypeName(info.type),
        type = deviceTypeName(info.type),
        isActive = false,
      )
    }
  }

  internal fun deviceTypeName(type: Int): String = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired_headphones"
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_ACCESSORY -> "usb"
    AudioDeviceInfo.TYPE_HDMI,
    AudioDeviceInfo.TYPE_HDMI_ARC -> "hdmi"
    AudioDeviceInfo.TYPE_LINE_ANALOG,
    AudioDeviceInfo.TYPE_LINE_DIGITAL -> "line_out"
    else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET) {
      "bluetooth_le"
    } else {
      "other"
    }
  }

  private fun routeTypeName(routeType: Int): String = when (routeType) {
    2 -> "speaker"
    3, 4 -> "wired_headphones"
    8, 23, 26 -> "bluetooth"
    9, 10 -> "hdmi"
    11, 22 -> "usb"
    1001 -> "tv"
    1002 -> "remote_speaker"
    else -> "other"
  }

  @Suppress("DEPRECATION")
  private fun canResolveActivity(pm: PackageManager, intent: Intent): Boolean =
    pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null

  @Suppress("DEPRECATION")
  private fun canResolveBroadcast(pm: PackageManager, intent: Intent): Boolean =
    pm.queryBroadcastReceivers(intent, 0).isNotEmpty()
}
