package top.logge.loggerythm.player

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import org.json.JSONObject

internal data class LoggeRythmCrossfadeConfig(
  val enabled: Boolean = false,
  val durationSec: Double = 0.0,
) {
  val durationMs: Long
    get() = (durationSec * 1_000.0).roundToLong().coerceAtLeast(0L)

  companion object {
    const val MIN_DURATION_SEC = 0.0
    const val MAX_DURATION_SEC = 12.0

    fun validated(enabled: Boolean, durationSec: Double): LoggeRythmCrossfadeConfig {
      if (!durationSec.isFinite() || durationSec < MIN_DURATION_SEC || durationSec > MAX_DURATION_SEC) {
        throw PlayerProtocolException("crossfade-duration-invalid")
      }
      return LoggeRythmCrossfadeConfig(
        enabled = enabled && durationSec > 0.0,
        durationSec = durationSec,
      )
    }
  }
}

internal data class LoggeRythmTrackCuePoints(
  val introEndMs: Long? = null,
  val outroStartMs: Long? = null,
) {
  companion object {
    fun fromExtras(extrasJson: String): LoggeRythmTrackCuePoints {
      if (extrasJson.isBlank() || extrasJson == "{}") return LoggeRythmTrackCuePoints()
      val root = try {
        JSONObject(extrasJson)
      } catch (_: Exception) {
        return LoggeRythmTrackCuePoints()
      }
      val crossfade = root.optJSONObject("crossfade")
      val track = root.optJSONObject("track")
      val introEndSec = positiveFinite(crossfade, "introEndSec")
        ?: positiveFinite(root, "introEndSec")
        ?: positiveFinite(track, "intro_end_sec")
      val outroStartSec = positiveFinite(crossfade, "outroStartSec")
        ?: positiveFinite(root, "outroStartSec")
        ?: positiveFinite(track, "outro_start_sec")
      return LoggeRythmTrackCuePoints(
        introEndMs = introEndSec?.let { (it * 1_000.0).roundToLong() },
        outroStartMs = outroStartSec?.let { (it * 1_000.0).roundToLong() },
      )
    }

    private fun positiveFinite(obj: JSONObject?, key: String): Double? {
      if (obj == null || !obj.has(key) || obj.isNull(key)) return null
      val raw = obj.opt(key) as? Number ?: return null
      val value = raw.toDouble()
      return if (value.isFinite() && value >= 0.0) value else null
    }
  }
}

internal data class LoggeRythmCrossfadePlan(
  val prepareAtMs: Long,
  val startAtMs: Long,
  val fadeDurationMs: Long,
  val incomingStartPositionMs: Long,
)

/** Equal-power crossfade curve maintaining constant perceived loudness across the overlap. */
internal object LoggeRythmCrossfadeCurve {
  fun outgoingGain(progress: Double): Float {
    val clamped = progress.coerceIn(0.0, 1.0)
    return cos(clamped * (PI / 2.0)).toFloat().coerceIn(0f, 1f)
  }

  fun incomingGain(progress: Double): Float {
    val clamped = progress.coerceIn(0.0, 1.0)
    return sin(clamped * (PI / 2.0)).toFloat().coerceIn(0f, 1f)
  }
}

/** Pure, JVM-testable crossfade trigger planner supporting optional intro/outro cue points. */
internal object LoggeRythmCrossfadePlanner {
  const val PREPARE_LEAD_MS = 1_500L
  const val MIN_TRACK_DURATION_MS = 4_000L

