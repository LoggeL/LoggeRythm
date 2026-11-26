package top.logge.loggerythm.player

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmAudioCraftTest {
  @Test
  fun loudnessNormalizationComputesAttenuationPositiveBoostPeakHeadroomAndPresets() {
    // Negative ReplayGain -> volume attenuation, zero boost
    val quietTrack = LoggeRythmLoudnessNormalization.computePlan(
      extrasJson = """{"loudnessNormalization":{"gainDb":-6.0,"peak":0.9}}""",
      enabled = true,
      preset = LoggeRythmLoudnessPreset.NORMAL,
    )
    assertEquals(0.5012f, quietTrack.volumeScale, 0.01f)
    assertEquals(0, quietTrack.boostMillibels)

    // Positive ReplayGain -> full player volume + LoudnessEnhancer positive boost in millibels
    val softTrack = LoggeRythmLoudnessNormalization.computePlan(
      extrasJson = """{"loudnessNormalization":{"gainDb":4.5,"peak":0.4}}""",
      enabled = true,
      preset = LoggeRythmLoudnessPreset.NORMAL,
    )
    assertEquals(1.0f, softTrack.volumeScale, 0.0001f)
    assertEquals(450, softTrack.boostMillibels)

    // Peak headroom limiter prevents clipping when peak is near 0 dBFS
    val nearFullScale = LoggeRythmLoudnessNormalization.computePlan(
      extrasJson = """{"loudnessNormalization":{"gainDb":6.0,"peak":0.89125}}""",
      enabled = true,
      preset = LoggeRythmLoudnessPreset.LOUD,
    )
    // -20*log10(0.89125) ~= +1.0 dB max safe boost
    assertEquals(1.0f, nearFullScale.volumeScale, 0.0001f)
    assertTrue(nearFullScale.boostMillibels in 95..105)

    // Track-level fallback loudness_gain_db works when loudnessNormalization block is omitted
    val fromTrack = LoggeRythmLoudnessNormalization.computePlan(
      extrasJson = """{"track":{"loudness_gain_db":3.0,"loudness_peak":0.5}}""",
      enabled = true,
      preset = LoggeRythmLoudnessPreset.LOUD,
    )
    assertEquals(600, fromTrack.boostMillibels)

    // Disabled loudness returns neutral gain
    val disabled = LoggeRythmLoudnessNormalization.computePlan(
      extrasJson = """{"loudnessNormalization":{"gainDb":5.0}}""",
      enabled = false,
      preset = LoggeRythmLoudnessPreset.LOUD,
    )
    assertEquals(1f, disabled.volumeScale, 0f)
    assertEquals(0, disabled.boostMillibels)

    val badPreset = assertThrows(PlayerProtocolException::class.java) {
      LoggeRythmLoudnessPreset.parse("ear-shattering")
    }
    assertEquals("loudness-preset-invalid", badPreset.code)
  }

  @Test
  fun equalizerPresetsMapAndClampToHardwareBandRangesAndValidatePlaybackSpeed() {
    val centers = listOf(60, 230, 910, 3600, 14000)
    val bassBoost = LoggeRythmEqualizerPreset.mapToBandLevelsMb(
      LoggeRythmEqualizerPreset.BASS_BOOST,
      centers,
      minMb = -1500,
      maxMb = 1500,
    )
    assertEquals(listOf(500, 350, 0, 0, 100), bassBoost)

    val clamped = LoggeRythmEqualizerPreset.mapToBandLevelsMb(
      LoggeRythmEqualizerPreset.BASS_BOOST,
      centers,
      minMb = -300,
      maxMb = 300,
    )
    assertEquals(listOf(300, 300, 0, 0, 100), clamped)

    val badEqPreset = assertThrows(LoggeRythmAudioEffectException::class.java) {
      LoggeRythmEqualizerPreset.parse("nonexistent-preset")
    }
    assertEquals("equalizer-preset-invalid", badEqPreset.code)

    // Playback speed / pitch validation
    LoggeRythmAudioEffectsController.validatePlaybackParameters(1.25f, 1.0f)
    assertEquals(
      "playback-speed-invalid",
      assertThrows(LoggeRythmAudioEffectException::class.java) {
        LoggeRythmAudioEffectsController.validatePlaybackParameters(0.1f, 1.0f)
      }.code,
    )
    assertEquals(
      "playback-pitch-invalid",
      assertThrows(LoggeRythmAudioEffectException::class.java) {
        LoggeRythmAudioEffectsController.validatePlaybackParameters(1.0f, 3.5f)
      }.code,
    )

    // Uninitialized audio session fails loud on effect attach
    val effects = LoggeRythmAudioEffectsController()
    assertEquals(
      "audio-session-unavailable",
      assertThrows(LoggeRythmAudioEffectException::class.java) {
        effects.getEqualizerState()
      }.code,
    )
    assertEquals(
      "bass-boost-strength-invalid",
      assertThrows(LoggeRythmAudioEffectException::class.java) {
        effects.setBassBoost(true, 1500)
      }.code,
    )
  }

  @Test
  fun crossfadePlannerSupportsCuePointsEqualPowerCurveAndGuardsEdgeCases() {
    val config = LoggeRythmCrossfadeConfig.validated(enabled = true, durationSec = 5.0)
    assertTrue(config.enabled)
    assertEquals(5_000L, config.durationMs)

    assertEquals(
      "crossfade-duration-invalid",
      assertThrows(PlayerProtocolException::class.java) {
        LoggeRythmCrossfadeConfig.validated(enabled = true, durationSec = 15.0)
      }.code,
    )

    val cuesOut = LoggeRythmTrackCuePoints.fromExtras(
      """{"crossfade":{"outroStartSec":170.0}}""",
    )
    val cuesIn = LoggeRythmTrackCuePoints.fromExtras(
      """{"crossfade":{"introEndSec":4.5}}""",
    )
    assertEquals(170_000L, cuesOut.outroStartMs)
    assertEquals(4_500L, cuesIn.introEndMs)

    val plan = LoggeRythmCrossfadePlanner.plan(
      config = config,
      outgoingDurationMs = 180_000L,
      outgoingCuePoints = cuesOut,
      incomingDurationMs = 200_000L,
      incomingCuePoints = cuesIn,
      repeatMode = Player.REPEAT_MODE_OFF,
      hasNextItem = true,
      isSleepFading = false,
    )
    assertNotNull(plan)
    assertEquals(170_000L, plan!!.startAtMs)
    assertEquals(168_500L, plan.prepareAtMs)
    assertEquals(5_000L, plan.fadeDurationMs)
    assertEquals(4_500L, plan.incomingStartPositionMs)

    // Disabled on repeat-one, sleep fade, or short tracks
    assertNull(
      LoggeRythmCrossfadePlanner.plan(
        config = config,
        outgoingDurationMs = 180_000L,
        outgoingCuePoints = LoggeRythmTrackCuePoints(),
        incomingDurationMs = 180_000L,
        incomingCuePoints = LoggeRythmTrackCuePoints(),
        repeatMode = Player.REPEAT_MODE_ONE,
        hasNextItem = true,
        isSleepFading = false,
      ),
    )
    assertNull(
      LoggeRythmCrossfadePlanner.plan(
        config = config,
        outgoingDurationMs = 2_000L,
        outgoingCuePoints = LoggeRythmTrackCuePoints(),
        incomingDurationMs = 180_000L,
        incomingCuePoints = LoggeRythmTrackCuePoints(),
        repeatMode = Player.REPEAT_MODE_OFF,
        hasNextItem = true,
        isSleepFading = false,
      ),
    )

    // Equal-power law: out^2 + in^2 == 1.0 across the entire fade
    for (step in 0..10) {
      val progress = step / 10.0
      val outG = LoggeRythmCrossfadeCurve.outgoingGain(progress)
      val inG = LoggeRythmCrossfadeCurve.incomingGain(progress)
      assertEquals(1.0, (outG * outG + inG * inG).toDouble(), 0.001)
    }

    // At 2.0x, the 5s fade and 200ms handoff lead span 10.4s of media time.
    val fastPlan = LoggeRythmCrossfadePlanner.plan(
      config = config,
      outgoingDurationMs = 180_000L,
      outgoingCuePoints = LoggeRythmTrackCuePoints(),
      incomingDurationMs = 200_000L,
      incomingCuePoints = LoggeRythmTrackCuePoints(),
      repeatMode = Player.REPEAT_MODE_OFF,
      hasNextItem = true,
      isSleepFading = false,
      playbackSpeed = 2.0f,
    )
    assertNotNull(fastPlan)
    assertEquals(169_600L, fastPlan!!.startAtMs)
    assertEquals(166_600L, fastPlan.prepareAtMs)
    assertEquals(5_000L, fastPlan.fadeDurationMs)

    // At 0.5x, the fade and handoff lead span 2.6s of media time.
    val slowPlan = LoggeRythmCrossfadePlanner.plan(
      config = config,
      outgoingDurationMs = 180_000L,
      outgoingCuePoints = LoggeRythmTrackCuePoints(),
      incomingDurationMs = 200_000L,
      incomingCuePoints = LoggeRythmTrackCuePoints(),
      repeatMode = Player.REPEAT_MODE_OFF,
      hasNextItem = true,
      isSleepFading = false,
      playbackSpeed = 0.5f,
    )
    assertNotNull(slowPlan)
    assertEquals(177_400L, slowPlan!!.startAtMs)
    assertEquals(176_650L, slowPlan.prepareAtMs)
    assertEquals(5_000L, slowPlan.fadeDurationMs)
  }

  @Test
  fun volumeMathNormalizesAndValidatesRemoteVolumeBoundsStrictly() {
    assertEquals(0.5, LoggeRythmVolumeMath.normalizeStep(50, 100), 0.0001)
    assertEquals(8, LoggeRythmVolumeMath.normalizedToStep(0.5, 15))
    assertEquals(
      "volume-invalid",
      assertThrows(PlayerProtocolException::class.java) {
        LoggeRythmVolumeMath.normalizedToStep(1.5, 15)
      }.code,
    )

    val remote = LoggeRythmVolumeMath.validateRemoteConfig(
      active = true,
      currentVolume = 35,
      maxVolume = 100,
      muted = false,
    )
    assertTrue(remote.active)
    assertFalse(remote.muted)
    assertEquals(0.35, remote.normalizedVolume, 0.0001)

    assertEquals(
      "remote-volume-value-invalid",
      assertThrows(PlayerProtocolException::class.java) {
        LoggeRythmVolumeMath.validateRemoteConfig(true, 105, 100, false)
      }.code,
    )
    assertEquals(
      "remote-volume-max-invalid",
      assertThrows(PlayerProtocolException::class.java) {
        LoggeRythmVolumeMath.validateRemoteConfig(true, 0, 0, false)
      }.code,
    )
  }
}
