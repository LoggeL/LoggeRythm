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

internal fun publishableRestoredRemoteCapabilities(
  explicitlyReset: Boolean,
  committedCapabilities: Set<RemotePlayerCapability>?,
): Set<RemotePlayerCapability>? =
  if (explicitlyReset) null else committedCapabilities?.toSet()

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
    RemoteControllerProfile.NOTIFICATION -> SessionCommands.Builder()
      .add(LoggeRythmNotificationFavoriteContract.command)
      .build()
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

/**
 * Publishes a remote command policy only after the complete encrypted player snapshot containing
 * it has been durably replaced. While the write is pending (and after any failure), externally
 * mutable commands remain reset. The injected persistence boundary makes ordering and failures
 * deterministic in local JVM tests.
 */
internal class LoggeRythmDurableRemoteCommandInstaller(
  private val resetPolicy: () -> Unit,
  private val installPolicy: (Set<RemotePlayerCapability>) -> Unit,
  private val refreshConnectedControllers: () -> Unit,
  private val persist: (Set<RemotePlayerCapability>, (Result<Unit>) -> Unit) -> Unit,
) {
  private var generation = 0L
  private var pending: ((Result<Unit>) -> Unit)? = null
  private var closed = false

  fun install(
    capabilities: Set<RemotePlayerCapability>,
    callback: (Result<Unit>) -> Unit,
  ) {
    if (closed) {
      callback(failure("player-session-control-unavailable"))
      return
    }
    if (pending != null) {
      callback(failure("player-command-policy-update-active"))
      return
    }
    generation = nextGeneration(generation)
    val ticket = generation
    val snapshot = capabilities.toSet()
    pending = callback
    resetPolicy()
    runCatching(refreshConnectedControllers)
    try {
      persist(snapshot) { result -> finish(ticket, snapshot, result) }
    } catch (_: Exception) {
      finish(ticket, capabilities, failure("player-persistence-save-failed"))
    }
  }

  /** Cancels one in-flight install and prevents its late persistence callback from republishing. */
  fun reset() {
    if (closed) return
    generation = nextGeneration(generation)
    resetPolicy()
    runCatching(refreshConnectedControllers)
    val callback = pending
    pending = null
    callback?.let {
      runCatching { it(failure("player-command-policy-update-cancelled")) }
    }
  }

  fun close() {
    if (closed) return
    closed = true
    generation = nextGeneration(generation)
    resetPolicy()
    val callback = pending
    pending = null
    callback?.let { runCatching { it(failure("player-persistence-closed")) } }
  }

  private fun finish(
    ticket: Long,
    capabilities: Set<RemotePlayerCapability>,
    result: Result<Unit>,
  ) {
    if (closed || ticket != generation) return
    val callback = pending ?: return
    pending = null
    if (result.isSuccess) {
      installPolicy(capabilities.toSet())
      // Availability propagation is best-effort. Request admission consults the already-installed
      // policy, so an obsolete controller cannot bypass it even if Media3 rejects a UI refresh.
      runCatching(refreshConnectedControllers)
      runCatching { callback(Result.success(Unit)) }
    } else {
      resetPolicy()
      runCatching(refreshConnectedControllers)
      runCatching {
        callback(Result.failure(
          result.exceptionOrNull()
            ?: LoggeRythmPersistedPlayerException("player-persistence-save-failed"),
        ))
      }
    }
  }

  private fun <T> failure(code: String): Result<T> =
    Result.failure(LoggeRythmPersistedPlayerException(code))

  private fun nextGeneration(value: Long): Long =
    if (value == Long.MAX_VALUE) 1L else value + 1L
}

internal interface LoggeRythmMediaSessionServiceControl {
  fun installRemoteCommands(
    capabilities: Set<RemotePlayerCapability>,
    callback: (Result<Unit>) -> Unit,
  )
  fun resetRemoteCommands()
  fun publishNotificationFavorite(
    mediaId: String?,
    liked: Boolean?,
    callback: (Result<Unit>) -> Unit,
  )
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

  fun installRemoteCommands(
    capabilities: Set<RemotePlayerCapability>,
    callback: (Result<Unit>) -> Unit,
  ) {
    val active = synchronized(lock) { control }
    if (active == null) {
      callback(Result.failure(
        LoggeRythmPersistedPlayerException("player-session-control-unavailable"),
      ))
    } else {
      active.installRemoteCommands(capabilities, callback)
    }
  }

  fun resetRemoteCommands() {
    synchronized(lock) { control }?.resetRemoteCommands()
  }

  fun publishNotificationFavorite(
    mediaId: String?,
    liked: Boolean?,
    callback: (Result<Unit>) -> Unit,
  ) {
    val active = synchronized(lock) { control }
    if (active == null) {
      callback(Result.failure(
        LoggeRythmPersistedPlayerException("player-session-control-unavailable"),
      ))
    } else {
      active.publishNotificationFavorite(mediaId, liked, callback)
    }
  }
}
