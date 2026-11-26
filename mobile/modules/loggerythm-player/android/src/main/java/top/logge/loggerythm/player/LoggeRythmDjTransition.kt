package top.logge.loggerythm.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.audio.AudioSink
import java.io.File
import java.io.IOException
import java.net.URI
import java.net.URISyntaxException
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONException
import org.json.JSONObject

/**
 * A queue item that streams from the LoggeRythm API (`/api/tracks/{id}/stream`).
 * [quality] is `null` when the URL has no `quality` parameter; the server then streams the
 * account's preferred quality, and the DJ endpoint resolves it the same way.
 */
internal data class LoggeRythmDjStreamRef(
  val origin: String,
  val trackId: String,
  val quality: String?,
) {
  companion object {
    private val PATH = Regex("^/api/tracks/(\\d+)/stream$")
    private val QUALITIES = setOf("lossless", "high", "saver")

    /** `null` for anything that is not an HTTPS API stream (local downloads, previews). */
    fun parse(uri: String?): LoggeRythmDjStreamRef? {
      if (uri == null) return null
      val parsed = try {
        URI(uri)
      } catch (_: URISyntaxException) {
        return null
      }
      if (parsed.scheme != "https") return null
      val host = parsed.host ?: return null
      val match = PATH.matchEntire(parsed.rawPath ?: return null) ?: return null
      val params = (parsed.rawQuery ?: "").split('&').filter(String::isNotEmpty).associate { part ->
        val eq = part.indexOf('=')
        if (eq < 0) part to "" else part.substring(0, eq) to part.substring(eq + 1)
      }
      val quality = params["quality"]
      if (quality != null && quality !in QUALITIES) return null
      val origin = if (parsed.port == -1) "https://$host" else "https://$host:${parsed.port}"
      return LoggeRythmDjStreamRef(origin, match.groupValues[1], quality)
    }
  }
}

/** Server-rendered transition clip timeline (seconds). See api/app/services/dj/render.py. */
internal data class LoggeRythmDjClip(
  val id: String,
  val durationS: Double,
  val aStartS: Double,
  val bOffsetS: Double,
  val cueS: Double,
  val deckStartS: Double,
  val joinInS: Double,
  val primarySeekS: Double,
  val mixStartS: Double,
  val mixEndS: Double,
  val joinOutS: Double,
  val aSpeed: Double,
  /** Seconds ffmpeg dropped at the start of A's / B's file; see [LoggeRythmDjDecoderOffset]. */
  val aStartSkipS: Double,
  val bStartSkipS: Double,
  /** Codec of the files the server analysed; the primary must play the same one. */
  val aMime: String,
  val bMime: String,
) {
  init {
    require(Regex("^[0-9a-f]{32}$").matches(id)) { "dj-clip-id-invalid" }
    require(deckStartS < joinInS && joinInS < cueS && cueS <= mixStartS + 1.0) { "dj-clip-timeline-order" }
    require(primarySeekS < mixEndS && mixEndS < joinOutS && joinOutS < durationS) { "dj-clip-timeline-order" }
    require(aStartSkipS in 0.0..0.2 && bStartSkipS in 0.0..0.2) { "dj-clip-start-skip-range" }
    require(aMime in CLIP_SOURCE_MIMES && bMime in CLIP_SOURCE_MIMES) { "dj-clip-source-mime" }
  }

  /** A media position (ms) for a clip position (ms); valid before [cueS]. */
  fun aMediaMs(clipMs: Long): Long = clipMs + (aStartS * 1000).toLong()

  /** B media position (ms) for a clip position (ms). */
  fun bMediaMs(clipMs: Long): Long = clipMs + Math.round(bOffsetS * 1000)

  companion object {
    fun fromJson(json: JSONObject): LoggeRythmDjClip = LoggeRythmDjClip(
      id = json.getString("id"),
      durationS = json.getDouble("duration_s"),
      aStartS = json.getDouble("a_start_s"),
      bOffsetS = json.getDouble("b_offset_s"),
      cueS = json.getDouble("cue_s"),
      deckStartS = json.getDouble("deck_start_s"),
      joinInS = json.getDouble("join_in_s"),
      primarySeekS = json.getDouble("primary_seek_s"),
      mixStartS = json.getDouble("mix_start_s"),
      mixEndS = json.getDouble("mix_end_s"),
      joinOutS = json.getDouble("join_out_s"),
      aSpeed = json.getDouble("a_speed"),
      aStartSkipS = json.getDouble("a_start_skip_s"),
      bStartSkipS = json.getDouble("b_start_skip_s"),
      aMime = json.getString("a_mime"),
      bMime = json.getString("b_mime"),
    )

    private val CLIP_SOURCE_MIMES = setOf(MimeTypes.AUDIO_MPEG, MimeTypes.AUDIO_FLAC)
  }
}

internal sealed class LoggeRythmDjPlanResponse {
  data class Pending(val reason: String, val retryAfterMs: Long) : LoggeRythmDjPlanResponse()
  data class Crossfade(val reason: String, val detail: String) : LoggeRythmDjPlanResponse()
  data class Beatmatch(val detail: String, val clip: LoggeRythmDjClip) : LoggeRythmDjPlanResponse()

  companion object {
    fun parse(body: String): LoggeRythmDjPlanResponse {
      val json = try {
        JSONObject(body)
      } catch (error: JSONException) {
        throw IllegalStateException("dj-plan-json-invalid", error)
      }
      return try {
        when (val status = json.getString("status")) {
          "pending" -> Pending(json.getString("reason"), json.getLong("retry_after_s") * 1000L)
          "ready" -> when (val kind = json.getString("kind")) {
            "crossfade" -> Crossfade(json.getString("reason"), json.optString("detail", ""))
            "beatmatch" -> Beatmatch(json.optString("detail", ""), LoggeRythmDjClip.fromJson(json.getJSONObject("clip")))
            else -> throw IllegalStateException("dj-plan-kind-unknown:$kind")
          }
          else -> throw IllegalStateException("dj-plan-status-unknown:$status")
        }
      } catch (error: JSONException) {
        throw IllegalStateException("dj-plan-field-invalid: ${error.message}", error)
      }
    }
  }
}

/**
 * Maps the primary player's position onto ffmpeg's decode timeline, which the server's
 * analysis and the clip use (Media3 1.10.1, AOSP codec2 software decoders):
 *
 * - MP3: c2.android.mp3.decoder drops its 529-sample delay after every start/flush.
 *   Media3 trims the LAME encoder delay D only after a sink reconfiguration (prepare, item
 *   change, cross-item seek), not after a seek within the same item (TrimmingAudioProcessor
 *   re-arms only on configure). ffmpeg drops `startSkipS` = (D + 529) / rate for tagged
 *   files and nothing for untagged ones.
 * - FLAC: no delay anywhere.
 *
 * ffmpeg position = player position + [offsetMs].
 */
internal object LoggeRythmDjDecoderOffset {
  const val MP3_DECODER_DELAY_SAMPLES = 529
  /** Decoders whose delay handling the offsets above were derived from. */
  val VERIFIED_DECODERS = setOf("c2.android.mp3.decoder", "c2.android.flac.decoder")

  fun offsetMs(mimeType: String?, sampleRate: Int, encoderDelay: Int, trimmed: Boolean, startSkipS: Double): Double {
    require(sampleRate > 0) { "dj-offset-sample-rate:$sampleRate" }
    val playerSkipSamples = when (mimeType) {
      MimeTypes.AUDIO_MPEG -> (if (trimmed) encoderDelay else 0) + MP3_DECODER_DELAY_SAMPLES
      MimeTypes.AUDIO_FLAC -> 0
      else -> throw IllegalArgumentException("dj-offset-unsupported-mime:$mimeType")
    }
    return playerSkipSamples * 1000.0 / sampleRate - startSkipS * 1000.0
  }
}

