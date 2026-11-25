package top.logge.loggerythm.player

import java.io.File
import java.math.BigDecimal
import java.math.RoundingMode
import java.net.URI
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

internal class PlayerProtocolException(val code: String) : IllegalArgumentException(code)

internal data class PlayerItemSpec(
  val id: String,
  val url: String,
  val title: String?,
  val artist: String?,
  val album: String?,
  val artworkUrl: String?,
  val durationMs: Long?,
  val cookie: String?,
  val extrasJson: String,
) {
  override fun toString(): String =
    "PlayerItemSpec(id=<redacted>, url=<redacted>, title=<redacted>, artist=<redacted>, " +
      "album=<redacted>, artworkUrl=<redacted>, durationMs=$durationMs, cookie=<redacted>, " +
      "extrasJson=<redacted>)"
}

internal data class PlayerSetupSpec(
  val sessionBinding: LoggeRythmPersistedSessionBinding,
)

/** Strict v1 payload used for the native append-and-ack radio transaction. */
internal data class LoggeRythmRadioPlaybackCompletionSpec(
  val expectedQueueGeneration: Long,
  val expectedActiveMediaId: String,
  val items: List<PlayerItemSpec>,
) {
  override fun toString(): String =
    "LoggeRythmRadioPlaybackCompletionSpec(expectedQueueGeneration=$expectedQueueGeneration, " +
      "expectedActiveMediaId=<redacted>, items=<redacted:${items.size}>)"
}

enum class RemotePlayerCapability(val wireValue: String) {
  SEEK("seek"),
  PLAY_PAUSE("playPause"),
  NEXT("next"),
  PREVIOUS("previous"),
  STOP("stop"),
  SKIP_FORWARD("skipForward"),
  SKIP_BACKWARD("skipBackward"),
}

internal sealed interface PlayerCommand {
  data class SetQueue(
    val items: List<PlayerItemSpec>,
    val startIndex: Int,
    val startPositionMs: Long,
  ) : PlayerCommand

  data class ReplaceQueue(
    val items: List<PlayerItemSpec>,
    val startIndex: Int,
    val startPositionMs: Long,
    val resume: Boolean,
  ) : PlayerCommand

  data class AddQueueItems(
    val index: Int,
    val items: List<PlayerItemSpec>,
  ) : PlayerCommand

  data class MoveQueueItem(
    val fromIndex: Int,
    val toIndex: Int,
  ) : PlayerCommand

  data class RemoveQueueItems(
    val fromIndex: Int,
    val toIndex: Int,
  ) : PlayerCommand

  data class ReplaceQueueItem(
    val index: Int,
    val item: PlayerItemSpec,
  ) : PlayerCommand

  data class SkipToIndex(val index: Int) : PlayerCommand

  data object Play : PlayerCommand
  data object Pause : PlayerCommand
  data class SeekTo(val positionMs: Long) : PlayerCommand
  data object SkipToNext : PlayerCommand
  data object SkipToPrevious : PlayerCommand
  data class SetRepeatMode(val mode: String) : PlayerCommand
  data class SetQueuePersistenceState(
    val contextShuffleEnabled: Boolean,
    val contextShuffleRestoreOrder: List<String>,
  ) : PlayerCommand
  data class SetCommands(val capabilities: Set<RemotePlayerCapability>) : PlayerCommand
  data object DisableGlobalShuffle : PlayerCommand
  data class SleepAfterTime(val durationMs: Long, val fadeOutMs: Long) : PlayerCommand
  data class SleepAfterMediaItemAtIndex(val index: Int) : PlayerCommand
  data object CancelSleepTimer : PlayerCommand
  data object Stop : PlayerCommand
  data object ClearQueue : PlayerCommand
  data object RefreshSnapshot : PlayerCommand
}

internal fun PlayerCommand.mutatesQueueStructure(): Boolean = when (this) {
  is PlayerCommand.SetQueue,
  is PlayerCommand.ReplaceQueue,
  is PlayerCommand.AddQueueItems,
  is PlayerCommand.MoveQueueItem,
  is PlayerCommand.RemoveQueueItems,
  is PlayerCommand.ReplaceQueueItem,
  PlayerCommand.ClearQueue -> true
  else -> false
}

