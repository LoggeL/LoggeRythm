package top.logge.loggerythm.player

import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import java.text.Normalizer
import java.util.Locale
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** What a `MediaSessionService.onGetSession` call represents. */
internal enum class LoggeRythmSessionLookup {
  /**
   * Media3's own placeholder for a platform `MediaBrowserService` bind. It identifies no caller:
   * the session's legacy browser binder is handed to the framework, and every real legacy browser
   * or platform controller is admitted later in `onConnect` with its platform-verified identity.
   */
  FRAMEWORK_LEGACY_BROWSER_BOOTSTRAP,

  /** A real controller identity that must pass controller admission. */
  CONTROLLER,
}

internal object LoggeRythmSessionLookupPolicy {
  /** `MediaSessionManager.RemoteUserInfo.UNKNOWN_UID`; Binder never reports it for a caller. */
  const val UNKNOWN_UID = -1

  /**
   * Media3 1.10 calls `onGetSession(ControllerInfo.createLegacyControllerInfo())` when the
   * framework binds `android.media.browse.MediaBrowserService`. Only that exact untrusted
   * placeholder (unknown UID, legacy package and version) is a bootstrap. A real Media3 controller
   * always carries its Binder calling UID, so it can never be classified as one.
   */
  fun classify(
    uid: Int,
    packageName: String,
    controllerVersion: Int,
    trusted: Boolean,
  ): LoggeRythmSessionLookup =
    if (
      uid == UNKNOWN_UID &&
      !trusted &&
      controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION &&
      packageName == MediaSession.ControllerInfo.LEGACY_CONTROLLER_PACKAGE_NAME
    ) {
      LoggeRythmSessionLookup.FRAMEWORK_LEGACY_BROWSER_BOOTSTRAP
    } else {
      LoggeRythmSessionLookup.CONTROLLER
    }
}

/**
 * User-facing car failures. Each maps to an explicit Media3 [SessionError] code and a localized,
 * actionable message; none carries an account, URL, Cookie, or internal diagnostic.
 */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
internal enum class LoggeRythmCarError(
  val code: String,
  val sessionErrorCode: Int,
  val messageRes: Int,
  val offersOpenApp: Boolean,
) {
  SIGNED_OUT(
    "car-library-signed-out",
    SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED,
    R.string.loggerythm_player_car_error_signed_out,
    offersOpenApp = true,
  ),
  RESTORE_FAILED(
    "car-library-restore-failed",
    SessionError.ERROR_SESSION_SETUP_REQUIRED,
    R.string.loggerythm_player_car_error_restore_failed,
    offersOpenApp = true,
  ),
  LIBRARY_EMPTY(
    "car-library-empty",
    SessionError.ERROR_SESSION_SETUP_REQUIRED,
    R.string.loggerythm_player_car_error_library_empty,
    offersOpenApp = true,
  ),
  LIBRARY_REFRESH_REQUIRED(
    "car-library-refresh-required",
    SessionError.ERROR_SESSION_SETUP_REQUIRED,
    R.string.loggerythm_player_car_error_refresh_required,
    offersOpenApp = true,
  ),
  LIST_UNAVAILABLE(
    "car-list-unavailable",
    SessionError.ERROR_BAD_VALUE,
    R.string.loggerythm_player_car_error_list_unavailable,
    offersOpenApp = false,
  ),
  MEDIA_ITEM_UNAVAILABLE(
    "media-item-not-available",
    SessionError.ERROR_BAD_VALUE,
    R.string.loggerythm_player_car_error_item_unavailable,
    offersOpenApp = false,
  ),
  SEARCH_NO_MATCH(
    "car-search-no-match",
    SessionError.ERROR_BAD_VALUE,
    R.string.loggerythm_player_car_error_search_no_match,
    offersOpenApp = false,
  ),
  NOTHING_TO_PLAY(
    "car-nothing-to-play",
    SessionError.ERROR_SESSION_SETUP_REQUIRED,
    R.string.loggerythm_player_car_error_nothing_to_play,
    offersOpenApp = true,
  ),
  CONTROLS_NOT_READY(
    "car-controls-not-configured",
    SessionError.ERROR_SESSION_SETUP_REQUIRED,
    R.string.loggerythm_player_car_error_controls_not_ready,
    offersOpenApp = true,
  ),
  SESSION_NOT_READY(
    "player-session-not-ready",
    SessionError.ERROR_INVALID_STATE,
    R.string.loggerythm_player_car_error_not_ready,
    offersOpenApp = false,
  ),
  CACHE_CLEARING(
    "player-cache-clearing",
    SessionError.ERROR_INVALID_STATE,
    R.string.loggerythm_player_car_error_busy,
    offersOpenApp = false,
  ),
  QUEUE_COMMIT_ACTIVE(
    "playback-event-queue-commit-active",
    SessionError.ERROR_INVALID_STATE,
    R.string.loggerythm_player_car_error_busy,
    offersOpenApp = false,
  ),
  UNSUPPORTED_REQUEST(
    "car-request-unsupported",
    SessionError.ERROR_NOT_SUPPORTED,
    R.string.loggerythm_player_car_error_unsupported,
    offersOpenApp = false,
  ),
}

