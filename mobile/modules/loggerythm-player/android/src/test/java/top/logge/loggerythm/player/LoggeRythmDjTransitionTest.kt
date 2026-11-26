package top.logge.loggerythm.player

import kotlin.math.abs
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmDjTransitionTest {
  @Test
  fun streamRefParsesApiStreamsOnly() {
    assertEquals(
      // no quality parameter: the server streams the account's preferred quality
      LoggeRythmDjStreamRef("https://music.example", "123", null),
      LoggeRythmDjStreamRef.parse("https://music.example/api/tracks/123/stream"),
    )
    assertEquals(
      LoggeRythmDjStreamRef("https://music.example:8443", "9", "lossless"),
      LoggeRythmDjStreamRef.parse("https://music.example:8443/api/tracks/9/stream?quality=lossless"),
    )
    assertNull(LoggeRythmDjStreamRef.parse("file:///data/user/0/app/files/downloads/123.mp3"))
    assertNull(LoggeRythmDjStreamRef.parse("http://music.example/api/tracks/123/stream"))
    assertNull(LoggeRythmDjStreamRef.parse("https://music.example/api/tracks/abc/stream"))
    assertNull(LoggeRythmDjStreamRef.parse("https://music.example/api/tracks/1/stream?quality=ultra"))
    assertNull(LoggeRythmDjStreamRef.parse(null))
  }

  private val clipJson = """
    {"id":"0123456789abcdef0123456789abcdef","render_version":1,"duration_s":27.195,
     "a_start_s":118.741,"b_offset_s":14.526,"cue_s":8.0,"deck_start_s":1.0,"join_in_s":6.32,
     "primary_seek_s":6.62,"mix_start_s":8.02,"bass_swap_s":15.52,"mix_end_s":23.02,
     "join_out_s":24.19,"a_speed":1.024,"limiter_reduction_db":2.8,
     "a_start_skip_s":0.025057,"b_start_skip_s":0.0,"a_mime":"audio/mpeg","b_mime":"audio/mpeg"}
  """.trimIndent()

  @Test
  fun parsesEveryPlanKind() {
    assertEquals(
      LoggeRythmDjPlanResponse.Pending("ANALYSING", 5_000L),
      LoggeRythmDjPlanResponse.parse("""{"status":"pending","reason":"ANALYSING","retry_after_s":5}"""),
    )
    assertEquals(
      LoggeRythmDjPlanResponse.Crossfade("TEMPO_GAP", "A would need 1.2x"),
      LoggeRythmDjPlanResponse.parse(
        """{"status":"ready","kind":"crossfade","reason":"TEMPO_GAP","detail":"A would need 1.2x"}""",
      ),
    )
    val beat = LoggeRythmDjPlanResponse.parse(
      """{"status":"ready","kind":"beatmatch","reason":"OK","detail":"8 bars","clip":$clipJson}""",
    ) as LoggeRythmDjPlanResponse.Beatmatch
    assertEquals(118_741L + 6_320L, beat.clip.aMediaMs(6_320L))
    assertEquals(24_190L + 14_526L, beat.clip.bMediaMs(24_190L))
  }

  @Test
  fun rejectsMalformedPlansLoudly() {
    val missing = assertThrows(IllegalStateException::class.java) {
      LoggeRythmDjPlanResponse.parse("""{"status":"ready","kind":"beatmatch","reason":"OK"}""")
    }
    assertTrue(missing.message!!.startsWith("dj-plan-field-invalid"))
    assertThrows(IllegalStateException::class.java) {
      LoggeRythmDjPlanResponse.parse("""{"status":"later"}""")
    }
    assertThrows(IllegalArgumentException::class.java) {
      LoggeRythmDjPlanResponse.parse(
        """{"status":"ready","kind":"beatmatch","reason":"OK","clip":${clipJson.replace("\"join_in_s\":6.32", "\"join_in_s\":0.5")}}""",
      )
    }
  }

  @Test
  fun decoderOffsetMapsPlayerPositionsOntoFfmpegsTimeline() {
    val tagged = (576 + 529) / 44_100.0 // ffprobe start_time of a LAME-tagged MP3
    // trimmed (prepare, item change, cross-item seek): both drop D + 529 -> no offset
    assertEquals(0.0, LoggeRythmDjDecoderOffset.offsetMs("audio/mpeg", 44_100, 576, trimmed = true, startSkipS = tagged), 1e-9)
    // after a seek within the item the encoder delay is no longer trimmed: player is D ahead
    assertEquals(-576_000.0 / 44_100, LoggeRythmDjDecoderOffset.offsetMs("audio/mpeg", 44_100, 576, trimmed = false, startSkipS = tagged), 1e-9)
    // untagged MP3: ffmpeg keeps the decoder delay, the player drops it
    assertEquals(529_000.0 / 44_100, LoggeRythmDjDecoderOffset.offsetMs("audio/mpeg", 44_100, 0, trimmed = true, startSkipS = 0.0), 1e-9)
    assertEquals(0.0, LoggeRythmDjDecoderOffset.offsetMs("audio/flac", 44_100, 0, trimmed = false, startSkipS = 0.0), 1e-9)
    assertThrows(IllegalArgumentException::class.java) {
      LoggeRythmDjDecoderOffset.offsetMs("audio/opus", 48_000, 0, trimmed = true, startSkipS = 0.0)
    }
  }

  /**
   * One simulated player as Media3 1.10.1 exposes it: the true audio position advances at the
   * applied rate; the app only sees the snapshot its playback thread published last (every 10 ms
   * in its own phase, floored to whole ms), and that thread sometimes stalls for 50-400 ms. Seeks
   * restart after a lag on a frame boundary; speed changes reach the audio after the AudioTrack
   * buffer drained (250-750 ms per player as Media3 sizes it, +-25 ms per change).
   */
  private class SimPlayer(
    private val rng: java.util.Random,
    startMs: Double,
    private val stallsPerSec: Double,
    private val frameMs: Double = 1024_000.0 / 44_100,
    private val restartLagMs: IntRange = 60..200,
    startDelayMs: Long = 0L,
  ) {
    var trueMs = startMs
    private var rate = 1.0
    /** Audio buffered in the AudioTrack: what a speed change waits for (per player, near constant). */
    val drainMs = 250L + rng.nextInt(500)
    private val pendingRates = ArrayDeque<Pair<Long, Double>>()
    private var restartUntilMs = startDelayMs
    private var paused = false
    private var snapshotMs = Math.floor(startMs)
    private var nextPublishMs = rng.nextInt(10).toLong()
    private var stalledUntilMs = Long.MIN_VALUE
    private var lastMs = 0L

    val playing get() = !paused && lastMs >= restartUntilMs

    fun advanceTo(nowMs: Long) {
      while (lastMs < nowMs) {
        val t = lastMs + 1
        while (pendingRates.isNotEmpty() && pendingRates.first().first <= t) rate = pendingRates.removeFirst().second
        if (!paused && t >= restartUntilMs) trueMs += rate
        if (t >= nextPublishMs) {
          if (t >= stalledUntilMs && rng.nextDouble() < stallsPerSec / 100.0) {
            stalledUntilMs = t + 50 + rng.nextInt(350)
          }
          if (t >= stalledUntilMs) snapshotMs = Math.floor(trueMs)
          nextPublishMs = t + 10
        }
        lastMs = t
      }
    }

    fun reported(): Double = snapshotMs

    fun seek(nowMs: Long, targetMs: Long) {
      trueMs = Math.floor(targetMs / frameMs) * frameMs
      snapshotMs = targetMs.toDouble() // masked position until the restart
      restartUntilMs = nowMs + restartLagMs.first + rng.nextInt(restartLagMs.last - restartLagMs.first + 1)
    }

    fun setSpeed(nowMs: Long, speed: Float) {
      pendingRates.addLast(nowMs + drainMs - 25 + rng.nextInt(50) to speed.toDouble())
    }

    fun pause() {
      paused = true
    }

    fun resume(nowMs: Long, lagMs: Long) {
      paused = false
      restartUntilMs = nowMs + lagMs
    }
  }

  private data class LockOutcome(
    val locked: Boolean,
    /** True follower - leader error when the lock first reported Locked (or at the end). */
    val trueErrorMs: Double,
    val atMs: Long,
    val fail: String?,
    val seeks: Int,
    /** Worst true error on a tick that reported Locked after the first lock. */
    val worstLockedErrorMs: Double,
    val failedAfterLock: Boolean,
    val firstAction: LoggeRythmDjPhaseLock.Action?,
    val state: String,
    val trace: List<String>,
  )

  /**
   * Runs the lock against two simulated players for [budgetMs] (ticks every 16-25 ms, 15 % of
   * them 40-160 ms late, as on the emulator). It keeps stepping after the first Locked, as the
   * controller does until the join. Lock time starts near 1e9 ms like a device's elapsedRealtime.
   */
  private fun simulateLock(
    seed: Long,
    startErrorMs: Double,
    stallsPerSec: Double,
    budgetMs: Long = 6_500L,
    leaderInterrupts: List<Pair<Long, Long>> = emptyList(),
    knownDrain: Boolean = true,
    followerStartDelayMs: Long = 0L,
    followerRestartLagMs: IntRange = 60..200,
    followerFrameMs: Double = 1024_000.0 / 44_100,
    initialSeekLeadMs: Long = 80L,
  ): LockOutcome {
    val rng = java.util.Random(seed)
    val base = 1_000_000_000L
    val leader = SimPlayer(rng, 120_000.0, stallsPerSec)
    val follower = SimPlayer(
      rng, 120_000.0 + startErrorMs, stallsPerSec, followerFrameMs, followerRestartLagMs, followerStartDelayMs,
    )
    val lock = LoggeRythmDjPhaseLock(initialSeekLeadMs)
    if (knownDrain) lock.followerDrainMs = follower.drainMs + 25
    var now = 0L
    val trace = mutableListOf<String>()
    var lockedAt: Long? = null
    var lockedError = 0.0
    var worstLocked = 0.0
    var firstAction: LoggeRythmDjPhaseLock.Action? = null
    var interrupted = false
    fun trueError() = follower.trueMs - leader.trueMs
    fun outcome(fail: String?) = LockOutcome(
      locked = lockedAt != null,
      trueErrorMs = if (lockedAt != null) lockedError else trueError(),
      atMs = lockedAt ?: now,
      fail = fail,
      seeks = lock.seeks,
      worstLockedErrorMs = worstLocked,
      failedAfterLock = fail != null && lockedAt != null,
      firstAction = firstAction,
      state = lock.describe(base + now),
      trace = trace,
    )
    while (now < budgetMs) {
      now += if (rng.nextDouble() < 0.15) 40L + rng.nextInt(120) else 16L + rng.nextInt(10)
      val inInterrupt = leaderInterrupts.any { (start, length) -> now in start until start + length }
      if (inInterrupt && !interrupted) {
        // the leader rebuffers: its audio stops; the controller pauses the follower
        leader.pause()
        follower.pause()
        interrupted = true
      } else if (!inInterrupt && interrupted) {
        leader.resume(now, 0L)
        follower.resume(now, 20L + rng.nextInt(40))
        interrupted = false
      }
      leader.advanceTo(now)
      follower.advanceTo(now)
      if (interrupted) {
        lock.leaderInterrupted(base + now)
        continue
      }
      val action = lock.step(base + now, follower.playing, leader.reported(), follower.reported(), budgetMs - now)
      if (action != LoggeRythmDjPhaseLock.Action.Wait) {
        if (firstAction == null) firstAction = action
        trace += String.format(java.util.Locale.ROOT, "%d true %.1f %s", now, trueError(), action)
      }
      when (action) {
        is LoggeRythmDjPhaseLock.Action.Seek -> follower.seek(now, action.targetMs - base + base)
        is LoggeRythmDjPhaseLock.Action.SetSpeed -> {
          assertTrue("speed ${action.speed} beyond the nudge bound", abs(action.speed - 1f) <= LoggeRythmDjPhaseLock.MAX_NUDGE + 1e-6)
          follower.setSpeed(now, action.speed)
        }
        LoggeRythmDjPhaseLock.Action.Locked -> {
          if (lockedAt == null) {
            lockedAt = now
            lockedError = trueError()
          }
          worstLocked = maxOf(worstLocked, abs(trueError()))
        }
        is LoggeRythmDjPhaseLock.Action.Fail -> return outcome(action.reason)
        LoggeRythmDjPhaseLock.Action.Wait -> Unit
      }
    }
    return outcome(null)
  }

  @Test
  fun phaseLockConvergesOnCleanMeasurements() {
    for (knownDrain in listOf(true, false)) {
      for (seed in 1L..20L) {
        for (start in listOf(-140.0, -40.0, 18.0, 90.0)) {
          val outcome = simulateLock(seed, start, stallsPerSec = 0.0, knownDrain = knownDrain)
          val label = "drain known $knownDrain seed $seed start $start: $outcome"
          assertTrue(label, outcome.locked && outcome.fail == null)
          assertTrue(label, abs(outcome.trueErrorMs) <= 7.0)
          assertTrue(label, outcome.worstLockedErrorMs <= LoggeRythmDjPhaseLock.RELOCK_MS + 2)
          assertTrue(label, outcome.atMs <= if (knownDrain) 6_000L else 6_300L)
          // a nudge fits every one of these: seeking would only add restart-lag noise
          assertEquals(label, 0, outcome.seeks)
        }
      }
    }
  }

  @Test
  fun phaseLockNudgesInTheRightDirection() {
    val ahead = simulateLock(1L, 40.0, stallsPerSec = 0.0).firstAction
    assertTrue("$ahead", ahead is LoggeRythmDjPhaseLock.Action.SetSpeed && ahead.speed < 1f)
    val behind = simulateLock(1L, -40.0, stallsPerSec = 0.0).firstAction
    assertTrue("$behind", behind is LoggeRythmDjPhaseLock.Action.SetSpeed && behind.speed > 1f)
  }

  /** Too far off for a nudge: seeks first, leading by the restart lag it measures. */
  @Test
  fun phaseLockSeeksLargeErrors() {
    for (seed in 1L..20L) {
      for (start in listOf(-350.0, 420.0)) {
        val outcome = simulateLock(seed, start, stallsPerSec = 1.0)
        val label = "seed $seed start $start: $outcome"
        assertTrue(label, outcome.locked && outcome.fail == null)
        assertTrue(label, abs(outcome.trueErrorMs) <= 8.0)
        assertTrue(label, outcome.seeks in 1..LoggeRythmDjPhaseLock.MAX_SEEKS)
      }
    }
  }

  /** The emulator case: both playback threads stall for 50-400 ms about twice a second. */
  @Test
  fun phaseLockIgnoresFrozenSnapshots() {
    var locked = 0
    val misses = mutableListOf<String>()
    for (seed in 1L..40L) {
      val outcome = simulateLock(seed, startErrorMs = if (seed % 2 == 0L) -57.0 else 104.0, stallsPerSec = 2.0)
      if (outcome.locked) {
        locked += 1
        assertTrue("seed $seed locked off target: $outcome", abs(outcome.trueErrorMs) <= 8.0)
        assertTrue("seed $seed lost a held lock: $outcome", !outcome.failedAfterLock)
        assertTrue("seed $seed held off target: $outcome", outcome.worstLockedErrorMs <= LoggeRythmDjPhaseLock.RELOCK_MS + 3)
      } else {
        misses += "seed $seed: ${outcome.fail ?: "deadline"}; ${outcome.state}; ${outcome.trace}"
      }
      assertTrue("seed $seed: $outcome", outcome.seeks <= LoggeRythmDjPhaseLock.MAX_SEEKS)
    }
    assertTrue("only $locked/40 locked:\n${misses.joinToString("\n")}", locked >= 36)
  }

  @Test
  fun phaseLockFailsLoudlyWhenSnapshotsKeepFreezing() {
    var noisy = 0
    for (seed in 1L..10L) {
      val outcome = simulateLock(seed, startErrorMs = 60.0, stallsPerSec = 40.0)
      if (outcome.locked) {
        assertTrue("seed $seed locked off target: $outcome", abs(outcome.trueErrorMs) <= 8.0)
      } else if (outcome.fail?.startsWith("timing-too-noisy") == true) {
        assertTrue(outcome.fail, outcome.fail.contains("stalls"))
        noisy += 1
      }
    }
    assertTrue("only $noisy/10 failed as timing-too-noisy", noisy >= 8)
  }

  @Test
  fun phaseLockFailsWhenTheLeaderKeepsStalling() {
    val outcome = simulateLock(
      3L, startErrorMs = 10.0, stallsPerSec = 0.0,
      leaderInterrupts = listOf(400L to 150L, 1_200L to 150L, 2_000L to 150L, 2_800L to 150L),
    )
    assertTrue(outcome.toString(), outcome.fail?.startsWith("leader-stalled") == true)
  }

  /** A rebuffer in the middle of a nudge must not count the paused time as correction. */
  @Test
  fun phaseLockSurvivesALeaderRebufferDuringANudge() {
    for (seed in 1L..20L) {
      val probe = simulateLock(seed, 80.0, stallsPerSec = 0.0)
      val nudgeAt = probe.trace.first().substringBefore(' ').toLong()
      val outcome = simulateLock(seed, 80.0, stallsPerSec = 0.0, leaderInterrupts = listOf(nudgeAt + 200 to 400L))
      val label = "seed $seed (nudge at $nudgeAt): $outcome"
      assertTrue(label, outcome.locked && outcome.fail == null)
      assertTrue(label, abs(outcome.trueErrorMs) <= 8.0)
    }
  }

  /** PRIMARY_LOCK: B may buffer for seconds after the seek; that is no timing noise. */
  @Test
  fun phaseLockWaitsOutASlowFollowerStart() {
    for (seed in 1L..10L) {
      val outcome = simulateLock(seed, 120.0, stallsPerSec = 0.5, budgetMs = 14_000L, followerStartDelayMs = 3_000L)
      val label = "seed $seed: $outcome"
      assertTrue(label, outcome.locked && outcome.fail == null)
      assertTrue(label, abs(outcome.trueErrorMs) <= 8.0)
    }
  }

  /** PRIMARY_LOCK on a streamed MP3: restarts take 600 ms, beyond the lead clamp after one sample. */
  @Test
  fun phaseLockHandlesSlowStreamRestarts() {
    for (seed in 1L..10L) {
      val outcome = simulateLock(
        seed, startErrorMs = 420.0, stallsPerSec = 0.5, budgetMs = 14_000L,
        followerRestartLagMs = 600..600, followerFrameMs = 1152_000.0 / 44_100, initialSeekLeadMs = 250L,
      )
      val label = "seed $seed: $outcome"
      assertTrue(label, outcome.seeks <= LoggeRythmDjPhaseLock.MAX_SEEKS)
      if (outcome.locked) {
        assertTrue(label, abs(outcome.trueErrorMs) <= 8.0)
      } else {
        assertTrue(label, outcome.fail?.startsWith("lock-infeasible") == true)
      }
    }
  }

  @Test
  fun phaseLockFailsWhenTheErrorCannotBeFixedInTime() {
    val outcome = simulateLock(5L, startErrorMs = 250.0, stallsPerSec = 0.0, budgetMs = 1_400L)
    assertTrue(outcome.toString(), outcome.fail?.startsWith("lock-infeasible") == true)
  }

  @Test
  fun clockEnvelopeTakesTheFreshestReadAndCountsStalls() {
    val envelope = LoggeRythmDjClockEnvelope()
    // true offset 1000 ms; reads lag by 0-9 ms (10 ms publish cadence), one frozen stretch
    var position = 0.0
    for (t in 0L..400L step 16) {
      if (t !in 100L..300L) position = 1000.0 + t - (t % 10)
      envelope.add(t, position, 1.0)
    }
    assertEquals(1000.0, envelope.offsetMs(400L)!!, 0.5)
    assertEquals(1, envelope.stalls)
  }

  @Test
  fun clockEnvelopeIgnoresOneOvershootAndUsesTheSlope() {
    val envelope = LoggeRythmDjClockEnvelope()
    for (t in 0L..400L step 20) {
      // 0.9x: position advances 0.9 ms per ms; one read is 30 ms ahead of the truth
      val position = 500.0 + 0.9 * t + if (t == 200L) 30.0 else 0.0
      envelope.add(t, position, 0.9)
    }
    assertEquals(500.0, envelope.offsetMs(400L)!!, 0.5)
  }

  @Test
  fun clockEnvelopeNeedsEnoughFreshReads() {
    val thin = LoggeRythmDjClockEnvelope()
    for (t in listOf(0L, 100L, 200L)) thin.add(t, 1000.0 + t, 1.0)
    assertNull(thin.offsetMs(200L)) // three reads
    val short = LoggeRythmDjClockEnvelope()
    for (t in 0L..150L step 16) short.add(t, 1000.0 + t, 1.0)
    assertNull(short.offsetMs(150L)) // span below MIN_SPAN_MS
    val pruned = LoggeRythmDjClockEnvelope()
    for (t in 0L..400L step 16) pruned.add(t, 1000.0 + t, 1.0)
    assertNull(pruned.offsetMs(400L + LoggeRythmDjClockEnvelope.WINDOW_MS)) // all reads aged out
  }

  @Test
  fun phaseLockWaitsWhileTheFollowerIsNotPlaying() {
    val lock = LoggeRythmDjPhaseLock(initialSeekLeadMs = 80L)
    for (t in 0L until 4_000L step 16) {
      assertEquals(LoggeRythmDjPhaseLock.Action.Wait, lock.step(t, followerPlaying = false, leaderMs = t.toDouble(), followerMs = 0.0, remainingMs = 5_000L))
    }
  }
}