  fun plan(
    config: LoggeRythmCrossfadeConfig,
    outgoingDurationMs: Long,
    outgoingCuePoints: LoggeRythmTrackCuePoints,
    incomingDurationMs: Long?,
    incomingCuePoints: LoggeRythmTrackCuePoints,
    repeatMode: Int,
    hasNextItem: Boolean,
    isSleepFading: Boolean,
    playbackSpeed: Float = 1.0f,
  ): LoggeRythmCrossfadePlan? {
    if (!config.enabled || !hasNextItem || isSleepFading) return null
    if (repeatMode == Player.REPEAT_MODE_ONE) return null
    val speed = playbackSpeed.takeIf { it.isFinite() && it > 0f } ?: 1.0f
    val requestedWallFadeMs = config.durationMs
    if (requestedWallFadeMs <= 0L) return null
    if (outgoingDurationMs < MIN_TRACK_DURATION_MS) return null

    // Convert desired wall-clock fade duration into media-timeline ms at the current playback speed
    // so speed > 1x triggers proportionally earlier and never runs off the end of the outgoing track.
    val requestedMediaFadeMs = (requestedWallFadeMs * speed.toDouble()).roundToLong()
    val maxMediaFadeMs = (outgoingDurationMs * 45L) / 100L
    val mediaFadeMs = requestedMediaFadeMs.coerceAtMost(maxMediaFadeMs)
    val clampedWallFadeMs = (mediaFadeMs / speed.toDouble()).roundToLong()
    if (clampedWallFadeMs < 250L) return null

    val defaultStartMs = (outgoingDurationMs - mediaFadeMs).coerceAtLeast(0L)
    val startAtMs = when (val outro = outgoingCuePoints.outroStartMs) {
      null -> defaultStartMs
      else -> if (outro in 1_000L until outgoingDurationMs) {
        outro.coerceAtMost(defaultStartMs)
      } else {
        defaultStartMs
      }
    }
    val remainingMediaFromStart = (outgoingDurationMs - startAtMs).coerceAtLeast(1L)
    val effectiveMediaFadeMs = mediaFadeMs.coerceAtMost(remainingMediaFromStart)
    val effectiveWallFadeMs = (effectiveMediaFadeMs / speed.toDouble()).roundToLong().coerceAtLeast(250L)
    val mediaLeadMs = (PREPARE_LEAD_MS * speed.toDouble()).roundToLong()
    val prepareAtMs = (startAtMs - mediaLeadMs).coerceAtLeast(0L)

    val incomingStartPositionMs = when (val intro = incomingCuePoints.introEndMs) {
      null -> 0L
      else -> {
        val maxIntro = if (incomingDurationMs != null && incomingDurationMs > 0L) {
          (incomingDurationMs / 3L).coerceAtMost(MAX_INTRO_SKIP_MS)
        } else {
          MAX_INTRO_SKIP_MS
        }
        intro.coerceIn(0L, maxIntro)
      }
    }

    return LoggeRythmCrossfadePlan(
      prepareAtMs = prepareAtMs,
      startAtMs = startAtMs,
      fadeDurationMs = effectiveWallFadeMs,
      incomingStartPositionMs = incomingStartPositionMs,
    )
  }

  private const val MAX_INTRO_SKIP_MS = 30_000L
}

/**
 * Dual-player Media3 crossfade controller.
 *
 * Uses a lazily-created secondary [ExoPlayer] deck to pre-roll and equal-power fade in the next
 * queue item while the primary [ExoPlayer] fades out, then hands off seamlessly back to the
 * primary player so the `MediaLibrarySession` timeline, Android Auto, and encrypted persistence
 * stay completely uninterrupted.
 */
