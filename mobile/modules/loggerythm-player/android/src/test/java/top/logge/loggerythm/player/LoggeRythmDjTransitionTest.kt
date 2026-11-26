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
      LoggeRythmDjStreamRef("https://music.example", "123", "high"),
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
     "join_out_s":24.19,"a_speed":1.024,"limiter_reduction_db":2.8}
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
  fun nudgeSpeedIsBoundedAndSlowsAFollowerThatIsAhead() {
    assertTrue(LoggeRythmDjPhaseLock.nudgeSpeed(20.0) < 1f)
    assertTrue(LoggeRythmDjPhaseLock.nudgeSpeed(-20.0) > 1f)
    assertEquals(0.97f, LoggeRythmDjPhaseLock.nudgeSpeed(500.0), 1e-6f)
    assertEquals(1.03f, LoggeRythmDjPhaseLock.nudgeSpeed(-500.0), 1e-6f)
  }

  /**
   * Simulated follower: starts 140 ms late, every seek restarts 70 ms late, speed changes take
   * effect 150 ms later. The lock must converge to within a few ms well inside the ~5 s window.
   */
  @Test
  fun phaseLockConvergesFromALateStart() {
    val lock = LoggeRythmDjPhaseLock()
    var error = -140.0
    var appliedSpeed = 1.0
    val pendingSpeeds = ArrayDeque<Pair<Long, Double>>()
    var locked = false
    var t = 0L
    while (t < 5_000L && !locked) {
      while (pendingSpeeds.isNotEmpty() && pendingSpeeds.first().first <= t) {
        appliedSpeed = pendingSpeeds.removeFirst().second
      }
      error += (appliedSpeed - 1.0) * 16.0
      val measured = error + if ((t / 16) % 2 == 0L) 1.0 else -1.0
      when (val action = lock.step(t, followerPlaying = true, errorMs = measured)) {
        is LoggeRythmDjPhaseLock.Action.Seek -> error += action.correctionMs - 70.0
        is LoggeRythmDjPhaseLock.Action.SetSpeed -> pendingSpeeds.addLast(t + 150L to action.speed.toDouble())
        LoggeRythmDjPhaseLock.Action.Locked -> locked = true
        LoggeRythmDjPhaseLock.Action.Wait -> Unit
      }
      t += 16
    }
    assertTrue("did not lock within 5 s (error $error ms)", locked)
    assertTrue("locked with error $error ms", abs(error) <= LoggeRythmDjPhaseLock.HOLD_MS)
    assertEquals(1f, lock.speed)
  }

  @Test
  fun phaseLockWaitsWhileTheFollowerIsNotPlaying() {
    val lock = LoggeRythmDjPhaseLock()
    for (t in 0L until 2_000L step 16) {
      assertEquals(LoggeRythmDjPhaseLock.Action.Wait, lock.step(t, followerPlaying = false, errorMs = 0.0))
    }
  }
}
