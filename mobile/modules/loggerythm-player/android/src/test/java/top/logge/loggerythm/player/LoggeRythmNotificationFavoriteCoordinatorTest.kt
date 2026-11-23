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

  @Test
  fun resolvesAuthoritativeLikedIdsAcrossTrackChangesAndPreservesEmptyVsUnsyncedDistinction() {
    val coordinator = LoggeRythmNotificationFavoriteCoordinator()

    // Unsynced (null) fails closed: never fabricates an unliked heart button.
    assertNull(coordinator.stateFor("playlist:1:0:100", activeTrackId = "100"))
    assertTrue(coordinator.buttonFor("playlist:1:0:100", activeTrackId = "100").isEmpty())

    // Synced-empty still shows an unfilled heart button.
    coordinator.syncAuthoritativeState(likedTrackIds = emptySet(), pendingFavorites = emptyMap())
    assertEquals(false, coordinator.stateFor("playlist:1:0:100", activeTrackId = "100")?.liked)
    assertEquals(
      CommandButton.ICON_HEART_UNFILLED,
      coordinator.buttonFor("playlist:1:0:100", activeTrackId = "100").single().icon,
    )

    // Track changes immediately resolve against the account-scoped set without disappearing.
    coordinator.syncAuthoritativeState(likedTrackIds = setOf("200"), pendingFavorites = emptyMap())
    assertEquals(
      CommandButton.ICON_HEART_UNFILLED,
      coordinator.buttonFor("playlist:1:0:100", activeTrackId = "100").single().icon,
    )
    assertEquals(
      CommandButton.ICON_HEART_FILLED,
      coordinator.buttonFor("playlist:1:1:200", activeTrackId = "200").single().icon,
    )
  }

  @Test
  fun pendingOverlayOverridesStaleAuthoritativeStateAndRevertsCleanlyOnRollbackOrClearAll() {
    val coordinator = LoggeRythmNotificationFavoriteCoordinator()
    coordinator.syncAuthoritativeState(
      likedTrackIds = setOf("200"),
      pendingFavorites = mapOf("100" to true, "200" to false),
    )

    assertEquals(
      CommandButton.ICON_HEART_FILLED,
      coordinator.buttonFor("queue:1:100", activeTrackId = "100").single().icon,
    )
    assertEquals(
      CommandButton.ICON_HEART_UNFILLED,
      coordinator.buttonFor("queue:2:200", activeTrackId = "200").single().icon,
    )

    // Rollback drops pending overlays -> icons immediately revert to authoritative saved state.
    coordinator.syncAuthoritativeState(likedTrackIds = setOf("200"), pendingFavorites = emptyMap())
    assertEquals(
      CommandButton.ICON_HEART_UNFILLED,
      coordinator.buttonFor("queue:1:100", activeTrackId = "100").single().icon,
    )
    assertEquals(
      CommandButton.ICON_HEART_FILLED,
      coordinator.buttonFor("queue:2:200", activeTrackId = "200").single().icon,
    )

    // Logout/account switch clears every source so nothing bleeds across accounts.
    coordinator.publish("queue:2:200", true)
    coordinator.clearAll()
    assertNull(coordinator.stateFor("queue:2:200", activeTrackId = "200"))
    assertTrue(coordinator.buttonFor("queue:2:200", activeTrackId = "200").isEmpty())
  }
}