/**
 * A rejected car request. The message is the stable machine code; the localized text is resolved
 * only when the error is published to a controller.
 */
internal class LoggeRythmCarRequestException(
  val error: LoggeRythmCarError,
  val messageArgument: String? = null,
) : IllegalStateException(error.code)

internal object LoggeRythmCarLibraryState {
  /** Older encrypted browse records lack the private Track required by the phone UI. */
  fun hasPhoneTrackMetadata(extrasJson: String): Boolean = try {
    val track = JSONObject(extrasJson).optJSONObject("track")
    val artists = track?.opt("artists") as? JSONArray
    track != null && track.opt("id") is String && track.opt("title") is String &&
      track.opt("artist") is String && artists != null && (0 until artists.length()).all { index ->
        val artist = artists.optJSONObject(index)
        artist != null && (artist.opt("id") is String || artist.opt("id") is Number) &&
          artist.opt("name") is String
      }
  } catch (_: JSONException) {
    false // The caller returns the explicit refresh-required car error; never queues this item.
  }

  /**
   * Why the library root cannot be served, or null when an account-bound tree exists. A missing
   * binding after a failed cold restore needs the app (the encrypted state was discarded); every
   * other missing binding means no account has been loaded on this phone.
   */
  fun rootUnavailable(bound: Boolean, coldRestoreFailed: Boolean): LoggeRythmCarError? = when {
    bound -> null
    coldRestoreFailed -> LoggeRythmCarError.RESTORE_FAILED
    else -> LoggeRythmCarError.SIGNED_OUT
  }
}

internal object LoggeRythmBrowsePaging {
  /**
   * The child index range for one Media3 page. Pages beyond the end are an empty, successful
   * result (Media3: "return an empty list for no children"); an invalid request returns null.
   */
  fun range(size: Int, page: Int, pageSize: Int): IntRange? {
    if (size < 0 || page < 0 || pageSize <= 0) return null
    val from = (page.toLong() * pageSize.toLong()).coerceAtMost(size.toLong()).toInt()
    val to = (from.toLong() + pageSize.toLong()).coerceAtMost(size.toLong()).toInt()
    return from until to
  }
}

/** One voice/search target resolved only from the account-bound native tree. */
internal sealed interface LoggeRythmLibraryTarget {
  val mediaId: String

  /** A playable leaf; playback queues its direct parent's playable children. */
  data class Leaf(override val mediaId: String) : LoggeRythmLibraryTarget

  /** A container; playback queues its playable children from the first one. */
  data class Container(override val mediaId: String) : LoggeRythmLibraryTarget
}

/**
 * Local, deterministic library search over the published tree. It never contacts the network and
 * never reads private sources: only public Media3 metadata (title, artist, album, subtitle).
 */
internal object LoggeRythmLibrarySearch {
  const val MAX_RESULTS = 100

  fun search(tree: RuntimeBrowseTree, query: String, limit: Int = MAX_RESULTS): List<String> {
    require(limit > 0)
    val normalizedQuery = normalize(query)
    if (normalizedQuery.isEmpty()) return emptyList()
    val tokens = normalizedQuery.split(' ')
    val seenLeaves = mutableSetOf<List<Any?>>()
    return candidates(tree, normalizedQuery, tokens)
      .sortedWith(compareBy<Candidate> { it.rank }.thenBy { it.order })
      .filter { candidate ->
        // The same track can be published under several parents (liked songs, playlists,
        // downloads). Show it once, at its first tree position.
        candidate.node.source == null || seenLeaves.add(publicIdentity(candidate.node))
      }
      .take(limit)
      .map { it.id }
  }

