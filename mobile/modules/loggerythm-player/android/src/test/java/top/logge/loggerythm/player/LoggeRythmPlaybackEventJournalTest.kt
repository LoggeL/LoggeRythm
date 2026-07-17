package top.logge.loggerythm.player

import java.nio.charset.StandardCharsets
import java.util.ArrayDeque
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmPlaybackEventJournalTest {
  private val binding = LoggeRythmPersistedSessionBinding(
    accountScope = "user:441",
    origin = "https://loggerythm.logge.top",
  )

  @Test
  fun projectsSnakeCaseExtrasAndEmitsAnExactSensitiveFieldFreeClaim() {
    val extras = JSONObject()
      .put("radio", true)
      .put("cookie", "must-not-cross-the-journal-boundary")
      .put(
        "track",
        JSONObject()
          .put("id", "84")
          .put("title", "Quoted \"title\"")
          .put("artist", "Artist")
          .put("artist_id", 10)
          .put("artists", JSONArray().put(
            JSONObject().put("id", "10").put("name", "Artist").put("url", "https://artist.invalid"),
          ))
          .put("album", "Album")
          .put("album_id", "20")
          .put("duration_sec", 180)
          .put("rank", 9)
          .put("release_date", "2026-07-16")
          .put("cover", "https://cover.invalid")
          .put("preview_url", "https://preview.invalid")
          .put("url", "https://stream.invalid")
          .put("error", "diagnostic-must-not-cross"),
      )
      .toString()
    val metadata = LoggeRythmPlaybackEventJournal.trackMetadataFromExtras(extras)
    assertEquals("10", metadata.artistId)
    assertTrue(LoggeRythmPlaybackEventJournal.isRadioExtras(extras))

    val eventId = uuid(1)
    val leaseId = uuid(2)
    val journal = LoggeRythmPlaybackEventJournal(
      uuidFactory = uuidFactory(eventId, leaseId),
    )
    val enqueue = journal.previewEnqueuePlay(metadata, NOW)
    assertTrue(enqueue.changed)
    assertTrue(enqueue.eventAccepted)
    assertTrue(journal.commit(enqueue))

    val raw = journal.claim(binding, maxEvents = 8, leaseMs = 120_000L, nowMs = NOW)
    val claim = JSONObject(raw)
    assertEquals(setOf("schemaVersion", "leaseId", "binding", "events"), keys(claim))
    assertEquals(setOf("accountScope", "origin"), keys(claim.getJSONObject("binding")))
    val event = claim.getJSONArray("events").getJSONObject(0)
    assertEquals(
      setOf("schemaVersion", "eventId", "type", "createdAtMs", "attempt", "track"),
      keys(event),
    )
    val track = event.getJSONObject("track")
    assertEquals(
      setOf(
        "id",
        "title",
        "artist",
        "artistId",
        "artists",
        "album",
        "albumId",
        "durationSec",
        "rank",
        "releaseDate",
      ),
      keys(track),
    )
    assertEquals(setOf("id", "name"), keys(track.getJSONArray("artists").getJSONObject(0)))
    listOf("cookie", "preview_url", "url", "error", "cover", "notBeforeEpochMs").forEach {
      forbidden -> assertFalse("claim leaked $forbidden", raw.contains("\"$forbidden\""))
    }
    assertTrue(raw.toByteArray(StandardCharsets.UTF_8).size <= LoggeRythmPlaybackEventJournal.MAX_JSON_BYTES)
  }

  @Test
  fun persistedCodecIsExactVersionedAndRejectsNonCanonicalIdsOrAttempts() {
    val event = playEvent(1, attempt = 16, notBeforeEpochMs = NOW + 5_000L)
    val encoded = LoggeRythmPlaybackEventJournal.encodePersistedEvents(listOf(event))
    val value = encoded.getJSONObject(0)
    assertEquals(
      setOf(
        "schemaVersion",
        "eventId",
        "type",
        "createdAtMs",
        "attempt",
        "notBeforeEpochMs",
        "track",
      ),
      keys(value),
    )
    assertEquals(listOf(event), LoggeRythmPlaybackEventJournal.decodePersistedEvents(encoded))
    assertEquals(
      encoded.toString().toByteArray(StandardCharsets.UTF_8).size,
      LoggeRythmPlaybackEventJournal.persistedUtf8Bytes(listOf(event)),
    )

    assertCode("event-fields-invalid") {
      LoggeRythmPlaybackEventJournal.decodePersistedEvents(
        JSONArray(encoded.toString()).also { it.getJSONObject(0).put("url", "https://invalid") },
      )
    }
    assertCode("event-id-invalid") {
      LoggeRythmPlaybackEventJournal.decodePersistedEvents(
        JSONArray(encoded.toString()).also {
          it.getJSONObject(0).put("eventId", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".uppercase())
        },
      )
    }
    assertCode("event-attempt-invalid") {
      LoggeRythmPlaybackEventJournal.decodePersistedEvents(
        JSONArray(encoded.toString()).also { it.getJSONObject(0).put("attempt", 17) },
      )
    }
    assertCode("event-fields-invalid") {
      LoggeRythmPlaybackEventJournal.decodePersistedEvents(
        JSONArray(encoded.toString()).also {
          it.getJSONObject(0).getJSONObject("track").put("cookie", "secret")
        },
      )
    }
  }

  @Test
  fun normalizePrunesAgeDeduplicatesRadioAndEvictsOldPlayBeforeCurrentRadio() {
    val plays = (1..63).map { index ->
      playEvent(index, createdAtMs = NOW - 10_000L + index)
    }
    val oldRadio = radioEvent(64, createdAtMs = NOW - 5_000L, generation = 1L, mediaId = "radio:1")
    val newRadio = radioEvent(65, createdAtMs = NOW - 1_000L, generation = 2L, mediaId = "radio:2")
    val normalized = LoggeRythmPlaybackEventJournal.normalize(plays + oldRadio + newRadio, NOW)

    assertEquals(64, normalized.size)
    assertFalse(normalized.any { it.eventId == plays.first().eventId })
    assertTrue(normalized.any { it.eventId == oldRadio.eventId })
    assertTrue(normalized.any { it.eventId == newRadio.eventId })
    assertTrue(plays.drop(1).all { play -> normalized.any { it.eventId == play.eventId } })

    val duplicateRadio = newRadio.copy(eventId = uuid(66), createdAtMs = newRadio.createdAtMs + 1L)
    val expired = playEvent(67, createdAtMs = NOW - LoggeRythmPlaybackEventJournal.MAX_AGE_MS - 1L)
    val deduped = LoggeRythmPlaybackEventJournal.normalize(
      listOf(duplicateRadio, expired, newRadio),
      NOW,
    )
    assertEquals(listOf(newRadio), deduped)
  }

  @Test
  fun retentionWakeProducesADurablePruneCandidateAndBoundsRetryScheduling() {
    val retentionWake = NOW + LoggeRythmPlaybackEventJournal.MAX_AGE_MS + 1L
    val event = playEvent(1, createdAtMs = NOW, notBeforeEpochMs = retentionWake + 60_000L)
    val journal = LoggeRythmPlaybackEventJournal(listOf(event))
    assertEquals(retentionWake, journal.nextWakeAtMs(NOW + 1L))

    val retryEvent = playEvent(2, createdAtMs = NOW)
    val leaseId = uuid(100)
    val retryJournal = LoggeRythmPlaybackEventJournal(listOf(retryEvent), uuidFactory(leaseId))
    retryJournal.claim(binding, 8, 120_000L, NOW + 1L)
    assertCode("retry-time-invalid") {
      retryJournal.previewRetry(
        leaseId,
        retryEvent.eventId,
        retentionWake + 1L,
        NOW + 2L,
      )
    }
    val prune = journal.previewPrune(retentionWake)
    assertTrue(prune.changed)
    assertTrue(prune.candidateEvents.isEmpty())
    assertEquals(listOf(event), journal.snapshot())
    assertTrue(journal.commit(prune))
    assertTrue(journal.snapshot().isEmpty())
  }

  @Test
  fun normalizeEnforcesTheUtf8BudgetWhileRetainingRadioBeforePlay() {
    val largeTrack = metadata().copy(
      title = "t".repeat(512),
      artist = "a".repeat(512),
      album = "b".repeat(512),
      artists = List(32) { index ->
        LoggeRythmPlaybackEventArtist((index + 1).toString(), "n".repeat(256))
      },
    )
    val events = (1..64).map { index ->
      if (index <= 20) {
        radioEvent(index, NOW - 1_000L + index, index.toLong(), "radio:$index", largeTrack)
      } else {
        playEvent(index, NOW - 1_000L + index, track = largeTrack)
      }
    }

    val normalized = LoggeRythmPlaybackEventJournal.normalize(events, NOW)

    assertTrue(normalized.size < events.size)
    assertTrue(
      LoggeRythmPlaybackEventJournal.persistedUtf8Bytes(normalized) <=
        LoggeRythmPlaybackEventJournal.MAX_JSON_BYTES,
    )
    val retainedRadioIds = normalized.filterIsInstance<LoggeRythmRadioPlaybackEvent>()
      .map { it.eventId }
      .toSet()
    val retainedPlayIds = normalized.filterIsInstance<LoggeRythmPlayPlaybackEvent>()
      .map { it.eventId }
      .toSet()
    val allRadioIds = events.filterIsInstance<LoggeRythmRadioPlaybackEvent>().map { it.eventId }
    val allPlayIds = events.filterIsInstance<LoggeRythmPlayPlaybackEvent>().map { it.eventId }
    assertTrue(retainedRadioIds.containsAll(allRadioIds))
    if (!retainedPlayIds.containsAll(allPlayIds)) {
      val retainedIndexes = events.withIndex()
        .filter { it.value.eventId in retainedPlayIds }
        .map { it.index }
      assertEquals(retainedIndexes.sorted(), retainedIndexes)
      if (retainedIndexes.isNotEmpty()) assertTrue(retainedIndexes.min() > 20)
    }
  }

  @Test
  fun claimIsBoundedToEightAndLeasesEligibleEventsUntilExpiry() {
    val events = (1..10).map { playEvent(it) }
    val journal = LoggeRythmPlaybackEventJournal(
      initialEvents = events,
      uuidFactory = uuidFactory(uuid(100), uuid(101), uuid(102)),
    )

    val first = JSONObject(journal.claim(binding, 8, 120_000L, NOW))
    val second = JSONObject(journal.claim(binding, 8, 120_000L, NOW))
    val third = JSONObject(journal.claim(binding, 8, 120_000L, NOW))
    assertEquals(8, first.getJSONArray("events").length())
    assertEquals(2, second.getJSONArray("events").length())
    assertEquals(0, third.getJSONArray("events").length())
    assertEquals(NOW + 120_000L, journal.nextWakeAtMs(NOW))
    assertCode("claim-max-events-invalid") { journal.claim(binding, 9, 1L, NOW) }
    assertCode("claim-lease-invalid") { journal.claim(binding, 8, 120_001L, NOW) }
  }

  @Test
  fun ackChangesOnlyAfterCommitAndAbortReleasesAnExpiredLease() {
    val event = playEvent(1)
    val firstLeaseId = uuid(100)
    val secondLeaseId = uuid(101)
    val journal = LoggeRythmPlaybackEventJournal(
      listOf(event),
      uuidFactory(firstLeaseId, secondLeaseId),
    )
    journal.claim(binding, 8, 10L, NOW)

    val candidate = journal.previewAck(firstLeaseId, event.eventId, NOW + 1L)
    assertTrue(candidate.changed)
    assertTrue(candidate.candidateEvents.isEmpty())
    assertEquals(listOf(event), journal.snapshot())
    assertTrue(journal.abort(candidate))
    assertFalse(journal.abort(candidate))

    val reclaimed = JSONObject(journal.claim(binding, 8, 10L, NOW + 11L))
    assertEquals(secondLeaseId, reclaimed.getString("leaseId"))
    assertEquals(1, reclaimed.getJSONArray("events").length())
    val committed = journal.previewAck(secondLeaseId, event.eventId, NOW + 12L)
    assertTrue(journal.commit(committed))
    assertFalse(journal.commit(committed))
    assertTrue(journal.snapshot().isEmpty())
    assertFalse(journal.previewAck(secondLeaseId, event.eventId, NOW + 13L).changed)
  }

  @Test
  fun retryIsTransactionalIdempotentScheduledAndDropsAfterAttemptSixteen() {
    val event = playEvent(1)
    val leaseId = uuid(100)
    val retryLeaseId = uuid(103)
    val journal = LoggeRythmPlaybackEventJournal(
      listOf(event),
      uuidFactory(leaseId, uuid(101), uuid(102), retryLeaseId),
    )
    journal.claim(binding, 8, 120_000L, NOW)
    val retryAt = NOW + 5_000L
    val retry = journal.previewRetry(leaseId, event.eventId, retryAt, NOW + 1L)
    assertEquals(0, journal.snapshot().single().attempt)
    assertEquals(1, retry.candidateEvents.single().attempt)
    assertTrue(journal.commit(retry))
    assertFalse(journal.previewRetry(leaseId, event.eventId, retryAt, NOW + 2L).changed)
    assertEquals(retryAt, journal.nextWakeAtMs(NOW + 2L))
    assertEquals(0, JSONObject(journal.claim(binding, 8, 120_000L, NOW + 2L))
      .getJSONArray("events").length())
    assertEquals(1, JSONObject(journal.claim(binding, 8, 120_000L, retryAt))
      .getJSONArray("events").length())

    val exhausted = playEvent(2, attempt = 16)
    journal.replace(listOf(exhausted), retryAt + 1L, invalidateLeases = true)
    val exhaustedClaim = JSONObject(journal.claim(binding, 8, 120_000L, retryAt + 1L))
    assertEquals(retryLeaseId, exhaustedClaim.getString("leaseId"))
    val drop = journal.previewRetry(
      retryLeaseId,
      exhausted.eventId,
      retryAt + 6_000L,
      retryAt + 2L,
    )
    assertTrue(journal.commit(drop))
    assertTrue(journal.snapshot().isEmpty())
  }

  @Test
  fun radioEnqueueDeduplicatesGenerationAndActiveMediaIdentity() {
    val existing = radioEvent(1, generation = 44L, mediaId = "radio:active")
    val journal = LoggeRythmPlaybackEventJournal(
      listOf(existing),
      uuidFactory(uuid(2)),
    )

    val duplicate = journal.previewEnqueueRadio(
      metadata("999"),
      activeMediaId = "radio:active",
      queueGeneration = 44L,
      nowMs = NOW + 1L,
    )
    assertFalse(duplicate.changed)
    assertTrue(duplicate.eventAccepted)
    assertEquals(existing.eventId, duplicate.event?.eventId)

    val distinct = journal.previewEnqueueRadio(
      metadata("999"),
      activeMediaId = "radio:active",
      queueGeneration = 45L,
      nowMs = NOW + 2L,
    )
    assertTrue(distinct.changed)
    assertTrue(journal.commit(distinct))
    assertEquals(2, journal.snapshot().size)
  }

  @Test
  fun transitionPreviewCommitsOrAbortsPlayAndRadioAsOneDurableCandidate() {
    val journal = LoggeRythmPlaybackEventJournal(
      uuidFactory = uuidFactory(uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)),
    )
    val radioContext = LoggeRythmPlaybackEventRadioContext(
      activeMediaId = "radio:active",
      queueGeneration = 44L,
    )

    val aborted = journal.previewEnqueueTransition(
      track = metadata(),
      includePlay = true,
      radioContext = radioContext,
      nowMs = NOW,
    )
    assertEquals(2, aborted.candidateEvents.size)
    assertEquals(1, aborted.candidateEvents.filterIsInstance<LoggeRythmPlayPlaybackEvent>().size)
    assertEquals(1, aborted.candidateEvents.filterIsInstance<LoggeRythmRadioPlaybackEvent>().size)
    assertTrue(journal.snapshot().isEmpty())
    assertTrue(journal.abort(aborted))
    assertTrue(journal.snapshot().isEmpty())

    val committed = journal.previewEnqueueTransition(
      track = metadata(),
      includePlay = true,
      radioContext = radioContext,
      nowMs = NOW + 1L,
    )
    assertTrue(journal.commit(committed))
    assertEquals(committed.candidateEvents, journal.snapshot())
    assertEquals(2, journal.snapshot().size)

    val playOnlyBecauseRadioIsDeduplicated = journal.previewEnqueueTransition(
      track = metadata("85"),
      includePlay = true,
      radioContext = radioContext,
      nowMs = NOW + 2L,
    )
    assertEquals(3, playOnlyBecauseRadioIsDeduplicated.candidateEvents.size)
    assertEquals(
      1,
      playOnlyBecauseRadioIsDeduplicated.candidateEvents
        .filterIsInstance<LoggeRythmRadioPlaybackEvent>()
        .size,
    )
  }

  @Test
  fun fullPlayBacklogRetainsTheNewCurrentRadioTransition() {
    val existing = (1..LoggeRythmPlaybackEventJournal.MAX_EVENTS).map { index ->
      playEvent(index, createdAtMs = NOW - 10_000L + index)
    }
    val journal = LoggeRythmPlaybackEventJournal(
      initialEvents = existing,
      uuidFactory = uuidFactory(uuid(101), uuid(102)),
    )

    val transition = journal.previewEnqueueTransition(
      track = metadata("999"),
      includePlay = true,
      radioContext = LoggeRythmPlaybackEventRadioContext(
        activeMediaId = "radio:current",
        queueGeneration = 81L,
      ),
      nowMs = NOW,
    )

    assertEquals(LoggeRythmPlaybackEventJournal.MAX_EVENTS, transition.candidateEvents.size)
    assertTrue(transition.eventAccepted)
    assertTrue(transition.event is LoggeRythmRadioPlaybackEvent)
    assertTrue(
      transition.candidateEvents.any {
        it is LoggeRythmRadioPlaybackEvent &&
          it.activeMediaId == "radio:current" &&
          it.queueGeneration == 81L
      },
    )
    assertTrue(transition.candidateEvents.any { it.eventId == uuid(101) })
    assertFalse(transition.candidateEvents.any { it.eventId == existing[0].eventId })
    assertFalse(transition.candidateEvents.any { it.eventId == existing[1].eventId })
  }

  @Test
  fun distinctOccurrencesOfTheSameTrackReceiveDistinctDurableEventIds() {
    val journal = LoggeRythmPlaybackEventJournal(
      uuidFactory = uuidFactory(uuid(71), uuid(72)),
    )

    val first = journal.previewEnqueueTransition(
      track = metadata("84"),
      includePlay = true,
      radioContext = null,
      nowMs = NOW,
    )
    assertTrue(journal.commit(first))
    val second = journal.previewEnqueueTransition(
      track = metadata("84"),
      includePlay = true,
      radioContext = null,
      nowMs = NOW + 1L,
    )
    assertTrue(journal.commit(second))

    val plays = journal.snapshot().filterIsInstance<LoggeRythmPlayPlaybackEvent>()
    assertEquals(2, plays.size)
    assertEquals(setOf(uuid(71), uuid(72)), plays.map { it.eventId }.toSet())
  }

  @Test
  fun coldRestoreRetainsOnlyTheCurrentRadioAndCannotFreshenAStaleGenerationCollision() {
    val current = radioEvent(1, generation = 50L, mediaId = "active:one")
    // A new process can reuse generation 3. This stale event must be dropped, not left at 3.
    val staleGeneration = radioEvent(2, generation = 3L, mediaId = "active:one")
    val otherActiveItem = radioEvent(3, generation = 50L, mediaId = "active:other")
    val play = playEvent(4)

    val restored = LoggeRythmPlaybackEventJournal.rebaseRestoredRadioEvents(
      events = listOf(current, staleGeneration, otherActiveItem, play),
      persistedQueueGeneration = 50L,
      restoredQueueGeneration = 3L,
      restoredActiveMediaId = "active:one",
      nowMs = NOW,
    )

    assertEquals(3L, (restored.single { it.eventId == current.eventId } as LoggeRythmRadioPlaybackEvent).queueGeneration)
    assertFalse(restored.any { it.eventId == staleGeneration.eventId })
    assertFalse(restored.any { it.eventId == otherActiveItem.eventId })
    assertEquals(play, restored.single { it.eventId == play.eventId })
  }

  @Test
  fun rejectsUnsafeMetadataAndNonCanonicalGeneratedUuids() {
    assertCode("track-id-invalid") {
      LoggeRythmPlaybackEventJournal.trackMetadataFromExtras(
        validExtras().put("track", JSONObject(validExtras().getJSONObject("track").toString()).put("id", ""))
          .toString(),
      )
    }
    assertCode("track-title-invalid") {
      LoggeRythmPlaybackEventJournal.trackMetadataFromExtras(
        validExtras().put(
          "track",
          JSONObject(validExtras().getJSONObject("track").toString()).put("title", "unsafe\ntext"),
        ).toString(),
      )
    }
    assertCode("event-id-invalid") {
      LoggeRythmPlaybackEventJournal(
        uuidFactory = { "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".uppercase() },
      )
        .previewEnqueuePlay(metadata(), NOW)
    }
    assertThrows(LoggeRythmPlaybackEventJournalException::class.java) {
      LoggeRythmPlaybackEventJournal.isRadioExtras("""{"radio":"true"}""")
    }
  }

  @Test
  fun clearInvalidatesEventsLeasesAndPendingMutation() {
    val event = playEvent(1)
    val leaseId = uuid(100)
    val journal = LoggeRythmPlaybackEventJournal(listOf(event), uuidFactory(leaseId))
    journal.claim(binding, 8, 120_000L, NOW)
    val pending = journal.previewAck(leaseId, event.eventId, NOW + 1L)

    journal.clear()

    assertTrue(journal.snapshot().isEmpty())
    assertEquals(null, journal.nextWakeAtMs(NOW + 2L))
    assertFalse(journal.commit(pending))
  }

  private fun validExtras(): JSONObject = JSONObject()
    .put("radio", false)
    .put(
      "track",
      JSONObject()
        .put("id", "84")
        .put("title", "Title")
        .put("artist", "Artist")
        .put("artist_id", "10")
        .put("artists", JSONArray().put(JSONObject().put("id", "10").put("name", "Artist")))
        .put("album", "Album")
        .put("album_id", "20")
        .put("duration_sec", 180)
        .put("rank", 9)
        .put("release_date", "2026-07-16"),
    )

  private fun metadata(id: String = "84"): LoggeRythmPlaybackEventTrackMetadata =
    LoggeRythmPlaybackEventTrackMetadata(
      id = id,
      title = "Title $id",
      artist = "Artist",
      artistId = "10",
      artists = listOf(LoggeRythmPlaybackEventArtist("10", "Artist")),
      album = "Album",
      albumId = "20",
      durationSec = 180L,
      rank = 9L,
      releaseDate = "2026-07-16",
    )

  private fun playEvent(
    index: Int,
    createdAtMs: Long = NOW - 1_000L + index,
    attempt: Int = 0,
    notBeforeEpochMs: Long = 0L,
    track: LoggeRythmPlaybackEventTrackMetadata = metadata(index.toString()),
  ): LoggeRythmPlayPlaybackEvent = LoggeRythmPlayPlaybackEvent(
    eventId = uuid(index),
    createdAtMs = createdAtMs,
    attempt = attempt,
    notBeforeEpochMs = notBeforeEpochMs,
    track = track,
  )

  private fun radioEvent(
    index: Int,
    createdAtMs: Long = NOW - 1_000L + index,
    generation: Long = index.toLong(),
    mediaId: String = "radio:$index",
    track: LoggeRythmPlaybackEventTrackMetadata = metadata(index.toString()),
  ): LoggeRythmRadioPlaybackEvent = LoggeRythmRadioPlaybackEvent(
    eventId = uuid(index),
    createdAtMs = createdAtMs,
    track = track,
    activeMediaId = mediaId,
    queueGeneration = generation,
  )

  private fun uuid(index: Int): String = "00000000-0000-4000-8000-${index.toString().padStart(12, '0')}"

  private fun uuidFactory(vararg values: String): () -> String {
    val remaining = ArrayDeque(values.toList())
    return { remaining.removeFirst() }
  }

  private fun keys(value: JSONObject): Set<String> = value.keys().asSequence().toSet()

  private fun assertCode(code: String, block: () -> Unit) {
    val error = assertThrows(LoggeRythmPlaybackEventJournalException::class.java, block)
    assertEquals(code, error.code)
    assertNotNull(error.message)
  }

  private companion object {
    const val NOW = 1_800_000_000_000L
  }
}