internal data class BrowseNodeSpec(
  val id: String,
  val title: String,
  val subtitle: String?,
  val artist: String?,
  val album: String?,
  val artworkUrl: String?,
  val durationMs: Long?,
  val playable: Boolean,
  val url: String?,
  val cookie: String?,
  val children: List<BrowseNodeSpec>,
  /**
   * App-private queue extras of a playable leaf, validated by the strict queue extras policy.
   * They only enter [PlayerItemSpec] and encrypted state; Media3 browse results never carry them.
   */
  val extrasJson: String = "{}",
  /** Optional Android Auto 2.0 browsable child layout hint ("grid" or "list"). */
  val contentStyleBrowsable: String? = null,
  /** Optional Android Auto 2.0 playable child layout hint ("grid" or "list"). */
  val contentStylePlayable: String? = null,
  /** Optional Media3 `MediaMetadata.MEDIA_TYPE_*` semantic type wire value. */
  val mediaType: String? = null,
  /** Optional Android Auto section group header title (`CONTENT_STYLE_GROUP_TITLE`). */
  val groupTitle: String? = null,
) {
  override fun toString(): String =
    "BrowseNodeSpec(id=<redacted>, title=<redacted>, subtitle=<redacted>, " +
      "artist=<redacted>, album=<redacted>, artworkUrl=<redacted>, durationMs=$durationMs, " +
      "playable=$playable, url=<redacted>, cookie=<redacted>, children=<redacted:${children.size}>, " +
      "extrasJson=<redacted>, contentStyleBrowsable=$contentStyleBrowsable, " +
      "contentStylePlayable=$contentStylePlayable, mediaType=$mediaType, " +
      "groupTitle=<redacted>)"
}

internal data class BrowseTreeSpec(val root: BrowseNodeSpec) {
  override fun toString(): String = "BrowseTreeSpec(root=<redacted>)"
}

internal class LoggeRythmPlayerProtocol(privateRoots: List<File>) {
  private val canonicalPrivateRoots = privateRoots.map { it.canonicalFile }.distinct()

  init {
    if (canonicalPrivateRoots.isEmpty()) throw IllegalArgumentException("private-roots-empty")
  }

  fun parseSetup(optionsJson: String): PlayerSetupSpec {
    val value = parseObject(optionsJson)
    requireExactKeys(value, SETUP_KEYS, SETUP_KEYS)
    val binding = LoggeRythmPersistedSessionBinding(
      accountScope = requiredString(value, "accountScope", MAX_ACCOUNT_SCOPE_LENGTH),
      origin = requiredString(value, "origin", MAX_ORIGIN_LENGTH),
    )
    try {
      LoggeRythmPersistedSessionBindingPolicy.requireValid(binding)
    } catch (error: LoggeRythmPersistedStateException) {
      fail(error.code)
    }
    return PlayerSetupSpec(binding)
  }

  fun parseCommand(name: String, payloadJson: String): PlayerCommand {
    val payload = parseObject(payloadJson)
    return when (name) {
      "setQueue" -> parseSetQueue(payload)
      "replaceQueue" -> parseReplaceQueue(payload)
      "addQueueItems" -> parseAddQueueItems(payload)
      "moveQueueItem" -> parseMoveQueueItem(payload)
      "removeQueueItems" -> parseRemoveQueueItems(payload)
      "replaceQueueItem" -> parseReplaceQueueItem(payload)
      "skipToIndex" -> {
        requireExactKeys(payload, setOf("index"), setOf("index"))
        PlayerCommand.SkipToIndex(requiredLong(payload, "index").toIntExact("skip-index-invalid"))
      }
      "play" -> emptyPayload(payload, PlayerCommand.Play)
      "pause" -> emptyPayload(payload, PlayerCommand.Pause)
      "seekTo" -> {
        requireExactKeys(payload, setOf("positionMs"), setOf("positionMs"))
        PlayerCommand.SeekTo(requiredLong(payload, "positionMs"))
      }
      "skipToNext" -> emptyPayload(payload, PlayerCommand.SkipToNext)
      "skipToPrevious" -> emptyPayload(payload, PlayerCommand.SkipToPrevious)
      "setRepeatMode" -> {
        requireExactKeys(payload, setOf("mode"), setOf("mode"))
        val mode = requiredString(payload, "mode", 8)
        if (mode !in REPEAT_MODES) fail("repeat-mode-invalid")
        PlayerCommand.SetRepeatMode(mode)
      }
      "setQueuePersistenceState" -> parseQueuePersistenceState(payload)
      "setCommands" -> parseRemoteCommands(payload)
      "setShuffleEnabled" -> {
        requireExactKeys(payload, setOf("enabled"), setOf("enabled"))
        val enabled = optionalBoolean(payload, "enabled") ?: fail("shuffle-state-invalid")
        if (enabled) fail("global-shuffle-enable-forbidden")
        PlayerCommand.DisableGlobalShuffle
      }
      "sleepAfterTime" -> parseSleepAfterTime(payload)
      "sleepAfterMediaItemAtIndex" -> {
        requireExactKeys(payload, setOf("index"), setOf("index"))
        PlayerCommand.SleepAfterMediaItemAtIndex(
          requiredLong(payload, "index").toIntExact("sleep-index-invalid"),
        )
      }
      "cancelSleepTimer" -> emptyPayload(payload, PlayerCommand.CancelSleepTimer)
      "stop" -> emptyPayload(payload, PlayerCommand.Stop)
      "clearQueue" -> emptyPayload(payload, PlayerCommand.ClearQueue)
      "refreshSnapshot" -> emptyPayload(payload, PlayerCommand.RefreshSnapshot)
      else -> fail("command-name-unsupported")
    }
  }

