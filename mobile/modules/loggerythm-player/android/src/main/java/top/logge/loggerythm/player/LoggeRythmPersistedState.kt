package top.logge.loggerythm.player

import java.math.BigDecimal
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.json.JSONTokener

/** A validation failure whose message is deliberately limited to a non-sensitive code. */
internal class LoggeRythmPersistedStateException(val code: String) :
  IllegalArgumentException(code)

/**
 * The complete private form of one queue entry.
 *
 * [cookie] must never be published in a player snapshot. Its only durable representation is the
 * ciphertext written by [LoggeRythmEncryptedStateStore]. The custom string form prevents an
 * accidental diagnostic from disclosing it.
 */
internal data class LoggeRythmPersistedQueueItem(
  val id: String,
  val url: String,
  val title: String? = null,
  val artist: String? = null,
  val album: String? = null,
  val artworkUrl: String? = null,
  val durationMs: Long? = null,
  val cookie: String? = null,
  val extrasJson: String = "{}",
) {
  override fun toString(): String =
    "LoggeRythmPersistedQueueItem(id=<redacted>, url=<redacted>, " +
      "title=<redacted>, artist=<redacted>, album=<redacted>, " +
      "artworkUrl=<redacted>, durationMs=$durationMs, cookie=<redacted>, " +
      "extrasJson=<redacted>)"
}

internal fun PlayerItemSpec.toPersistedQueueItem(): LoggeRythmPersistedQueueItem =
  LoggeRythmPersistedQueueItem(
    id = id,
    url = url,
    title = title,
    artist = artist,
    album = album,
    artworkUrl = artworkUrl,
    durationMs = durationMs,
    cookie = cookie,
    extrasJson = extrasJson,
  )

internal fun LoggeRythmPersistedQueueItem.toPlayerItemSpec(): PlayerItemSpec =
  PlayerItemSpec(
    id = id,
    url = url,
    title = title,
    artist = artist,
    album = album,
    artworkUrl = artworkUrl,
    durationMs = durationMs,
    cookie = cookie,
    extrasJson = extrasJson,
  )

internal data class LoggeRythmPersistedContextShuffle(
  val enabled: Boolean,
  val restoreOrder: List<String>,
) {
  override fun toString(): String =
    "LoggeRythmPersistedContextShuffle(enabled=$enabled, restoreOrder=<redacted:${restoreOrder.size}>)"
}

/** Account and server identity stored inside (and compared outside) the encrypted state. */
internal data class LoggeRythmPersistedSessionBinding(
  val accountScope: String,
  val origin: String,
) {
  override fun toString(): String =
    "LoggeRythmPersistedSessionBinding(accountScope=<redacted>, origin=<redacted>)"
}

internal object LoggeRythmPersistedSessionBindingPolicy {
  fun requireValid(binding: LoggeRythmPersistedSessionBinding) {
    if (!ACCOUNT_SCOPE_PATTERN.matches(binding.accountScope)) bindingFailure("account-scope-invalid")
    val uri = try {
      URI(binding.origin)
    } catch (_: Exception) {
      bindingFailure("origin-invalid")
    }
    if (
      uri.scheme != "https" ||
      uri.host.isNullOrBlank() ||
      uri.userInfo != null ||
      uri.rawQuery != null ||
      uri.rawFragment != null ||
      (uri.rawPath?.isNotEmpty() == true)
    ) {
      bindingFailure("origin-invalid")
    }
    val port = uri.port
    if (port != -1 && port !in 1..65_535) bindingFailure("origin-invalid")
    val canonicalPort = if (port == 443) -1 else port
    val canonical = try {
      URI("https", null, uri.host.lowercase(), canonicalPort, null, null, null).toASCIIString()
    } catch (_: Exception) {
      bindingFailure("origin-invalid")
    }
    if (binding.origin != canonical) bindingFailure("origin-not-canonical")
  }

  private fun bindingFailure(code: String): Nothing =
    throw LoggeRythmPersistedStateException(code)

  private val ACCOUNT_SCOPE_PATTERN = Regex("user:[1-9][0-9]{0,63}")
}

