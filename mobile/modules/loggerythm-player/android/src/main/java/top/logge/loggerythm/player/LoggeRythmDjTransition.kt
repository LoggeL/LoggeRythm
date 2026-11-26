package top.logge.loggerythm.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
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
) {
  init {
    require(Regex("^[0-9a-f]{32}$").matches(id)) { "dj-clip-id-invalid" }
    require(deckStartS < joinInS && joinInS < cueS && cueS <= mixStartS + 1.0) { "dj-clip-timeline-order" }
    require(primarySeekS < mixEndS && mixEndS < joinOutS && joinOutS < durationS) { "dj-clip-timeline-order" }
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
    )
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
 * Keeps a muted follower player phase-locked to a leader that plays the same audio:
 * a few corrective seeks for large errors, then a small speed nudge (Sonic) for the rest.
 * Pure arithmetic so it is JVM-testable; the controller feeds it measured errors.
 */
internal class LoggeRythmDjPhaseLock {
  private val samples = ArrayDeque<Double>()
  private var playingSinceMs: Long? = null
  private var lastActionMs = Long.MIN_VALUE / 2
  private var stableSinceMs: Long? = null
  var speed = 1f
    private set
  var seeks = 0
    private set
  /** Expected restart latency after a follower seek (learned from the last seek). */
  var seekLeadMs = INITIAL_SEEK_LEAD_MS
    private set
  private var lastSeekErrorTarget: Double? = null
  var lastErrorMs: Double? = null
    private set

  sealed class Action {
    data object Wait : Action()
    data class Seek(val correctionMs: Long) : Action()
    data class SetSpeed(val speed: Float) : Action()
    data object Locked : Action()
  }

  fun reset() {
    samples.clear()
    playingSinceMs = null
    stableSinceMs = null
    lastErrorMs = null
  }

  /** [errorMs] > 0: follower is ahead of where it should be. */
  fun step(nowMs: Long, followerPlaying: Boolean, errorMs: Double): Action {
    if (!followerPlaying) {
      reset()
      return Action.Wait
    }
    val since = playingSinceMs ?: nowMs.also { playingSinceMs = it }
    if (nowMs - since < SETTLE_MS) return Action.Wait
    samples.addLast(errorMs)
    while (samples.size > WINDOW) samples.removeFirst()
    if (samples.size < WINDOW) return Action.Wait
    val e = samples.sorted()[WINDOW / 2]
    lastErrorMs = e
    lastSeekErrorTarget?.let { target ->
      // first settled measurement after a seek: learn how far the restart lagged
      seekLeadMs = (seekLeadMs + (target - e)).toLong().coerceIn(0L, MAX_SEEK_LEAD_MS)
      lastSeekErrorTarget = null
    }
    if (abs(e) > SEEK_THRESHOLD_MS && seeks < MAX_SEEKS && nowMs - lastActionMs >= ACTION_GAP_MS) {
      seeks += 1
      lastActionMs = nowMs
      lastSeekErrorTarget = 0.0
      reset()
      return Action.Seek(correctionMs = Math.round(-e) + seekLeadMs)
    }
    val wanted = if (abs(e) <= LOCK_MS) 1f else nudgeSpeed(e)
    if (abs(wanted - speed) >= SPEED_STEP && nowMs - lastActionMs >= SPEED_GAP_MS) {
      speed = wanted
      lastActionMs = nowMs
      stableSinceMs = null
      samples.clear()
      return Action.SetSpeed(wanted)
    }
    if (speed == 1f && abs(e) <= HOLD_MS) {
      val stable = stableSinceMs ?: nowMs.also { stableSinceMs = it }
      if (nowMs - stable >= HOLD_DURATION_MS) return Action.Locked
    } else {
      stableSinceMs = null
    }
    return Action.Wait
  }

  companion object {
    const val WINDOW = 5
    const val SETTLE_MS = 300L
    const val SEEK_THRESHOLD_MS = 30.0
    const val MAX_SEEKS = 4
    const val ACTION_GAP_MS = 400L
    const val SPEED_GAP_MS = 120L
    const val SPEED_STEP = 0.002f
    const val LOCK_MS = 3.0
    const val HOLD_MS = 8.0
    const val HOLD_DURATION_MS = 250L
    const val MAX_NUDGE = 0.03
    const val GAIN_PER_SEC = 1.0
    const val INITIAL_SEEK_LEAD_MS = 80L
    const val MAX_SEEK_LEAD_MS = 400L

    /** Follower ahead by e ms -> run slower so the error decays with a ~1 s time constant. */
    fun nudgeSpeed(errorMs: Double): Float =
      (1.0 - (errorMs / 1000.0 * GAIN_PER_SEC).coerceIn(-MAX_NUDGE, MAX_NUDGE)).toFloat()
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
    data class Declined(val reason: String) : PlanState()
    data class Ready(val clip: LoggeRythmDjClip, val file: File) : PlanState()
  }

  private enum class Phase { DECK_LOCK, JOIN_IN, CLIP, PRIMARY_LOCK, JOIN_OUT }

  private class Run(val pair: DjPair, val clip: LoggeRythmDjClip, val deck: ExoPlayer) {
    var phase = Phase.DECK_LOCK
    var lock = LoggeRythmDjPhaseLock()
    var rampStartMs = 0L
  }

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
      val active = run ?: return
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

    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_IDLE || playbackState == Player.STATE_ENDED) abort("primary-state:$playbackState")
      scheduleMonitor()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      scheduleMonitor()
    }
  }

  init {
    primaryPlayer.addListener(primaryListener)
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

  private fun decline(pair: DjPair, reason: String) {
    Log.i(TAG, "DJ transition ${pair.from.trackId}->${pair.to.trackId} declined: $reason; regular transition instead")
    planState = PlanState.Declined(reason)
  }

  private fun fetchPlan(pair: DjPair) {
    val session = LoggeRythmPlayerRuntime.sessionCookieForCurrentOrigin()
    if (session == null || session.first != pair.from.origin) {
      planState = PlanState.Declined("no-session-for-origin")
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
        decline(pair, "past-clip-start (at ${positionMs} ms, deck starts at A ${deckStartAMs} ms)")
      }
      return
    }
    if (positionMs < deckStartAMs - DECK_PREPARE_LEAD_MS) return
    if (isCrossfadeActive()) {
      // the crossfade started while the plan was still pending; it owns this transition now
      return decline(pair, "crossfade-already-running")
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
    val now = SystemClock.elapsedRealtime()
    val clipMs = r.deck.currentPosition
    r.deck.playerError?.let { error ->
      Log.e(TAG, "DJ transition clip deck failed", error)
      return abort("deck-error:${error.errorCodeName}")
    }
    if (r.deck.playbackState == Player.STATE_ENDED) return abort("deck-ended")
    when (r.phase) {
      Phase.DECK_LOCK -> {
        if (primaryPlayer.currentMediaItem?.mediaId != r.pair.fromMediaId) return abort("primary-left-a")
        // the leader may rebuffer; its position then stands still, so the muted deck waits too
        // instead of burning its corrective seeks on a moving target
        if (!primaryPlayer.isPlaying) {
          if (r.deck.playWhenReady) r.deck.pause()
          r.lock.reset()
          return
        }
        if (!r.deck.playWhenReady) r.deck.play()
        val expected = primaryPlayer.currentPosition - (r.clip.aStartS * 1000).toLong()
        val locked = applyLock(r, r.deck, (clipMs - expected).toDouble(), now) { correction ->
          r.deck.seekTo(clipMs + correction)
        }
        val joinWindowEndMs = ((r.clip.cueS - JOIN_IN_LATEST_BEFORE_CUE_S) * 1000).toLong()
        if (locked && clipMs >= (r.clip.joinInS * 1000).toLong() && clipMs < joinWindowEndMs) {
          r.phase = Phase.JOIN_IN
          r.rampStartMs = now
        } else if (clipMs >= joinWindowEndMs) {
          Log.w(TAG, "DJ transition deck never locked onto A (last error ${r.lock.lastErrorMs} ms); regular transition instead")
          planState = PlanState.Declined("deck-lock-timeout")
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
          r.lock = LoggeRythmDjPhaseLock()
          r.phase = Phase.PRIMARY_LOCK
        }
      }
      Phase.PRIMARY_LOCK -> {
        if (primaryPlayer.currentMediaItem?.mediaId != r.pair.toMediaId) return abort("primary-left-b")
        primaryPlayer.volume = 0f
        val expected = r.clip.bMediaMs(clipMs)
        val locked = applyLock(r, primaryPlayer, (primaryPlayer.currentPosition - expected).toDouble(), now) { correction ->
          selfSeek(primaryPlayer.currentMediaItemIndex, primaryPlayer.currentPosition + correction)
        }
        val joinOutMs = (r.clip.joinOutS * 1000).toLong()
        val deadlineMs = ((r.clip.durationS - JOIN_OUT_LATEST_BEFORE_END_S) * 1000).toLong()
        if ((locked && clipMs >= joinOutMs) || clipMs >= deadlineMs) {
          if (!locked) {
            Log.w(TAG, "DJ transition joins back to B unlocked (last error ${r.lock.lastErrorMs} ms)")
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

  /** Runs one phase-lock step; returns true while locked. */
  private fun applyLock(r: Run, follower: ExoPlayer, errorMs: Double, now: Long, seek: (Long) -> Unit): Boolean =
    when (val action = r.lock.step(now, follower.isPlaying, errorMs)) {
      LoggeRythmDjPhaseLock.Action.Wait -> false
      LoggeRythmDjPhaseLock.Action.Locked -> true
      is LoggeRythmDjPhaseLock.Action.Seek -> {
        seek(action.correctionMs)
        false
      }
      is LoggeRythmDjPhaseLock.Action.SetSpeed -> {
        if (follower === primaryPlayer) {
          setPrimaryParameters(PlaybackParameters(action.speed))
        } else {
          follower.playbackParameters = PlaybackParameters(action.speed)
        }
        false
      }
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
    if (primaryPlayer.playbackParameters.speed != 1f && active.phase >= Phase.CLIP) {
      primaryPlayer.playbackParameters = PlaybackParameters.DEFAULT
    }
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
      .build()
      .also { deck = it }
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
    private const val JOIN_MS = 150.0
    private const val ERROR_RETRY_MS = 60_000L
    private const val DECK_PREPARE_LEAD_MS = 8_000L
    private const val DECK_INITIAL_LEAD_MS = 80L
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