  fun parseRadioPlaybackCompletion(payloadJson: String): LoggeRythmRadioPlaybackCompletionSpec {
    val payload = parseObject(payloadJson)
    requireExactKeys(payload, RADIO_COMPLETION_KEYS, RADIO_COMPLETION_KEYS)
    if (requiredLong(payload, "schemaVersion") != RADIO_COMPLETION_SCHEMA_VERSION) {
      fail("radio-completion-version-unsupported")
    }
    val generation = requiredLong(payload, "expectedQueueGeneration")
    if (generation > MAX_JS_SAFE_INTEGER) fail("radio-completion-generation-invalid")
    val values = requiredArray(payload, "items")
    if (values.length() > MAX_RADIO_COMPLETION_ITEMS) fail("radio-completion-items-too-large")
    val ids = mutableSetOf<String>()
    val items = List(values.length()) { index ->
      parseQueueItem(requiredObject(values, index)).also { item ->
        if (!ids.add(item.id)) fail("queue-item-id-duplicate")
      }
    }
    return LoggeRythmRadioPlaybackCompletionSpec(
      expectedQueueGeneration = generation,
      expectedActiveMediaId = requiredId(payload, "expectedActiveMediaId"),
      items = items,
    )
  }

  private fun parseQueuePersistenceState(payload: JSONObject): PlayerCommand.SetQueuePersistenceState {
    requireExactKeys(payload, QUEUE_PERSISTENCE_KEYS, QUEUE_PERSISTENCE_KEYS)
    val enabled = optionalBoolean(payload, "contextShuffleEnabled")
      ?: fail("shuffle-state-invalid")
    val values = requiredArray(payload, "contextShuffleRestoreOrder")
    if (values.length() > MAX_QUEUE_ITEMS) fail("shuffle-order-too-large")
    val seen = mutableSetOf<String>()
    val order = List(values.length()) { index ->
      val value = values.opt(index) as? String ?: fail("shuffle-id-invalid")
      if (
        value.isBlank() ||
        value.length > MAX_STABLE_ID_LENGTH ||
        value.any(Char::isISOControl)
      ) {
        fail("shuffle-id-invalid")
      }
      if (!seen.add(value)) fail("shuffle-id-duplicate")
      value
    }
    if (!enabled && order.isNotEmpty()) fail("shuffle-disabled-order-invalid")
    return PlayerCommand.SetQueuePersistenceState(enabled, order)
  }

  private fun parseRemoteCommands(payload: JSONObject): PlayerCommand.SetCommands {
    requireExactKeys(payload, REMOTE_COMMAND_KEYS, setOf("capabilities"))
    if (payload.has("handling")) {
      val handling = requiredString(payload, "handling", 16)
      if (handling != "native") fail("remote-command-handling-unsupported")
    }
    val values = requiredArray(payload, "capabilities")
    if (values.length() > RemotePlayerCapability.entries.size) {
      fail("remote-capability-count-invalid")
    }
    val seen = linkedSetOf<RemotePlayerCapability>()
    repeat(values.length()) { index ->
      val wireValue = values.opt(index) as? String ?: fail("remote-capability-invalid")
      val capability = RemotePlayerCapability.entries.firstOrNull { it.wireValue == wireValue }
        ?: fail("remote-capability-invalid")
      if (!seen.add(capability)) fail("remote-capability-duplicate")
    }
    return PlayerCommand.SetCommands(seen.toSet())
  }

