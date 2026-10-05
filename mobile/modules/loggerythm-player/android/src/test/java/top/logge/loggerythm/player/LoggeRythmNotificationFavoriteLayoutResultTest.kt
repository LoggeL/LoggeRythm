package top.logge.loggerythm.player

import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class LoggeRythmNotificationFavoriteLayoutResultTest {
  @Test
  fun acceptsTheNotificationListenersLegacyUnsupportedLayoutAcknowledgment() {
    // Media3 1.10.1 applies preferences via the new listener event, then the inherited old hook
    // replies ERROR_NOT_SUPPORTED. This is the native result observed on first track playback.
    assertNull(
      notificationFavoriteLayoutFailure(listOf(SessionResult(SessionError.ERROR_NOT_SUPPORTED))),
    )
  }

  @Test
  fun acceptsSuccessfulAndSkippedPreferenceRefreshes() {
    assertNull(
      notificationFavoriteLayoutFailure(
        listOf(
          SessionResult(SessionResult.RESULT_SUCCESS),
          SessionResult(SessionResult.RESULT_INFO_SKIPPED),
        ),
      ),
    )
  }

  @Test
  fun keepsPermissionDisconnectionAndUnexpectedFailuresLoud() {
    for (code in listOf(
      SessionError.ERROR_PERMISSION_DENIED,
      SessionError.ERROR_SESSION_DISCONNECTED,
      SessionError.ERROR_BAD_VALUE,
      SessionError.ERROR_UNKNOWN,
      2,
    )) {
      val rejection = SessionResult(code)
      assertSame(
        rejection,
        notificationFavoriteLayoutFailure(
          listOf(
            SessionResult(SessionResult.RESULT_SUCCESS),
            SessionResult(SessionError.ERROR_NOT_SUPPORTED),
            rejection,
            SessionResult(SessionResult.RESULT_INFO_SKIPPED),
          ),
        ),
      )
    }
  }
}
