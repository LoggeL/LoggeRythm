package top.logge.loggerythm.player

import android.os.Bundle
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.SessionCommand

internal object LoggeRythmNotificationFavoriteContract {
  const val ACTION = "top.logge.loggerythm.action.TOGGLE_FAVORITE"
  val command = SessionCommand(ACTION, Bundle())
}

internal data class LoggeRythmNotificationFavoriteState(
  val mediaId: String,
  val liked: Boolean,
  val trackId: String? = null,
)

internal enum class LoggeRythmNotificationFavoriteRequestResult {
  DELIVERED,
  STATE_UNAVAILABLE,
  DELIVERY_UNAVAILABLE,
}

/**
 * Current-item favorite state machine shared by notification/car button publication and command
 * admission.
 *
 * Authoritative account-scoped liked track IDs plus pending durable favorite events take
 * precedence whenever the active item's canonical track ID is known, so car/notification controls
 * survive track changes, pauses, backgrounding, and cold service restores without vanishing.
 * Explicit per-mediaId [publish] remains supported as a fallback when no authoritative snapshot
 * has been synced.
 */
internal class LoggeRythmNotificationFavoriteCoordinator {
  private var published: LoggeRythmNotificationFavoriteState? = null
  private var authoritativeLikedTrackIds: Set<String>? = null
  private var pendingFavoriteStates: Map<String, Boolean> = emptyMap()

  fun publish(mediaId: String?, liked: Boolean?) {
    if (mediaId == null && liked == null) {
      published = null
      return
    }
    require(!mediaId.isNullOrBlank() && liked != null) {
      "notification-favorite-state-invalid"
    }
    published = LoggeRythmNotificationFavoriteState(mediaId, liked)
  }

  fun syncAuthoritativeState(
    likedTrackIds: Set<String>?,
    pendingFavorites: Map<String, Boolean>,
  ) {
    authoritativeLikedTrackIds = likedTrackIds?.toSet()
    pendingFavoriteStates = pendingFavorites.toMap()
  }

  fun clearAll() {
    published = null
    authoritativeLikedTrackIds = null
    pendingFavoriteStates = emptyMap()
  }

  fun stateFor(
    activeMediaId: String?,
    activeTrackId: String? = null,
  ): LoggeRythmNotificationFavoriteState? {
    if (activeMediaId == null) return null
    if (activeTrackId != null) {
      pendingFavoriteStates[activeTrackId]?.let { pendingLiked ->
        return LoggeRythmNotificationFavoriteState(
          mediaId = activeMediaId,
          liked = pendingLiked,
          trackId = activeTrackId,
        )
      }
      authoritativeLikedTrackIds?.let { likedIds ->
        return LoggeRythmNotificationFavoriteState(
          mediaId = activeMediaId,
          liked = activeTrackId in likedIds,
          trackId = activeTrackId,
        )
      }
    }
    return published?.takeIf { it.mediaId == activeMediaId }
  }

  fun requestToggle(
    activeMediaId: String?,
    deliver: (mediaId: String, requestedLiked: Boolean) -> Boolean,
  ): LoggeRythmNotificationFavoriteRequestResult {
    val current = stateFor(activeMediaId)
      ?: return LoggeRythmNotificationFavoriteRequestResult.STATE_UNAVAILABLE
    val requestedLiked = !current.liked
    if (!deliver(current.mediaId, requestedLiked)) {
      return LoggeRythmNotificationFavoriteRequestResult.DELIVERY_UNAVAILABLE
    }
    published = current.copy(liked = requestedLiked)
    return LoggeRythmNotificationFavoriteRequestResult.DELIVERED
  }

  @UnstableApi
  fun buttonFor(
    activeMediaId: String?,
    activeTrackId: String? = null,
  ): List<CommandButton> {
    val current = stateFor(activeMediaId, activeTrackId) ?: return emptyList()
    return listOf(
      CommandButton.Builder(
        if (current.liked) CommandButton.ICON_HEART_FILLED
        else CommandButton.ICON_HEART_UNFILLED,
      )
        .setSessionCommand(LoggeRythmNotificationFavoriteContract.command)
        .setDisplayName(
          if (current.liked) "Remove from favorites" else "Add to favorites",
        )
        .setSlots(CommandButton.SLOT_FORWARD_SECONDARY, CommandButton.SLOT_OVERFLOW)
        .build(),
    )
  }
}

/** In-process delivery exists only while the React module can synchronously accept the request. */
internal object LoggeRythmNotificationFavoriteEventBridge {
  private var receiver: ((String, Boolean) -> Boolean)? = null

  @Synchronized
  fun attach(value: (String, Boolean) -> Boolean) {
    check(receiver == null || receiver === value) { "notification-favorite-receiver-active" }
    receiver = value
  }

  @Synchronized
  fun detach(value: (String, Boolean) -> Boolean) {
    if (receiver === value) receiver = null
  }

  @Synchronized
  fun emit(mediaId: String, requestedLiked: Boolean): Boolean =
    receiver?.invoke(mediaId, requestedLiked) ?: false
}
