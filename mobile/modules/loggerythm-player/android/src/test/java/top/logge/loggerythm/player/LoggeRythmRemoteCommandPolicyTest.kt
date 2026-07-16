package top.logge.loggerythm.player

import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.SessionCommand
import org.junit.Assert.assertFalse
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
}