/**
 * One player's clock as seen through Media3 1.10.1's `Player.getCurrentPosition()`.
 *
 * That value is the snapshot the player's playback thread published last (every ~10 ms; the
 * application thread does not extrapolate it). A busy or stalled playback thread freezes it while
 * the audio keeps playing, and the next snapshot jumps to the true position. The emulator showed
 * freezes of up to ~400 ms per player. A read can lag the audio but is never ahead of it, so
 * c = position - speed * now is at most the true offset, and the upper envelope of c over a short
 * window estimates the true offset. Frozen reads carry no new information and are skipped.
 */
internal class LoggeRythmDjClockEnvelope {
  private val offsets = ArrayDeque<Pair<Long, Double>>()
  private var lastPositionMs: Double? = null
  private var lastFreshMs: Long? = null
  private var inStall = false
  /** Episodes in which the position stood still for more than [STALL_MS] while playing. */
  var stalls = 0
    private set

  fun clear() {
    offsets.clear()
    lastPositionMs = null
    lastFreshMs = null
    inStall = false
  }

  /** [slope]: the speed the reported position advances at (the commanded playback speed). */
  fun add(nowMs: Long, positionMs: Double, slope: Double) {
    val previous = lastPositionMs
    lastPositionMs = positionMs
    if (previous != null && positionMs == previous) {
      val fresh = lastFreshMs
      if (!inStall && fresh != null && nowMs - fresh > STALL_MS) {
        inStall = true
        stalls += 1
      }
      return
    }
    inStall = false
    lastFreshMs = nowMs
    offsets.addLast(nowMs to positionMs - slope * nowMs)
    prune(nowMs)
  }

  /** Estimated true offset (position - slope * now) in ms, or null while the window is too thin. */
  fun offsetMs(nowMs: Long): Double? {
    prune(nowMs)
    if (offsets.size < MIN_SAMPLES || offsets.last().first - offsets.first().first < MIN_SPAN_MS) return null
    // second-highest: one read that overshoots (rare tracker correction) cannot set the estimate
    return offsets.map { it.second }.sortedDescending()[1]
  }

  /** Envelope minus median of the window: how stale the typical read was (diagnostics). */
  fun stalenessMs(nowMs: Long): Double? {
    val envelope = offsetMs(nowMs) ?: return null
    val sorted = offsets.map { it.second }.sorted()
    return envelope - sorted[sorted.size / 2]
  }

  private fun prune(nowMs: Long) {
    while (offsets.isNotEmpty() && nowMs - offsets.first().first > WINDOW_MS) offsets.removeFirst()
  }

  companion object {
    /** Longer than the longest freezes seen (~400 ms), so a window always holds fresh reads. */
    const val WINDOW_MS = 600L
    const val MIN_SAMPLES = 4
    const val MIN_SPAN_MS = 250L
    const val STALL_MS = 120L
  }
}

/**
 * Keeps a muted follower player phase-locked to a leader that plays the same audio at 1.0x.
 *
 * Both positions come in on one timeline (the follower's). Each player's clock is estimated with
 * [LoggeRythmDjClockEnvelope]; the lock acts only on an error that stayed stable over three
 * estimates at least [ESTIMATE_GAP_MS] apart:
 * - more than [HOLD_MS] off: a timed speed nudge (Sonic, at most [MAX_NUDGE] off 1.0; the follower
 *   is muted in both lock phases) that removes the error over at least [NUDGE_MS], then back to
 *   1.0 and measure again. Speed changes reach the reported position and the audio only after the
 *   AudioTrack buffer drained, at the start and at the end alike, so a timed nudge integrates
 *   correctly where a continuous controller hunts.
 * - an error no nudge can remove within [NUDGE_MAX_MS] or the time left: seek, leading by the
 *   median restart lag measured so far. Seeks are the coarse tool: their restart lag varies and
 *   playback resumes on a frame boundary.
 * - within [HOLD_MS] at 1.0x: Locked (stays locked while the error stays within [RELOCK_MS])
 *
 * It fails loudly (Action.Fail with the measurement state) instead of guessing when the timing is
 * too noisy to measure, the leader keeps stalling, or the remaining time cannot fix the error.
 * Pure arithmetic so it is JVM-testable; the controller feeds it raw positions.
 */
internal class LoggeRythmDjPhaseLock(private val initialSeekLeadMs: Long) {
  sealed class Action {
    data object Wait : Action()
    /** Seek the follower to [targetMs] (follower timeline); [errorMs] is the stable error acted on. */
    data class Seek(val targetMs: Long, val errorMs: Double) : Action()
    data class SetSpeed(val speed: Float) : Action()
    data object Locked : Action()
    data class Fail(val reason: String) : Action()
  }

  private val leader = LoggeRythmDjClockEnvelope()
  private val follower = LoggeRythmDjClockEnvelope()
  private val estimates = ArrayDeque<Pair<Long, Double>>()
  private var playingSinceMs: Long? = null
  /** Measuring (settled, playing) without a stable estimate since then; the noisy-timeout clock. */
  private var measuringSinceMs: Long? = null
  /** Until then the follower still plays audio processed at its previous speed. */
  private var drainUntilMs: Long? = null
  /** Drain still owed when the follower stopped playing; it resumes with the playback. */
  private var pausedDrainMs: Long? = null
  /** A nudge was cancelled while step() was not called; the next step commands 1.0. */
  private var speedResetPending = false
  private var nudgeEndMs: Long? = null
  private var nudgeStartMs = 0L
  /** Error (ms) the running nudge is meant to remove; follower ahead > 0. */
  private var nudgeErrorMs = 0.0
  private var chainedNudges = 0
  private var pendingSeek: Pair<Double, Double>? = null
  private val restartLagsMs = mutableListOf<Double>()
  private var locked = false
  private var leaderInterruptions = 0
  private var lastInterruptionMs: Long? = null

  var speed = 1f
    private set
  var seeks = 0
    private set
  var nudges = 0
    private set
  /**
   * Audio the follower's AudioTrack buffers (from onAudioTrackInitialized): a speed change reaches
   * the audio and the reported position only after it played out. Media3's worst case until known.
   */
  var followerDrainMs = MAX_DRAIN_MS
    set(value) {
      require(value in 0L..MAX_DRAIN_MS * 2) { "dj-lock-drain-implausible:$value" }
      field = value
    }

  private fun speedSettleMs(): Long = followerDrainMs + DRAIN_MARGIN_MS
  /** Last stable error (ms, follower ahead > 0) and when it was measured; never cleared. */
  var lastStableErrorMs: Double? = null
    private set
  var lastStableAtMs: Long? = null
    private set

  /**
   * The leader stopped playing (rebuffer): both clocks restart, learned state stays.
   * Returns true when this starts a new interruption episode.
   */
  fun leaderInterrupted(nowMs: Long): Boolean {
    val last = lastInterruptionMs
    lastInterruptionMs = nowMs
    // the controller pauses the follower meanwhile: a running nudge removes nothing while paused
    if (cancelNudge()) speedResetPending = true
    pauseDrain(nowMs)
    newEpoch()
    if (last != null && nowMs - last <= INTERRUPTION_GAP_MS) return false
    leaderInterruptions += 1
    return true
  }

