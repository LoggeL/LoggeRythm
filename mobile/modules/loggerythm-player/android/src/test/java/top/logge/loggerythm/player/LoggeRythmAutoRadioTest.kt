package top.logge.loggerythm.player

import androidx.media3.common.Player
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmAutoRadioTest {
  private val album = JSONObject()
    .put("radio", false)
    .put("queueContextType", "album")
    .put("queueContextId", "album-1")
    .toString()
  private val radio = JSONObject().put("radio", true).toString()
  private val party = JSONObject()
    .put("radio", false)
    .put("queueContextType", "party")
    .put("queueContextId", "ABC")
    .toString()

  @Test
  fun explicitRadioAlwaysExtendsItself() {
    assertTrue(radioExtensionEligible(radio, autoRadioEnabled = false, Player.REPEAT_MODE_OFF))
    assertTrue(radioExtensionEligible(radio, autoRadioEnabled = false, Player.REPEAT_MODE_ALL))
  }

  @Test
  fun autoplayExtendsAnAlbumOnlyWithRepeatOff() {
    assertTrue(radioExtensionEligible(album, autoRadioEnabled = true, Player.REPEAT_MODE_OFF))
    assertFalse(radioExtensionEligible(album, autoRadioEnabled = false, Player.REPEAT_MODE_OFF))
    assertFalse(radioExtensionEligible(album, autoRadioEnabled = true, Player.REPEAT_MODE_ALL))
    assertFalse(radioExtensionEligible(album, autoRadioEnabled = true, Player.REPEAT_MODE_ONE))
  }

  @Test
  fun autoplayNeverExtendsAPartyQueue() {
    assertFalse(radioExtensionEligible(party, autoRadioEnabled = true, Player.REPEAT_MODE_OFF))
  }

  @Test
  fun legacyItemsWithoutContextAreExtendedByAutoplay() {
    assertTrue(radioExtensionEligible("{}", autoRadioEnabled = true, Player.REPEAT_MODE_OFF))
  }
}
