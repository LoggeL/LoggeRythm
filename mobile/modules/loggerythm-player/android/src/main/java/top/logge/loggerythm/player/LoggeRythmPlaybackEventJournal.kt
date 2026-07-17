package top.logge.loggerythm.player

import java.math.BigDecimal
import java.nio.charset.StandardCharsets
import java.util.UUID
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

internal class LoggeRythmPlaybackEventJournalException(val code: String) :
  IllegalArgumentException(code)

internal data class LoggeRythmPlaybackEventArtist(
  val id: String,
  val name: String,
) {
  override fun toString(): String =
    "LoggeRythmPlaybackEventArtist(id=<redacted>, name=<redacted>)"
}

internal data class LoggeRythmPlaybackEventTrackMetadata(
  val id: String,
  val title: String,
  val artist: String,
  val artistId: String,
  val artists: List<LoggeRythmPlaybackEventArtist>,
  val album: String,
  val albumId: String,
  val durationSec: Long,
  val rank: Long,
  val releaseDate: String,
) {
  override fun toString(): String =
    "LoggeRythmPlaybackEventTrackMetadata(id=<redacted>, title=<redacted>, " +
      "artist=<redacted>, artistId=<redacted>, artists=<redacted:${artists.size}>, " +
      "album=<redacted>, albumId=<redacted>, durationSec=$durationSec, rank=$rank, " +
      "releaseDate=<redacted>)"
}

internal sealed interface LoggeRythmPlaybackEvent {
  val eventId: String
  val createdAtMs: Long
  val attempt: Int
  val notBeforeEpochMs: Long
  val track: LoggeRythmPlaybackEventTrackMetadata
}

internal data class LoggeRythmPlayPlaybackEvent(
  override val eventId: String,
  override val createdAtMs: Long,
  override val attempt: Int = 0,
  override val notBeforeEpochMs: Long = 0L,
  override val track: LoggeRythmPlaybackEventTrackMetadata,
) : LoggeRythmPlaybackEvent {
  override fun toString(): String =
    "LoggeRythmPlayPlaybackEvent(eventId=<redacted>, createdAtMs=$createdAtMs, " +
      "attempt=$attempt, notBeforeEpochMs=$notBeforeEpochMs, track=<redacted>)"
}

internal data class LoggeRythmRadioPlaybackEvent(
  override val eventId: String,
  override val createdAtMs: Long,
  override val attempt: Int = 0,
  override val notBeforeEpochMs: Long = 0L,
  override val track: LoggeRythmPlaybackEventTrackMetadata,
  val activeMediaId: String,
  val queueGeneration: Long,
) : LoggeRythmPlaybackEvent {
  override fun toString(): String =
    "LoggeRythmRadioPlaybackEvent(eventId=<redacted>, createdAtMs=$createdAtMs, " +
      "attempt=$attempt, notBeforeEpochMs=$notBeforeEpochMs, track=<redacted>, " +
      "activeMediaId=<redacted>, queueGeneration=$queueGeneration)"
}

internal data class LoggeRythmPlaybackEventRadioContext(
  val activeMediaId: String,
  val queueGeneration: Long,
) {
  override fun toString(): String =
    "LoggeRythmPlaybackEventRadioContext(activeMediaId=<redacted>, " +
      "queueGeneration=$queueGeneration)"
}

/**
 * A durable journal candidate. The owner must persist [candidateEvents] before calling [commit]
 * on the journal. A failed persistence attempt must call `abort` instead.
 */
internal class LoggeRythmPlaybackEventJournalMutation internal constructor(
  internal val token: Long,
  val candidateEvents: List<LoggeRythmPlaybackEvent>,
  val changed: Boolean,
  val event: LoggeRythmPlaybackEvent?,
  val eventAccepted: Boolean,
) {
  override fun toString(): String =
    "LoggeRythmPlaybackEventJournalMutation(token=<redacted>, " +
      "candidateEvents=<redacted:${candidateEvents.size}>, changed=$changed, " +
      "event=<redacted>, eventAccepted=$eventAccepted)"
}

/**
 * Process-local lease engine around an immutable, coordinator-owned durable event snapshot.
 *
 * Durable mutations are deliberately two-phase. `preview*` reserves any affected lease but does
 * not change [snapshot]. The coordinator writes [LoggeRythmPlaybackEventJournalMutation.candidateEvents]
 * into its encrypted transaction and only then calls [commit].
 */
