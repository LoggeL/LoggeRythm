package top.logge.loggerythm.player

import android.content.Context
import androidx.media3.common.Player
import org.json.JSONObject

/**
 * Device-wide "Autoplay" preference: when a queue runs out, the native player keeps the music
 * going with the song radio of the track that is playing near the tail.
 *
 * The value lives in plain SharedPreferences (it is not account data and holds no secret) so the
 * service can decide on its own, without a running React context, e.g. during Android Auto or a
 * notification-only session. A failed write is reported, never silently dropped.
 */
internal object LoggeRythmAutoRadioPreference {
  private const val PREFERENCES = "loggerythm_player_preferences"
  private const val KEY_ENABLED = "auto_radio_enabled"
  private const val DEFAULT_ENABLED = true

  fun isEnabled(context: Context): Boolean =
    context.applicationContext
      .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .getBoolean(KEY_ENABLED, DEFAULT_ENABLED)

  fun setEnabled(context: Context, enabled: Boolean) {
    val written = context.applicationContext
      .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(KEY_ENABLED, enabled)
      .commit()
    if (!written) throw LoggeRythmPersistedPlayerException("auto-radio-preference-write-failed")
  }
}

/**
 * Whether the item playing near the queue tail may be extended with radio tracks.
 *
 * An explicit song radio always extends itself. Any other queue extends only with Autoplay on,
 * repeat off (a repeating queue never ends) and outside a party, whose queue belongs to the host.
 */
internal fun radioExtensionEligible(
  extrasJson: String,
  autoRadioEnabled: Boolean,
  repeatMode: Int,
): Boolean {
  if (LoggeRythmPlaybackEventJournal.isRadioExtras(extrasJson)) return true
  if (!autoRadioEnabled || repeatMode != Player.REPEAT_MODE_OFF) return false
  val contextType = JSONObject(extrasJson).opt(QUEUE_CONTEXT_TYPE_EXTRA)
  return contextType != PARTY_CONTEXT_TYPE
}

private const val QUEUE_CONTEXT_TYPE_EXTRA = "queueContextType"
private const val PARTY_CONTEXT_TYPE = "party"