  /**
   * [leaderMs]/[followerMs]: raw reported positions mapped onto the follower's timeline;
   * [remainingMs]: time left (follower timeline) until the lock must be done.
   */
  fun step(nowMs: Long, followerPlaying: Boolean, leaderMs: Double, followerMs: Double, remainingMs: Long): Action {
    if (speedResetPending) {
      speedResetPending = false
      return commandSpeedOne(nowMs)
    }
    if (!followerPlaying) {
      // restarting after a seek, paused, or rebuffering: its clock is not running
      val cancelled = cancelNudge()
      pauseDrain(nowMs)
      newEpoch()
      if (cancelled) {
        pausedDrainMs = speedSettleMs()
        return Action.SetSpeed(1f)
      }
      return Action.Wait
    }
    nudgeEndMs?.let { end ->
      if (nowMs < end) return Action.Wait
      // the tick that ends the nudge can come late (main thread); what the nudge really removed
      // is (1 - speed) * its actual length, since both speed edges wait for the same drain
      val residualMs = nudgeErrorMs - (1.0 - speed) * (nowMs - nudgeStartMs)
      nudgeEndMs = null
      val allowedMs = minOf(NUDGE_MAX_MS, remainingMs - speedSettleMs() - MEASURE_MS)
      val fits = Math.ceil(abs(residualMs) / MAX_NUDGE) <= allowedMs
      if (abs(residualMs) > HOLD_MS && chainedNudges < MAX_CHAINED_NUDGES && fits) {
        chainedNudges += 1
        return startNudge(nowMs, residualMs, NUDGE_MS)
      }
      chainedNudges = 0
      return commandSpeedOne(nowMs)
    }
    if (leaderInterruptions > MAX_LEADER_INTERRUPTIONS) {
      return Action.Fail("leader-stalled: $leaderInterruptions interruptions; ${describe(nowMs)}")
    }
    val playingSince = playingSinceMs ?: nowMs.also { now ->
      playingSinceMs = now
      pausedDrainMs?.let { owed -> drainUntilMs = now + owed }
      pausedDrainMs = null
    }
    if (nowMs - playingSince < SETTLE_MS) return Action.Wait
    drainUntilMs?.let { until ->
      if (nowMs < until) return Action.Wait
      drainUntilMs = null
    }
    val measuringSince = measuringSinceMs ?: nowMs.also { measuringSinceMs = it }
    leader.add(nowMs, leaderMs, 1.0)
    follower.add(nowMs, followerMs, speed.toDouble())
    val cl = leader.offsetMs(nowMs)
    val cf = follower.offsetMs(nowMs)
    if (cl == null || cf == null) return noisyCheck(nowMs, measuringSince)
    val e = cf - cl
    if (estimates.isEmpty() || nowMs - estimates.last().first >= ESTIMATE_GAP_MS) {
      estimates.addLast(nowMs to e)
      while (estimates.size > STABLE_ESTIMATES) estimates.removeFirst()
    }
    if (estimates.size < STABLE_ESTIMATES) return noisyCheck(nowMs, measuringSince)
    val values = estimates.map { it.second }.sorted()
    if (values.last() - values.first() > STABLE_SPREAD_MS) return noisyCheck(nowMs, measuringSince)
    val stable = values[values.size / 2]
    lastStableErrorMs = stable
    lastStableAtMs = nowMs
    measuringSinceMs = nowMs
    pendingSeek?.let { (before, correction) ->
      // e_after = e_before + correction - lag
      restartLagsMs += before + correction - stable
      pendingSeek = null
    }
    // Double arithmetic: elapsedRealtime reaches 1e9 ms, where a Float product is 64 ms coarse
    return decide(nowMs, stable, followerNowMs = cf + speed.toDouble() * nowMs, remainingMs = remainingMs)
  }

  /** Back to 1.0x; measuring resumes once the audio processed at the old speed played out. */
  private fun commandSpeedOne(nowMs: Long): Action {
    speed = 1f
    newEpoch()
    drainUntilMs = nowMs + speedSettleMs()
    pausedDrainMs = null
    return Action.SetSpeed(1f)
  }

  /** Stops a running nudge (true when one ran); the caller commands 1.0. */
  private fun cancelNudge(): Boolean {
    if (nudgeEndMs == null) return false
    nudgeEndMs = null
    chainedNudges = 0
    speed = 1f
    return true
  }

  private fun pauseDrain(nowMs: Long) {
    drainUntilMs?.let { until -> if (until > nowMs) pausedDrainMs = until - nowMs }
    drainUntilMs = null
  }

  private fun decide(nowMs: Long, e: Double, followerNowMs: Double, remainingMs: Long): Action {
    val absE = abs(e)
    if (locked) {
      if (absE <= RELOCK_MS) return Action.Locked
      locked = false
    }
    if (absE <= HOLD_MS) {
      locked = true
      return Action.Locked
    }
    // nudges integrate exactly; a seek restarts with a variable lag on a frame boundary, so seek
    // only when a nudge cannot remove the error in the time left (or within NUDGE_MAX_MS)
    val neededMs = Math.ceil(absE / MAX_NUDGE).toLong()
    val availableMs = remainingMs - speedSettleMs() - MEASURE_MS
    val nudgeFits = neededMs <= minOf(availableMs, NUDGE_MAX_MS)
    if (!nudgeFits && seeks < MAX_SEEKS && remainingMs >= SEEK_MIN_REMAINING_MS) {
      seeks += 1
      val correction = Math.round(-e) + seekLeadMs()
      pendingSeek = e to correction.toDouble()
      newEpoch()
      // a seek flushes the AudioTrack: nothing at an old speed is left to drain
      drainUntilMs = null
      pausedDrainMs = null
      return Action.Seek(targetMs = Math.round(followerNowMs) + correction, errorMs = e)
    }
    // at most MAX_NUDGE off 1.0; as gentle as the remaining time allows, at least NUDGE_MS long
    if (neededMs > availableMs && absE <= RELOCK_MS) {
      // no time left to trim a few ms; this is inside the tolerance a held lock keeps anyway
      locked = true
      return Action.Locked
    }
    if (neededMs > availableMs) {
      return Action.Fail(
        String.format(
          Locale.ROOT,
          "lock-infeasible: error %.1f ms needs a %d ms nudge, %d ms left; %s",
          e, neededMs, remainingMs, describe(nowMs),
        ),
      )
    }
    return startNudge(nowMs, e, maxOf(neededMs, minOf(NUDGE_MS, availableMs)))
  }

  private fun startNudge(nowMs: Long, errorMs: Double, durationMs: Long): Action {
    val duration = maxOf(durationMs, Math.ceil(abs(errorMs) / MAX_NUDGE).toLong())
    nudges += 1
    nudgeStartMs = nowMs
    nudgeErrorMs = errorMs
    speed = (1.0 - errorMs / duration).toFloat()
    nudgeEndMs = nowMs + duration
    return Action.SetSpeed(speed)
  }

  private fun noisyCheck(nowMs: Long, measuringSinceMs: Long): Action =
    if (nowMs - measuringSinceMs > NOISY_TIMEOUT_MS) {
      Action.Fail("timing-too-noisy: no stable error within $NOISY_TIMEOUT_MS ms; ${describe(nowMs)}")
    } else {
      Action.Wait
    }

  /** Median measured restart lag, or the initial guess before the first seek was measured. */
  fun seekLeadMs(): Long =
    if (restartLagsMs.isEmpty()) {
      initialSeekLeadMs
    } else {
      Math.round(restartLagsMs.sorted()[restartLagsMs.size / 2]).coerceIn(0L, MAX_SEEK_LEAD_MS)
    }

  private fun newEpoch() {
    playingSinceMs = null
    measuringSinceMs = null
    leader.clear()
    follower.clear()
    estimates.clear()
  }

  fun describe(nowMs: Long): String =
    String.format(
      Locale.ROOT,
      "seeks %d/%d (restart lags %s ms, lead %d), nudges %d, speed %.4f, drain %d ms, last stable error %s, " +
        "stalls leader %d follower %d, leader interruptions %d, staleness leader %s follower %s ms",
      seeks, MAX_SEEKS, restartLagsMs.map { Math.round(it) }, seekLeadMs(), nudges, speed, followerDrainMs,
      lastStableErrorMs?.let { String.format(Locale.ROOT, "%.1f ms (%d ms ago)", it, nowMs - (lastStableAtMs ?: nowMs)) } ?: "none",
      leader.stalls, follower.stalls, leaderInterruptions,
      leader.stalenessMs(nowMs)?.let { String.format(Locale.ROOT, "%.1f", it) } ?: "-",
      follower.stalenessMs(nowMs)?.let { String.format(Locale.ROOT, "%.1f", it) } ?: "-",
    )

