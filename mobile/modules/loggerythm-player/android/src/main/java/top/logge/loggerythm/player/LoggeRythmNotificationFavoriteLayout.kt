package top.logge.loggerythm.player

import androidx.media3.common.util.UnstableApi
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult

/**
 * Only for Media3 button preference publication to the notification or a car controller. In 1.10.1,
 * preferences are applied and onMediaButtonPreferencesChanged is delivered before the deprecated
 * onSetCustomLayout acknowledgment completes. A listener can handle the new event and inherit
 * the old hook's ERROR_NOT_SUPPORTED result, so that acknowledgment is not a publication
 * failure. This policy must not be used for favorite mutations or other controller commands.
 */
@UnstableApi
internal fun notificationFavoriteLayoutFailure(results: List<SessionResult>): SessionResult? =
  results.firstOrNull { result ->
    when (result.resultCode) {
      SessionResult.RESULT_SUCCESS,
      SessionResult.RESULT_INFO_SKIPPED,
      SessionError.ERROR_NOT_SUPPORTED,
      -> false
      else -> true
    }
  }
