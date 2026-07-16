package top.logge.loggerythm.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmProgressTickerPolicyTest {
  @Test
  fun runsOnlyForObservedPlayingOrPlayWhenReadyBufferingState() {
    assertTrue(policy(isPlaying = true))
    assertTrue(policy(isBuffering = true, playWhenReady = true))
    assertFalse(policy())
    assertFalse(policy(isBuffering = true, playWhenReady = false))
    assertFalse(policy(isPlaying = true, listenerCount = 0))
    assertFalse(policy(isPlaying = true, invalidated = true))
  }

  @Test
  fun intervalIsApproximatelyOneSecond() {
    assertTrue(LoggeRythmProgressTickerPolicy.INTERVAL_MS in 900L..1_100L)
  }

  private fun policy(
    listenerCount: Int = 1,
    isPlaying: Boolean = false,
    isBuffering: Boolean = false,
    playWhenReady: Boolean = false,
    invalidated: Boolean = false,
  ): Boolean = LoggeRythmProgressTickerPolicy.shouldRun(
    listenerCount,
    isPlaying,
    isBuffering,
    playWhenReady,
    invalidated,
  )
}