internal sealed interface LoggeRythmPersistedSleepState {
  /** An absolute wall-clock deadline survives process death and device reboot. */
  data class Time(
    val triggerAtEpochMs: Long,
    val fadeOutMs: Long,
  ) : LoggeRythmPersistedSleepState

  /** The service updates the target transactionally whenever a following timer tracks a move. */
  data class MediaItem(
    val targetIndex: Int,
    val followsCurrentItem: Boolean,
  ) : LoggeRythmPersistedSleepState
}

internal data class LoggeRythmPersistedPlayerState(
  val sessionBinding: LoggeRythmPersistedSessionBinding,
  val queue: List<LoggeRythmPersistedQueueItem>,
  val activeIndex: Int?,
  val positionMs: Long,
  val repeatMode: String,
  val contextShuffle: LoggeRythmPersistedContextShuffle,
  val sleep: LoggeRythmPersistedSleepState?,
) {
  override fun toString(): String =
    "LoggeRythmPersistedPlayerState(sessionBinding=<redacted>, queue=<redacted:${queue.size}>, " +
      "activeIndex=$activeIndex, positionMs=$positionMs, repeatMode=$repeatMode, " +
      "contextShuffle=$contextShuffle, sleep=$sleep)"
}

/**
 * Strict, versioned and bounded JSON codec for the encrypted player-state plaintext.
 *
 * Queue media validation is delegated to [LoggeRythmPlayerProtocol], so persisted state cannot
 * bypass the command boundary's HTTPS/private-file, cookie, metadata, extras, or queue limits.
 */