@UnstableApi
internal class LoggeRythmDualPlayerCrossfadeController(
  private val context: Context,
  private val primaryPlayer: ExoPlayer,
  private val playerCache: LoggeRythmPlayerCache,
  private val audioAttributes: AudioAttributes,
  private val isSleepFading: () -> Boolean,
  private val loudnessScaleForMediaId: (String?) -> Float,
  private val restorePrimaryLoudness: () -> Unit,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var config = LoggeRythmCrossfadeConfig()
  private var secondaryPlayer: ExoPlayer? = null
  private var preparedTargetIndex: Int = C.INDEX_UNSET
  private var preparedTargetMediaId: String? = null
  private var activeFade: ActiveFade? = null
  private var monitorScheduled = false
  private var released = false

  private data class ActiveFade(
    val sourceMediaId: String,
    val targetIndex: Int,
    val targetMediaId: String,
    val startedAtElapsedMs: Long,
    val durationMs: Long,
    val outgoingBaseVolume: Float,
    val incomingBaseVolume: Float,
  )

  private val monitorRunnable = object : Runnable {
    override fun run() {
      monitorScheduled = false
      if (released) return
      tick()
      scheduleMonitorIfNeeded()
    }
  }

  private val primaryListener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      if (released) return
      if (
        events.contains(Player.EVENT_TIMELINE_CHANGED) ||
        events.contains(Player.EVENT_MEDIA_ITEM_TRANSITION) ||
        events.contains(Player.EVENT_POSITION_DISCONTINUITY)
      ) {
        abortCrossfade(restoreVolume = true)
      }
      if (
        events.contains(Player.EVENT_IS_PLAYING_CHANGED) ||
        events.contains(Player.EVENT_PLAY_WHEN_READY_CHANGED) ||
        events.contains(Player.EVENT_PLAYBACK_STATE_CHANGED)
      ) {
        if (!player.isPlaying) {
          abortCrossfade(restoreVolume = true)
        }
      }
      scheduleMonitorIfNeeded()
    }
  }

  init {
    primaryPlayer.addListener(primaryListener)
  }

  fun currentConfig(): LoggeRythmCrossfadeConfig = config

  fun setConfig(next: LoggeRythmCrossfadeConfig) {
    config = next
    if (!next.enabled) {
      abortCrossfade(restoreVolume = true)
      releaseSecondaryPlayer()
      stopMonitor()
    } else {
      scheduleMonitorIfNeeded()
    }
  }

  fun isCrossfadeActive(): Boolean = activeFade != null

  fun release() {
    if (released) return
    released = true
    stopMonitor()
    primaryPlayer.removeListener(primaryListener)
    abortCrossfade(restoreVolume = false)
    releaseSecondaryPlayer()
  }

  private fun tick() {
    if (!config.enabled || !primaryPlayer.isPlaying || isSleepFading()) {
      abortCrossfade(restoreVolume = true)
      return
    }
    val currentFade = activeFade
    if (currentFade != null) {
      advanceFade(currentFade)
      return
    }

    val currentItem = primaryPlayer.currentMediaItem ?: return
    val nextIndex = primaryPlayer.nextMediaItemIndex
    val hasNext = nextIndex != C.INDEX_UNSET && nextIndex in 0 until primaryPlayer.mediaItemCount
    if (!hasNext) return
    val nextItem = primaryPlayer.getMediaItemAt(nextIndex)
    val durationMs = primaryPlayer.duration
    if (durationMs == C.TIME_UNSET || durationMs <= 0L) return

    val outgoingCues = LoggeRythmTrackCuePoints.fromExtras(
      LoggeRythmPlayerRuntime.extrasFor(currentItem.mediaId),
    )
    val incomingCues = LoggeRythmTrackCuePoints.fromExtras(
      LoggeRythmPlayerRuntime.extrasFor(nextItem.mediaId),
    )
    val plan = LoggeRythmCrossfadePlanner.plan(
      config = config,
      outgoingDurationMs = durationMs,
      outgoingCuePoints = outgoingCues,
      incomingDurationMs = nextItem.mediaMetadata.durationMs,
      incomingCuePoints = incomingCues,
      repeatMode = primaryPlayer.repeatMode,
      hasNextItem = true,
      isSleepFading = isSleepFading(),
      playbackSpeed = primaryPlayer.playbackParameters.speed,
    ) ?: return

    val positionMs = primaryPlayer.currentPosition.coerceAtLeast(0L)
    if (positionMs >= plan.prepareAtMs && (preparedTargetIndex != nextIndex || preparedTargetMediaId != nextItem.mediaId)) {
      prepareSecondary(nextIndex, nextItem, plan.incomingStartPositionMs)
    }
    if (positionMs >= plan.startAtMs) {
      startFade(
        sourceMediaId = currentItem.mediaId,
        targetIndex = nextIndex,
        targetItem = nextItem,
        plan = plan,
      )
    }
  }

  private fun prepareSecondary(nextIndex: Int, nextItem: MediaItem, startPositionMs: Long) {
    val deck = ensureSecondaryPlayer()
    deck.stop()
    deck.clearMediaItems()
    deck.playbackParameters = primaryPlayer.playbackParameters
    deck.volume = 0f
    deck.setMediaItem(nextItem, startPositionMs)
    deck.prepare()
    preparedTargetIndex = nextIndex
    preparedTargetMediaId = nextItem.mediaId
  }

  private fun startFade(
    sourceMediaId: String,
    targetIndex: Int,
    targetItem: MediaItem,
    plan: LoggeRythmCrossfadePlan,
  ) {
    val deck = ensureSecondaryPlayer()
    if (preparedTargetIndex != targetIndex || preparedTargetMediaId != targetItem.mediaId) {
      prepareSecondary(targetIndex, targetItem, plan.incomingStartPositionMs)
    }
    deck.playbackParameters = primaryPlayer.playbackParameters
    deck.volume = 0f
    deck.play()
    activeFade = ActiveFade(
      sourceMediaId = sourceMediaId,
      targetIndex = targetIndex,
      targetMediaId = targetItem.mediaId,
      startedAtElapsedMs = SystemClock.elapsedRealtime(),
      durationMs = plan.fadeDurationMs,
      outgoingBaseVolume = primaryPlayer.volume.coerceIn(0f, 1f),
      incomingBaseVolume = loudnessScaleForMediaId(targetItem.mediaId).coerceIn(0f, 1f),
    )
  }

  private fun advanceFade(fade: ActiveFade) {
    val deck = secondaryPlayer
    if (deck == null || primaryPlayer.currentMediaItem?.mediaId != fade.sourceMediaId) {
      abortCrossfade(restoreVolume = true)
      return
    }
    val elapsedMs = (SystemClock.elapsedRealtime() - fade.startedAtElapsedMs).coerceAtLeast(0L)
    val progress = (elapsedMs.toDouble() / fade.durationMs.toDouble()).coerceIn(0.0, 1.0)
    primaryPlayer.volume = (fade.outgoingBaseVolume * LoggeRythmCrossfadeCurve.outgoingGain(progress))
      .coerceIn(0f, 1f)
    deck.volume = (fade.incomingBaseVolume * LoggeRythmCrossfadeCurve.incomingGain(progress))
      .coerceIn(0f, 1f)

    if (progress >= 1.0) {
      completeHandoff(fade, deck)
    }
  }

  private fun completeHandoff(fade: ActiveFade, deck: ExoPlayer) {
    val handoffPositionMs = deck.currentPosition.coerceAtLeast(0L)
    activeFade = null
    preparedTargetIndex = C.INDEX_UNSET
    preparedTargetMediaId = null
    if (
      fade.targetIndex in 0 until primaryPlayer.mediaItemCount &&
      primaryPlayer.getMediaItemAt(fade.targetIndex).mediaId == fade.targetMediaId
    ) {
      primaryPlayer.volume = fade.incomingBaseVolume
      primaryPlayer.seekTo(fade.targetIndex, handoffPositionMs)
      if (!primaryPlayer.playWhenReady) primaryPlayer.play()
    } else {
      restorePrimaryLoudness()
    }
    deck.pause()
    deck.stop()
    deck.clearMediaItems()
  }

  private fun abortCrossfade(restoreVolume: Boolean) {
    val wasActive = activeFade != null
    activeFade = null
    preparedTargetIndex = C.INDEX_UNSET
    preparedTargetMediaId = null
    secondaryPlayer?.let { deck ->
      deck.pause()
      deck.stop()
      deck.clearMediaItems()
    }
    if (wasActive && restoreVolume && !isSleepFading()) {
      restorePrimaryLoudness()
    }
  }

  private fun ensureSecondaryPlayer(): ExoPlayer {
    secondaryPlayer?.let { return it }
    val mediaSourceFactory = DefaultMediaSourceFactory(playerCache.playbackDataSourceFactory())
    return ExoPlayer.Builder(context.applicationContext)
      .setMediaSourceFactory(mediaSourceFactory)
      // Never request audio focus on the incoming deck so the primary player keeps focus.
      .setAudioAttributes(audioAttributes, false)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()
      .also { secondaryPlayer = it }
  }

  private fun releaseSecondaryPlayer() {
    secondaryPlayer?.let { deck ->
      runCatching {
        deck.stop()
        deck.release()
      }
    }
    secondaryPlayer = null
  }

  private fun scheduleMonitorIfNeeded() {
    if (released || !config.enabled) {
      stopMonitor()
      return
    }
    val shouldRun = primaryPlayer.isPlaying &&
      primaryPlayer.nextMediaItemIndex != C.INDEX_UNSET &&
      primaryPlayer.repeatMode != Player.REPEAT_MODE_ONE
    if (!shouldRun) {
      stopMonitor()
      return
    }
    if (!monitorScheduled) {
      monitorScheduled = true
      val delay = if (activeFade != null) FADE_TICK_MS else MONITOR_INTERVAL_MS
      mainHandler.postDelayed(monitorRunnable, delay)
    }
  }

  private fun stopMonitor() {
    if (!monitorScheduled) return
    mainHandler.removeCallbacks(monitorRunnable)
    monitorScheduled = false
  }

  companion object {
    private const val MONITOR_INTERVAL_MS = 100L
    private const val FADE_TICK_MS = 32L
  }
}
