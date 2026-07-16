package top.logge.loggerythm.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmControllerPolicyTest {
  @Test
  fun acceptsSelfNotificationAndAnyPlatformTrustedController() {
    assertTrue(LoggeRythmControllerPolicy.accepts(signals(self = true)))
    assertTrue(LoggeRythmControllerPolicy.accepts(signals(mediaNotification = true)))
    assertTrue(LoggeRythmControllerPolicy.accepts(signals(trusted = true)))
  }

  @Test
  fun rejectsOrdinaryUntrustedThirdPartyController() {
    assertFalse(LoggeRythmControllerPolicy.accepts(signals()))
    assertFalse(LoggeRythmControllerPolicy.accepts(signals(automotive = true)))
    assertFalse(LoggeRythmControllerPolicy.accepts(signals(autoCompanion = true)))
  }

  @Test
  fun notificationProfileWinsEvenWhenControllerSharesTheAppIdentity() {
    assertTrue(
      LoggeRythmControllerPolicy.commandProfile(self = true, mediaNotification = true) ==
        RemoteControllerProfile.NOTIFICATION,
    )
    assertTrue(
      LoggeRythmControllerPolicy.commandProfile(self = true, mediaNotification = false) ==
        RemoteControllerProfile.INTERNAL,
    )
    assertTrue(
      LoggeRythmControllerPolicy.commandProfile(self = false, mediaNotification = false) ==
        RemoteControllerProfile.TRUSTED_BROWSER,
    )
  }

  private fun signals(
    self: Boolean = false,
    mediaNotification: Boolean = false,
    trusted: Boolean = false,
    automotive: Boolean = false,
    autoCompanion: Boolean = false,
  ) = ControllerTrustSignals(
    self = self,
    mediaNotification = mediaNotification,
    trusted = trusted,
    automotive = automotive,
    autoCompanion = autoCompanion,
    systemUid = false,
    trustedLegacyMediaButton = false,
  )
}