internal class LoggeRythmPersistedStateCodec(
  private val playerProtocol: LoggeRythmPlayerProtocol,
) {
  fun requireValidBinding(binding: LoggeRythmPersistedSessionBinding) {
    LoggeRythmPersistedSessionBindingPolicy.requireValid(binding)
  }

  fun encode(state: LoggeRythmPersistedPlayerState): ByteArray {
    val normalized = validateAndNormalize(state)
    val root = JSONObject()
      .put("version", SCHEMA_VERSION)
      .put("sessionBinding", sessionBindingJson(normalized.sessionBinding))
      .put("queue", queueJson(normalized.queue))
      .put("activeIndex", normalized.activeIndex ?: JSONObject.NULL)
      .put("positionMs", normalized.positionMs)
      .put("repeatMode", normalized.repeatMode)
      .put("contextShuffle", contextShuffleJson(normalized.contextShuffle))
      .put("sleep", sleepJson(normalized.sleep))
    val encoded = root.toString().toByteArray(StandardCharsets.UTF_8)
    if (encoded.size > MAX_STATE_JSON_BYTES) fail("state-size-invalid")
    return encoded
  }

  fun decode(
    encoded: ByteArray,
    expectedBinding: LoggeRythmPersistedSessionBinding,
  ): LoggeRythmPersistedPlayerState {
    if (encoded.isEmpty() || encoded.size > MAX_STATE_JSON_BYTES) fail("state-size-invalid")
    val root = parseExactObject(encoded)
    requireExactKeys(root, ROOT_KEYS)
    if (requiredInt(root, "version") != SCHEMA_VERSION) fail("state-version-unsupported")

    val binding = parseSessionBinding(requiredObject(root, "sessionBinding"))
    requireValidBinding(expectedBinding)
    if (binding != expectedBinding) fail("session-binding-mismatch")
    val queueValues = requiredArray(root, "queue")
    val activeIndex = requiredNullableInt(root, "activeIndex")
    val positionMs = requiredLong(root, "positionMs")
    val queue = parseQueue(queueValues, activeIndex, positionMs)
    val state = LoggeRythmPersistedPlayerState(
      sessionBinding = binding,
      queue = queue,
      activeIndex = activeIndex,
      positionMs = positionMs,
      repeatMode = requiredString(root, "repeatMode", 8),
      contextShuffle = parseContextShuffle(requiredObject(root, "contextShuffle")),
      sleep = parseSleep(root),
    )
    return validateAndNormalize(state)
  }

  private fun validateAndNormalize(
    state: LoggeRythmPersistedPlayerState,
  ): LoggeRythmPersistedPlayerState {
    requireValidBinding(state.sessionBinding)
    validateEncodeBudget(state)
    if (state.positionMs < 0L || state.positionMs > MAX_POSITION_MS) fail("position-invalid")
    if (state.repeatMode !in REPEAT_MODES) fail("repeat-mode-invalid")
    if (state.queue.isEmpty()) {
      if (state.activeIndex != null || state.positionMs != 0L) fail("empty-queue-state-invalid")
    } else if (state.activeIndex == null || state.activeIndex !in state.queue.indices) {
      fail("active-index-invalid")
    }

    val parsedQueue = parseQueue(queueJson(state.queue), state.activeIndex, state.positionMs)
    parsedQueue.forEachIndexed { index, parsed ->
      val source = state.queue[index]
      // URI canonicalization must never silently change the durable resource identity.
      if (source.url != parsed.url || source.artworkUrl != parsed.artworkUrl) {
        fail("uri-not-canonical")
      }
      if (parsed.durationMs != null && parsed.durationMs > MAX_DURATION_MS) {
        fail("duration-invalid")
      }
    }

    validateCookieOrigins(parsedQueue, state.sessionBinding.origin)
    validateContextShuffle(parsedQueue, state.contextShuffle)
    validateSleep(parsedQueue, state.activeIndex, state.sleep)
    return state.copy(queue = parsedQueue)
  }

  private fun parseQueue(
    values: JSONArray,
    activeIndex: Int?,
    positionMs: Long,
  ): List<LoggeRythmPersistedQueueItem> {
    if (values.length() > MAX_QUEUE_ITEMS) fail("queue-too-large")
    if (values.length() == 0) {
      if (activeIndex != null || positionMs != 0L) fail("empty-queue-state-invalid")
    } else if (activeIndex == null || activeIndex !in 0 until values.length()) {
      fail("active-index-invalid")
    }
    val payload = JSONObject()
      .put("items", values)
      .put("startIndex", activeIndex ?: 0)
      .put("startPositionMs", positionMs)
    val command = try {
      playerProtocol.parseCommand("setQueue", payload.toString()) as PlayerCommand.SetQueue
    } catch (error: PlayerProtocolException) {
      fail("queue-${error.code}")
    }
    return command.items.mapIndexed { index, item ->
      val raw = requiredObject(values, index)
      if (requiredString(raw, "url", MAX_URI_LENGTH) != item.url) fail("uri-not-canonical")
      val rawArtwork = optionalString(raw, "artworkUrl", MAX_URI_LENGTH)
      if (rawArtwork != item.artworkUrl) fail("uri-not-canonical")
      LoggeRythmPersistedQueueItem(
        id = item.id,
        url = item.url,
        title = item.title,
        artist = item.artist,
        album = item.album,
        artworkUrl = item.artworkUrl,
        durationMs = item.durationMs,
        cookie = item.cookie,
        extrasJson = item.extrasJson,
      )
    }
  }

  private fun parseContextShuffle(value: JSONObject): LoggeRythmPersistedContextShuffle {
    requireExactKeys(value, CONTEXT_SHUFFLE_KEYS)
    val enabled = requiredBoolean(value, "enabled")
    val values = requiredArray(value, "restoreOrder")
    if (values.length() > MAX_QUEUE_ITEMS) fail("shuffle-order-too-large")
    val order = List(values.length()) { index ->
      val id = values.opt(index) as? String ?: fail("shuffle-id-invalid")
      validateStableId(id)
      id
    }
    return LoggeRythmPersistedContextShuffle(enabled, order)
  }

  private fun parseSessionBinding(value: JSONObject): LoggeRythmPersistedSessionBinding {
    requireExactKeys(value, SESSION_BINDING_KEYS)
    return LoggeRythmPersistedSessionBinding(
      accountScope = requiredString(value, "accountScope", MAX_ACCOUNT_SCOPE_LENGTH),
      origin = requiredString(value, "origin", MAX_ORIGIN_LENGTH),
    ).also(::requireValidBinding)
  }

  private fun parseSleep(root: JSONObject): LoggeRythmPersistedSleepState? {
    if (root.isNull("sleep")) return null
    val value = requiredObject(root, "sleep")
    return when (requiredString(value, "type", 16)) {
      "time" -> {
        requireExactKeys(value, TIME_SLEEP_KEYS)
        LoggeRythmPersistedSleepState.Time(
          triggerAtEpochMs = requiredLong(value, "triggerAtEpochMs"),
          fadeOutMs = requiredLong(value, "fadeOutMs"),
        )
      }
      "mediaItem" -> {
        requireExactKeys(value, MEDIA_ITEM_SLEEP_KEYS)
        LoggeRythmPersistedSleepState.MediaItem(
          targetIndex = requiredInt(value, "targetIndex"),
          followsCurrentItem = requiredBoolean(value, "followsCurrentItem"),
        )
      }
      else -> fail("sleep-type-invalid")
    }
  }

  private fun validateContextShuffle(
    queue: List<LoggeRythmPersistedQueueItem>,
    shuffle: LoggeRythmPersistedContextShuffle,
  ) {
    if (!shuffle.enabled && shuffle.restoreOrder.isNotEmpty()) {
      fail("shuffle-disabled-order-invalid")
    }
    if (queue.isEmpty() && shuffle.enabled) fail("empty-queue-shuffle-invalid")
    if (shuffle.restoreOrder.size > queue.size) fail("shuffle-order-too-large")

    val stableIds = mutableSetOf<String>()
    val contextIndexes = mutableMapOf<String, MutableSet<Int>>()
    queue.forEach { item ->
      val extras = parseExactObject(item.extrasJson.toByteArray(StandardCharsets.UTF_8))
      validateProductExtras(extras)
      val stableId = if (extras.has("queueStableId")) {
        val value = extras.opt("queueStableId") as? String ?: fail("stable-id-invalid")
        validateStableId(value)
        value
      } else {
        item.id
      }
      if (!stableIds.add(stableId)) fail("stable-id-duplicate")

      if (extras.has("queueOriginalContextOrder")) {
        val order = exactInt(extras.opt("queueOriginalContextOrder"), "context-index-invalid")
        if (order < 0) fail("context-index-invalid")
        val type = extras.opt("queueContextType") as? String ?: fail("context-index-invalid")
        val id = extras.opt("queueContextId") as? String ?: fail("context-index-invalid")
        if (type.isBlank() || id.isBlank()) fail("context-index-invalid")
        if (extras.opt("queueOrigin") == "manual") fail("context-index-invalid")
        val indexes = contextIndexes.getOrPut("$type\u0000$id") { mutableSetOf() }
        if (!indexes.add(order)) fail("context-index-duplicate")
      }
    }

    val seenRestoreIds = mutableSetOf<String>()
    shuffle.restoreOrder.forEach { stableId ->
      validateStableId(stableId)
      if (!seenRestoreIds.add(stableId)) fail("shuffle-id-duplicate")
      if (stableId !in stableIds) fail("shuffle-id-missing")
    }
  }

  private fun validateProductExtras(extras: JSONObject) {
    val origin = if (extras.has("queueOrigin")) {
      (extras.opt("queueOrigin") as? String)?.also {
        if (it !in QUEUE_ORIGINS) fail("queue-origin-invalid")
      } ?: fail("queue-origin-invalid")
    } else {
      null
    }

    val hasType = extras.has("queueContextType")
    val hasId = extras.has("queueContextId")
    val hasLabel = extras.has("queueContextLabel")
    if (hasType != hasId || (hasLabel && !hasType)) fail("queue-context-invalid")
    if (hasType) {
      val type = extras.opt("queueContextType") as? String ?: fail("queue-context-invalid")
      val id = extras.opt("queueContextId") as? String ?: fail("queue-context-invalid")
      if (type !in CONTEXT_TYPES || id.isBlank() || id.length > MAX_CONTEXT_ID_LENGTH) {
        fail("queue-context-invalid")
      }
      if (hasLabel) {
        val label = extras.opt("queueContextLabel") as? String ?: fail("queue-context-invalid")
        if (label.isBlank()) fail("queue-context-invalid")
      }
    }
    if (origin == "manual" && (hasType || extras.has("queueOriginalContextOrder"))) {
      fail("queue-context-invalid")
    }
    if (origin == "context" && (!hasType || !extras.has("queueOriginalContextOrder"))) {
      fail("queue-context-invalid")
    }
  }

  /** Reject oversized caller-owned state before constructing any aggregate JSON objects. */
  private fun validateEncodeBudget(state: LoggeRythmPersistedPlayerState) {
    if (state.queue.size > MAX_QUEUE_ITEMS) fail("queue-too-large")
    var bytes = 1_024L
    fun add(value: Long) {
      bytes += value
      if (bytes > MAX_STATE_JSON_BYTES) fail("state-size-invalid")
    }
    add(jsonStringBytes(state.sessionBinding.accountScope))
    add(jsonStringBytes(state.sessionBinding.origin))
    state.queue.forEach { item ->
      add(192L)
      add(jsonStringBytes(item.id))
      add(jsonStringBytes(item.url))
      item.title?.let { add(jsonStringBytes(it)) }
      item.artist?.let { add(jsonStringBytes(it)) }
      item.album?.let { add(jsonStringBytes(it)) }
      item.artworkUrl?.let { add(jsonStringBytes(it)) }
      item.cookie?.let { add(jsonStringBytes(it)) }
      add(utf8Bytes(item.extrasJson))
    }
    state.contextShuffle.restoreOrder.forEach { add(jsonStringBytes(it)) }
  }

  private fun jsonStringBytes(value: String): Long {
    var bytes = 2L // Surrounding quotes.
    value.forEach { character ->
      bytes += when {
        character == '"' || character == '\\' -> 2L
        character in "\b\t\n\u000c\r" -> 2L
        character.code < 0x20 -> 6L
        character.code <= 0x7f -> 1L
        character.code <= 0x7ff -> 2L
        else -> 3L // A surrogate pair is conservatively counted as six instead of four.
      }
      if (bytes > MAX_STATE_JSON_BYTES) fail("state-size-invalid")
    }
    return bytes
  }

  private fun utf8Bytes(value: String): Long {
    var bytes = 0L
    value.forEach { character ->
      bytes += when {
        character.code <= 0x7f -> 1L
        character.code <= 0x7ff -> 2L
        else -> 3L
      }
      if (bytes > MAX_STATE_JSON_BYTES) fail("state-size-invalid")
    }
    return bytes
  }

  /**
   * A Cookie is bound to the encrypted account state and may only authenticate that binding's
   * exact origin. Unauthenticated media may still use a validated HTTPS CDN URL.
   */
  private fun validateCookieOrigins(
    queue: List<LoggeRythmPersistedQueueItem>,
    boundOrigin: String,
  ) {
    queue.filter { it.cookie != null }.forEach { item ->
      val uri = try {
        URI(item.url)
      } catch (_: Exception) {
        fail("cookie-origin-invalid")
      }
      val port = if (uri.port == 443) -1 else uri.port
      val origin = try {
        URI("https", null, uri.host.lowercase(), port, null, null, null).toASCIIString()
      } catch (_: Exception) {
        fail("cookie-origin-invalid")
      }
      if (origin != boundOrigin) fail("cookie-origin-mismatch")
    }
  }

  private fun validateSleep(
    queue: List<LoggeRythmPersistedQueueItem>,
    activeIndex: Int?,
    sleep: LoggeRythmPersistedSleepState?,
  ) {
    when (sleep) {
      null -> Unit
      is LoggeRythmPersistedSleepState.Time -> {
        if (queue.isEmpty()) fail("empty-queue-sleep-invalid")
        if (sleep.triggerAtEpochMs !in MIN_TRIGGER_EPOCH_MS..MAX_TRIGGER_EPOCH_MS) {
          fail("sleep-deadline-invalid")
        }
        if (sleep.fadeOutMs < 0L || sleep.fadeOutMs > MAX_FADE_OUT_MS) {
          fail("sleep-fade-invalid")
        }
      }
      is LoggeRythmPersistedSleepState.MediaItem -> {
        if (sleep.targetIndex !in queue.indices) fail("sleep-index-invalid")
        if (sleep.followsCurrentItem && sleep.targetIndex != activeIndex) {
          fail("sleep-follow-index-invalid")
        }
      }
    }
  }

  private fun queueJson(queue: List<LoggeRythmPersistedQueueItem>): JSONArray = JSONArray().also {
    queue.forEach { item ->
      val value = JSONObject()
        .put("id", item.id)
        .put("url", item.url)
      item.title?.let { title -> value.put("title", title) }
      item.artist?.let { artist -> value.put("artist", artist) }
      item.album?.let { album -> value.put("album", album) }
      item.artworkUrl?.let { artwork -> value.put("artworkUrl", artwork) }
      item.durationMs?.let { duration -> value.put("durationMs", duration) }
      item.cookie?.let { cookie ->
        value.put("headers", JSONObject().put("Cookie", cookie))
      }
      value.put(
        "extras",
        parseExactObject(item.extrasJson.toByteArray(StandardCharsets.UTF_8)),
      )
      it.put(value)
    }
  }

  private fun contextShuffleJson(value: LoggeRythmPersistedContextShuffle): JSONObject =
    JSONObject()
      .put("enabled", value.enabled)
      .put("restoreOrder", JSONArray(value.restoreOrder))

  private fun sessionBindingJson(value: LoggeRythmPersistedSessionBinding): JSONObject =
    JSONObject()
      .put("accountScope", value.accountScope)
      .put("origin", value.origin)

  private fun sleepJson(value: LoggeRythmPersistedSleepState?): Any = when (value) {
    null -> JSONObject.NULL
    is LoggeRythmPersistedSleepState.Time -> JSONObject()
      .put("type", "time")
      .put("triggerAtEpochMs", value.triggerAtEpochMs)
      .put("fadeOutMs", value.fadeOutMs)
    is LoggeRythmPersistedSleepState.MediaItem -> JSONObject()
      .put("type", "mediaItem")
      .put("targetIndex", value.targetIndex)
      .put("followsCurrentItem", value.followsCurrentItem)
  }

  private fun parseExactObject(encoded: ByteArray): JSONObject {
    if (encoded.isEmpty() || encoded.size > MAX_STATE_JSON_BYTES) fail("json-size-invalid")
    val text = try {
      StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(encoded))
        .toString()
    } catch (_: Exception) {
      fail("json-utf8-invalid")
    }
    validateJsonNesting(text)
    return try {
      val tokener = JSONTokener(text)
      val value = tokener.nextValue()
      if (value !is JSONObject || tokener.nextClean() != '\u0000') fail("json-invalid")
      value
    } catch (error: LoggeRythmPersistedStateException) {
      throw error
    } catch (_: JSONException) {
      fail("json-invalid")
    }
  }

  private fun validateJsonNesting(text: String) {
    var depth = 0
    var inString = false
    var escaped = false
    text.forEach { character ->
      if (inString) {
        if (escaped) {
          escaped = false
        } else if (character == '\\') {
          escaped = true
        } else if (character == '"') {
          inString = false
        }
      } else {
        when (character) {
          '"' -> inString = true
          '{', '[' -> {
            depth += 1
            if (depth > MAX_JSON_NESTING) fail("json-depth-invalid")
          }
          '}', ']' -> {
            depth -= 1
            if (depth < 0) fail("json-invalid")
          }
        }
      }
    }
    if (inString || depth != 0) fail("json-invalid")
  }

  private fun requireExactKeys(value: JSONObject, expected: Set<String>) {
    if (value.keys().asSequence().toSet() != expected) fail("unexpected-or-missing-key")
  }

  private fun requiredObject(value: JSONObject, key: String): JSONObject =
    value.opt(key) as? JSONObject ?: fail("object-value-invalid")

  private fun requiredObject(value: JSONArray, index: Int): JSONObject =
    value.opt(index) as? JSONObject ?: fail("object-value-invalid")

  private fun requiredArray(value: JSONObject, key: String): JSONArray =
    value.opt(key) as? JSONArray ?: fail("array-value-invalid")

  private fun requiredString(value: JSONObject, key: String, maxLength: Int): String {
    val raw = value.opt(key)
    if (raw !is String || raw.isEmpty() || raw.length > maxLength) fail("string-value-invalid")
    return raw
  }

  private fun optionalString(value: JSONObject, key: String, maxLength: Int): String? {
    if (!value.has(key) || value.isNull(key)) return null
    return requiredString(value, key, maxLength)
  }

  private fun requiredBoolean(value: JSONObject, key: String): Boolean =
    value.opt(key) as? Boolean ?: fail("boolean-value-invalid")

  private fun requiredLong(value: JSONObject, key: String): Long =
    exactLong(value.opt(key), "number-value-invalid")

  private fun requiredInt(value: JSONObject, key: String): Int =
    exactInt(value.opt(key), "number-value-invalid")

  private fun requiredNullableInt(value: JSONObject, key: String): Int? {
    if (!value.has(key)) fail("unexpected-or-missing-key")
    if (value.isNull(key)) return null
    return exactInt(value.opt(key), "number-value-invalid")
  }

  private fun exactLong(value: Any?, code: String): Long {
    val number = value as? Number ?: fail(code)
    val decimal = try {
      BigDecimal(number.toString())
    } catch (_: NumberFormatException) {
      fail(code)
    }
    val longValue = try {
      decimal.longValueExact()
    } catch (_: ArithmeticException) {
      fail(code)
    }
    if (longValue < 0L) fail(code)
    return longValue
  }

  private fun exactInt(value: Any?, code: String): Int {
    val longValue = exactLong(value, code)
    if (longValue > Int.MAX_VALUE) fail(code)
    return longValue.toInt()
  }

  private fun validateStableId(value: String) {
    if (
      value.isBlank() ||
      value.length > MAX_STABLE_ID_LENGTH ||
      value.any { it.isISOControl() }
    ) {
      fail("stable-id-invalid")
    }
  }

  private fun fail(code: String): Nothing = throw LoggeRythmPersistedStateException(code)

  companion object {
    internal const val SCHEMA_VERSION = 1
    internal const val MAX_STATE_JSON_BYTES = 2_000_000
    internal const val MAX_QUEUE_ITEMS = 2_000
    private const val MAX_URI_LENGTH = 4_096
    private const val MAX_STABLE_ID_LENGTH = 512
    private const val MAX_CONTEXT_ID_LENGTH = 512
    private const val MAX_JSON_NESTING = 16
    private const val MAX_POSITION_MS = 315_576_000_000L // Ten Julian years.
    private const val MAX_DURATION_MS = MAX_POSITION_MS
    private const val MIN_TRIGGER_EPOCH_MS = 946_684_800_000L // 2000-01-01 UTC.
    private const val MAX_TRIGGER_EPOCH_MS = 32_503_680_000_000L // 3000-01-01 UTC.
    private const val MAX_FADE_OUT_MS = 86_400_000L
    private val REPEAT_MODES = setOf("off", "one", "all")
    private val ROOT_KEYS = setOf(
      "version",
      "sessionBinding",
      "queue",
      "activeIndex",
      "positionMs",
      "repeatMode",
      "contextShuffle",
      "sleep",
    )
    private val SESSION_BINDING_KEYS = setOf("accountScope", "origin")
    private val CONTEXT_SHUFFLE_KEYS = setOf("enabled", "restoreOrder")
    private val TIME_SLEEP_KEYS = setOf("type", "triggerAtEpochMs", "fadeOutMs")
    private val MEDIA_ITEM_SLEEP_KEYS = setOf("type", "targetIndex", "followsCurrentItem")
    private const val MAX_ACCOUNT_SCOPE_LENGTH = 128
    private const val MAX_ORIGIN_LENGTH = 512
    private val QUEUE_ORIGINS = setOf("manual", "context")
    private val CONTEXT_TYPES = setOf(
      "album",
      "artist",
      "chart",
      "collection",
      "discover",
      "genre",
      "home",
      "liked",
      "playlist",
      "radio",
      "recent",
      "search",
    )
  }
}