  private fun parseSleepAfterTime(payload: JSONObject): PlayerCommand.SleepAfterTime {
    requireExactKeys(payload, SLEEP_TIME_KEYS, setOf("seconds"))
    val durationMs = secondsToMilliseconds(payload.opt("seconds"), allowZero = false)
    val fadeOutMs = if (payload.has("fadeOutSeconds")) {
      secondsToMilliseconds(payload.opt("fadeOutSeconds"), allowZero = true)
    } else {
      0L
    }
    if (durationMs > MAX_SLEEP_DURATION_MS || fadeOutMs > MAX_SLEEP_FADE_MS) {
      fail("sleep-duration-invalid")
    }
    if (fadeOutMs > durationMs) fail("sleep-fade-invalid")
    return PlayerCommand.SleepAfterTime(durationMs, fadeOutMs)
  }

  private fun secondsToMilliseconds(value: Any?, allowZero: Boolean): Long {
    val number = value as? Number ?: fail("sleep-duration-invalid")
    val seconds = try {
      BigDecimal(number.toString())
    } catch (_: NumberFormatException) {
      fail("sleep-duration-invalid")
    }
    if (seconds.signum() < 0 || (!allowZero && seconds.signum() == 0)) {
      fail("sleep-duration-invalid")
    }
    val milliseconds = try {
      seconds.movePointRight(3).setScale(0, RoundingMode.HALF_UP).longValueExact()
    } catch (_: ArithmeticException) {
      fail("sleep-duration-invalid")
    }
    if ((!allowZero && milliseconds == 0L) || milliseconds < 0L) {
      fail("sleep-duration-invalid")
    }
    return milliseconds
  }

  fun parseBrowseTree(treeJson: String): BrowseTreeSpec {
    val value = parseObject(treeJson)
    requireExactKeys(value, setOf("root"), setOf("root"))
    val rootValue = requiredObject(value, "root")
    val seen = mutableSetOf<String>()
    val nodeCount = intArrayOf(0)
    val root = parseBrowseNode(rootValue, 0, seen, nodeCount)
    if (root.playable) fail("browse-root-playable")
    return BrowseTreeSpec(root)
  }

  fun parseLikedTrackIds(trackIdsJson: String?): Set<String>? {
    if (trackIdsJson == null) return null
    val value = parseObject(trackIdsJson)
    requireExactKeys(value, LIKED_TRACK_IDS_KEYS, LIKED_TRACK_IDS_KEYS)
    if (requiredLong(value, "schemaVersion") != LIKED_TRACK_IDS_SCHEMA_VERSION) {
      fail("liked-track-ids-version-unsupported")
    }
    if (value.isNull("trackIds")) return null
    val values = requiredArray(value, "trackIds")
    if (values.length() > MAX_LIKED_TRACK_IDS) fail("liked-track-ids-too-large")
    val result = linkedSetOf<String>()
    repeat(values.length()) { index ->
      val id = values.opt(index) as? String ?: fail("liked-track-id-invalid")
      if (!DEEZER_ID_PATTERN.matches(id)) fail("liked-track-id-invalid")
      if (!result.add(id)) fail("liked-track-id-duplicate")
    }
    return result.toSet()
  }

  private fun parseSetQueue(payload: JSONObject): PlayerCommand.SetQueue {
    requireExactKeys(
      payload,
      setOf("items", "startIndex", "startPositionMs"),
      setOf("items"),
    )
    val values = requiredArray(payload, "items")
    if (values.length() > MAX_QUEUE_ITEMS) fail("queue-too-large")
    val ids = mutableSetOf<String>()
    val items = List(values.length()) { index ->
      val item = parseQueueItem(requiredObject(values, index))
      if (!ids.add(item.id)) fail("queue-item-id-duplicate")
      item
    }
    val startIndex = optionalLong(payload, "startIndex")?.toIntExact("start-index-invalid") ?: 0
    val startPositionMs = optionalLong(payload, "startPositionMs") ?: 0L
    if (items.isEmpty()) {
      if (startIndex != 0 || startPositionMs != 0L) fail("empty-queue-start-invalid")
    } else if (startIndex !in items.indices) {
      fail("start-index-invalid")
    }
    return PlayerCommand.SetQueue(items, startIndex, startPositionMs)
  }

