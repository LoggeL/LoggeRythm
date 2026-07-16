package top.logge.loggerythm.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class LoggeRythmPlayerSnapshotTest {
  @Test
  fun emptyTimelineCanonicalizesMedia3IndexZeroToNullFields() {
    val snapshot = normalizedCurrentItemSnapshot(
      mediaItemCount = 0,
      reportedIndex = 0,
      reportedMediaId = null,
    )

    assertNull(snapshot.index)
    assertNull(snapshot.mediaId)
  }

  @Test
  fun missingCurrentItemCanonicalizesBothFieldsEvenForANonemptyTimeline() {
    val snapshot = normalizedCurrentItemSnapshot(
      mediaItemCount = 2,
      reportedIndex = 0,
      reportedMediaId = null,
    )

    assertNull(snapshot.index)
    assertNull(snapshot.mediaId)
  }

  @Test
  fun validCurrentItemKeepsItsExactIndexAndId() {
    val snapshot = normalizedCurrentItemSnapshot(
      mediaItemCount = 2,
      reportedIndex = 1,
      reportedMediaId = "track:two",
    )

    assertEquals(1, snapshot.index)
    assertEquals("track:two", snapshot.mediaId)
  }

  @Test
  fun currentItemOutsideTheTimelineFailsClosed() {
    val error = assertThrows(PlayerProtocolException::class.java) {
      normalizedCurrentItemSnapshot(
        mediaItemCount = 1,
        reportedIndex = 1,
        reportedMediaId = "track:outside",
      )
    }

    assertEquals("player-current-item-invalid", error.code)
  }
}
