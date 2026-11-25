package top.logge.loggerythm.player

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.HapticFeedbackConstants
import java.util.Locale

internal enum class LoggeRythmHapticStyle(
  val wireName: String,
  val predefinedEffectId: Int?,
  val legacyViewConstant: Int,
  val api30ViewConstant: Int,
) {
  LIGHT(
    wireName = "light",
    predefinedEffectId = VibrationEffect.EFFECT_TICK,
    legacyViewConstant = HapticFeedbackConstants.CLOCK_TICK,
    api30ViewConstant = HapticFeedbackConstants.CLOCK_TICK,
  ),
  MEDIUM(
    wireName = "medium",
    predefinedEffectId = VibrationEffect.EFFECT_CLICK,
    legacyViewConstant = HapticFeedbackConstants.VIRTUAL_KEY,
    api30ViewConstant = HapticFeedbackConstants.VIRTUAL_KEY,
  ),
  HEAVY(
    wireName = "heavy",
    predefinedEffectId = VibrationEffect.EFFECT_HEAVY_CLICK,
    legacyViewConstant = HapticFeedbackConstants.LONG_PRESS,
    api30ViewConstant = HapticFeedbackConstants.LONG_PRESS,
  ),
  SUCCESS(
    wireName = "success",
    predefinedEffectId = VibrationEffect.EFFECT_DOUBLE_CLICK,
    legacyViewConstant = HapticFeedbackConstants.VIRTUAL_KEY,
    api30ViewConstant = HapticFeedbackConstants.CONFIRM,
  ),
  ERROR(
    wireName = "error",
    predefinedEffectId = null,
    legacyViewConstant = HapticFeedbackConstants.LONG_PRESS,
    api30ViewConstant = HapticFeedbackConstants.REJECT,
  );

  companion object {
    fun parse(raw: String): LoggeRythmHapticStyle = when (raw.trim().lowercase(Locale.ROOT)) {
      "light", "selection", "tick" -> LIGHT
      "medium", "click" -> MEDIUM
      "heavy" -> HEAVY
      "success", "double", "confirm" -> SUCCESS
      "error", "reject", "warning" -> ERROR
      else -> throw PlayerProtocolException("haptic-style-invalid")
    }
  }
}

internal data class LoggeRythmHapticResult(
  val performed: Boolean,
  val style: String,
  val reason: String? = null,
)

internal enum class LoggeRythmHapticDispatchMode {
  SYSTEM_DISABLED,
  PREDEFINED_EFFECT,
  WAVEFORM_ERROR,
  VIEW_FEEDBACK,
  UNAVAILABLE,
}

/** Pure, JVM-testable dispatch planner for native Android haptics. */
internal object LoggeRythmHapticPolicy {
  val ERROR_TIMINGS_MS: LongArray = longArrayOf(0L, 28L, 36L, 28L)
  val ERROR_AMPLITUDES: IntArray = intArrayOf(0, 180, 0, 220)

  fun plan(
    style: LoggeRythmHapticStyle,
    sdkInt: Int,
    systemHapticsEnabled: Boolean,
    hasVibrator: Boolean,
    hasActivityView: Boolean,
  ): LoggeRythmHapticDispatchMode {
    if (!systemHapticsEnabled) return LoggeRythmHapticDispatchMode.SYSTEM_DISABLED
    if (sdkInt >= Build.VERSION_CODES.Q && hasVibrator) {
      return if (style.predefinedEffectId != null) {
        LoggeRythmHapticDispatchMode.PREDEFINED_EFFECT
      } else {
        LoggeRythmHapticDispatchMode.WAVEFORM_ERROR
      }
    }
    if (hasActivityView) return LoggeRythmHapticDispatchMode.VIEW_FEEDBACK
    return LoggeRythmHapticDispatchMode.UNAVAILABLE
  }

  fun viewFeedbackConstant(style: LoggeRythmHapticStyle, sdkInt: Int): Int =
    if (sdkInt >= Build.VERSION_CODES.R) style.api30ViewConstant else style.legacyViewConstant
}

/**
 * Crisp Android haptics using `VibrationEffect.createPredefined` (API 29+) and
 * `HapticFeedbackConstants` on older APIs, strictly respecting Android's system haptic setting.
 */
internal object LoggeRythmHaptics {
  fun perform(
    context: Context,
    activity: Activity?,
    rawStyle: String,
  ): LoggeRythmHapticResult {
    val style = LoggeRythmHapticStyle.parse(rawStyle)
    val systemEnabled = isSystemHapticsEnabled(context)
    val vibrator = resolveVibrator(context)
    val hasVibrator = vibrator?.hasVibrator() == true
    val decorView = activity?.window?.decorView
    val mode = LoggeRythmHapticPolicy.plan(
      style = style,
      sdkInt = Build.VERSION.SDK_INT,
      systemHapticsEnabled = systemEnabled,
      hasVibrator = hasVibrator,
      hasActivityView = decorView != null,
    )
    return when (mode) {
      LoggeRythmHapticDispatchMode.SYSTEM_DISABLED -> LoggeRythmHapticResult(
        performed = false,
        style = style.wireName,
        reason = "system-haptics-disabled",
      )
      LoggeRythmHapticDispatchMode.PREDEFINED_EFFECT -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val effect = VibrationEffect.createPredefined(checkNotNull(style.predefinedEffectId))
          checkNotNull(vibrator).vibrate(effect)
          LoggeRythmHapticResult(performed = true, style = style.wireName)
        } else {
          error("Predefined vibration effects require Android 10 (API 29)+")
        }
      }
      LoggeRythmHapticDispatchMode.WAVEFORM_ERROR -> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          val effect = VibrationEffect.createWaveform(
            LoggeRythmHapticPolicy.ERROR_TIMINGS_MS,
            LoggeRythmHapticPolicy.ERROR_AMPLITUDES,
            -1,
          )
          checkNotNull(vibrator).vibrate(effect)
          LoggeRythmHapticResult(performed = true, style = style.wireName)
        } else {
          error("Waveform vibration effects require Android 8 (API 26)+")
        }
      }
      LoggeRythmHapticDispatchMode.VIEW_FEEDBACK -> {
        val constant = LoggeRythmHapticPolicy.viewFeedbackConstant(style, Build.VERSION.SDK_INT)
        val ok = checkNotNull(decorView).performHapticFeedback(constant)
        LoggeRythmHapticResult(
          performed = ok,
          style = style.wireName,
          reason = if (ok) null else "view-haptic-rejected",
        )
      }
      LoggeRythmHapticDispatchMode.UNAVAILABLE -> LoggeRythmHapticResult(
        performed = false,
        style = style.wireName,
        reason = "haptics-hardware-unavailable",
      )
    }
  }

  @Suppress("DEPRECATION")
  private fun isSystemHapticsEnabled(context: Context): Boolean {
    val value = Settings.System.getInt(
      context.contentResolver,
      Settings.System.HAPTIC_FEEDBACK_ENABLED,
      1,
    )
    return value != 0
  }

  @Suppress("DEPRECATION")
  private fun resolveVibrator(context: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val manager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
      manager?.defaultVibrator
    } else {
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
}
