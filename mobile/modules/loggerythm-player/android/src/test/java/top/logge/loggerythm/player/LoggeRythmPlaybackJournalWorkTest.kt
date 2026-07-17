package top.logge.loggerythm.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmPlaybackJournalWorkTest {
  @Test
  fun idleUsesSlotAAndRunningWorkerMovesTheOppositeSlotDeadline() {
    val backend = RecordingBackend()
    val arbiter = LoggeRythmPlaybackJournalWorkArbiter()

    arbiter.schedule(backend, 12_000L)
    assertEquals(listOf("replace:A:12000"), backend.calls)

    assertTrue(arbiter.workerStarted(LoggeRythmPlaybackJournalWorkSlot.A))
    assertTrue(arbiter.isWorkerRunning())
    assertFalse(arbiter.workerStarted(LoggeRythmPlaybackJournalWorkSlot.B))
    arbiter.schedule(backend, 0L)
    arbiter.schedule(backend, 5_000L)

    assertEquals(
      listOf(
        "replace:A:12000",
        "replace:B:0",
        "replace:B:5000",
      ),
      backend.calls,
    )

    arbiter.workerFinished(LoggeRythmPlaybackJournalWorkSlot.A)
    assertFalse(arbiter.isWorkerRunning())
    arbiter.schedule(backend, 7_000L)
    assertEquals("replace:A:7000", backend.calls.last())
  }

  @Test
  fun cancellationCancelsBothOpaqueSlots() {
    val backend = RecordingBackend()
    val arbiter = LoggeRythmPlaybackJournalWorkArbiter()

    assertTrue(arbiter.workerStarted(LoggeRythmPlaybackJournalWorkSlot.B))
    arbiter.schedule(backend, 1_000L)
    arbiter.cancel(backend)
    arbiter.schedule(backend, 2_000L)

    assertEquals(
      listOf("replace:A:1000", "cancel", "replace:A:2000"),
      backend.calls,
    )
  }

  @Test
  fun emptyWorkerCompletionCannotEraseALaterPrearm() {
    val backend = RecordingBackend()
    val arbiter = LoggeRythmPlaybackJournalWorkArbiter()

    assertTrue(arbiter.workerStarted(LoggeRythmPlaybackJournalWorkSlot.A))
    // EMPTY itself performs no cancellation. A transition admitted before the old worker returns
    // can therefore commit the opposite opaque slot without being erased by a stale decision.
    arbiter.schedule(backend, 0L)
    arbiter.workerFinished(LoggeRythmPlaybackJournalWorkSlot.A)

    assertEquals(listOf("replace:B:0"), backend.calls)
  }

  @Test
  fun durableAdmissionNeverPersistsBeforePrearmSuccess() {
    val calls = mutableListOf<String>()
    var prearmCompletion: ((Result<Unit>) -> Unit)? = null

    LoggeRythmPlaybackJournalDurableAdmission.admit(
      candidateNonempty = true,
      prearm = { completion ->
        calls += "prearm"
        prearmCompletion = completion
      },
      persist = { calls += "persist" },
      reject = { calls += "reject" },
    )

    assertEquals(listOf("prearm"), calls)
    prearmCompletion?.invoke(Result.success(Unit))
    assertEquals(listOf("prearm", "persist"), calls)
  }

  @Test
  fun durableAdmissionFailureRejectsWithoutCandidatePersistence() {
    val calls = mutableListOf<String>()

    LoggeRythmPlaybackJournalDurableAdmission.admit(
      candidateNonempty = true,
      prearm = { completion ->
        calls += "prearm"
        completion(Result.failure(IllegalStateException("work-db-failed")))
      },
      persist = { calls += "persist" },
      reject = { calls += "reject:${it.message}" },
    )

    assertEquals(listOf("prearm", "reject:work-db-failed"), calls)
  }

  @Test
  fun emptyCandidateDoesNotNeedAWorkSpec() {
    val calls = mutableListOf<String>()
    LoggeRythmPlaybackJournalDurableAdmission.admit(
      candidateNonempty = false,
      prearm = { calls += "prearm" },
      persist = { calls += "persist" },
      reject = { calls += "reject" },
    )
    assertEquals(listOf("persist"), calls)
  }

  @Test(expected = IllegalArgumentException::class)
  fun rejectsNegativeOpaqueWakeDelay() {
    LoggeRythmPlaybackJournalWorkArbiter().schedule(RecordingBackend(), -1L)
  }

  private class RecordingBackend : LoggeRythmPlaybackJournalWorkBackend {
    val calls = mutableListOf<String>()

    override fun replace(
      slot: LoggeRythmPlaybackJournalWorkSlot,
      delayMs: Long,
      callback: (Result<Unit>) -> Unit,
    ) {
      calls += "replace:$slot:$delayMs"
      callback(Result.success(Unit))
    }

    override fun cancel() {
      calls += "cancel"
    }
  }
}
