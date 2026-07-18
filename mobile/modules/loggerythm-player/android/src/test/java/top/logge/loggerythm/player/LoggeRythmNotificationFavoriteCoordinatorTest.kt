package top.logge.loggerythm.player

import androidx.media3.session.CommandButton
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmNotificationFavoriteCoordinatorTest {
  @Test
  fun publishesOnlyForTheExactCurrentMediaItem() {
    val coordinator = LoggeRythmNotificationFavoriteCoordinator()
    coordinator.publish("queue:track:42", false)

    assertNull(coordinator.stateFor("queue:track:41"))
    assertEquals(false, coordinator.stateFor("queue:track:42")?.liked)
    assertTrue(coordinator.buttonFor("queue:track:41").isEmpty())
    assertEquals(
      CommandButton.ICON_HEART_UNFILLED,
      coordinator.buttonFor("queue:track:42").single().icon,
    )
  }

  @Test
  fun togglesOptimisticallyOnlyAfterDeliveryIsAccepted() {
    val coordinator = LoggeRythmNotificationFavoriteCoordinator()
    coordinator.publish("queue:track:42", false)

    val rejected = coordinator.requestToggle("queue:track:42") { _, _ -> false }
    assertEquals(LoggeRythmNotificationFavoriteRequestResult.DELIVERY_UNAVAILABLE, rejected)
    assertFalse(coordinator.stateFor("queue:track:42")!!.liked)

    var deliveredId: String? = null
    var deliveredState: Boolean? = null
    val accepted = coordinator.requestToggle("queue:track:42") { mediaId, liked ->
      deliveredId = mediaId
      deliveredState = liked
      true
    }
    assertEquals(LoggeRythmNotificationFavoriteRequestResult.DELIVERED, accepted)
    assertEquals("queue:track:42", deliveredId)
    assertEquals(true, deliveredState)
    assertTrue(coordinator.stateFor("queue:track:42")!!.liked)
    assertEquals(
      CommandButton.ICON_HEART_FILLED,
      coordinator.buttonFor("queue:track:42").single().icon,
    )
  }

  @Test
  fun rejectsIncompletePublicationAndClearsExplicitly() {
    val coordinator = LoggeRythmNotificationFavoriteCoordinator()
    coordinator.publish("queue:track:42", true)
    coordinator.publish(null, null)
    assertNull(coordinator.stateFor("queue:track:42"))

    val error = runCatching { coordinator.publish("queue:track:42", null) }.exceptionOrNull()
    assertEquals("notification-favorite-state-invalid", error?.message)
  }
}