  private fun parseReplaceQueue(payload: JSONObject): PlayerCommand.ReplaceQueue {
    requireExactKeys(
      payload,
      setOf("items", "startIndex", "startPositionMs", "resume"),
      setOf("items", "startIndex", "startPositionMs", "resume"),
    )
    val values = requiredArray(payload, "items")
    if (values.length() == 0) fail("empty-queue-replace-invalid")
    if (values.length() > MAX_QUEUE_ITEMS) fail("queue-too-large")
    val ids = mutableSetOf<String>()
    val items = List(values.length()) { index ->
      val item = parseQueueItem(requiredObject(values, index))
      if (!ids.add(item.id)) fail("queue-item-id-duplicate")
      item
    }
    val startIndex = requiredLong(payload, "startIndex").toIntExact("start-index-invalid")
    val startPositionMs = requiredLong(payload, "startPositionMs")
    val resume = optionalBoolean(payload, "resume") ?: fail("replace-resume-invalid")
    if (startIndex !in items.indices) fail("start-index-invalid")
    return PlayerCommand.ReplaceQueue(items, startIndex, startPositionMs, resume)
  }

  private fun parseAddQueueItems(payload: JSONObject): PlayerCommand.AddQueueItems {
    requireExactKeys(payload, setOf("index", "items"), setOf("index", "items"))
    val index = requiredLong(payload, "index").toIntExact("queue-index-invalid")
    val values = requiredArray(payload, "items")
    if (values.length() == 0) fail("queue-items-empty")
    if (values.length() > MAX_QUEUE_ITEMS) fail("queue-too-large")
    val ids = mutableSetOf<String>()
    val items = List(values.length()) { i ->
      val item = parseQueueItem(requiredObject(values, i))
      if (!ids.add(item.id)) fail("queue-item-id-duplicate")
      item
    }
    return PlayerCommand.AddQueueItems(index, items)
  }

  private fun parseMoveQueueItem(payload: JSONObject): PlayerCommand.MoveQueueItem {
    requireExactKeys(payload, setOf("fromIndex", "toIndex"), setOf("fromIndex", "toIndex"))
    val fromIndex = requiredLong(payload, "fromIndex").toIntExact("move-index-invalid")
    val toIndex = requiredLong(payload, "toIndex").toIntExact("move-index-invalid")
    return PlayerCommand.MoveQueueItem(fromIndex, toIndex)
  }

  private fun parseRemoveQueueItems(payload: JSONObject): PlayerCommand.RemoveQueueItems {
    requireExactKeys(payload, setOf("fromIndex", "toIndex"), setOf("fromIndex", "toIndex"))
    val fromIndex = requiredLong(payload, "fromIndex").toIntExact("remove-range-invalid")
    val toIndex = requiredLong(payload, "toIndex").toIntExact("remove-range-invalid")
    if (toIndex <= fromIndex) fail("remove-range-invalid")
    return PlayerCommand.RemoveQueueItems(fromIndex, toIndex)
  }

  private fun parseReplaceQueueItem(payload: JSONObject): PlayerCommand.ReplaceQueueItem {
    requireExactKeys(payload, setOf("index", "item"), setOf("index", "item"))
    val index = requiredLong(payload, "index").toIntExact("replace-index-invalid")
    val item = parseQueueItem(requiredObject(payload, "item"))
    return PlayerCommand.ReplaceQueueItem(index, item)
  }

  private fun parseQueueItem(value: JSONObject): PlayerItemSpec {
    requireExactKeys(value, QUEUE_ITEM_KEYS, setOf("id", "url"))
    val id = requiredId(value, "id")
    val url = validateMediaUrl(requiredString(value, "url", MAX_URL_LENGTH))
    val artworkUrl = optionalString(value, "artworkUrl", MAX_URL_LENGTH)?.let(::validateMediaUrl)
    val cookie = optionalHeaders(value)
    if (cookie != null && !url.startsWith("https://")) fail("header-url-invalid")
    return PlayerItemSpec(
      id = id,
      url = url,
      title = optionalString(value, "title", MAX_METADATA_LENGTH),
      artist = optionalString(value, "artist", MAX_METADATA_LENGTH),
      album = optionalString(value, "album", MAX_METADATA_LENGTH),
      artworkUrl = artworkUrl,
      durationMs = optionalLong(value, "durationMs"),
      cookie = cookie,
      extrasJson = optionalExtras(value),
    )
  }

