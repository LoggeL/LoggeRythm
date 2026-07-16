package top.logge.loggerythm.player

import androidx.media3.exoplayer.ExoPlayer
import java.lang.reflect.Proxy
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
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
  fun sameBindingJoinsServiceRestoreAndBothCallbacksSettleOnce() {
    val gate = LoggeRythmPersistedBoundaryGate()
    val binding = binding(42)
    val restoreCalls = AtomicInteger()
    val bindCalls = AtomicInteger()
    var restoreResult: Result<Boolean>? = null
    var bindResult: Result<Unit>? = null

    assertEquals(
      LoggeRythmPersistedBoundaryGate.RestoreAdmission.START_SERVICE_RESTORE,
      gate.admitRestore {
        restoreCalls.incrementAndGet()
        restoreResult = it
      }.getOrThrow(),
    )
    assertEquals(
      LoggeRythmPersistedBoundaryGate.BindAdmission.DEFERRED_TO_RESTORE,
      gate.admitBind(binding) {
        bindCalls.incrementAndGet()
        bindResult = it
      }.getOrThrow(),
    )
    assertEquals(binding, gate.deferredServiceBinding())
    assertNull(restoreResult)
    assertNull(bindResult)

    gate.finishService(Result.success(true), Result.success(Unit))
    gate.finishService(Result.success(true), Result.success(Unit))

    assertEquals(1, restoreCalls.get())
    assertEquals(1, bindCalls.get())
    assertEquals(true, restoreResult?.getOrThrow())
    assertTrue(bindResult?.isSuccess == true)
  }

  @Test
  fun differentBindingWaitsForDestructiveReconciliationBeforeRestorePublication() {
    val gate = LoggeRythmPersistedBoundaryGate()
    val requested = binding(43)
    val destructiveClearFinished = CountDownLatch(1)
    val baselineSaved = CountDownLatch(1)
    val publication = mutableListOf<String>()
    var browserSawCompletedBoundary = false
    var reactSawCompletedBoundary = false

    gate.admitRestore { result ->
      browserSawCompletedBoundary = result.isSuccess &&
        destructiveClearFinished.count == 0L &&
        baselineSaved.count == 0L
      publication += "browser"
    }.getOrThrow()
    gate.admitBind(requested) { result ->
      reactSawCompletedBoundary = result.isSuccess &&
        destructiveClearFinished.count == 0L &&
        baselineSaved.count == 0L
      publication += "react"
    }.getOrThrow()

    assertEquals(requested, gate.deferredServiceBinding())
    assertTrue(publication.isEmpty())
    destructiveClearFinished.countDown()
    assertTrue(publication.isEmpty())
    baselineSaved.countDown()
    gate.finishService(Result.success(false), Result.success(Unit))

    assertEquals(listOf("react", "browser"), publication)
    assertTrue(browserSawCompletedBoundary)
    assertTrue(reactSawCompletedBoundary)
    assertNull(gate.deferredServiceBinding())
  }

  @Test
  fun serviceRestoreJoinsAnExactBindAlreadyInFlightInsteadOfPoisoningIt() {
    val gate = LoggeRythmPersistedBoundaryGate()
    val binding = binding(42)
    var bindResult: Result<Unit>? = null
    var restoreResult: Result<Boolean>? = null

    assertEquals(
      LoggeRythmPersistedBoundaryGate.BindAdmission.START_EXACT,
      gate.admitBind(binding) { bindResult = it }.getOrThrow(),
    )
    assertEquals(
      LoggeRythmPersistedBoundaryGate.RestoreAdmission.JOINED_EXACT,
      gate.admitRestore { restoreResult = it }.getOrThrow(),
    )
    assertNull(bindResult)
    assertNull(restoreResult)

    gate.finishExact(Result.success(Unit), restored = true)

    assertTrue(bindResult?.isSuccess == true)
    assertEquals(true, restoreResult?.getOrThrow())

    var laterRestore: Result<Boolean>? = null
    assertEquals(
      LoggeRythmPersistedBoundaryGate.RestoreAdmission.START_SERVICE_RESTORE,
      gate.admitRestore { laterRestore = it }.getOrThrow(),
    )
    gate.finishService(Result.success(false), Result.success(Unit))
    assertEquals(false, laterRestore?.getOrThrow())
  }

  @Test
  fun closeSettlesEveryQueuedBoundaryCallbackExactlyOnce() {
    val gate = LoggeRythmPersistedBoundaryGate()
    val calls = AtomicInteger()
    val completed = CountDownLatch(2)
    val codes = mutableListOf<String?>()

    gate.admitRestore {
      calls.incrementAndGet()
      codes += persistedCode(it.exceptionOrNull())
      completed.countDown()
    }.getOrThrow()
    gate.admitBind(binding(42)) {
      calls.incrementAndGet()
      codes += persistedCode(it.exceptionOrNull())
      completed.countDown()
    }.getOrThrow()

    gate.close()
    gate.close()
    gate.finishService(Result.success(true), Result.success(Unit))

    assertTrue(completed.await(1, TimeUnit.SECONDS))
    assertEquals(2, calls.get())
    assertEquals(listOf("player-persistence-closed", "player-persistence-closed"), codes)
  }

  @Test
  fun pendingCleanupResultSettlesExactlyOnceOnCompletionOrClose() {
    val completed = LoggeRythmPendingResult<Int>()
    val completedCalls = AtomicInteger()
    var completedResult: Result<Int>? = null
    assertTrue(completed.register {
      completedCalls.incrementAndGet()
      completedResult = it
    })

    completed.finish(Result.success(7))
    completed.finish(Result.success(8))
    completed.close(LoggeRythmPersistedPlayerException("player-persistence-closed"))

    assertEquals(1, completedCalls.get())
    assertEquals(7, completedResult?.getOrThrow())

    val closed = LoggeRythmPendingResult<Int>()
    val closedCalls = AtomicInteger()
    var closedResult: Result<Int>? = null
    assertTrue(closed.register {
      closedCalls.incrementAndGet()
      closedResult = it
    })

    closed.close(LoggeRythmPersistedPlayerException("player-persistence-closed"))
    closed.close(LoggeRythmPersistedPlayerException("player-persistence-closed"))
    closed.finish(Result.success(9))

    assertEquals(1, closedCalls.get())
    assertEquals("player-persistence-closed", persistedCode(closedResult?.exceptionOrNull()))
    assertFalse(closed.register { error("closed callback must not be accepted") })
  }

  @Test
  fun stagedRemotePolicyIsFailClosedUntilItsDurableSaveCommits() {
    val durability = LoggeRythmRemotePolicyDurability()
    val previouslyCommitted = setOf(RemotePlayerCapability.PLAY_PAUSE)
    val widening = setOf(
      RemotePlayerCapability.PLAY_PAUSE,
      RemotePlayerCapability.NEXT,
    )
    durability.markDurableState(previouslyCommitted)

    val ticket = durability.beginUpdate(widening)

    assertNull(durability.publishableCapabilities())
    assertEquals(widening, durability.capabilitiesForPersistence())
    assertTrue(durability.requiresClearOnClose())

    assertTrue(durability.completeUpdate(ticket, succeeded = true))
    assertEquals(widening, durability.publishableCapabilities())
    assertFalse(durability.requiresClearOnClose())
  }

  @Test
  fun cancelledSameBindingPolicyCannotRepublishAndRollsBackCommittedSnapshot() {
    val durability = LoggeRythmRemotePolicyDurability()
    val committed = setOf(RemotePlayerCapability.PLAY_PAUSE)
    val staged = setOf(RemotePlayerCapability.PLAY_PAUSE, RemotePlayerCapability.NEXT)
    durability.markDurableState(committed)
    val stagedTicket = durability.beginUpdate(staged)

    val rollbackTicket = checkNotNull(durability.cancelUpdateForRollback())

    assertFalse(durability.completeUpdate(stagedTicket, succeeded = true))
    assertNull(durability.publishableCapabilities())
    assertEquals(committed, durability.capabilitiesForPersistence())
    assertTrue(durability.requiresClearOnClose())

    assertTrue(durability.completeRollback(rollbackTicket, succeeded = true))
    assertEquals(committed, durability.publishableCapabilities())
    assertFalse(durability.requiresClearOnClose())
  }

  @Test
  fun failedOrInterruptedPolicyWriteRequiresDestructiveCloseClear() {
    val durability = LoggeRythmRemotePolicyDurability()
    durability.markDurableState(setOf(RemotePlayerCapability.PLAY_PAUSE))
    val ticket = durability.beginUpdate(RemotePlayerCapability.entries.toSet())

    assertTrue(durability.completeUpdate(ticket, succeeded = false))
    assertTrue(durability.requiresClearOnClose())
    assertNull(durability.publishableCapabilities())

    durability.beginDestructiveBoundary()
    durability.markDurableState(null)
    assertFalse(durability.requiresClearOnClose())
    assertNull(durability.capabilitiesForPersistence())
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
      var browseSaved: Result<Unit>? = null
      LoggeRythmPersistedServiceBridge.onBrowseTreeInstalled { browseSaved = it }
      assertTrue(browseSaved?.isSuccess == true)
      assertTrue(control.browseTreeInstalled)
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
    var browseTreeInstalled = false
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

    override fun onBrowseTreeInstalled(callback: (Result<Unit>) -> Unit) {
      browseTreeInstalled = true
      callback(Result.success(Unit))
    }

    override fun onRemoteCommandsInstalled(
      capabilities: Set<RemotePlayerCapability>,
      callback: (Result<Unit>) -> Unit,
    ) {
      callback(Result.success(Unit))
    }

    override fun publicState(): LoggeRythmPersistedPublicState = state

    override fun clearPersistedState(
      callback: (Result<LoggeRythmCacheClearResult>) -> Unit,
    ) {
      callback(Result.success(LoggeRythmCacheClearResult(0L, 0L, 0, true)))
    }
  }

  private fun binding(id: Int) = LoggeRythmPersistedSessionBinding(
    accountScope = "user:$id",
    origin = "https://loggerythm.logge.top",
  )

  private fun persistedCode(error: Throwable?): String? =
    (error as? LoggeRythmPersistedPlayerException)?.code
}
