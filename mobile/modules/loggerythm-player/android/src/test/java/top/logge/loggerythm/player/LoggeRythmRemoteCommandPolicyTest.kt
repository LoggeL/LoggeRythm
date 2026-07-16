package top.logge.loggerythm.player

import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.SessionCommand
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@UnstableApi
class LoggeRythmRemoteCommandPolicyTest {
  @Test
  fun internalControllerCannotRequestGlobalShuffleMutation() {
    val policy = LoggeRythmRemoteCommandPolicy()

    assertFalse(policy.permits(RemoteControllerProfile.INTERNAL, Player.COMMAND_SET_SHUFFLE_MODE))
    assertTrue(policy.permits(RemoteControllerProfile.INTERNAL, Player.COMMAND_PLAY_PAUSE))
  }

  @Test
  fun defaultsExternalControllersToReadOnlyAndResetsFailClosed() {
    val policy = LoggeRythmRemoteCommandPolicy()

    assertExternalMutationCommandsAbsent(
      policy.playerCommandCodes(RemoteControllerProfile.NOTIFICATION),
      allowValidatedBrowseSelection = false,
    )
    assertExternalMutationCommandsAbsent(
      policy.playerCommandCodes(RemoteControllerProfile.TRUSTED_BROWSER),
      allowValidatedBrowseSelection = false,
    )

    policy.install(setOf(RemotePlayerCapability.PLAY_PAUSE, RemotePlayerCapability.NEXT))
    assertTrue(
      Player.COMMAND_PLAY_PAUSE in policy.playerCommandCodes(RemoteControllerProfile.NOTIFICATION),
    )
    policy.reset()
    assertFalse(
      Player.COMMAND_PLAY_PAUSE in policy.playerCommandCodes(RemoteControllerProfile.NOTIFICATION),
    )
  }

  @Test
  fun explicitSetupResetSuppressesAConcurrentColdRestorePolicyPublication() {
    val committed = setOf(RemotePlayerCapability.PLAY_PAUSE, RemotePlayerCapability.NEXT)

    assertNull(
      publishableRestoredRemoteCapabilities(
        explicitlyReset = true,
        committedCapabilities = committed,
      ),
    )
    assertEquals(
      committed,
      publishableRestoredRemoteCapabilities(
        explicitlyReset = false,
        committedCapabilities = committed,
      ),
    )
  }

  @Test
  fun mapsEveryConfiguredTransportCapabilityWithoutGlobalOrQueueMutation() {
    val policy = LoggeRythmRemoteCommandPolicy()
    policy.install(RemotePlayerCapability.entries.toSet())
    val notification = policy.playerCommandCodes(RemoteControllerProfile.NOTIFICATION)

    listOf(
      Player.COMMAND_PLAY_PAUSE,
      Player.COMMAND_PREPARE,
      Player.COMMAND_SEEK_TO_NEXT,
      Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_PREVIOUS,
      Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
      Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
      Player.COMMAND_STOP,
      Player.COMMAND_SEEK_FORWARD,
      Player.COMMAND_SEEK_BACK,
    ).forEach { command -> assertTrue(command in notification) }
    assertExternalMutationCommandsAbsent(notification, allowValidatedBrowseSelection = false)
  }

  @Test
  fun givesTrustedBrowserOnlyValidatedSelectionAndRequiredLibraryCommands() {
    val policy = LoggeRythmRemoteCommandPolicy()
    policy.install(setOf(RemotePlayerCapability.PLAY_PAUSE))
    val playerCommands = policy.playerCommandCodes(RemoteControllerProfile.TRUSTED_BROWSER)
    val sessionCommands = policy.sessionCommandCodes(RemoteControllerProfile.TRUSTED_BROWSER)

    assertTrue(Player.COMMAND_SET_MEDIA_ITEM in playerCommands)
    assertTrue(Player.COMMAND_PREPARE in playerCommands)
    assertExternalMutationCommandsAbsent(playerCommands, allowValidatedBrowseSelection = true)
    assertTrue(SessionCommand.COMMAND_CODE_LIBRARY_GET_LIBRARY_ROOT in sessionCommands)
    assertTrue(SessionCommand.COMMAND_CODE_LIBRARY_GET_CHILDREN in sessionCommands)
    assertTrue(SessionCommand.COMMAND_CODE_LIBRARY_GET_ITEM in sessionCommands)
    assertTrue(SessionCommand.COMMAND_CODE_LIBRARY_SUBSCRIBE in sessionCommands)
    assertTrue(SessionCommand.COMMAND_CODE_LIBRARY_UNSUBSCRIBE in sessionCommands)
    assertFalse(SessionCommand.COMMAND_CODE_LIBRARY_SEARCH in sessionCommands)
    assertFalse(SessionCommand.COMMAND_CODE_SESSION_SET_RATING in sessionCommands)
  }

  @Test
  fun durableInstallerKeepsPolicyResetAndPromisePendingUntilEncryptedSaveCompletes() {
    val policy = LoggeRythmRemoteCommandPolicy().apply {
      install(RemotePlayerCapability.entries.toSet())
    }
    val fakePersistence = FakeCapabilityPersistence()
    val refreshes = AtomicInteger()
    val installer = LoggeRythmDurableRemoteCommandInstaller(
      resetPolicy = policy::reset,
      installPolicy = policy::install,
      refreshConnectedControllers = { refreshes.incrementAndGet() },
      persist = fakePersistence::save,
    )
    val narrowed = mutableSetOf(RemotePlayerCapability.PLAY_PAUSE)
    var result: Result<Unit>? = null

    installer.install(narrowed) { result = it }

    assertTrue(fakePersistence.entered.await(1, TimeUnit.SECONDS))
    assertNull(result)
    assertFalse(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_PLAY_PAUSE))
    assertEquals(1, refreshes.get())

