package top.logge.loggerythm.player

import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log

internal enum class LoggeRythmQuickTileClickDecision {
  PAUSE,
  RESUME,
  START_PERSONAL_RADIO,
}

internal data class LoggeRythmQuickTilePresentation(
  val tileState: Int,
  val subtitle: String,
)

/** Pure, JVM-testable state machine for the Quick Settings "Resume / Personal Radio" tile. */
internal object LoggeRythmQuickTilePolicy {
  fun decideClick(nowPlaying: LoggeRythmVoiceNowPlaying?): LoggeRythmQuickTileClickDecision =
    when {
      nowPlaying == null -> LoggeRythmQuickTileClickDecision.START_PERSONAL_RADIO
      nowPlaying.isPlaying -> LoggeRythmQuickTileClickDecision.PAUSE
      nowPlaying.hasActiveTrack && nowPlaying.queueSize > 0 ->
        LoggeRythmQuickTileClickDecision.RESUME
      else -> LoggeRythmQuickTileClickDecision.START_PERSONAL_RADIO
    }

  fun presentation(
    nowPlaying: LoggeRythmVoiceNowPlaying?,
    idleSubtitle: String,
    playingFallback: String,
    pausedFallback: String,
  ): LoggeRythmQuickTilePresentation {
    if (nowPlaying == null || !nowPlaying.hasActiveTrack) {
      return LoggeRythmQuickTilePresentation(
        tileState = Tile.STATE_INACTIVE,
        subtitle = idleSubtitle,
      )
    }
    val trackTitle = nowPlaying.track?.title?.trim()?.takeIf(String::isNotEmpty)
    return if (nowPlaying.isPlaying) {
      LoggeRythmQuickTilePresentation(
        tileState = Tile.STATE_ACTIVE,
        subtitle = trackTitle ?: playingFallback,
      )
    } else {
      LoggeRythmQuickTilePresentation(
        tileState = Tile.STATE_INACTIVE,
        subtitle = trackTitle ?: pausedFallback,
      )
    }
  }
}

/**
 * Native Android Quick Settings Tile ("Resume / Personal Radio").
 *
 * - Tapping while playing pauses playback.
 * - Tapping while paused with a loaded track resumes playback.
 * - Tapping when idle/empty launches Personal Radio directly from the notification shade.
 */
public class LoggeRythmQuickTileService : TileService() {
  @Volatile
  private var lastNowPlaying: LoggeRythmVoiceNowPlaying? = null

  override fun onStartListening() {
    super.onStartListening()
    refreshTile()
  }

  override fun onClick() {
    super.onClick()
    val decision = LoggeRythmQuickTilePolicy.decideClick(lastNowPlaying)
    val future = when (decision) {
      LoggeRythmQuickTileClickDecision.PAUSE ->
        LoggeRythmVoiceBridge.controlPlayback(this, LoggeRythmVoicePlaybackAction.PAUSE)
          .thenApply { it }
      LoggeRythmQuickTileClickDecision.RESUME ->
        LoggeRythmVoiceBridge.controlPlayback(this, LoggeRythmVoicePlaybackAction.PLAY)
          .thenApply { it }
      LoggeRythmQuickTileClickDecision.START_PERSONAL_RADIO ->
        LoggeRythmVoiceBridge.startRadio(this, moodOrGenre = null)
          .thenApply { it.nowPlaying }
    }
    future.whenComplete { updated, error ->
      if (error != null) {
        Log.e(TAG, "Quick tile action ${decision.name} failed (${error.javaClass.simpleName})")
        applyErrorState()
      } else if (updated != null) {
        lastNowPlaying = updated
        applyPresentation(updated)
      } else {
        refreshTile()
      }
    }
  }

  private fun refreshTile() {
    LoggeRythmVoiceBridge.getNowPlaying(this).whenComplete { snapshot, error ->
      if (error != null) {
        Log.e(TAG, "Quick tile refresh failed (${error.javaClass.simpleName})")
        lastNowPlaying = null
        applyPresentation(null)
      } else {
        lastNowPlaying = snapshot
        applyPresentation(snapshot)
      }
    }
  }

  private fun applyErrorState() {
    val tile = qsTile ?: return
    tile.label = getString(R.string.loggerythm_qs_tile_label)
    tile.state = Tile.STATE_INACTIVE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.subtitle = getString(R.string.loggerythm_qs_tile_subtitle_idle)
    }
    tile.updateTile()
  }

  private companion object {
    const val TAG = "LoggeRythmQuickTile"
  }

  private fun applyPresentation(snapshot: LoggeRythmVoiceNowPlaying?) {
    val tile = qsTile ?: return
    val presentation = LoggeRythmQuickTilePolicy.presentation(
      nowPlaying = snapshot,
      idleSubtitle = getString(R.string.loggerythm_qs_tile_subtitle_idle),
      playingFallback = getString(R.string.loggerythm_qs_tile_subtitle_playing),
      pausedFallback = getString(R.string.loggerythm_qs_tile_subtitle_paused),
    )
    tile.label = getString(R.string.loggerythm_qs_tile_label)
    tile.state = presentation.tileState
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.subtitle = presentation.subtitle
    }
    tile.updateTile()
  }
}
