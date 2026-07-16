package top.logge.loggerythm.player

import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands

internal enum class RemoteControllerProfile {
  INTERNAL,
  NOTIFICATION,
  TRUSTED_BROWSER,
}

/** Service-owned, process-only permissions for notification and trusted external controllers. */
@UnstableApi
internal class LoggeRythmRemoteCommandPolicy {
  private var configured = false
  private var capabilities: Set<RemotePlayerCapability> = emptySet()

  fun install(values: Set<RemotePlayerCapability>) {
    configured = true
    capabilities = values.toSet()
  }

  fun reset() {
    configured = false
    capabilities = emptySet()
  }

  fun playerCommands(profile: RemoteControllerProfile): Player.Commands {
    if (profile == RemoteControllerProfile.INTERNAL) {
      return MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS.buildUpon()
        .remove(Player.COMMAND_SET_SHUFFLE_MODE)
        .build()
    }
    val codes = playerCommandCodes(profile)
    return Player.Commands.Builder()
      .addIf(Player.COMMAND_GET_CURRENT_MEDIA_ITEM, Player.COMMAND_GET_CURRENT_MEDIA_ITEM in codes)
      .addIf(Player.COMMAND_GET_TIMELINE, Player.COMMAND_GET_TIMELINE in codes)
      .addIf(Player.COMMAND_GET_METADATA, Player.COMMAND_GET_METADATA in codes)
      .addIf(Player.COMMAND_GET_AUDIO_ATTRIBUTES, Player.COMMAND_GET_AUDIO_ATTRIBUTES in codes)
      .addIf(Player.COMMAND_GET_VOLUME, Player.COMMAND_GET_VOLUME in codes)
      .addIf(Player.COMMAND_PLAY_PAUSE, Player.COMMAND_PLAY_PAUSE in codes)
      .addIf(Player.COMMAND_PREPARE, Player.COMMAND_PREPARE in codes)
      .addIf(Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT in codes)
      .addIf(
        Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
        Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM in codes,
      )
      .addIf(Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS in codes)
      .addIf(
        Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
        Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM in codes,
      )
      .addIf(
        Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
        Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM in codes,
      )
      .addIf(Player.COMMAND_STOP, Player.COMMAND_STOP in codes)
      .addIf(Player.COMMAND_SEEK_FORWARD, Player.COMMAND_SEEK_FORWARD in codes)
      .addIf(Player.COMMAND_SEEK_BACK, Player.COMMAND_SEEK_BACK in codes)
      .addIf(Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_SET_MEDIA_ITEM in codes)
      .build()
  }

  fun playerCommandCodes(profile: RemoteControllerProfile): Set<Int> {
    if (profile == RemoteControllerProfile.INTERNAL) return emptySet()
    val commands = linkedSetOf(
      Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
      Player.COMMAND_GET_TIMELINE,
      Player.COMMAND_GET_METADATA,
      Player.COMMAND_GET_AUDIO_ATTRIBUTES,
      Player.COMMAND_GET_VOLUME,
    )
    if (!configured) return commands

    capabilities.forEach { capability ->
      when (capability) {
        RemotePlayerCapability.PLAY_PAUSE -> commands += setOf(
          Player.COMMAND_PLAY_PAUSE,
          Player.COMMAND_PREPARE,
        )
        RemotePlayerCapability.NEXT -> commands += setOf(
          Player.COMMAND_SEEK_TO_NEXT,
          Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
        )
        RemotePlayerCapability.PREVIOUS -> commands += setOf(
          Player.COMMAND_SEEK_TO_PREVIOUS,
          Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
        )
        RemotePlayerCapability.SEEK -> commands += Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM
        RemotePlayerCapability.STOP -> commands += Player.COMMAND_STOP
        RemotePlayerCapability.SKIP_FORWARD -> commands += Player.COMMAND_SEEK_FORWARD
        RemotePlayerCapability.SKIP_BACKWARD -> commands += Player.COMMAND_SEEK_BACK
      }
    }

    // Trusted library controllers may select only IDs resolved by onAddMediaItems.
    // Notification controllers never receive queue-replacement permission.
    if (profile == RemoteControllerProfile.TRUSTED_BROWSER) {
      commands += setOf(Player.COMMAND_SET_MEDIA_ITEM, Player.COMMAND_PREPARE)
    }
    return commands
  }

  fun sessionCommands(profile: RemoteControllerProfile): SessionCommands = when (profile) {
    RemoteControllerProfile.INTERNAL ->
      MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
    RemoteControllerProfile.NOTIFICATION -> SessionCommands.EMPTY
    RemoteControllerProfile.TRUSTED_BROWSER -> SessionCommands.Builder().apply {
      sessionCommandCodes(profile).forEach(::add)
    }.build()
  }

  fun sessionCommandCodes(profile: RemoteControllerProfile): Set<Int> = when (profile) {
    RemoteControllerProfile.TRUSTED_BROWSER -> setOf(
      SessionCommand.COMMAND_CODE_LIBRARY_GET_LIBRARY_ROOT,
      SessionCommand.COMMAND_CODE_LIBRARY_GET_CHILDREN,
      SessionCommand.COMMAND_CODE_LIBRARY_GET_ITEM,
      SessionCommand.COMMAND_CODE_LIBRARY_SUBSCRIBE,
      SessionCommand.COMMAND_CODE_LIBRARY_UNSUBSCRIBE,
    )
    else -> emptySet()
  }

  fun permits(profile: RemoteControllerProfile, playerCommand: Int): Boolean = when (profile) {
    RemoteControllerProfile.INTERNAL -> playerCommand != Player.COMMAND_SET_SHUFFLE_MODE
    else -> playerCommand in playerCommandCodes(profile)
  }
}

internal interface LoggeRythmMediaSessionServiceControl {
  fun installRemoteCommands(capabilities: Set<RemotePlayerCapability>)
  fun resetRemoteCommands()
}

/** In-process command-policy bridge. It deliberately carries no identity, source, or credential. */
internal object LoggeRythmMediaSessionServiceBridge {
  private val lock = Any()
  private var control: LoggeRythmMediaSessionServiceControl? = null

  fun attach(value: LoggeRythmMediaSessionServiceControl) = synchronized(lock) {
    if (control != null && control !== value) {
      throw LoggeRythmPersistedPlayerException("player-session-control-active")
    }
    control = value
  }

  fun detach(value: LoggeRythmMediaSessionServiceControl) = synchronized(lock) {
    if (control === value) control = null
  }

  fun installRemoteCommands(capabilities: Set<RemotePlayerCapability>) {
    val active = synchronized(lock) { control }
      ?: throw LoggeRythmPersistedPlayerException("player-session-control-unavailable")
    active.installRemoteCommands(capabilities)
  }

  fun resetRemoteCommands() {
    synchronized(lock) { control }?.resetRemoteCommands()
  }
}
