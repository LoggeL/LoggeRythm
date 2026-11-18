package top.logge.loggerythm.player

import androidx.media3.common.Player
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmSessionClosePolicyTest {
  @Test
  fun ongoingPlaybackSurvivesTheAppUiGoingAway() {
    assertTrue(keeps(playWhenReady = true, Player.STATE_READY))
    assertTrue(keeps(playWhenReady = true, Player.STATE_BUFFERING))
  }

  @Test
  fun pausedFinishedOrStoppedSessionsAreClosedWithTheAppUi() {
    assertFalse(keeps(playWhenReady = false, Player.STATE_READY))
    assertFalse(keeps(playWhenReady = false, Player.STATE_BUFFERING))
    assertFalse(keeps(playWhenReady = true, Player.STATE_ENDED))
    assertFalse(keeps(playWhenReady = true, Player.STATE_IDLE))
    assertFalse(keeps(playWhenReady = false, Player.STATE_IDLE))
  }

  @Test
  fun playPreparesOnlyAStoppedPlayerThatStillHasAQueue() {
    assertTrue(prepares(Player.STATE_IDLE, hasPlayerError = false, mediaItemCount = 3))
    // A failed player is left to the JavaScript recovery policy.
    assertFalse(prepares(Player.STATE_IDLE, hasPlayerError = true, mediaItemCount = 3))
    assertFalse(prepares(Player.STATE_IDLE, hasPlayerError = false, mediaItemCount = 0))
    assertFalse(prepares(Player.STATE_READY, hasPlayerError = false, mediaItemCount = 3))
    assertFalse(prepares(Player.STATE_ENDED, hasPlayerError = false, mediaItemCount = 3))
  }

  private fun keeps(playWhenReady: Boolean, playbackState: Int): Boolean =
    LoggeRythmSessionClosePolicy.keepsSessionWithoutUi(playWhenReady, playbackState)

  private fun prepares(playbackState: Int, hasPlayerError: Boolean, mediaItemCount: Int): Boolean =
    LoggeRythmSessionClosePolicy.requiresPrepareBeforePlay(
      playbackState,
      hasPlayerError,
      mediaItemCount,
    )
}