internal class LoggeRythmPlaybackEventJournal(
  initialEvents: List<LoggeRythmPlaybackEvent> = emptyList(),
  private val uuidFactory: () -> String = { UUID.randomUUID().toString() },
) {
  private enum class Resolution { ACK, RETRY }

  private data class Lease(
    val leaseId: String,
    val expiresAtMs: Long,
    val activeEventIds: MutableSet<String>,
    val resolvedEventIds: MutableSet<String> = linkedSetOf(),
  )

  private data class PendingMutation(
    val publicValue: LoggeRythmPlaybackEventJournalMutation,
    val baseRevision: Long,
    val leaseId: String?,
    val eventId: String?,
    val resolution: Resolution?,
  )

  private var committedEvents = decodePersistedEvents(encodePersistedEvents(initialEvents))
  private var revision = 0L
  private var nextMutationToken = 1L
  private var pendingMutation: PendingMutation? = null
  private val leases = linkedMapOf<String, Lease>()
  private val eventLeaseIds = mutableMapOf<String, String>()
  private val finalizedMutationTokens = linkedSetOf<Long>()

  @Synchronized
  fun snapshot(): List<LoggeRythmPlaybackEvent> = committedEvents.toList()

  @Synchronized
  fun snapshot(nowMs: Long): List<LoggeRythmPlaybackEvent> = normalize(committedEvents, nowMs)

  @Synchronized
  fun normalizedSnapshot(nowMs: Long): List<LoggeRythmPlaybackEvent> =
    normalize(committedEvents, nowMs)

  @Synchronized
  fun replace(
    events: List<LoggeRythmPlaybackEvent>,
    nowMs: Long,
    invalidateLeases: Boolean,
  ) {
    if (pendingMutation != null) fail("mutation-pending")
    val normalized = normalize(events, nowMs)
    if (normalized != committedEvents) {
      committedEvents = normalized
      revision += 1L
    }
    if (invalidateLeases) {
      invalidateLeases()
    } else {
      reconcileLeases(normalized.mapTo(mutableSetOf()) { it.eventId })
    }
  }

  @Synchronized
  fun clear() {
    pendingMutation?.publicValue?.token?.let(::rememberFinalizedToken)
    pendingMutation = null
    if (committedEvents.isNotEmpty()) revision += 1L
    committedEvents = emptyList()
    invalidateLeases()
  }

  @Synchronized
  fun previewEnqueuePlay(
    track: LoggeRythmPlaybackEventTrackMetadata,
    nowMs: Long,
  ): LoggeRythmPlaybackEventJournalMutation =
    previewEnqueue(
      LoggeRythmPlayPlaybackEvent(
        eventId = nextUuid("event-id-invalid"),
        createdAtMs = requireNow(nowMs),
        track = track,
      ),
      nowMs,
    )

  @Synchronized
  fun previewEnqueueRadio(
    track: LoggeRythmPlaybackEventTrackMetadata,
    activeMediaId: String,
    queueGeneration: Long,
    nowMs: Long,
  ): LoggeRythmPlaybackEventJournalMutation {
    requireNow(nowMs)
    validateSafeString(activeMediaId, "active-media-id-invalid", MAX_EVENT_MEDIA_ID_LENGTH)
    requireSafeInteger(queueGeneration, "queue-generation-invalid")
    validateTrack(track)
    val existing = normalize(committedEvents, nowMs)
      .filterIsInstance<LoggeRythmRadioPlaybackEvent>()
      .firstOrNull {
        it.queueGeneration == queueGeneration && it.activeMediaId == activeMediaId
      }
    if (existing != null) {
      return beginMutation(
        candidate = normalize(committedEvents, nowMs),
        event = existing,
        resolution = null,
      )
    }
    return previewEnqueue(
      LoggeRythmRadioPlaybackEvent(
        eventId = nextUuid("event-id-invalid"),
        createdAtMs = nowMs,
        track = track,
        activeMediaId = activeMediaId,
        queueGeneration = queueGeneration,
      ),
      nowMs,
    )
  }

  @Synchronized
  fun previewEnqueue(
    event: LoggeRythmPlaybackEvent,
    nowMs: Long,
  ): LoggeRythmPlaybackEventJournalMutation {
    requireNoPendingMutation()
    val base = normalize(committedEvents, nowMs)
    if (base.any { it.eventId == event.eventId }) fail("event-id-duplicate")
    val candidate = normalize(base + event, nowMs)
    return beginMutation(candidate, event, resolution = null)
  }

  /**
   * Atomically preview all journal effects of one media transition. A process crash can therefore
   * never persist PLAY while losing the RADIO request (or vice versa) for the same transition.
   */
  @Synchronized
  fun previewEnqueueTransition(
    track: LoggeRythmPlaybackEventTrackMetadata,
    includePlay: Boolean,
    radioContext: LoggeRythmPlaybackEventRadioContext?,
    nowMs: Long,
  ): LoggeRythmPlaybackEventJournalMutation {
    requireNoPendingMutation()
    val now = requireNow(nowMs)
    validateTrack(track)
    var candidate = normalize(committedEvents, now)
    var resultEvent: LoggeRythmPlaybackEvent? = null
    if (includePlay) {
      val play = LoggeRythmPlayPlaybackEvent(
        eventId = nextUuid("event-id-invalid"),
        createdAtMs = now,
        track = track,
      )
      candidate = normalize(candidate + play, now)
      resultEvent = play
    }
    if (radioContext != null) {
      validateSafeString(
        radioContext.activeMediaId,
        "active-media-id-invalid",
        MAX_EVENT_MEDIA_ID_LENGTH,
      )
      requireSafeInteger(radioContext.queueGeneration, "queue-generation-invalid")
      val existing = candidate.filterIsInstance<LoggeRythmRadioPlaybackEvent>()
        .firstOrNull {
          it.queueGeneration == radioContext.queueGeneration &&
            it.activeMediaId == radioContext.activeMediaId
        }
      if (existing != null) {
        resultEvent = existing
      } else {
        val radio = LoggeRythmRadioPlaybackEvent(
          eventId = nextUuid("event-id-invalid"),
          createdAtMs = now,
          track = track,
          activeMediaId = radioContext.activeMediaId,
          queueGeneration = radioContext.queueGeneration,
        )
        candidate = normalize(candidate + radio, now)
        resultEvent = radio
      }
    }
    return beginMutation(candidate, resultEvent, resolution = null)
  }

  /** Build the encrypted candidate that durably removes expired or over-budget entries. */
  @Synchronized
  fun previewPrune(nowMs: Long): LoggeRythmPlaybackEventJournalMutation {
    requireNoPendingMutation()
    return beginMutation(
      candidate = normalize(committedEvents, nowMs),
      event = null,
      resolution = null,
    )
  }

  @Synchronized
  fun claim(
    binding: LoggeRythmPersistedSessionBinding,
    maxEvents: Int,
    leaseMs: Long,
    nowMs: Long,
  ): String {
    val now = requireNow(nowMs)
    if (maxEvents !in 1..CLAIM_MAX_EVENTS) fail("claim-max-events-invalid")
    if (leaseMs !in 1L..LEASE_MAX_MS) fail("claim-lease-invalid")
    try {
      LoggeRythmPersistedSessionBindingPolicy.requireValid(binding)
    } catch (error: LoggeRythmPersistedStateException) {
      fail(error.code)
    }
    cleanupExpiredLeases(now)
    val selected = normalize(committedEvents, now)
      .asSequence()
      .filter { it.notBeforeEpochMs <= now }
      .filterNot { eventLeaseIds.containsKey(it.eventId) }
      .filterNot { pendingMutation?.eventId == it.eventId }
      .take(maxEvents)
      .toMutableList()
    val leaseId = nextUuid("lease-id-invalid")
    val expiresAtMs = safeAdd(now, leaseMs, "claim-lease-invalid")
    var raw = claimJson(leaseId, binding, selected).toString()
    while (raw.toByteArray(StandardCharsets.UTF_8).size > MAX_JSON_BYTES && selected.isNotEmpty()) {
      selected.removeAt(selected.lastIndex)
      raw = claimJson(leaseId, binding, selected).toString()
    }
    if (raw.toByteArray(StandardCharsets.UTF_8).size > MAX_JSON_BYTES) fail("claim-size-invalid")
    if (selected.isNotEmpty()) {
      if (leases.containsKey(leaseId)) fail("lease-id-collision")
      val ids = selected.mapTo(linkedSetOf()) { it.eventId }
      leases[leaseId] = Lease(leaseId, expiresAtMs, ids)
      ids.forEach { eventId -> eventLeaseIds[eventId] = leaseId }
    }
    return raw
  }

  @Synchronized
  fun previewAck(
    leaseId: String,
    eventId: String,
    nowMs: Long,
  ): LoggeRythmPlaybackEventJournalMutation =
    previewLeaseMutation(leaseId, eventId, nowMs, Resolution.ACK, notBeforeEpochMs = null)

  @Synchronized
  fun previewRetry(
    leaseId: String,
    eventId: String,
    notBeforeEpochMs: Long,
    nowMs: Long,
  ): LoggeRythmPlaybackEventJournalMutation =
    previewLeaseMutation(
      leaseId,
      eventId,
      nowMs,
      Resolution.RETRY,
      notBeforeEpochMs,
    )

  @Synchronized
  fun commit(mutation: LoggeRythmPlaybackEventJournalMutation): Boolean {
    if (finalizedMutationTokens.contains(mutation.token)) return false
    if (!mutation.changed) return false
    val pending = pendingMutation
    if (pending == null || pending.publicValue !== mutation) fail("mutation-not-pending")
    if (pending.baseRevision != revision) fail("mutation-stale")
    committedEvents = mutation.candidateEvents
    revision += 1L
    finalizeLeaseMutation(pending)
    pendingMutation = null
    rememberFinalizedToken(mutation.token)
    return true
  }

  @Synchronized
  fun abort(mutation: LoggeRythmPlaybackEventJournalMutation): Boolean {
    if (finalizedMutationTokens.contains(mutation.token)) return false
    if (!mutation.changed) return false
    val pending = pendingMutation
    if (pending == null || pending.publicValue !== mutation) fail("mutation-not-pending")
    pendingMutation = null
    rememberFinalizedToken(mutation.token)
    return true
  }

  @Synchronized
  fun nextWakeAtMs(nowMs: Long): Long? {
    val now = requireNow(nowMs)
    cleanupExpiredLeases(now)
    var earliest: Long? = null
    committedEvents.forEach { event ->
      validateEvent(event, now, enforceAge = false)
      val leaseId = eventLeaseIds[event.eventId]
      val retentionDeadline = retentionDeadline(event.createdAtMs)
      val operationalWakeAt = when {
        pendingMutation?.eventId == event.eventId ->
          leaseId?.let { leases[it]?.expiresAtMs } ?: now
        leaseId != null -> leases[leaseId]?.expiresAtMs ?: now
        event.notBeforeEpochMs <= now -> now
        else -> event.notBeforeEpochMs
      }
      val wakeAt = minOf(operationalWakeAt, retentionDeadline).coerceAtLeast(now)
      if (earliest == null || wakeAt < earliest) earliest = wakeAt
    }
    return earliest
  }

  private fun previewLeaseMutation(
    leaseId: String,
    eventId: String,
    nowMs: Long,
    resolution: Resolution,
    notBeforeEpochMs: Long?,
  ): LoggeRythmPlaybackEventJournalMutation {
    requireCanonicalUuid(leaseId, "lease-id-invalid")
    requireCanonicalUuid(eventId, "event-id-invalid")
    val now = requireNow(nowMs)
    if (notBeforeEpochMs != null) requireSafeInteger(notBeforeEpochMs, "retry-time-invalid")
    cleanupExpiredLeases(now)
    pendingMutation?.let { pending ->
      if (
        pending.leaseId == leaseId && pending.eventId == eventId &&
        pending.resolution == resolution
      ) {
        return pending.publicValue
      }
      fail("mutation-pending")
    }
    val lease = leases[leaseId]
    if (
      lease == null || lease.resolvedEventIds.contains(eventId) ||
      !lease.activeEventIds.contains(eventId) || eventLeaseIds[eventId] != leaseId
    ) {
      return noChangeMutation()
    }
    val base = normalize(committedEvents, now)
    val source = base.firstOrNull { it.eventId == eventId }
    if (
      resolution == Resolution.RETRY && source != null &&
      notBeforeEpochMs!! > lastRetriableAt(source.createdAtMs)
    ) {
      fail("retry-time-invalid")
    }
    val candidate = when (resolution) {
      Resolution.ACK -> base.filterNot { it.eventId == eventId }
      Resolution.RETRY -> if (source == null || source.attempt >= MAX_ATTEMPT) {
        base.filterNot { it.eventId == eventId }
      } else {
        base.map { event ->
          if (event.eventId != eventId) event
          else event.withRetry(source.attempt + 1, notBeforeEpochMs!!)
        }
      }
    }
    return beginMutation(
      candidate = normalize(candidate, now),
      event = source,
      resolution = resolution,
      leaseId = leaseId,
      eventId = eventId,
    )
  }

  private fun beginMutation(
    candidate: List<LoggeRythmPlaybackEvent>,
    event: LoggeRythmPlaybackEvent?,
    resolution: Resolution?,
    leaseId: String? = null,
    eventId: String? = null,
  ): LoggeRythmPlaybackEventJournalMutation {
    requireNoPendingMutation()
    val accepted = event != null && candidate.any { it.eventId == event.eventId }
    val changed = candidate != committedEvents
    val mutation = LoggeRythmPlaybackEventJournalMutation(
      token = if (changed) nextMutationToken++ else 0L,
      candidateEvents = candidate.toList(),
      changed = changed,
      event = event,
      eventAccepted = accepted,
    )
    if (changed) {
      pendingMutation = PendingMutation(
        publicValue = mutation,
        baseRevision = revision,
        leaseId = leaseId,
        eventId = eventId,
        resolution = resolution,
      )
    }
    return mutation
  }

  private fun noChangeMutation(): LoggeRythmPlaybackEventJournalMutation =
    LoggeRythmPlaybackEventJournalMutation(
      token = 0L,
      candidateEvents = committedEvents.toList(),
      changed = false,
      event = null,
      eventAccepted = false,
    )

  private fun finalizeLeaseMutation(pending: PendingMutation) {
    val leaseId = pending.leaseId ?: return
    val eventId = pending.eventId ?: return
    val lease = leases[leaseId] ?: return
    lease.activeEventIds.remove(eventId)
    lease.resolvedEventIds.add(eventId)
    eventLeaseIds.remove(eventId, leaseId)
  }

  private fun cleanupExpiredLeases(nowMs: Long) {
    val pendingEventId = pendingMutation?.eventId
    val expired = leases.values.filter { lease ->
      lease.expiresAtMs <= nowMs && pendingEventId !in lease.activeEventIds
    }
    expired.forEach { lease ->
      lease.activeEventIds.forEach { eventId -> eventLeaseIds.remove(eventId, lease.leaseId) }
      leases.remove(lease.leaseId)
    }
  }

  private fun reconcileLeases(retainedEventIds: Set<String>) {
    leases.values.forEach { lease ->
      val removed = lease.activeEventIds.filterNot(retainedEventIds::contains)
      removed.forEach { eventId ->
        lease.activeEventIds.remove(eventId)
        lease.resolvedEventIds.add(eventId)
        eventLeaseIds.remove(eventId, lease.leaseId)
      }
    }
  }

  private fun invalidateLeases() {
    leases.clear()
    eventLeaseIds.clear()
  }

  private fun requireNoPendingMutation() {
    if (pendingMutation != null) fail("mutation-pending")
  }

  private fun rememberFinalizedToken(token: Long) {
    if (token == 0L) return
    finalizedMutationTokens.add(token)
    while (finalizedMutationTokens.size > MAX_FINALIZED_MUTATIONS) {
      finalizedMutationTokens.remove(finalizedMutationTokens.first())
    }
  }

  private fun nextUuid(code: String): String {
    val value = uuidFactory()
    requireCanonicalUuid(value, code)
    return value
  }

  companion object {
    internal const val SCHEMA_VERSION = 1
    internal const val MAX_EVENTS = 64
    internal const val CLAIM_MAX_EVENTS = 8
    internal const val MAX_JSON_BYTES = 256 * 1024
    internal const val MAX_AGE_MS = 7L * 24L * 60L * 60L * 1_000L
    internal const val MAX_FUTURE_SKEW_MS = 5L * 60L * 1_000L
    internal const val MAX_ATTEMPT = 16
    internal const val LEASE_MAX_MS = 120_000L

    private const val MAX_EVENT_MEDIA_ID_LENGTH = 512
    private const val MAX_TRACK_TEXT_LENGTH = 512
    private const val MAX_REFERENCE_TEXT_LENGTH = 256
    private const val MAX_ARTISTS = 32
    private const val MAX_RELEASE_DATE_LENGTH = 64
    private const val MAX_DURATION_SECONDS = 7L * 24L * 60L * 60L
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    private const val MAX_EXTRAS_LENGTH = 32_768
    private const val MAX_JSON_NESTING = 16
    private const val MAX_FINALIZED_MUTATIONS = 128

    private val CANONICAL_UUID =
      Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
    private val DEEZER_ID = Regex("[0-9]{1,32}")
    private val EVENT_ORDER = compareBy<LoggeRythmPlaybackEvent>({ it.createdAtMs }, { it.eventId })
    private val EVICTION_ORDER = compareBy<LoggeRythmPlaybackEvent>(
      // PLAY accounting is replay-safe and can tolerate bounded oldest-first loss under extreme
      // backlog pressure. A current RADIO compare-and-set event owns endless-tail continuity, so
      // retain RADIO until every older PLAY candidate has already been evicted.
      { if (it is LoggeRythmPlayPlaybackEvent) 0 else 1 },
      { it.createdAtMs },
      { it.eventId },
    )
    private val PLAY_PERSISTED_KEYS = setOf(
      "schemaVersion",
      "eventId",
      "type",
      "createdAtMs",
      "attempt",
      "notBeforeEpochMs",
      "track",
    )
    private val RADIO_PERSISTED_KEYS = PLAY_PERSISTED_KEYS + setOf(
      "activeMediaId",
      "queueGeneration",
    )
    private val TRACK_KEYS = setOf(
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
    )
    private val ARTIST_KEYS = setOf("id", "name")

    /** Validate, age-prune, radio-dedupe and deterministically fit one durable snapshot. */
    fun normalize(
      events: List<LoggeRythmPlaybackEvent>,
      nowMs: Long,
    ): List<LoggeRythmPlaybackEvent> {
      val now = requireNow(nowMs)
      val eventIds = mutableSetOf<String>()
      events.forEach { event ->
        validateEvent(event, now, enforceAge = false)
        if (!eventIds.add(event.eventId)) fail("event-id-duplicate")
      }
      val radioKeys = mutableSetOf<Pair<Long, String>>()
      val retained = events.sortedWith(EVENT_ORDER).filter { event ->
        if (now - event.createdAtMs > MAX_AGE_MS) return@filter false
        event !is LoggeRythmRadioPlaybackEvent ||
          radioKeys.add(event.queueGeneration to event.activeMediaId)
      }.toMutableList()
      while (retained.size > MAX_EVENTS || persistedEventsSize(retained) > MAX_JSON_BYTES) {
        val victim = retained.minWithOrNull(EVICTION_ORDER) ?: fail("journal-size-invalid")
        retained.remove(victim)
      }
      return retained.toList()
    }

    /** Exact, URL/cookie/error-free JSON used inside the encrypted v3 player state. */
    fun encodePersistedEvents(events: List<LoggeRythmPlaybackEvent>): JSONArray {
      if (events.size > MAX_EVENTS) fail("journal-count-invalid")
      val ids = mutableSetOf<String>()
      val radioKeys = mutableSetOf<Pair<Long, String>>()
      events.forEach { event ->
        validateEvent(event, nowMs = null, enforceAge = false)
        if (!ids.add(event.eventId)) fail("event-id-duplicate")
        if (
          event is LoggeRythmRadioPlaybackEvent &&
          !radioKeys.add(event.queueGeneration to event.activeMediaId)
        ) {
          fail("radio-event-duplicate")
        }
      }
      return JSONArray().also { values -> events.forEach { values.put(persistedEventJson(it)) } }
        .also { values ->
          if (values.toString().toByteArray(StandardCharsets.UTF_8).size > MAX_JSON_BYTES) {
            fail("journal-size-invalid")
          }
        }
    }

    fun persistedUtf8Bytes(events: List<LoggeRythmPlaybackEvent>): Int =
      encodePersistedEvents(events).toString().toByteArray(StandardCharsets.UTF_8).size

    /**
     * Retain and rebase only a RADIO compare-and-set token proven current in the exact persisted
     * queue snapshot. Every other RADIO event is dropped: leaving an old generation in place is
     * unsafe because a new process can reuse that numeric generation and make the stale event look
     * current. PLAY events are independent of queue identity and remain intact.
     */
    fun rebaseRestoredRadioEvents(
      events: List<LoggeRythmPlaybackEvent>,
      persistedQueueGeneration: Long,
      restoredQueueGeneration: Long,
      restoredActiveMediaId: String?,
      nowMs: Long,
    ): List<LoggeRythmPlaybackEvent> {
      requireSafeInteger(persistedQueueGeneration, "persisted-queue-generation-invalid")
      requireSafeInteger(restoredQueueGeneration, "restored-queue-generation-invalid")
      if (restoredActiveMediaId == null) {
        return normalize(events.filterIsInstance<LoggeRythmPlayPlaybackEvent>(), nowMs)
      }
      validateSafeString(
        restoredActiveMediaId,
        "restored-active-media-id-invalid",
        MAX_EVENT_MEDIA_ID_LENGTH,
      )
      return normalize(
        events.mapNotNull { event ->
          when {
            event is LoggeRythmPlayPlaybackEvent -> event
            event is LoggeRythmRadioPlaybackEvent &&
              event.queueGeneration == persistedQueueGeneration &&
              event.activeMediaId == restoredActiveMediaId ->
              event.copy(queueGeneration = restoredQueueGeneration)
            else -> null
          }
        },
        nowMs,
      )
    }

    /** Strict structural decode; call [normalize] with the coordinator clock before use. */
    fun decodePersistedEvents(values: JSONArray): List<LoggeRythmPlaybackEvent> {
      if (values.length() > MAX_EVENTS) fail("journal-count-invalid")
      if (values.toString().toByteArray(StandardCharsets.UTF_8).size > MAX_JSON_BYTES) {
        fail("journal-size-invalid")
      }
      val events = List(values.length()) { index ->
        decodePersistedEvent(values.opt(index), "playback-event[$index]")
      }
      // Round-tripping through the encoder also rejects duplicate IDs and radio identities.
      encodePersistedEvents(events)
      return events
    }

    fun trackMetadataFromExtras(extrasJson: String): LoggeRythmPlaybackEventTrackMetadata {
      val extras = parseObject(extrasJson)
      val track = extras.opt("track") as? JSONObject ?: fail("extras-track-invalid")
      return decodeTrack(
        value = track,
        label = "extras-track",
        keys = TrackInputKeys.SNAKE_CASE,
        exactKeys = false,
      )
    }

    fun isRadioExtras(extrasJson: String): Boolean {
      val extras = parseObject(extrasJson)
      if (!extras.has("radio") || extras.isNull("radio")) return false
      return extras.opt("radio") as? Boolean ?: fail("extras-radio-invalid")
    }

    private enum class TrackInputKeys { CAMEL_CASE, SNAKE_CASE }

    private fun decodePersistedEvent(value: Any?, label: String): LoggeRythmPlaybackEvent {
      val source = value as? JSONObject ?: fail("event-object-invalid")
      val type = source.opt("type") as? String ?: fail("event-type-invalid")
      requireExactKeys(
        source,
        when (type) {
          "PLAY" -> PLAY_PERSISTED_KEYS
          "RADIO" -> RADIO_PERSISTED_KEYS
          else -> fail("event-type-invalid")
        },
      )
      if (exactSafeLong(source.opt("schemaVersion"), "event-version-invalid") != SCHEMA_VERSION.toLong()) {
        fail("event-version-invalid")
      }
      val common = CommonEventFields(
        eventId = requireCanonicalUuid(source.opt("eventId"), "event-id-invalid"),
        createdAtMs = exactSafeLong(source.opt("createdAtMs"), "event-created-at-invalid", minimum = 1L),
        attempt = exactSafeLong(
          source.opt("attempt"),
          "event-attempt-invalid",
          maximum = MAX_ATTEMPT.toLong(),
        ).toInt(),
        notBeforeEpochMs = exactSafeLong(
          source.opt("notBeforeEpochMs"),
          "event-not-before-invalid",
        ),
        track = decodeTrack(
          source.opt("track"),
          "$label.track",
          TrackInputKeys.CAMEL_CASE,
          exactKeys = true,
        ),
      )
      return if (type == "PLAY") {
        LoggeRythmPlayPlaybackEvent(
          common.eventId,
          common.createdAtMs,
          common.attempt,
          common.notBeforeEpochMs,
          common.track,
        )
      } else {
        LoggeRythmRadioPlaybackEvent(
          common.eventId,
          common.createdAtMs,
          common.attempt,
          common.notBeforeEpochMs,
          common.track,
          activeMediaId = safeString(
            source.opt("activeMediaId"),
            "event-active-media-id-invalid",
            MAX_EVENT_MEDIA_ID_LENGTH,
          ),
          queueGeneration = exactSafeLong(
            source.opt("queueGeneration"),
            "event-queue-generation-invalid",
          ),
        )
      }
    }

    private data class CommonEventFields(
      val eventId: String,
      val createdAtMs: Long,
      val attempt: Int,
      val notBeforeEpochMs: Long,
      val track: LoggeRythmPlaybackEventTrackMetadata,
    )

    private fun decodeTrack(
      value: Any?,
      label: String,
      keys: TrackInputKeys,
      exactKeys: Boolean,
    ): LoggeRythmPlaybackEventTrackMetadata {
      val source = value as? JSONObject ?: fail("track-object-invalid")
      if (exactKeys) requireExactKeys(source, TRACK_KEYS)
      val artistsValue = source.opt("artists") as? JSONArray ?: fail("track-artists-invalid")
      if (artistsValue.length() > MAX_ARTISTS) fail("track-artists-invalid")
      val artists = List(artistsValue.length()) { index ->
        val artist = artistsValue.opt(index) as? JSONObject ?: fail("track-artist-invalid")
        if (exactKeys) requireExactKeys(artist, ARTIST_KEYS)
        LoggeRythmPlaybackEventArtist(
          id = referenceId(artist.opt("id"), "track-artist-id-invalid"),
          name = safeString(
            artist.opt("name"),
            "track-artist-name-invalid",
            MAX_REFERENCE_TEXT_LENGTH,
            allowEmpty = true,
          ),
        )
      }
      fun key(camel: String, snake: String): String =
        if (keys == TrackInputKeys.CAMEL_CASE) camel else snake
      val id = safeString(source.opt("id"), "track-id-invalid", 32)
      if (!DEEZER_ID.matches(id)) fail("track-id-invalid")
      return LoggeRythmPlaybackEventTrackMetadata(
        id = id,
        title = safeString(source.opt("title"), "track-title-invalid", MAX_TRACK_TEXT_LENGTH, true),
        artist = safeString(source.opt("artist"), "track-artist-invalid", MAX_TRACK_TEXT_LENGTH, true),
        artistId = referenceId(source.opt(key("artistId", "artist_id")), "track-artist-id-invalid"),
        artists = artists,
        album = safeString(source.opt("album"), "track-album-invalid", MAX_TRACK_TEXT_LENGTH, true),
        albumId = referenceId(source.opt(key("albumId", "album_id")), "track-album-id-invalid"),
        durationSec = exactSafeLong(
          source.opt(key("durationSec", "duration_sec")),
          "track-duration-invalid",
          maximum = MAX_DURATION_SECONDS,
        ),
        rank = exactSafeLong(source.opt("rank"), "track-rank-invalid"),
        releaseDate = safeString(
          source.opt(key("releaseDate", "release_date")),
          "track-release-date-invalid",
          MAX_RELEASE_DATE_LENGTH,
          true,
        ),
      )
    }

    private fun persistedEventsSize(events: List<LoggeRythmPlaybackEvent>): Int =
      JSONArray().also { values -> events.forEach { values.put(persistedEventJson(it)) } }
        .toString()
        .toByteArray(StandardCharsets.UTF_8)
        .size

    private fun persistedEventJson(event: LoggeRythmPlaybackEvent): JSONObject =
      JSONObject()
        .put("schemaVersion", SCHEMA_VERSION)
        .put("eventId", event.eventId)
        .put("type", if (event is LoggeRythmRadioPlaybackEvent) "RADIO" else "PLAY")
        .put("createdAtMs", event.createdAtMs)
        .put("attempt", event.attempt)
        .put("notBeforeEpochMs", event.notBeforeEpochMs)
        .put("track", trackJson(event.track))
        .apply {
          if (event is LoggeRythmRadioPlaybackEvent) {
            put("activeMediaId", event.activeMediaId)
            put("queueGeneration", event.queueGeneration)
          }
        }

    private fun claimEventJson(event: LoggeRythmPlaybackEvent): JSONObject =
      JSONObject()
        .put("schemaVersion", SCHEMA_VERSION)
        .put("eventId", event.eventId)
        .put("type", if (event is LoggeRythmRadioPlaybackEvent) "RADIO" else "PLAY")
        .put("createdAtMs", event.createdAtMs)
        .put("attempt", event.attempt)
        .put("track", trackJson(event.track))
        .apply {
          if (event is LoggeRythmRadioPlaybackEvent) {
            put("activeMediaId", event.activeMediaId)
            put("queueGeneration", event.queueGeneration)
          }
        }

    private fun claimJson(
      leaseId: String,
      binding: LoggeRythmPersistedSessionBinding,
      events: List<LoggeRythmPlaybackEvent>,
    ): JSONObject = JSONObject()
      .put("schemaVersion", SCHEMA_VERSION)
      .put("leaseId", leaseId)
      .put(
        "binding",
        JSONObject()
          .put("accountScope", binding.accountScope)
          .put("origin", binding.origin),
      )
      .put(
        "events",
        JSONArray().also { values -> events.forEach { values.put(claimEventJson(it)) } },
      )

    private fun trackJson(track: LoggeRythmPlaybackEventTrackMetadata): JSONObject =
      JSONObject()
        .put("id", track.id)
        .put("title", track.title)
        .put("artist", track.artist)
        .put("artistId", track.artistId)
        .put(
          "artists",
          JSONArray().also { values ->
            track.artists.forEach { artist ->
              values.put(JSONObject().put("id", artist.id).put("name", artist.name))
            }
          },
        )
        .put("album", track.album)
        .put("albumId", track.albumId)
        .put("durationSec", track.durationSec)
        .put("rank", track.rank)
        .put("releaseDate", track.releaseDate)

    private fun validateEvent(
      event: LoggeRythmPlaybackEvent,
      nowMs: Long?,
      enforceAge: Boolean,
    ) {
      requireCanonicalUuid(event.eventId, "event-id-invalid")
      requireSafeInteger(event.createdAtMs, "event-created-at-invalid", minimum = 1L)
      if (event.attempt !in 0..MAX_ATTEMPT) fail("event-attempt-invalid")
      requireSafeInteger(event.notBeforeEpochMs, "event-not-before-invalid")
      validateTrack(event.track)
      if (nowMs != null) {
        if (event.createdAtMs - nowMs > MAX_FUTURE_SKEW_MS) fail("event-created-at-invalid")
        if (enforceAge && nowMs - event.createdAtMs > MAX_AGE_MS) fail("event-created-at-invalid")
      }
      when (event) {
        is LoggeRythmPlayPlaybackEvent -> Unit
        is LoggeRythmRadioPlaybackEvent -> {
          validateSafeString(
            event.activeMediaId,
            "event-active-media-id-invalid",
            MAX_EVENT_MEDIA_ID_LENGTH,
          )
          requireSafeInteger(event.queueGeneration, "event-queue-generation-invalid")
        }
      }
    }

    private fun validateTrack(track: LoggeRythmPlaybackEventTrackMetadata) {
      if (!DEEZER_ID.matches(track.id)) fail("track-id-invalid")
      validateSafeString(track.title, "track-title-invalid", MAX_TRACK_TEXT_LENGTH, true)
      validateSafeString(track.artist, "track-artist-invalid", MAX_TRACK_TEXT_LENGTH, true)
      validateReferenceId(track.artistId, "track-artist-id-invalid")
      if (track.artists.size > MAX_ARTISTS) fail("track-artists-invalid")
      track.artists.forEach { artist ->
        validateReferenceId(artist.id, "track-artist-id-invalid")
        validateSafeString(
          artist.name,
          "track-artist-name-invalid",
          MAX_REFERENCE_TEXT_LENGTH,
          true,
        )
      }
      validateSafeString(track.album, "track-album-invalid", MAX_TRACK_TEXT_LENGTH, true)
      validateReferenceId(track.albumId, "track-album-id-invalid")
      requireSafeInteger(track.durationSec, "track-duration-invalid", maximum = MAX_DURATION_SECONDS)
      requireSafeInteger(track.rank, "track-rank-invalid")
      validateSafeString(
        track.releaseDate,
        "track-release-date-invalid",
        MAX_RELEASE_DATE_LENGTH,
        true,
      )
    }

    private fun LoggeRythmPlaybackEvent.withRetry(
      nextAttempt: Int,
      notBeforeEpochMs: Long,
    ): LoggeRythmPlaybackEvent = when (this) {
      is LoggeRythmPlayPlaybackEvent -> copy(
        attempt = nextAttempt,
        notBeforeEpochMs = notBeforeEpochMs,
      )
      is LoggeRythmRadioPlaybackEvent -> copy(
        attempt = nextAttempt,
        notBeforeEpochMs = notBeforeEpochMs,
      )
    }

    private fun parseObject(json: String): JSONObject {
      if (json.isEmpty() || json.length > MAX_EXTRAS_LENGTH) {
        fail("extras-json-size-invalid")
      }
      validateJsonNesting(json)
      return try {
        val tokener = JSONTokener(json)
        val value = tokener.nextValue()
        if (value !is JSONObject || tokener.nextClean() != '\u0000') fail("extras-json-invalid")
        value
      } catch (error: LoggeRythmPlaybackEventJournalException) {
        throw error
      } catch (_: JSONException) {
        fail("extras-json-invalid")
      }
    }

    private fun validateJsonNesting(json: String) {
      var depth = 0
      var inString = false
      var escaped = false
      json.forEach { character ->
        if (inString) {
          if (escaped) escaped = false
          else if (character == '\\') escaped = true
          else if (character == '"') inString = false
        } else {
          when (character) {
            '"' -> inString = true
            '{', '[' -> {
              depth += 1
              if (depth > MAX_JSON_NESTING) fail("extras-json-depth-invalid")
            }
            '}', ']' -> {
              depth -= 1
              if (depth < 0) fail("extras-json-invalid")
            }
          }
        }
      }
      if (inString || depth != 0) fail("extras-json-invalid")
    }

    private fun requireExactKeys(value: JSONObject, expected: Set<String>) {
      if (value.keys().asSequence().toSet() != expected) fail("event-fields-invalid")
    }

    private fun referenceId(value: Any?, code: String): String {
      if (value == "") return ""
      if (value is String) {
        validateReferenceId(value, code)
        return value
      }
      return exactSafeLong(value, code).toString()
    }

    private fun validateReferenceId(value: String, code: String) {
      if (value.isNotEmpty() && !DEEZER_ID.matches(value)) fail(code)
    }

    private fun safeString(
      value: Any?,
      code: String,
      maximumLength: Int,
      allowEmpty: Boolean = false,
    ): String {
      val text = value as? String ?: fail(code)
      validateSafeString(text, code, maximumLength, allowEmpty)
      return text
    }

    private fun validateSafeString(
      value: String,
      code: String,
      maximumLength: Int,
      allowEmpty: Boolean = false,
    ) {
      if (
        value.length > maximumLength || (!allowEmpty && value.trim().isEmpty()) ||
        hasUnsafeText(value)
      ) {
        fail(code)
      }
    }

    private fun hasUnsafeText(value: String): Boolean {
      var index = 0
      while (index < value.length) {
        val code = value[index].code
        if (code <= 0x1f || code in 0x7f..0x9f) return true
        if (code in 0xd800..0xdbff) {
          if (index + 1 >= value.length || value[index + 1].code !in 0xdc00..0xdfff) return true
          index += 2
        } else {
          if (code in 0xdc00..0xdfff) return true
          index += 1
        }
      }
      return false
    }

    private fun exactSafeLong(
      value: Any?,
      code: String,
      minimum: Long = 0L,
      maximum: Long = MAX_SAFE_INTEGER,
    ): Long {
      val number = value as? Number ?: fail(code)
      val result = try {
        BigDecimal(number.toString()).longValueExact()
      } catch (_: Exception) {
        fail(code)
      }
      requireSafeInteger(result, code, minimum, maximum)
      return result
    }

    private fun requireSafeInteger(
      value: Long,
      code: String,
      minimum: Long = 0L,
      maximum: Long = MAX_SAFE_INTEGER,
    ): Long {
      if (value < minimum || value > maximum) fail(code)
      return value
    }

    private fun requireNow(nowMs: Long): Long =
      requireSafeInteger(nowMs, "journal-time-invalid", minimum = 1L)

    private fun requireCanonicalUuid(value: Any?, code: String): String {
      val text = value as? String ?: fail(code)
      if (!CANONICAL_UUID.matches(text)) fail(code)
      return text
    }

    private fun safeAdd(left: Long, right: Long, code: String): Long {
      if (right > MAX_SAFE_INTEGER - left) fail(code)
      return left + right
    }

    private fun retentionDeadline(createdAtMs: Long): Long {
      val duration = MAX_AGE_MS + 1L
      return if (createdAtMs > MAX_SAFE_INTEGER - duration) MAX_SAFE_INTEGER
      else createdAtMs + duration
    }

    private fun lastRetriableAt(createdAtMs: Long): Long =
      if (createdAtMs > MAX_SAFE_INTEGER - MAX_AGE_MS) MAX_SAFE_INTEGER
      else createdAtMs + MAX_AGE_MS

    private fun fail(code: String): Nothing =
      throw LoggeRythmPlaybackEventJournalException(code)
  }
}