    narrowed += RemotePlayerCapability.NEXT
    fakePersistence.complete(Result.success(Unit))

    assertTrue(result?.isSuccess == true)
    assertTrue(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_PLAY_PAUSE))
    assertFalse(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_SEEK_TO_NEXT))
    assertEquals(2, refreshes.get())
  }

  @Test
  fun durableInstallerFailureLeavesPolicyFailClosedAndRejectsExactlyOnce() {
    val policy = LoggeRythmRemoteCommandPolicy().apply {
      install(RemotePlayerCapability.entries.toSet())
    }
    val fakePersistence = FakeCapabilityPersistence()
    val callbackCalls = AtomicInteger()
    val installer = LoggeRythmDurableRemoteCommandInstaller(
      resetPolicy = policy::reset,
      installPolicy = policy::install,
      refreshConnectedControllers = {},
      persist = fakePersistence::save,
    )
    var result: Result<Unit>? = null

    installer.install(emptySet()) {
      callbackCalls.incrementAndGet()
      result = it
    }
    fakePersistence.complete(Result.failure(IllegalStateException("synthetic-save-failure")))
    fakePersistence.complete(Result.success(Unit))

    assertTrue(result?.isFailure == true)
    assertEquals(1, callbackCalls.get())
    assertFalse(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_PLAY_PAUSE))
    assertFalse(policy.permits(RemoteControllerProfile.TRUSTED_BROWSER, Player.COMMAND_SET_MEDIA_ITEM))
  }

  @Test
  fun durableInstallerCloseSettlesPendingUpdateAndIgnoresLatePersistenceCallback() {
    val policy = LoggeRythmRemoteCommandPolicy()
    val fakePersistence = FakeCapabilityPersistence()
    val calls = AtomicInteger()
    val result = AtomicReference<Result<Unit>>()
    val installer = LoggeRythmDurableRemoteCommandInstaller(
      resetPolicy = policy::reset,
      installPolicy = policy::install,
      refreshConnectedControllers = {},
      persist = fakePersistence::save,
    )

    installer.install(setOf(RemotePlayerCapability.NEXT)) {
      calls.incrementAndGet()
      result.set(it)
    }
    installer.close()
    fakePersistence.complete(Result.success(Unit))

    assertEquals(1, calls.get())
    assertEquals(
      "player-persistence-closed",
      (result.get().exceptionOrNull() as LoggeRythmPersistedPlayerException).code,
    )
    assertFalse(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_SEEK_TO_NEXT))
  }

  @Test
  fun explicitResetCancelsPendingUpdateOnceAndLateSuccessCannotRepublishIt() {
    val policy = LoggeRythmRemoteCommandPolicy().apply {
      install(setOf(RemotePlayerCapability.PLAY_PAUSE))
    }
    val fakePersistence = FakeCapabilityPersistence()
    val calls = AtomicInteger()
    val result = AtomicReference<Result<Unit>>()
    val installer = LoggeRythmDurableRemoteCommandInstaller(
      resetPolicy = policy::reset,
      installPolicy = policy::install,
      refreshConnectedControllers = {},
      persist = fakePersistence::save,
    )

    installer.install(RemotePlayerCapability.entries.toSet()) {
      calls.incrementAndGet()
      result.set(it)
    }
    installer.reset()
    installer.reset()
    fakePersistence.complete(Result.success(Unit))

    assertEquals(1, calls.get())
    assertEquals(
      "player-command-policy-update-cancelled",
      (result.get().exceptionOrNull() as LoggeRythmPersistedPlayerException).code,
    )
    assertFalse(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_PLAY_PAUSE))
    assertFalse(policy.permits(RemoteControllerProfile.NOTIFICATION, Player.COMMAND_SEEK_TO_NEXT))
  }

  private fun assertExternalMutationCommandsAbsent(
    commands: Set<Int>,
    allowValidatedBrowseSelection: Boolean,
  ) {
    assertFalse(Player.COMMAND_SET_SHUFFLE_MODE in commands)
    assertFalse(Player.COMMAND_SET_REPEAT_MODE in commands)
    assertFalse(Player.COMMAND_CHANGE_MEDIA_ITEMS in commands)
    assertFalse(Player.COMMAND_SET_SPEED_AND_PITCH in commands)
    assertFalse(Player.COMMAND_SET_VOLUME in commands)
    assertFalse(Player.COMMAND_SET_PLAYLIST_METADATA in commands)
    assertTrue(
      (Player.COMMAND_SET_MEDIA_ITEM in commands) == allowValidatedBrowseSelection,
    )
  }

  private class FakeCapabilityPersistence {
    val entered = CountDownLatch(1)
    private val callback = AtomicReference<((Result<Unit>) -> Unit)?>()

    fun save(
      capabilities: Set<RemotePlayerCapability>,
      completion: (Result<Unit>) -> Unit,
    ) {
      assertTrue(capabilities.size <= RemotePlayerCapability.entries.size)
      assertTrue(callback.compareAndSet(null, completion))
      entered.countDown()
    }

    fun complete(result: Result<Unit>) {
      callback.getAndSet(null)?.invoke(result)
    }
  }
}
