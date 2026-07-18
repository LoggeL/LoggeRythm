package top.logge.loggerythm.player

import android.os.Bundle
import androidx.media3.session.CommandButton
import androidx.media3.session.SessionCommand

internal object LoggeRythmNotificationFavoriteContract {
  const val ACTION = "top.logge.loggerythm.action.TOGGLE_FAVORITE"
  val command = SessionCommand(ACTION, Bundle.EMPTY)
}

internal data class LoggeRythmNotificationFavoriteState(
  val mediaId: String,
  val liked: Boolean,
)

internal enum class LoggeRythmNotificationFavoriteRequestResult {
  DELIVERED,
  STATE_UNAVAILABLE,
  DELIVERY_UNAVAILABLE,
}

/** Exact-current-item state machine shared by notification publication and command admission. */
internal class LoggeRythmNotificationFavoriteCoordinator {
  private var published: LoggeRythmNotificationFavoriteState? = null

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

  fun stateFor(activeMediaId: String?): LoggeRythmNotificationFavoriteState? =
    published?.takeIf { activeMediaId != null && it.mediaId == activeMediaId }

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

  fun buttonFor(activeMediaId: String?): List<CommandButton> {
    val current = stateFor(activeMediaId) ?: return emptyList()
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