  private fun parseBrowseNode(
    value: JSONObject,
    depth: Int,
    seen: MutableSet<String>,
    nodeCount: IntArray,
  ): BrowseNodeSpec {
    if (depth > MAX_BROWSE_DEPTH) fail("browse-depth-exceeded")
    nodeCount[0] += 1
    if (nodeCount[0] > MAX_BROWSE_NODES) fail("browse-node-limit-exceeded")
    requireExactKeys(value, BROWSE_NODE_KEYS, setOf("id", "title"))
    val id = requiredId(value, "id")
    if (!seen.add(id)) fail("browse-id-duplicate")
    val playable = optionalBoolean(value, "playable") ?: false
    val url = optionalString(value, "url", MAX_URL_LENGTH)?.let(::validateMediaUrl)
    val cookie = optionalHeaders(value)
    val childValues = optionalArray(value, "children") ?: JSONArray()
    if (childValues.length() > MAX_BROWSE_CHILDREN) fail("browse-children-limit-exceeded")
    if (playable && url == null) fail("browse-playable-url-missing")
    if (!playable && (url != null || cookie != null)) fail("browse-container-media-invalid")
    if (!playable && value.has("extras")) fail("browse-container-extras-invalid")
    val extrasJson = optionalExtras(value)
    if (cookie != null && url?.startsWith("https://") != true) fail("header-url-invalid")
    if (playable && childValues.length() != 0) fail("browse-playable-children-invalid")
    val contentStyleBrowsable = optionalString(value, "contentStyleBrowsable", 16)?.also {
      if (it !in BROWSE_CONTENT_STYLES) fail("browse-content-style-invalid")
    }
    val contentStylePlayable = optionalString(value, "contentStylePlayable", 16)?.also {
      if (it !in BROWSE_CONTENT_STYLES) fail("browse-content-style-invalid")
    }
    val mediaType = optionalString(value, "mediaType", 32)?.also {
      if (it !in BROWSE_MEDIA_TYPES) fail("browse-media-type-invalid")
    }
    val groupTitle = optionalString(value, "groupTitle", MAX_TITLE_LENGTH)
    val children = List(childValues.length()) { index ->
      parseBrowseNode(requiredObject(childValues, index), depth + 1, seen, nodeCount)
    }
    return BrowseNodeSpec(
      id = id,
      title = requiredString(value, "title", MAX_TITLE_LENGTH),
      subtitle = optionalString(value, "subtitle", MAX_METADATA_LENGTH),
      artist = optionalString(value, "artist", MAX_METADATA_LENGTH),
      album = optionalString(value, "album", MAX_METADATA_LENGTH),
      artworkUrl = optionalString(value, "artworkUrl", MAX_URL_LENGTH)?.let(::validateMediaUrl),
      durationMs = optionalLong(value, "durationMs"),
      playable = playable,
      url = url,
      cookie = cookie,
      children = children,
      extrasJson = extrasJson,
      contentStyleBrowsable = contentStyleBrowsable,
      contentStylePlayable = contentStylePlayable,
      mediaType = mediaType,
      groupTitle = groupTitle,
    )
  }

  private fun optionalHeaders(value: JSONObject): String? {
    if (!value.has("headers") || value.isNull("headers")) return null
    val headers = requiredObject(value, "headers")
    requireExactKeys(headers, setOf("Cookie"), emptySet())
    if (!headers.has("Cookie")) return null
    val cookie = requiredString(headers, "Cookie", MAX_COOKIE_LENGTH)
    if ('\r' in cookie || '\n' in cookie) fail("header-value-invalid")
    return cookie
  }

  private fun optionalExtras(value: JSONObject): String {
    if (!value.has("extras") || value.isNull("extras")) return "{}"
    val extras = requiredObject(value, "extras")
    val budget = intArrayOf(0)
    validateExtraValue(extras, 0, budget)
    val canonical = extras.toString()
    if (canonical.length > MAX_EXTRAS_LENGTH) fail("extras-size-invalid")
    return canonical
  }

  private fun validateExtraValue(value: Any?, depth: Int, budget: IntArray) {
    if (depth > MAX_EXTRAS_DEPTH) fail("extras-depth-invalid")
    budget[0] += 1
    if (budget[0] > MAX_EXTRAS_VALUES) fail("extras-size-invalid")
    when (value) {
      null, JSONObject.NULL, is Boolean -> Unit
      is String -> if (value.length > MAX_EXTRA_STRING_LENGTH) fail("extras-string-invalid")
      is Number -> if (!value.toDouble().isFinite()) fail("extras-number-invalid")
      is JSONArray -> {
        if (value.length() > MAX_EXTRAS_ARRAY_LENGTH) fail("extras-array-invalid")
        repeat(value.length()) { index -> validateExtraValue(value.opt(index), depth + 1, budget) }
      }
      is JSONObject -> {
        val keys = value.keys().asSequence().toList()
        if (keys.size > MAX_EXTRAS_OBJECT_KEYS) fail("extras-object-invalid")
        keys.forEach { key ->
          if (!EXTRA_KEY_PATTERN.matches(key) || isSensitiveExtraKey(key)) {
            fail("extras-key-invalid")
          }
          validateExtraValue(value.opt(key), depth + 1, budget)
        }
      }
      else -> fail("extras-value-invalid")
    }
  }

