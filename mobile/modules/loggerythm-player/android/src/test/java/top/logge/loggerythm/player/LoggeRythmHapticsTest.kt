package top.logge.loggerythm.player

import android.os.Build
import android.view.HapticFeedbackConstants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class LoggeRythmHapticsTest {
  @Test
  fun parsesSupportedStylesAndAliasesAndRejectsUnknownLoudly() {
    assertEquals(LoggeRythmHapticStyle.LIGHT, LoggeRythmHapticStyle.parse("light"))
    assertEquals(LoggeRythmHapticStyle.LIGHT, LoggeRythmHapticStyle.parse(" SELECTION "))
    assertEquals(LoggeRythmHapticStyle.LIGHT, LoggeRythmHapticStyle.parse("tick"))
    assertEquals(LoggeRythmHapticStyle.MEDIUM, LoggeRythmHapticStyle.parse("medium"))
    assertEquals(LoggeRythmHapticStyle.MEDIUM, LoggeRythmHapticStyle.parse("click"))
    assertEquals(LoggeRythmHapticStyle.HEAVY, LoggeRythmHapticStyle.parse("heavy"))
    assertEquals(LoggeRythmHapticStyle.SUCCESS, LoggeRythmHapticStyle.parse("success"))
    assertEquals(LoggeRythmHapticStyle.SUCCESS, LoggeRythmHapticStyle.parse("double"))
    assertEquals(LoggeRythmHapticStyle.ERROR, LoggeRythmHapticStyle.parse("error"))
    assertEquals(LoggeRythmHapticStyle.ERROR, LoggeRythmHapticStyle.parse("reject"))

    for (invalid in listOf("", "   ", "buzz", "explosion")) {
      val error = assertThrows(PlayerProtocolException::class.java) {
        LoggeRythmHapticStyle.parse(invalid)
      }
      assertEquals("haptic-style-invalid", error.code)
    }
  }

  @Test
  fun respectsSystemHapticsSettingAndSelectsApiAppropriateDispatchMode() {
    assertEquals(
      LoggeRythmHapticDispatchMode.SYSTEM_DISABLED,
      LoggeRythmHapticPolicy.plan(
        style = LoggeRythmHapticStyle.MEDIUM,
        sdkInt = Build.VERSION_CODES.UPSIDE_DOWN_CAKE,
        systemHapticsEnabled = false,
        hasVibrator = true,
        hasActivityView = true,
      ),
    )

    assertEquals(
      LoggeRythmHapticDispatchMode.PREDEFINED_EFFECT,
      LoggeRythmHapticPolicy.plan(
        style = LoggeRythmHapticStyle.LIGHT,
        sdkInt = Build.VERSION_CODES.Q,
        systemHapticsEnabled = true,
        hasVibrator = true,
        hasActivityView = false,
      ),
    )

    assertEquals(
      LoggeRythmHapticDispatchMode.WAVEFORM_ERROR,
      LoggeRythmHapticPolicy.plan(
        style = LoggeRythmHapticStyle.ERROR,
        sdkInt = Build.VERSION_CODES.Q,
        systemHapticsEnabled = true,
        hasVibrator = true,
        hasActivityView = true,
      ),
    )

    assertEquals(
      LoggeRythmHapticDispatchMode.VIEW_FEEDBACK,
      LoggeRythmHapticPolicy.plan(
        style = LoggeRythmHapticStyle.MEDIUM,
        sdkInt = Build.VERSION_CODES.P,
        systemHapticsEnabled = true,
        hasVibrator = true,
        hasActivityView = true,
      ),
    )

    assertEquals(
      LoggeRythmHapticDispatchMode.UNAVAILABLE,
      LoggeRythmHapticPolicy.plan(
        style = LoggeRythmHapticStyle.MEDIUM,
        sdkInt = Build.VERSION_CODES.Q,
        systemHapticsEnabled = true,
        hasVibrator = false,
        hasActivityView = false,
      ),
    )

    assertEquals(
      HapticFeedbackConstants.CONFIRM,
      LoggeRythmHapticPolicy.viewFeedbackConstant(LoggeRythmHapticStyle.SUCCESS, Build.VERSION_CODES.R),
    )
    assertEquals(
      HapticFeedbackConstants.VIRTUAL_KEY,
      LoggeRythmHapticPolicy.viewFeedbackConstant(LoggeRythmHapticStyle.SUCCESS, Build.VERSION_CODES.Q),
    )
    assertEquals(
      HapticFeedbackConstants.REJECT,
      LoggeRythmHapticPolicy.viewFeedbackConstant(LoggeRythmHapticStyle.ERROR, Build.VERSION_CODES.R),
    )
  }
}
