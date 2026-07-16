package top.logge.loggerythm.player

import androidx.media3.exoplayer.ExoPlayer
import java.lang.reflect.Proxy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmPersistedPlayerCoordinatorTest {
  @Test
  fun compatibilityShuffleDisableMutatesOnlyTheServiceOwnedPlayer() {
    var shuffleEnabled: Boolean? = null
    val player = Proxy.newProxyInstance(
      ExoPlayer::class.java.classLoader,
      arrayOf(ExoPlayer::class.java),
    ) { _, method, arguments ->
      if (method.name != "setShuffleModeEnabled") {
        throw AssertionError("Unexpected ExoPlayer method ${method.name}")
      }
      shuffleEnabled = arguments?.single() as Boolean
      null
    } as ExoPlayer

    assertTrue(applyServiceOwnedGlobalShuffleCommand(player, PlayerCommand.DisableGlobalShuffle))
    assertEquals(false, shuffleEnabled)
    shuffleEnabled = null
    assertFalse(applyServiceOwnedGlobalShuffleCommand(player, PlayerCommand.Play))
    assertNull(shuffleEnabled)
  }

  @Test
  fun generationInvalidatesEveryOlderLifecycleTicket() {
    val generation = LoggeRythmPersistedGeneration()
    val first = generation.advance()
    assertTrue(generation.isCurrent(first))

    val second = generation.advance()
    assertFalse(generation.isCurrent(first))
    assertTrue(generation.isCurrent(second))
  }

  @Test
  fun sleepSnapshotUsesRemainingTimeAndNeverPublishesNegativeValues() {
    val active = LoggeRythmPersistedSleepState.Time(
      triggerAtEpochMs = 12_000L,
      fadeOutMs = 2_000L,
    )
    assertEquals(
      LoggeRythmPersistedSleepSnapshot.Time(3_000L, 2_000L),
      active.toPublicSnapshot(9_000L),
    )
    assertEquals(
      LoggeRythmPersistedSleepSnapshot.Time(0L, 2_000L),
      active.toPublicSnapshot(13_000L),
    )
    assertEquals(
      LoggeRythmPersistedSleepSnapshot.MediaItem(7),
      LoggeRythmPersistedSleepState.MediaItem(7, false).toPublicSnapshot(9_000L),
    )
    assertNull(null.toPublicSnapshot(9_000L))
  }

  @Test
  fun bridgeForwardsBoundControlAndFailsClosedAfterDetach() {
    val control = FakeControl()
    LoggeRythmPersistedServiceBridge.attach(control)
    try {
      val binding = LoggeRythmPersistedSessionBinding(
        accountScope = "user:42",
        origin = "https://loggerythm.logge.top",
      )
      var bindResult: Result<Unit>? = null
      LoggeRythmPersistedServiceBridge.bindSession(binding) { bindResult = it }
      assertTrue(bindResult?.isSuccess == true)
      assertEquals(binding, control.binding)
      assertTrue(LoggeRythmPersistedServiceBridge.isReady())
      assertEquals(control.state, LoggeRythmPersistedServiceBridge.publicState())

      val command = PlayerCommand.CancelSleepTimer
      assertTrue(LoggeRythmPersistedServiceBridge.applyAuxiliaryCommand(command))
      assertEquals(command, control.auxiliaryCommand)
    } finally {
      LoggeRythmPersistedServiceBridge.detach(control)
    }

    assertFalse(LoggeRythmPersistedServiceBridge.isReady())
    var unavailable: Result<Unit>? = null
    LoggeRythmPersistedServiceBridge.bindSession(
      LoggeRythmPersistedSessionBinding("user:42", "https://loggerythm.logge.top"),
    ) { unavailable = it }
    assertTrue(unavailable?.isFailure == true)
    assertEquals(
      "player-persistence-unavailable",
      (unavailable?.exceptionOrNull() as LoggeRythmPersistedPlayerException).code,
    )
  }

  @Test
  fun runtimeBindingChangeClearsPrivateQueueSidecars() {
    val first = LoggeRythmPersistedSessionBinding("user:42", "https://loggerythm.logge.top")
    val second = LoggeRythmPersistedSessionBinding("user:43", "https://loggerythm.logge.top")
    LoggeRythmPlayerRuntime.clearSessionAndAllData()
    try {
      assertTrue(LoggeRythmPlayerRuntime.bindSession(first))
      assertTrue(LoggeRythmPlayerRuntime.installQueue(emptyList()).isEmpty())
      assertEquals(first, LoggeRythmPlayerRuntime.currentSessionBinding())

      assertTrue(LoggeRythmPlayerRuntime.bindSession(second))
      assertTrue(LoggeRythmPlayerRuntime.queueSources().isEmpty())
      assertEquals(second, LoggeRythmPlayerRuntime.currentSessionBinding())
    } finally {
      LoggeRythmPlayerRuntime.clearSessionAndAllData()
    }
    assertNull(LoggeRythmPlayerRuntime.currentSessionBinding())
  }

  private class FakeControl : LoggeRythmPersistedServiceControl {
    var binding: LoggeRythmPersistedSessionBinding? = null
    var auxiliaryCommand: PlayerCommand? = null
    val state = LoggeRythmPersistedPublicState(
      contextShuffleEnabled = true,
      contextShuffleRestoreOrder = listOf("stable:1"),
      sleepTimer = LoggeRythmPersistedSleepSnapshot.MediaItem(1),
    )

    override fun bindSession(
      binding: LoggeRythmPersistedSessionBinding,
      callback: (Result<Unit>) -> Unit,
    ) {
      this.binding = binding
      callback(Result.success(Unit))
    }

    override fun isReady(): Boolean = true

    override fun applyAuxiliaryCommand(command: PlayerCommand): Boolean {
      auxiliaryCommand = command
      return true
    }

    override fun onCommandApplied(command: PlayerCommand) = Unit

    override fun onLiveQueueCleared() = Unit

    override fun publicState(): LoggeRythmPersistedPublicState = state

    override fun clearPersistedState(
      callback: (Result<LoggeRythmCacheClearResult>) -> Unit,
    ) {
      callback(Result.success(LoggeRythmCacheClearResult(0L, 0L, 0, true)))
    }
  }
}
