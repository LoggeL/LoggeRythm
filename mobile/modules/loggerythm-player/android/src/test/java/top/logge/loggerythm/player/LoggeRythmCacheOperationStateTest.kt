package top.logge.loggerythm.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmCacheOperationStateTest {
  @Test
  fun admitsOnlyOneClearAndIgnoresAStaleCompletion() {
    val state = LoggeRythmCacheOperationState(available = true)
    val ticket = requireNotNull(state.beginClear())

    assertTrue(state.isClearing())
    assertNull(state.beginClear())
    state.finishClear(ticket + 1)
    assertTrue(state.isClearing())

    state.finishClear(ticket)
    assertTrue(state.isReady())
    assertFalse(state.isClearing())
    assertNotNull(state.beginClear())
  }

  @Test
  fun unavailableAndClosedCachesNeverAdmitClear() {
    assertNull(LoggeRythmCacheOperationState(available = false).beginClear())

    val state = LoggeRythmCacheOperationState(available = true)
    state.close()
    assertFalse(state.isReady())
    assertNull(state.beginClear())
  }
}
