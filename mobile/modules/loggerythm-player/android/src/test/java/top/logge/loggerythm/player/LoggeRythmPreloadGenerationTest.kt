package top.logge.loggerythm.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmPreloadGenerationTest {
  @Test
  fun ticketsAreBoundToTheExactQueueAndOperationGeneration() {
    val state = LoggeRythmPreloadGenerationState()
    assertNull(state.newTicket(1L, "https://example.test/one"))

    state.onQueueGenerationChanged(1L)
    val first = requireNotNull(state.newTicket(1L, "https://example.test/one"))
    assertTrue(state.isCurrent(first))

    val replacement = requireNotNull(state.newTicket(1L, "https://example.test/two"))
    assertFalse(state.isCurrent(first))
    assertTrue(state.isCurrent(replacement))

    state.onQueueGenerationChanged(2L)
    assertFalse(state.isCurrent(replacement))
    assertNull(state.newTicket(1L, "https://example.test/stale"))
  }

  @Test
  fun progressIsBoundedAndCancellationOrCloseInvalidatesWork() {
    val state = LoggeRythmPreloadGenerationState()
    state.onQueueGenerationChanged(7L)
    val ticket = requireNotNull(state.newTicket(7L, "https://example.test/next"))

    assertEquals(0L, state.boundedProgress(ticket, -1L))
    assertEquals(
      LoggeRythmPreloadGenerationState.MAX_PRELOAD_BYTES,
      state.boundedProgress(ticket, Long.MAX_VALUE),
    )

    state.cancel()
    assertNull(state.boundedProgress(ticket, 1L))
    state.close()
    assertNull(state.newTicket(7L, "https://example.test/closed"))
  }
}