  private fun isSensitiveExtraKey(key: String): Boolean {
    val compact = key.lowercase().filter(Char::isLetterOrDigit)
    return compact == "auth" ||
      compact.contains("authorization") ||
      compact.contains("authtoken") ||
      compact.contains("accesstoken") ||
      compact.contains("refreshtoken") ||
      compact.contains("token") ||
      compact.contains("cookie") ||
      compact.contains("header") ||
      compact.contains("secret") ||
      compact.contains("password") ||
      compact.contains("session")
  }

  private fun validateMediaUrl(raw: String): String {
    val uri = try {
      URI(raw)
    } catch (_: Exception) {
      fail("media-url-invalid")
    }
    val scheme = uri.scheme
    if (scheme == "https") {
      if (uri.host.isNullOrBlank() || uri.userInfo != null || uri.fragment != null) {
        fail("media-url-invalid")
      }
      return uri.toASCIIString()
    }
    if (scheme == "file") {
      if (uri.host?.isNotEmpty() == true || uri.userInfo != null || uri.query != null || uri.fragment != null) {
        fail("media-url-invalid")
      }
      val candidate = try {
        File(uri).canonicalFile
      } catch (_: Exception) {
        fail("media-url-invalid")
      }
      if (!candidate.isFile || canonicalPrivateRoots.none { candidate.isStrictlyInside(it) }) {
        fail("media-file-outside-private-storage")
      }
      return candidate.toURI().toASCIIString()
    }
    fail("media-url-scheme-invalid")
  }

  private fun File.isStrictlyInside(root: File): Boolean {
    val rootPath = root.path.trimEnd(File.separatorChar) + File.separator
    return path.startsWith(rootPath)
  }

  private fun <T : PlayerCommand> emptyPayload(value: JSONObject, command: T): T {
    requireExactKeys(value, emptySet(), emptySet())
    return command
  }

  private fun parseObject(json: String): JSONObject {
    if (json.isEmpty() || json.length > MAX_JSON_LENGTH) fail("json-size-invalid")
    return try {
      JSONObject(json)
    } catch (_: JSONException) {
      fail("json-invalid")
    }
  }

  private fun requireExactKeys(value: JSONObject, allowed: Set<String>, required: Set<String>) {
    val keys = value.keys().asSequence().toSet()
    if (!allowed.containsAll(keys)) fail("unexpected-key")
    if (!keys.containsAll(required)) fail("required-key-missing")
  }

  private fun requiredObject(value: JSONObject, key: String): JSONObject =
    value.opt(key) as? JSONObject ?: fail("object-value-invalid")

  private fun requiredObject(value: JSONArray, index: Int): JSONObject =
    value.opt(index) as? JSONObject ?: fail("object-value-invalid")

  private fun requiredArray(value: JSONObject, key: String): JSONArray =
    value.opt(key) as? JSONArray ?: fail("array-value-invalid")

  private fun optionalArray(value: JSONObject, key: String): JSONArray? {
    if (!value.has(key) || value.isNull(key)) return null
    return requiredArray(value, key)
  }

  private fun requiredId(value: JSONObject, key: String): String {
    val id = requiredString(value, key, MAX_ID_LENGTH)
    if (!ID_PATTERN.matches(id)) fail("media-id-invalid")
    return id
  }

  private fun requiredString(value: JSONObject, key: String, maxLength: Int): String {
    val raw = value.opt(key)
    if (raw !is String || raw.isEmpty() || raw.length > maxLength) fail("string-value-invalid")
    return raw
  }

  private fun optionalString(value: JSONObject, key: String, maxLength: Int): String? {
    if (!value.has(key) || value.isNull(key)) return null
    return requiredString(value, key, maxLength)
  }

  private fun requiredLong(value: JSONObject, key: String): Long =
    optionalLong(value, key) ?: fail("number-value-invalid")

  private fun optionalLong(value: JSONObject, key: String): Long? {
    if (!value.has(key) || value.isNull(key)) return null
    val number = value.opt(key) as? Number ?: fail("number-value-invalid")
    val doubleValue = number.toDouble()
    if (!doubleValue.isFinite() || doubleValue < 0.0 || doubleValue > Long.MAX_VALUE.toDouble()) {
      fail("number-value-invalid")
    }
    val longValue = doubleValue.toLong()
    if (longValue.toDouble() != doubleValue) fail("number-value-invalid")
    return longValue
  }