  /**
   * Resolve a non-blank voice query. A playlist focus prefers containers; otherwise a leaf wins a
   * tie at the same rank. Exact container titles still rank above partial song matches.
   */
  fun resolvePlayRequest(
    tree: RuntimeBrowseTree,
    query: String,
    preferContainers: Boolean,
  ): LoggeRythmLibraryTarget? {
    val normalizedQuery = normalize(query)
    if (normalizedQuery.isEmpty()) return null
    val tokens = normalizedQuery.split(' ')
    return candidates(tree, normalizedQuery, tokens)
      .sortedWith(
        compareBy<Candidate> { it.rank }
          .thenBy { if ((it.node.source == null) == preferContainers) 0 else 1 }
          .thenBy { it.order },
      )
      .firstNotNullOfOrNull { candidate -> playableTarget(tree, candidate.id) }
  }

  /** The first container (tree order) with at least one directly playable child. */
  fun firstPlayableContainer(tree: RuntimeBrowseTree): LoggeRythmLibraryTarget.Container? =
    tree.nodes.keys.firstNotNullOfOrNull { id ->
      playableTarget(tree, id) as? LoggeRythmLibraryTarget.Container
    }

  fun normalize(value: String): String {
    val decomposed = Normalizer.normalize(value, Normalizer.Form.NFKD)
    val builder = StringBuilder(decomposed.length)
    var pendingSpace = false
    decomposed.lowercase(Locale.ROOT).forEach { character ->
      when {
        Character.getType(character) == Character.NON_SPACING_MARK.toInt() -> Unit
        Character.isLetterOrDigit(character) -> {
          if (pendingSpace && builder.isNotEmpty()) builder.append(' ')
          pendingSpace = false
          builder.append(character)
        }
        else -> pendingSpace = true
      }
    }
    return builder.toString()
  }

  private data class Candidate(
    val id: String,
    val node: RuntimeBrowseNode,
    val rank: Int,
    val order: Int,
  )

  private fun candidates(
    tree: RuntimeBrowseTree,
    normalizedQuery: String,
    tokens: List<String>,
  ): List<Candidate> = tree.nodes.entries.mapIndexedNotNull { order, (id, node) ->
    if (id == tree.rootId) return@mapIndexedNotNull null
    rank(node, normalizedQuery, tokens)?.let { rank -> Candidate(id, node, rank, order) }
  }

  private fun rank(node: RuntimeBrowseNode, normalizedQuery: String, tokens: List<String>): Int? {
    val metadata = node.mediaItem.mediaMetadata
    val title = normalize(metadata.title?.toString().orEmpty())
    if (title == normalizedQuery) return 0
    if (title.startsWith(normalizedQuery)) return 1
    if (tokens.all(title::contains)) return 2
    val haystack = listOf(
      title,
      normalize(metadata.artist?.toString().orEmpty()),
      normalize(metadata.albumTitle?.toString().orEmpty()),
      normalize(metadata.subtitle?.toString().orEmpty()),
    ).joinToString(" ")
    return if (tokens.all(haystack::contains)) 3 else null
  }

  private fun playableTarget(tree: RuntimeBrowseTree, id: String): LoggeRythmLibraryTarget? {
    val node = tree.nodes[id] ?: return null
    if (node.source != null) {
      return if (tree.parentByChildId[id] != null) LoggeRythmLibraryTarget.Leaf(id) else null
    }
    if (id == tree.rootId) return null
    val hasPlayableChild = node.childIds.any { childId -> tree.nodes[childId]?.source != null }
    return if (hasPlayableChild) LoggeRythmLibraryTarget.Container(id) else null
  }

  private fun publicIdentity(node: RuntimeBrowseNode): List<Any?> {
    val metadata = node.mediaItem.mediaMetadata
    return listOf(
      metadata.title?.toString(),
      metadata.artist?.toString(),
      metadata.albumTitle?.toString(),
      metadata.durationMs,
    )
  }
}