  companion object {
    const val SETTLE_MS = 300L
    /** Media3 sizes the PCM AudioTrack buffer to at most 750 ms; the old speed plays out of it. */
    const val MAX_DRAIN_MS = 750L
    /** Sonic's own buffering plus the 10 ms snapshot cadence. */
    const val DRAIN_MARGIN_MS = 100L
    const val ESTIMATE_GAP_MS = 100L
    const val STABLE_ESTIMATES = 3
    const val STABLE_SPREAD_MS = 8.0
    const val NOISY_TIMEOUT_MS = 2_500L
    const val MAX_SEEKS = 3
    /** A seek needs its restart, a settle and a measurement before the deadline. */
    const val SEEK_MIN_REMAINING_MS = 1_500L
    const val HOLD_MS = 5.0
    const val RELOCK_MS = 12.0
    const val NUDGE_MS = 400L
    const val NUDGE_MAX_MS = 2_000L
    /** Open-loop follow-ups for a nudge that ended late, before measuring again. */
    const val MAX_CHAINED_NUDGES = 2
    const val MAX_NUDGE = 0.10
    /** Settle plus three estimates after a nudge. */
    const val MEASURE_MS = 700L
    const val MAX_SEEK_LEAD_MS = 400L
    const val MAX_LEADER_INTERRUPTIONS = 3
    const val INTERRUPTION_GAP_MS = 500L
  }
}

/**
 * Beat-matched DJ transitions (opt-in account setting).
 *
 * For the pair (current item A, next item B) the server plans the transition and, when the two
 * tracks can be beat-matched, renders a clip: A's tail time-stretched onto B's tempo with B
 * entering on the downbeat. This controller plays that clip on a second, session-invisible deck:
 *
 * 1. deck starts muted in the clip's A-only pre-roll and phase-locks to the primary player (A)
 * 2. equal-gain join A -> deck between two beats (same audio on both, so a few ms do not matter)
 * 3. primary is muted and seeks to B; it phase-locks, muted, to the deck's B audio
 * 4. equal-gain join deck -> primary in the clip's B-only tail; the deck stops
 *
 * Pairs the server declines (`crossfade` + reason) use the regular crossfade settings.
 */