  private fun optionalBoolean(value: JSONObject, key: String): Boolean? {
    if (!value.has(key) || value.isNull(key)) return null
    return value.opt(key) as? Boolean ?: fail("boolean-value-invalid")
  }

  private fun Long.toIntExact(code: String): Int {
    if (this > Int.MAX_VALUE) fail(code)
    return toInt()
  }

  private fun fail(code: String): Nothing = throw PlayerProtocolException(code)

  companion object {
    internal const val MAX_BROWSE_DEPTH = 8
    internal const val MAX_BROWSE_NODES = 5_000
    private const val MAX_BROWSE_CHILDREN = 1_000
    private const val MAX_COOKIE_LENGTH = 4_096
    private const val MAX_EXTRAS_ARRAY_LENGTH = 256
    private const val MAX_EXTRAS_DEPTH = 6
    private const val MAX_EXTRAS_LENGTH = 32_768
    private const val MAX_EXTRAS_OBJECT_KEYS = 128
    private const val MAX_EXTRAS_VALUES = 1_024
    private const val MAX_EXTRA_STRING_LENGTH = 2_048
    private const val MAX_ID_LENGTH = 128
    private const val MAX_JSON_LENGTH = 2_000_000
    private const val MAX_METADATA_LENGTH = 512
    internal const val MAX_QUEUE_ITEMS = 2_000
    private const val MAX_TITLE_LENGTH = 256
    private const val MAX_URL_LENGTH = 4_096
    private const val MAX_ACCOUNT_SCOPE_LENGTH = 128
    private const val MAX_ORIGIN_LENGTH = 512
    private const val MAX_STABLE_ID_LENGTH = 512
    private const val MAX_SLEEP_DURATION_MS = 365L * 24L * 60L * 60L * 1_000L
    private const val MAX_SLEEP_FADE_MS = 24L * 60L * 60L * 1_000L
    private const val MAX_JS_SAFE_INTEGER = 9_007_199_254_740_991L
    private const val MAX_RADIO_COMPLETION_ITEMS = 5
    private const val RADIO_COMPLETION_SCHEMA_VERSION = 1L
    internal const val MAX_LIKED_TRACK_IDS = 50_000
    private const val LIKED_TRACK_IDS_SCHEMA_VERSION = 1L
    private val DEEZER_ID_PATTERN = Regex("[0-9]{1,32}")
    private val LIKED_TRACK_IDS_KEYS = setOf("schemaVersion", "trackIds")
    private val ID_PATTERN = Regex("[A-Za-z0-9._:-]{1,$MAX_ID_LENGTH}")
    private val EXTRA_KEY_PATTERN = Regex("[A-Za-z0-9._:-]{1,64}")
    private val REPEAT_MODES = setOf("off", "one", "all")
    private val SETUP_KEYS = setOf("accountScope", "origin")
    private val QUEUE_PERSISTENCE_KEYS = setOf(
      "contextShuffleEnabled",
      "contextShuffleRestoreOrder",
    )
    private val SLEEP_TIME_KEYS = setOf("seconds", "fadeOutSeconds")
    private val REMOTE_COMMAND_KEYS = setOf("capabilities", "handling")
    private val RADIO_COMPLETION_KEYS = setOf(
      "schemaVersion",
      "expectedQueueGeneration",
      "expectedActiveMediaId",
      "items",
    )
    private val QUEUE_ITEM_KEYS = setOf(
      "id",
      "url",
      "title",
      "artist",
      "album",
      "artworkUrl",
      "durationMs",
      "headers",
      "extras",
    )
    private val BROWSE_CONTENT_STYLES = setOf("grid", "list")
    private val BROWSE_MEDIA_TYPES = setOf(
      "mixed",
      "music",
      "artist",
      "album",
      "playlist",
      "genre",
      "radio_station",
      "folder_mixed",
      "folder_albums",
      "folder_artists",
      "folder_genres",
      "folder_playlists",
      "folder_radio_stations",
    )
    private val BROWSE_NODE_KEYS = setOf(
      "id",
      "title",
      "subtitle",
      "artist",
      "album",
      "artworkUrl",
      "durationMs",
      "playable",
      "url",
      "headers",
      "children",
      "extras",
      "contentStyleBrowsable",
      "contentStylePlayable",
      "mediaType",
      "groupTitle",
    )
  }
}