@UnstableApi
internal class LoggeRythmDjTransitionController(
  private val context: Context,
  private val primaryPlayer: ExoPlayer,
  private val audioAttributes: AudioAttributes,
  private val isSleepFading: () -> Boolean,
  /** True while a "sleep after this track" timer targets the current item. */
  private val sleepsAfterCurrentItem: () -> Boolean,
  private val isCrossfadeActive: () -> Boolean,
  private val loudnessPlanForMediaId: (String?) -> LoggeRythmLoudnessPlan,
  private val restorePrimaryLoudness: () -> Unit,
  private val httpClient: OkHttpClient = defaultHttpClient(),
) {
  private data class DjPair(
    val fromMediaId: String,
    val toMediaId: String,
    val toIndex: Int,
    val from: LoggeRythmDjStreamRef,
    val to: LoggeRythmDjStreamRef,
    val aGainMilli: Int,
    val bGainMilli: Int,
    val aBoostMillibels: Int,
    val bBoostMillibels: Int,
  )

  private sealed class PlanState {
    data object Fetching : PlanState()
    data class RetryAt(val elapsedMs: Long) : PlanState()
    /** [retryable]: depends on position or transient state; a user seek plans the pair again. */
    data class Declined(val reason: String, val retryable: Boolean = false) : PlanState()
    data class Ready(val clip: LoggeRythmDjClip, val file: File) : PlanState()
  }

  private enum class Phase { DECK_LOCK, JOIN_IN, CLIP, PRIMARY_LOCK, JOIN_OUT }

  private class Run(val pair: DjPair, val clip: LoggeRythmDjClip, val deck: ExoPlayer) {
    var phase = Phase.DECK_LOCK
    var lock = LoggeRythmDjPhaseLock(DECK_INITIAL_LEAD_MS)
    var rampStartMs = 0L
    var lastStatusLogMs = 0L
    /** Why the primary's lock onto B gave up; the join back then happens unlocked. */
    var primaryLockFailure: String? = null
  }

  private enum class LockState { LOCKED, UNLOCKED, FAILED }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val io: ExecutorService = Executors.newSingleThreadExecutor()
  private var enabled = false
  private var released = false
  private var planPair: DjPair? = null
  private var planState: PlanState? = null
  private var generation = 0
  private var deck: ExoPlayer? = null
  private var deckPreparedFor: String? = null
  private var run: Run? = null
  /** Seeks this controller issued on the primary player, matched exactly in onPositionDiscontinuity. */
  private val pendingSelfSeeks = ArrayDeque<Pair<Int, Long>>()
  /** Whether Media3 trimmed the current item's encoder delay since its last flush; see [LoggeRythmDjDecoderOffset]. */
  private var primaryTrimmed = true
  /** A reconfiguration (prepare, item change) has armed the trim but no audio went through yet. */
  private var trimPending = true
  private var primaryDecoderName: String? = null
  /** Duration the primary's / deck's current AudioTrack buffers; null until one was created. */
  private var primaryDrainMs: Long? = null
  private var deckDrainMs: Long? = null
  /** Why the current AudioTrack of the primary / deck cannot be phase-locked (not plain PCM). */
  private var primaryTrackProblem: String? = null
  private var deckTrackProblem: String? = null
  /** The primary's playback parameters as this controller last set them during a run. */
  private var expectedPrimaryParameters = PlaybackParameters.DEFAULT
  private var monitorScheduled = false

  private val monitor = object : Runnable {
    override fun run() {
      monitorScheduled = false
      if (released) return
      try {
        tick()
      } catch (error: RuntimeException) {
        Log.e(TAG, "DJ transition tick failed; aborting (${error.message})", error)
        abort("tick-error")
      }
      scheduleMonitor()
    }
  }

  private val primaryListener = object : Player.Listener {
    override fun onPositionDiscontinuity(
      oldPosition: Player.PositionInfo,
      newPosition: Player.PositionInfo,
      reason: Int,
    ) {
      when (reason) {
        Player.DISCONTINUITY_REASON_SEEK, Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT ->
          if (oldPosition.mediaItemIndex != newPosition.mediaItemIndex) {
            armTrim()
          } else if (!trimPending) {
            // a seek within the item after audio flowed flushes without reconfiguring the
            // sink, so the encoder delay is not trimmed again; before that the armed trim holds
            primaryTrimmed = false
          }
        // reported once the new item already plays: its trim (gapless reconfiguration) is spent
        Player.DISCONTINUITY_REASON_AUTO_TRANSITION -> trimSpent()
        Player.DISCONTINUITY_REASON_REMOVE -> armTrim()
        else -> Unit
      }
      val active = run
      if (active == null) {
        val declined = planState as? PlanState.Declined
        if (reason == Player.DISCONTINUITY_REASON_SEEK && declined?.retryable == true) clearPlan()
        return
      }
      if (reason == Player.DISCONTINUITY_REASON_SEEK && consumeSelfSeek(newPosition)) return
      if (
        reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION &&
        active.phase == Phase.CLIP &&
        newPosition.mediaItemIndex == active.pair.toIndex
      ) {
        return // A ended naturally under the clip; the planned seek into B still follows
      }
      abort(
        "primary-discontinuity:$reason (item ${newPosition.mediaItemIndex} at ${newPosition.positionMs} ms; " +
          "not one of this controller's seeks)",
      )
    }

    override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) {
      if (run != null && playbackParameters != expectedPrimaryParameters) {
        abort("primary-speed-changed:${playbackParameters.speed}/${playbackParameters.pitch}")
      }
    }

    override fun onAudioSessionIdChanged(audioSessionId: Int) {
      if (run != null) abort("audio-session-changed:$audioSessionId")
    }

    override fun onTimelineChanged(timeline: Timeline, reason: Int) {
      val active = run ?: return
      if (!targetStillAt(active.pair)) abort("queue-changed")
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      if (!playWhenReady) abort("paused")
      scheduleMonitor()
    }

    override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
      if (playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) abort("playback-suppressed")
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      when (reason) {
        Player.MEDIA_ITEM_TRANSITION_REASON_AUTO, Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT -> trimSpent()
        else -> armTrim() // seek to another item or playlist change: reconfigured, trim pending
      }
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      when (playbackState) {
        Player.STATE_IDLE -> armTrim() // the next prepare reconfigures the sink
        // READY: the renderer has pushed audio through the sink, so the armed trim is spent
        Player.STATE_READY -> trimPending = false
        else -> Unit
      }
      if (playbackState == Player.STATE_IDLE || playbackState == Player.STATE_ENDED) abort("primary-state:$playbackState")
      scheduleMonitor()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      scheduleMonitor()
    }
  }

  private val primaryAnalytics = object : AnalyticsListener {
    override fun onAudioDecoderInitialized(
      eventTime: AnalyticsListener.EventTime,
      decoderName: String,
      initializedTimestampMs: Long,
      initializationDurationMs: Long,
    ) {
      primaryDecoderName = decoderName
      Log.i(TAG, "Primary audio decoder: $decoderName")
    }

    override fun onAudioPositionAdvancing(eventTime: AnalyticsListener.EventTime, playoutStartSystemTimeMs: Long) {
      trimPending = false // audio reached the output, so an armed trim has been applied
    }

    override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, audioTrackConfig: AudioSink.AudioTrackConfig) {
      primaryTrackProblem = unsupportedTrack(audioTrackConfig)
      primaryDrainMs = if (primaryTrackProblem == null) audioTrackDrainMs("primary", audioTrackConfig) else null
    }

    override fun onAudioUnderrun(eventTime: AnalyticsListener.EventTime, bufferSize: Int, bufferSizeMs: Long, elapsedSinceLastFeedMs: Long) {
      logUnderrun("primary", bufferSizeMs, elapsedSinceLastFeedMs)
    }

    override fun onAudioInputFormatChanged(
      eventTime: AnalyticsListener.EventTime,
      format: Format,
      decoderReuseEvaluation: DecoderReuseEvaluation?,
    ) {
      decoderReuseEvaluation?.let { primaryDecoderName = it.decoderName }
    }
  }

  init {
    primaryPlayer.addListener(primaryListener)
    primaryPlayer.addAnalyticsListener(primaryAnalytics)
  }

  fun isEnabled(): Boolean = enabled

  fun setEnabled(next: Boolean) {
    enabled = next
    if (!next) {
      abort("disabled")
      clearPlan()
      releaseDeck()
    }
    scheduleMonitor()
  }

  /** True while this controller will (or does) handle the A -> B transition itself. */
  fun claimsTransition(): Boolean = run != null || (planState is PlanState.Ready && planPair == currentPair())

  /** True while the primary player's volume is driven by a DJ transition. */
  fun ownsPrimaryVolume(): Boolean = run?.phase.let { it != null && it != Phase.DECK_LOCK }

  /**
   * Called when a sleep fade starts, before the fade reads the primary's volume as its base:
   * hand the audio back to the primary at its loudness gain so the fade starts from there.
   */
  fun abortForSleepFade() {
    abort("sleep-fade")
  }

  fun release() {
    if (released) return
    abort("released")
    released = true
    mainHandler.removeCallbacks(monitor)
    primaryPlayer.removeListener(primaryListener)
    primaryPlayer.removeAnalyticsListener(primaryAnalytics)
    releaseDeck()
    io.shutdownNow()
  }

  // ------------------------------------------------------------------ pair + plan

  private fun currentPair(): DjPair? {
    if (!enabled || isSleepFading()) return null
    // the DJ switch is a seek (MEDIA_ITEM_TRANSITION_REASON_SEEK), which a
    // "sleep after this track" timer would not see as the end of the track
    if (sleepsAfterCurrentItem()) return null
    if (primaryPlayer.repeatMode == Player.REPEAT_MODE_ONE) return null
    val params = primaryPlayer.playbackParameters
    if (params.speed != 1f || params.pitch != 1f) return null
    val current = primaryPlayer.currentMediaItem ?: return null
    val nextIndex = primaryPlayer.nextMediaItemIndex
    if (nextIndex == C.INDEX_UNSET || nextIndex !in 0 until primaryPlayer.mediaItemCount) return null
    val next = primaryPlayer.getMediaItemAt(nextIndex)
    val from = LoggeRythmDjStreamRef.parse(current.localConfiguration?.uri?.toString()) ?: return null
    val to = LoggeRythmDjStreamRef.parse(next.localConfiguration?.uri?.toString()) ?: return null
    if (from.origin != to.origin || from.trackId == to.trackId) return null
    val aPlan = loudnessPlanForMediaId(current.mediaId)
    val bPlan = loudnessPlanForMediaId(next.mediaId)
    val aGain = (aPlan.volumeScale * 1000).toInt()
    val bGain = (bPlan.volumeScale * 1000).toInt()
    if (aGain !in 1..1000 || bGain !in 1..1000) return null
    return DjPair(current.mediaId, next.mediaId, nextIndex, from, to, aGain, bGain, aPlan.boostMillibels, bPlan.boostMillibels)
  }

  private fun clearPlan() {
    generation += 1
    planPair = null
    planState = null
    if (run == null && deckPreparedFor != null) {
      deck?.let { d ->
        d.stop()
        d.clearMediaItems()
      }
      deckPreparedFor = null
    }
  }

  private fun decline(pair: DjPair, reason: String, retryable: Boolean = false) {
    Log.i(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} declined: $reason; regular transition instead")
    planState = PlanState.Declined(reason, retryable)
  }

  private fun armTrim() {
    primaryTrimmed = true
    trimPending = true
  }

  private fun trimSpent() {
    primaryTrimmed = true
    trimPending = false
  }

  private fun fetchPlan(pair: DjPair) {
    val session = LoggeRythmPlayerRuntime.sessionCookieForCurrentOrigin()
    if (session == null || session.first != pair.from.origin) {
      planState = PlanState.Declined("no-session-for-origin", retryable = true)
      Log.e(TAG, "DJ transition skipped: no session cookie for ${pair.from.origin}")
      return
    }
    if (pair.to.quality != pair.from.quality) {
      return decline(pair, "quality-mismatch:${pair.from.quality}/${pair.to.quality}")
    }
    if (pair.aBoostMillibels != pair.bBoostMillibels) {
      // the LoudnessEnhancer boost is per session and switches abruptly; mid-song that is audible
      return decline(pair, "loudness-boost-differs:${pair.aBoostMillibels}/${pair.bBoostMillibels} mB")
    }
    val (origin, cookie) = session
    val gen = generation
    planState = PlanState.Fetching
    io.execute {
      val outcome: Result<PlanState> = runCatching {
        val url = String.format(
          Locale.ROOT,
          "%s/api/dj/transition?from_id=%s&to_id=%s&a_gain=%.3f&b_gain=%.3f",
          origin, pair.from.trackId, pair.to.trackId, pair.aGainMilli / 1000.0, pair.bGainMilli / 1000.0,
        ) + (pair.from.quality?.let { "&quality=$it" } ?: "")
        when (val response = LoggeRythmDjPlanResponse.parse(httpGetString(url, cookie))) {
          is LoggeRythmDjPlanResponse.Pending ->
            PlanState.RetryAt(SystemClock.elapsedRealtime() + response.retryAfterMs)
          is LoggeRythmDjPlanResponse.Crossfade -> {
            Log.i(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId}: crossfade (${response.reason}: ${response.detail})")
            PlanState.Declined(response.reason)
          }
          is LoggeRythmDjPlanResponse.Beatmatch -> {
            val file = downloadClip(origin, cookie, response.clip.id)
            Log.i(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId}: beatmatch (${response.detail})")
            PlanState.Ready(response.clip, file)
          }
        }
      }
      mainHandler.post {
        if (released || gen != generation) return@post
        planState = outcome.getOrElse { error ->
          Log.e(TAG, "DJ transition plan for ${pair.from.trackId}->${pair.to.trackId} failed: ${error.message}", error)
          PlanState.RetryAt(SystemClock.elapsedRealtime() + ERROR_RETRY_MS)
        }
        scheduleMonitor()
      }
    }
  }

  private fun httpGetString(url: String, cookie: String): String {
    val request = Request.Builder().url(url).header("Accept", "application/json").header("Cookie", cookie).get().build()
    httpClient.newCall(request).execute().use { response ->
      val body = response.body?.string() ?: throw IOException("dj-plan-empty-body:${response.code}")
      if (response.code != 200) throw IOException("dj-plan-http-${response.code}: ${body.take(300)}")
      return body
    }
  }

  private fun downloadClip(origin: String, cookie: String, clipId: String): File {
    val dir = File(context.cacheDir, "dj-clips").apply { mkdirs() }
    val target = File(dir, "$clipId.flac")
    if (target.isFile && target.length() > 0) return target
    val request = Request.Builder().url("$origin/api/dj/clips/$clipId").header("Cookie", cookie).get().build()
    httpClient.newCall(request).execute().use { response ->
      if (response.code != 200) throw IOException("dj-clip-http-${response.code}")
      val body = response.body ?: throw IOException("dj-clip-empty-body")
      val tmp = File(dir, "$clipId.part")
      tmp.outputStream().use { out -> body.byteStream().use { it.copyTo(out) } }
      if (tmp.length() == 0L) throw IOException("dj-clip-empty")
      if (!tmp.renameTo(target)) throw IOException("dj-clip-rename-failed")
    }
    dir.listFiles()?.filter { it.isFile && it != target }
      ?.sortedByDescending { it.lastModified() }
      ?.drop(MAX_CACHED_CLIPS)
      ?.forEach { if (!it.delete()) Log.w(TAG, "Could not prune DJ clip ${it.name}") }
    return target
  }

  // ------------------------------------------------------------------ tick

  private fun tick() {
    run?.let {
      advance(it)
      return
    }
    if (!enabled || !primaryPlayer.isPlaying) return
    val pair = currentPair()
    if (pair == null) {
      if (planPair != null) clearPlan()
      return
    }
    if (pair != planPair) {
      clearPlan()
      planPair = pair
      fetchPlan(pair)
      return
    }
    when (val state = planState) {
      is PlanState.RetryAt -> if (SystemClock.elapsedRealtime() >= state.elapsedMs) fetchPlan(pair)
      is PlanState.Ready -> maybeStart(pair, state)
      else -> Unit
    }
  }

  private fun maybeStart(pair: DjPair, ready: PlanState.Ready) {
    val clip = ready.clip
    val positionMs = primaryPlayer.currentPosition
    val deckStartAMs = clip.aMediaMs((clip.deckStartS * 1000).toLong())
    if (positionMs > deckStartAMs + LATE_START_TOLERANCE_MS) {
      val deckError = deck?.playerError
      if (deckPreparedFor == clip.id && deckError != null) {
        Log.e(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} skipped: the clip deck failed to prepare", deckError)
        planState = PlanState.Declined("deck-prepare-failed")
      } else {
        decline(pair, "past-clip-start (at ${positionMs} ms, deck starts at A ${deckStartAMs} ms)", retryable = true)
      }
      return
    }
    if (positionMs < deckStartAMs - DECK_PREPARE_LEAD_MS) return
    if (isCrossfadeActive()) {
      // the crossfade started while the plan was still pending; it owns this transition now
      return decline(pair, "crossfade-already-running", retryable = true)
    }
    val sessionId = primaryPlayer.audioSessionId
    if (sessionId == C.AUDIO_SESSION_ID_UNSET) {
      Log.e(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} skipped: primary player has no audio session id")
      planState = PlanState.Declined("no-audio-session")
      return
    }
    val d = ensureDeck()
    if (deckPreparedFor != clip.id) {
      d.stop()
      d.clearMediaItems()
      d.volume = 0f
      d.playbackParameters = PlaybackParameters.DEFAULT
      // same session as the primary: its EQ, bass boost and loudness enhancer apply to the
      // clip too, so both joins compare identically processed audio
      d.setAudioSessionId(sessionId)
      d.setMediaItem(MediaItem.fromUri(Uri.fromFile(ready.file)), (clip.deckStartS * 1000).toLong())
      d.prepare()
      deckPreparedFor = clip.id
    }
    d.playerError?.let { error ->
      Log.e(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} skipped: the clip deck failed to prepare", error)
      planState = PlanState.Declined("deck-prepare-failed")
      d.stop()
      d.clearMediaItems()
      deckPreparedFor = null
      return
    }
    if (positionMs >= deckStartAMs && d.playbackState == Player.STATE_READY) {
      primaryTrackProblem?.let { problem ->
        Log.e(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} skipped: primary AudioTrack not plain PCM ($problem)")
        planState = PlanState.Declined("unsupported-audio-track")
        return
      }
      unverifiedPrimaryTiming()?.let { problem ->
        Log.e(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} skipped: $problem")
        planState = PlanState.Declined("unverified-primary-timing", retryable = true)
        return
      }
      val playing = primaryPlayer.audioFormat?.sampleMimeType
      if (playing != clip.aMime) {
        // e.g. the player still plays a cached MP3 after the account switched to lossless
        Log.e(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} skipped: server analysed ${clip.aMime}, player plays $playing")
        planState = PlanState.Declined("source-codec-mismatch")
        return
      }
      if (d.audioSessionId != sessionId) {
        Log.e(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} skipped: deck session ${d.audioSessionId} != primary $sessionId")
        planState = PlanState.Declined("audio-session-mismatch")
        return
      }
      d.seekTo(positionMs - (clip.aStartS * 1000).toLong() + DECK_INITIAL_LEAD_MS)
      d.play()
      pendingSelfSeeks.clear()
      expectedPrimaryParameters = PlaybackParameters.DEFAULT
      run = Run(pair, clip, d)
    }
  }

  private fun advance(r: Run) {
    if (isSleepFading()) return abort("sleep-fade")
    if (r.phase <= Phase.CLIP && sleepsAfterCurrentItem()) {
      // still on A: hand back so A ends naturally and the sleep timer sees an AUTO transition
      planState = PlanState.Declined("sleep-after-current-item")
      return abort("sleep-after-current-item")
    }
    val now = SystemClock.elapsedRealtime()
    // both snapshots back to back, before any other player call, so the pair is as close in time
    // as the main thread allows
    val clipMs = r.deck.currentPosition
    val primaryMs = primaryPlayer.currentPosition
    r.deck.playerError?.let { error ->
      Log.e(TAG, "DJ transition clip deck failed", error)
      return abort("deck-error:${error.errorCodeName}")
    }
    if (r.deck.playbackState == Player.STATE_ENDED) return abort("deck-ended")
    (primaryTrackProblem?.let { "primary $it" } ?: deckTrackProblem?.let { "deck $it" })?.let { problem ->
      Log.e(TAG, "DJ transition: AudioTrack not plain PCM ($problem); the phase lock cannot model it")
      planState = PlanState.Declined("unsupported-audio-track")
      return abort("unsupported-audio-track")
    }
    when (r.phase) {
      Phase.DECK_LOCK -> {
        if (primaryPlayer.currentMediaItem?.mediaId != r.pair.fromMediaId) return abort("primary-left-a")
        // the leader may rebuffer; its position then stands still, so the muted deck waits too
        // instead of burning its corrective seeks on a moving target
        if (!primaryPlayer.isPlaying) {
          if (r.lock.leaderInterrupted(now)) {
            Log.w(TAG, "DJ lock DECK_LOCK: primary not playing (state ${primaryPlayer.playbackState}); deck waits")
          }
          if (r.deck.playWhenReady) r.deck.pause()
          return
        }
        if (!r.deck.playWhenReady) r.deck.play()
        val aOffsetMs = primaryOffsetMs(r.clip.aStartSkipS) ?: return abort("primary-format-unknown")
        val joinWindowEndMs = ((r.clip.cueS - JOIN_IN_LATEST_BEFORE_CUE_S) * 1000).toLong()
        val state = applyLock(
          r, r.deck,
          leaderMs = primaryMs + aOffsetMs - r.clip.aStartS * 1000,
          followerMs = clipMs.toDouble(),
          remainingMs = joinWindowEndMs - clipMs,
          now = now,
        ) { targetMs -> r.deck.seekTo(targetMs) }
        if (state == LockState.FAILED) return
        if (state == LockState.LOCKED && clipMs >= (r.clip.joinInS * 1000).toLong() && clipMs < joinWindowEndMs) {
          r.phase = Phase.JOIN_IN
          r.rampStartMs = now
        } else if (clipMs >= joinWindowEndMs) {
          Log.w(TAG, "DJ transition deck never locked onto A: ${r.lock.describe(now)}; regular transition instead")
          planState = PlanState.Declined("deck-lock-timeout", retryable = true)
          abort("deck-lock-timeout")
        }
      }
      Phase.JOIN_IN -> {
        val p = ((now - r.rampStartMs).toDouble() / JOIN_MS).coerceIn(0.0, 1.0)
        r.deck.volume = p.toFloat()
        primaryPlayer.volume = ((1 - p) * r.pair.aGainMilli / 1000.0).toFloat()
        if (p >= 1.0) {
          primaryPlayer.volume = 0f
          r.phase = Phase.CLIP
        }
      }
      Phase.CLIP -> {
        if (clipMs >= (r.clip.primarySeekS * 1000).toLong()) {
          if (!targetStillAt(r.pair)) return abort("queue-changed")
          primaryPlayer.volume = 0f
          selfSeek(r.pair.toIndex, r.clip.bMediaMs(clipMs) + PRIMARY_SEEK_LEAD_MS)
          r.lock = LoggeRythmDjPhaseLock(PRIMARY_SEEK_LEAD_MS)
          r.phase = Phase.PRIMARY_LOCK
        }
      }
      Phase.PRIMARY_LOCK -> {
        if (primaryPlayer.currentMediaItem?.mediaId != r.pair.toMediaId) return abort("primary-left-b")
        primaryPlayer.volume = 0f
        primaryPlayer.audioFormat?.sampleMimeType?.let { playing ->
          if (playing != r.clip.bMime) {
            Log.e(TAG, "DJ transition: server analysed B as ${r.clip.bMime}, player plays $playing")
            return abort("source-codec-mismatch-b")
          }
        }
        val joinOutMs = (r.clip.joinOutS * 1000).toLong()
        val deadlineMs = ((r.clip.durationS - JOIN_OUT_LATEST_BEFORE_END_S) * 1000).toLong()
        val bOffsetMs = primaryOffsetMs(r.clip.bStartSkipS)
        val state = when {
          r.primaryLockFailure != null -> LockState.FAILED
          bOffsetMs == null -> LockState.UNLOCKED // B's format not known yet right after the seek
          else -> applyLock(
            r, primaryPlayer,
            leaderMs = r.clip.bMediaMs(clipMs).toDouble(),
            followerMs = primaryMs + bOffsetMs,
            remainingMs = deadlineMs - clipMs,
            now = now,
          ) { targetMs ->
            // a seek within B after audio flowed flushes without trimming the encoder delay again
            // (see the discontinuity listener), so the target maps with the offset that will hold
            val afterSeekOffsetMs = checkNotNull(primaryOffsetMs(r.clip.bStartSkipS, trimmed = trimPending && primaryTrimmed)) {
              "dj-primary-offset-lost: B's format vanished between two reads of one tick"
            }
            selfSeek(primaryPlayer.currentMediaItemIndex, Math.round(targetMs - afterSeekOffsetMs))
          }
        }
        val giveUp = state == LockState.FAILED && clipMs >= joinOutMs
        if ((state == LockState.LOCKED && clipMs >= joinOutMs) || giveUp || clipMs >= deadlineMs) {
          if (state != LockState.LOCKED) {
            Log.w(
              TAG,
              "DJ transition joins back to B unlocked (${r.primaryLockFailure ?: "deadline: ${r.lock.describe(now)}"}; " +
                "timing ${unverifiedPrimaryTiming() ?: "verified"})",
            )
          }
          setPrimaryParameters(PlaybackParameters.DEFAULT)
          r.phase = Phase.JOIN_OUT
          r.rampStartMs = now
        }
      }
      Phase.JOIN_OUT -> {
        if (primaryPlayer.currentMediaItem?.mediaId != r.pair.toMediaId) return abort("primary-left-b")
        val p = ((now - r.rampStartMs).toDouble() / JOIN_MS).coerceIn(0.0, 1.0)
        r.deck.volume = (1 - p).toFloat()
        primaryPlayer.volume = (p * r.pair.bGainMilli / 1000.0).toFloat()
        if (p >= 1.0) finish(r)
      }
    }
  }

  /**
   * Runs one phase-lock step on positions mapped onto the follower's timeline. On a lock failure
   * in DECK_LOCK the run is declined and aborted here; in PRIMARY_LOCK the failure is recorded
   * and the caller joins back unlocked.
   */
  private fun applyLock(
    r: Run,
    follower: ExoPlayer,
    leaderMs: Double,
    followerMs: Double,
    remainingMs: Long,
    now: Long,
    seek: (Long) -> Unit,
  ): LockState {
    if (Log.isLoggable(TAG, Log.VERBOSE)) {
      // raw per-tick trace: `adb shell setprop log.tag.LoggeRythmDj VERBOSE`
      Log.v(
        TAG,
        String.format(
          Locale.ROOT,
          "tick %s t=%d leader=%.1f follower=%.1f raw=%.1f left=%d playing=%b/%b",
          r.phase, now, leaderMs, followerMs, followerMs - leaderMs, remainingMs,
          primaryPlayer.isPlaying, r.deck.isPlaying,
        ),
      )
    }
    if (now - r.lastStatusLogMs >= STATUS_LOG_INTERVAL_MS) {
      r.lastStatusLogMs = now
      Log.d(
        TAG,
        String.format(
          Locale.ROOT,
          "DJ lock %s: raw error %.1f ms, follower state=%d playing=%b, %d ms left, trimmed=%b; %s",
          r.phase, followerMs - leaderMs, follower.playbackState, follower.isPlaying, remainingMs,
          primaryTrimmed, r.lock.describe(now),
        ),
      )
    }
    (if (follower === primaryPlayer) primaryDrainMs else deckDrainMs)?.let { r.lock.followerDrainMs = it }
    return when (val action = r.lock.step(now, follower.isPlaying, leaderMs, followerMs, remainingMs)) {
      LoggeRythmDjPhaseLock.Action.Wait -> LockState.UNLOCKED
      LoggeRythmDjPhaseLock.Action.Locked -> LockState.LOCKED
      is LoggeRythmDjPhaseLock.Action.Seek -> {
        Log.i(
          TAG,
          String.format(
            Locale.ROOT,
            "DJ lock %s: stable error %.1f ms, seek follower %.0f -> %d ms (lead %d ms)",
            r.phase, action.errorMs, followerMs, action.targetMs, r.lock.seekLeadMs(),
          ),
        )
        seek(action.targetMs)
        LockState.UNLOCKED
      }
      is LoggeRythmDjPhaseLock.Action.SetSpeed -> {
        Log.i(TAG, "DJ lock ${r.phase}: speed ${action.speed} (stable error ${r.lock.lastStableErrorMs} ms)")
        if (follower === primaryPlayer) {
          setPrimaryParameters(PlaybackParameters(action.speed))
        } else {
          follower.playbackParameters = PlaybackParameters(action.speed)
        }
        LockState.UNLOCKED
      }
      is LoggeRythmDjPhaseLock.Action.Fail -> {
        Log.e(TAG, "DJ lock ${r.phase} failed: ${action.reason}")
        if (r.phase == Phase.DECK_LOCK) {
          planState = PlanState.Declined(action.reason.substringBefore(':'), retryable = true)
          abort("lock-failed:${action.reason.substringBefore(':')}")
        } else {
          setPrimaryParameters(PlaybackParameters.DEFAULT)
          r.primaryLockFailure = action.reason
        }
        LockState.FAILED
      }
    }
  }

  /** Why the primary's position cannot be mapped onto the clip timeline, or null when it can. */
  private fun unverifiedPrimaryTiming(): String? {
    val decoder = primaryDecoderName ?: return "primary audio decoder not known yet"
    if (decoder !in LoggeRythmDjDecoderOffset.VERIFIED_DECODERS) {
      return "primary audio decoder $decoder has no verified delay handling"
    }
    val format = primaryPlayer.audioFormat ?: return "primary audio format not known yet"
    val mime = format.sampleMimeType
    if (mime != MimeTypes.AUDIO_MPEG && mime != MimeTypes.AUDIO_FLAC) return "unsupported primary format $mime"
    if (format.sampleRate <= 0) return "primary sample rate unknown"
    return null
  }

  /** ms to add to the primary's position to get ffmpeg's timeline; null while the format is not known. */
  private fun primaryOffsetMs(startSkipS: Double, trimmed: Boolean = primaryTrimmed): Double? {
    if (unverifiedPrimaryTiming() != null) return null
    val format = primaryPlayer.audioFormat ?: return null
    val encoderDelay = if (format.encoderDelay == Format.NO_VALUE) 0 else format.encoderDelay
    return LoggeRythmDjDecoderOffset.offsetMs(format.sampleMimeType, format.sampleRate, encoderDelay, trimmed, startSkipS)
  }

  /** Seeks the primary and records the seek so the discontinuity is not taken for the user's. */
  private fun selfSeek(index: Int, positionMs: Long) {
    pendingSelfSeeks.addLast(index to positionMs)
    primaryPlayer.seekTo(index, positionMs)
  }

  private fun consumeSelfSeek(position: Player.PositionInfo): Boolean {
    val match = pendingSelfSeeks.firstOrNull { (index, positionMs) ->
      index == position.mediaItemIndex && abs(positionMs - position.positionMs) <= SELF_SEEK_MATCH_MS
    } ?: return false
    pendingSelfSeeks.remove(match)
    return true
  }

  private fun setPrimaryParameters(parameters: PlaybackParameters) {
    expectedPrimaryParameters = parameters
    if (primaryPlayer.playbackParameters != parameters) primaryPlayer.playbackParameters = parameters
  }

  private fun finish(r: Run) {
    run = null
    pendingSelfSeeks.clear()
    r.deck.pause()
    r.deck.stop()
    r.deck.clearMediaItems()
    deckPreparedFor = null
    clearPlan()
    restorePrimaryLoudness()
    Log.i(TAG, "DJ transition ${r.pair.from.trackId}->${r.pair.to.trackId} completed")
  }

  private fun abort(reason: String) {
    val active = run ?: return
    run = null
    pendingSelfSeeks.clear()
    active.deck.pause()
    active.deck.stop()
    active.deck.clearMediaItems()
    deckPreparedFor = null
    // undo only our own Sonic nudge; a speed the user just chose (the abort reason) stays
    if (expectedPrimaryParameters != PlaybackParameters.DEFAULT && primaryPlayer.playbackParameters == expectedPrimaryParameters) {
      primaryPlayer.playbackParameters = PlaybackParameters.DEFAULT
    }
    expectedPrimaryParameters = PlaybackParameters.DEFAULT
    if (active.phase != Phase.DECK_LOCK && !isSleepFading()) restorePrimaryLoudness()
    if (planState !is PlanState.Declined) clearPlan()
    Log.w(TAG, "DJ transition ${active.pair.from.trackId}->${active.pair.to.trackId} aborted in ${active.phase}: $reason")
  }

  private fun targetStillAt(pair: DjPair): Boolean =
    pair.toIndex in 0 until primaryPlayer.mediaItemCount &&
      primaryPlayer.getMediaItemAt(pair.toIndex).mediaId == pair.toMediaId

  private fun ensureDeck(): ExoPlayer {
    deck?.let { return it }
    return ExoPlayer.Builder(context.applicationContext)
      // never request audio focus: the primary player keeps it
      .setAudioAttributes(audioAttributes, false)
      // keep played clip samples: a backward lock correction then stays inside the buffer
      // instead of reloading, so forward and backward seeks restart alike
      .setLoadControl(DefaultLoadControl.Builder().setBackBuffer(DECK_BACK_BUFFER_MS, true).build())
      .build()
      .apply {
        addAnalyticsListener(
          object : AnalyticsListener {
            override fun onAudioTrackInitialized(eventTime: AnalyticsListener.EventTime, audioTrackConfig: AudioSink.AudioTrackConfig) {
              deckTrackProblem = unsupportedTrack(audioTrackConfig)
              deckDrainMs = if (deckTrackProblem == null) audioTrackDrainMs("deck", audioTrackConfig) else null
            }

            override fun onAudioUnderrun(eventTime: AnalyticsListener.EventTime, bufferSize: Int, bufferSizeMs: Long, elapsedSinceLastFeedMs: Long) {
              logUnderrun("deck", bufferSizeMs, elapsedSinceLastFeedMs)
            }
          },
        )
      }
      .also { deck = it }
  }

  /** An underrun during a run is a real gap in that player's audio: the lock's positions jump with it. */
  private fun logUnderrun(player: String, bufferSizeMs: Long, elapsedSinceLastFeedMs: Long) {
    val active = run ?: return
    Log.w(
      TAG,
      "DJ ${active.phase}: $player audio underrun (buffer $bufferSizeMs ms, last fed $elapsedSinceLastFeedMs ms ago)",
    )
  }

  /** Why the lock cannot model this AudioTrack (Sonic speed + buffer drain), or null for plain PCM. */
  private fun unsupportedTrack(config: AudioSink.AudioTrackConfig): String? =
    if (!Util.isEncodingLinearPcm(config.encoding) || config.offload || config.tunneling) {
      "encoding ${config.encoding}, offload ${config.offload}, tunneling ${config.tunneling}"
    } else {
      null
    }

  /** How long a plain-PCM AudioTrack's buffer plays. */
  private fun audioTrackDrainMs(player: String, config: AudioSink.AudioTrackConfig): Long {
    val channels = Integer.bitCount(config.channelConfig)
    val frameBytes = Util.getPcmFrameSize(config.encoding, channels)
    check(frameBytes > 0 && config.sampleRate > 0) { "dj-audiotrack-config-invalid:$player ${config.encoding}/${config.channelConfig}/${config.sampleRate}" }
    val drainMs = config.bufferSize.toLong() / frameBytes * 1000 / config.sampleRate
    Log.d(TAG, "DJ: $player AudioTrack buffers $drainMs ms (${config.bufferSize} bytes)")
    return drainMs
  }

  private fun releaseDeck() {
    deck?.release()
    deck = null
    deckPreparedFor = null
  }

  private fun scheduleMonitor() {
    if (released || monitorScheduled) return
    if (!enabled && run == null) return
    if (run == null && !primaryPlayer.isPlaying) return
    monitorScheduled = true
    mainHandler.postDelayed(monitor, if (run != null) RUN_TICK_MS else IDLE_TICK_MS)
  }

  companion object {
    private const val TAG = "LoggeRythmDj"
    private const val IDLE_TICK_MS = 100L
    private const val RUN_TICK_MS = 16L
    private const val STATUS_LOG_INTERVAL_MS = 500L
    private const val JOIN_MS = 150.0
    private const val ERROR_RETRY_MS = 60_000L
    private const val DECK_PREPARE_LEAD_MS = 8_000L
    private const val DECK_INITIAL_LEAD_MS = 80L
    private const val DECK_BACK_BUFFER_MS = 60_000
    private const val LATE_START_TOLERANCE_MS = 1_500L
    private const val PRIMARY_SEEK_LEAD_MS = 250L
    private const val SELF_SEEK_MATCH_MS = 1L
    private const val JOIN_IN_LATEST_BEFORE_CUE_S = 0.4
    private const val JOIN_OUT_LATEST_BEFORE_END_S = 0.6
    private const val MAX_CACHED_CLIPS = 6

    internal fun defaultHttpClient(): OkHttpClient = failClosedMediaHttpClient {
      connectTimeout(10, TimeUnit.SECONDS)
      readTimeout(30, TimeUnit.SECONDS)
      callTimeout(60, TimeUnit.SECONDS)
    }
  }
}
