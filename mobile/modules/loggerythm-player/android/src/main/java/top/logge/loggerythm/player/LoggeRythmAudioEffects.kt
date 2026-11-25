package top.logge.loggerythm.player

import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import java.util.Locale
import kotlin.math.abs

internal class LoggeRythmAudioEffectException(
  val code: String,
  message: String = code,
  cause: Throwable? = null,
) : IllegalStateException(message, cause)

internal data class LoggeRythmEqualizerBand(
  val index: Int,
  val centerFreqHz: Int,
  val minFreqHz: Int,
  val maxFreqHz: Int,
  val levelMb: Int,
)

internal data class LoggeRythmEqualizerState(
  val supported: Boolean,
  val audioSessionId: Int,
  val enabled: Boolean,
  val minBandLevelMb: Int,
  val maxBandLevelMb: Int,
  val bands: List<LoggeRythmEqualizerBand>,
  val preset: String,
  val presets: List<String>,
)

internal data class LoggeRythmBassBoostState(
  val supported: Boolean,
  val audioSessionId: Int,
  val enabled: Boolean,
  val strength: Int,
)

internal data class LoggeRythmLoudnessState(
  val enabled: Boolean,
  val preset: String,
  val enhancerAttached: Boolean,
  val currentBoostMb: Int,
  val currentVolumeScale: Float,
  val currentGainDb: Double,
)

/**
 * Curated 5-band equalizer curves (anchor frequencies: 60 Hz, 230 Hz, 910 Hz, 3.6 kHz, 14 kHz)
 * mapped onto any Android hardware band layout by nearest-frequency interpolation.
 */
internal enum class LoggeRythmEqualizerPreset(
  val wireName: String,
  val anchorGainsMb: IntArray,
) {
  FLAT("flat", intArrayOf(0, 0, 0, 0, 0)),
  BASS_BOOST("bass_boost", intArrayOf(500, 350, 0, 0, 100)),
  VOCAL("vocal", intArrayOf(-150, 100, 350, 300, 50)),
  ELECTRONIC("electronic", intArrayOf(450, 200, -100, 250, 450)),
  ROCK("rock", intArrayOf(350, 150, -100, 250, 400)),
  JAZZ("jazz", intArrayOf(250, 100, -150, 200, 300)),
  CLASSICAL("classical", intArrayOf(300, 150, -100, 200, 350)),
  ACOUSTIC("acoustic", intArrayOf(200, 150, 100, 200, 250)),
  LATE_NIGHT("late_night", intArrayOf(-200, 100, 250, 150, -250));

  companion object {
    private val ANCHOR_FREQS_HZ = intArrayOf(60, 230, 910, 3600, 14000)

    fun parse(raw: String): LoggeRythmEqualizerPreset {
      val normalized = raw.trim().lowercase(Locale.ROOT).replace('-', '_').replace(' ', '_')
      return entries.firstOrNull { it.wireName == normalized }
        ?: throw LoggeRythmAudioEffectException("equalizer-preset-invalid")
    }

    fun allWireNames(): List<String> = entries.map { it.wireName }

    fun mapToBandLevelsMb(
      preset: LoggeRythmEqualizerPreset,
      centerFreqsHz: List<Int>,
      minMb: Int,
      maxMb: Int,
    ): List<Int> = centerFreqsHz.map { freq ->
      var nearestIndex = 0
      var nearestDistance = Int.MAX_VALUE
      for (index in ANCHOR_FREQS_HZ.indices) {
        val distance = abs(freq - ANCHOR_FREQS_HZ[index])
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestIndex = index
        }
      }
      preset.anchorGainsMb[nearestIndex].coerceIn(minMb, maxMb)
    }
  }
}

/**
 * Owns Android native audio effects (`Equalizer`, `BassBoost`, and `LoudnessEnhancer`) attached
 * to ExoPlayer's `audioSessionId`.
 *
 * Strictly fail-loud: operations against an uninitialized session or unsupported hardware throw
 * [LoggeRythmAudioEffectException] instead of silently faking success.
 */
@OptIn(UnstableApi::class)
internal class LoggeRythmAudioEffectsController {
  private var audioSessionId: Int = C.AUDIO_SESSION_ID_UNSET
  private var equalizer: Equalizer? = null
  private var bassBoost: BassBoost? = null
  private var loudnessEnhancer: LoudnessEnhancer? = null

  private var eqEnabled: Boolean = false
  private var eqPreset: String = LoggeRythmEqualizerPreset.FLAT.wireName
  private var desiredBandLevelsMb: MutableList<Int> = mutableListOf()

  private var bassBoostEnabled: Boolean = false
  private var bassBoostStrength: Int = 0

  private var loudnessEnabled: Boolean = true
  private var loudnessPreset: LoggeRythmLoudnessPreset = LoggeRythmLoudnessPreset.NORMAL
  private var lastLoudnessPlan: LoggeRythmLoudnessPlan = LoggeRythmLoudnessPlan(
    volumeScale = 1f,
    boostMillibels = 0,
    effectiveGainDb = 0.0,
    rawGainDb = null,
  )

  fun currentAudioSessionId(): Int = audioSessionId

  fun onAudioSessionIdChanged(newSessionId: Int) {
    if (newSessionId == audioSessionId) return
    releaseEffects()
    audioSessionId = newSessionId
    if (newSessionId <= 0 || newSessionId == C.AUDIO_SESSION_ID_UNSET) return
    // Re-attach effects that the user had active before the audio session changed.
    // On failure, log loudly and keep enabled flags truthful so callers never observe enabled=true
    // with a dead null hardware effect handle.
    if (eqEnabled || desiredBandLevelsMb.isNotEmpty()) {
      try {
        attachEqualizerIfNeeded()
      } catch (error: Throwable) {
        eqEnabled = false
        Log.e(TAG, "Equalizer re-attach failed for session=$newSessionId (${error.javaClass.simpleName})")
      }
    }
    if (bassBoostEnabled || bassBoostStrength > 0) {
      try {
        attachBassBoostIfNeeded()
      } catch (error: Throwable) {
        bassBoostEnabled = false
        Log.e(TAG, "BassBoost re-attach failed for session=$newSessionId (${error.javaClass.simpleName})")
      }
    }
    if (loudnessEnabled && lastLoudnessPlan.boostMillibels > 0) {
      try {
        applyLoudnessEnhancer(lastLoudnessPlan.boostMillibels)
      } catch (error: Throwable) {
        Log.e(TAG, "LoudnessEnhancer re-attach failed for session=$newSessionId (${error.javaClass.simpleName})")
      }
    }
  }

  fun getEqualizerState(): LoggeRythmEqualizerState {
    val eq = attachEqualizerIfNeeded()
    return readEqualizerState(eq)
  }

  fun setEqualizerEnabled(enabled: Boolean): LoggeRythmEqualizerState {
    val eq = attachEqualizerIfNeeded()
    val status = eq.setEnabled(enabled)
    if (status != Equalizer.SUCCESS && status != Equalizer.ALREADY_EXISTS) {
      throw LoggeRythmAudioEffectException("equalizer-enable-failed")
    }
    eqEnabled = enabled
    return readEqualizerState(eq)
  }

  fun setEqualizerBandLevel(bandIndex: Int, levelMb: Int): LoggeRythmEqualizerState {
    val eq = attachEqualizerIfNeeded()
    val count = eq.numberOfBands.toInt()
    if (bandIndex !in 0 until count) {
      throw LoggeRythmAudioEffectException("equalizer-band-index-invalid")
    }
    val range = eq.bandLevelRange
    val minMb = range[0].toInt()
    val maxMb = range[1].toInt()
    if (levelMb !in minMb..maxMb) {
      throw LoggeRythmAudioEffectException("equalizer-band-level-invalid")
    }
    eq.setBandLevel(bandIndex.toShort(), levelMb.toShort())
    syncDesiredLevels(eq)
    eqPreset = CUSTOM_PRESET
    return readEqualizerState(eq)
  }

  fun setEqualizerBandLevels(levelsMb: List<Int>): LoggeRythmEqualizerState {
    val eq = attachEqualizerIfNeeded()
    val count = eq.numberOfBands.toInt()
    if (levelsMb.size != count) {
      throw LoggeRythmAudioEffectException("equalizer-band-count-invalid")
    }
    val range = eq.bandLevelRange
    val minMb = range[0].toInt()
    val maxMb = range[1].toInt()
    levelsMb.forEach { level ->
      if (level !in minMb..maxMb) {
        throw LoggeRythmAudioEffectException("equalizer-band-level-invalid")
      }
    }
    levelsMb.forEachIndexed { index, level ->
      eq.setBandLevel(index.toShort(), level.toShort())
    }
    desiredBandLevelsMb = levelsMb.toMutableList()
    eqPreset = CUSTOM_PRESET
    return readEqualizerState(eq)
  }

  fun setEqualizerPreset(presetName: String): LoggeRythmEqualizerState {
    val parsed = LoggeRythmEqualizerPreset.parse(presetName)
    val eq = attachEqualizerIfNeeded()
    val count = eq.numberOfBands.toInt()
    val range = eq.bandLevelRange
    val minMb = range[0].toInt()
    val maxMb = range[1].toInt()
    val centersHz = List(count) { idx -> eq.getCenterFreq(idx.toShort()) / 1000 }
    val levels = LoggeRythmEqualizerPreset.mapToBandLevelsMb(parsed, centersHz, minMb, maxMb)
    levels.forEachIndexed { idx, level ->
      eq.setBandLevel(idx.toShort(), level.toShort())
    }
    desiredBandLevelsMb = levels.toMutableList()
    eqPreset = parsed.wireName
    return readEqualizerState(eq)
  }

  fun getBassBoostState(): LoggeRythmBassBoostState {
    val boost = attachBassBoostIfNeeded()
    return LoggeRythmBassBoostState(
      supported = boost.strengthSupported,
      audioSessionId = audioSessionId,
      enabled = boost.enabled,
      strength = boost.roundedStrength.toInt(),
    )
  }

  fun setBassBoost(enabled: Boolean, strength: Int): LoggeRythmBassBoostState {
    if (strength !in 0..MAX_BASS_BOOST_STRENGTH) {
      throw LoggeRythmAudioEffectException("bass-boost-strength-invalid")
    }
    val boost = attachBassBoostIfNeeded()
    if (!boost.strengthSupported && strength > 0 && enabled) {
      throw LoggeRythmAudioEffectException("bass-boost-unsupported")
    }
    boost.setStrength(strength.toShort())
    val status = boost.setEnabled(enabled)
    if (status != BassBoost.SUCCESS && status != BassBoost.ALREADY_EXISTS) {
      throw LoggeRythmAudioEffectException("bass-boost-enable-failed")
    }
    bassBoostEnabled = enabled
    bassBoostStrength = strength
    return LoggeRythmBassBoostState(
      supported = boost.strengthSupported,
      audioSessionId = audioSessionId,
      enabled = boost.enabled,
      strength = boost.roundedStrength.toInt(),
    )
  }

  fun getLoudnessState(): LoggeRythmLoudnessState = LoggeRythmLoudnessState(
    enabled = loudnessEnabled,
    preset = loudnessPreset.wireName,
    enhancerAttached = loudnessEnhancer != null,
    currentBoostMb = lastLoudnessPlan.boostMillibels,
    currentVolumeScale = lastLoudnessPlan.volumeScale,
    currentGainDb = lastLoudnessPlan.effectiveGainDb,
  )

  fun setLoudnessConfig(
    enabled: Boolean,
    presetName: String,
    activeExtrasJson: String,
    isSleepFading: Boolean,
  ): Pair<LoggeRythmLoudnessState, Float> {
    val parsedPreset = LoggeRythmLoudnessPreset.parse(presetName)
    loudnessEnabled = enabled
    loudnessPreset = parsedPreset
    val volumeScale = applyTrackLoudness(activeExtrasJson, isSleepFading)
    return getLoudnessState() to volumeScale
  }

  /**
   * Computes and applies the active track's ReplayGain plan. Positive boost is applied via
   * `LoudnessEnhancer`; linear attenuation `[0, 1]` is returned for ExoPlayer `player.volume`.
   */
  fun applyTrackLoudness(extrasJson: String, isSleepFading: Boolean): Float {
    val plan = LoggeRythmLoudnessNormalization.computePlan(
      extrasJson = extrasJson,
      enabled = loudnessEnabled,
      preset = loudnessPreset,
    )
    lastLoudnessPlan = plan
    if (!isSleepFading) {
      applyLoudnessEnhancer(plan.boostMillibels)
    }
    return plan.volumeScale
  }

  fun resetLoudnessBoostForFade() {
    loudnessEnhancer?.let { enhancer ->
      runCatching {
        enhancer.setTargetGain(0)
        enhancer.enabled = false
      }
    }
  }

  fun release() {
    releaseEffects()
    audioSessionId = C.AUDIO_SESSION_ID_UNSET
  }

  private fun requireActiveAudioSessionId(): Int {
    val sessionId = audioSessionId
    if (sessionId <= 0 || sessionId == C.AUDIO_SESSION_ID_UNSET) {
      throw LoggeRythmAudioEffectException("audio-session-unavailable")
    }
    return sessionId
  }

  private fun attachEqualizerIfNeeded(): Equalizer {
    equalizer?.let { return it }
    val sessionId = requireActiveAudioSessionId()
    val created = try {
      Equalizer(0, sessionId)
    } catch (error: Throwable) {
      throw LoggeRythmAudioEffectException("equalizer-init-failed", cause = error)
    }
    val count = created.numberOfBands.toInt()
    val range = created.bandLevelRange
    val minMb = range[0].toInt()
    val maxMb = range[1].toInt()
    if (desiredBandLevelsMb.size == count) {
      desiredBandLevelsMb.forEachIndexed { idx, level ->
        created.setBandLevel(idx.toShort(), level.coerceIn(minMb, maxMb).toShort())
      }
    } else {
      syncDesiredLevels(created)
    }
    created.enabled = eqEnabled
    equalizer = created
    return created
  }

  private fun attachBassBoostIfNeeded(): BassBoost {
    bassBoost?.let { return it }
    val sessionId = requireActiveAudioSessionId()
    val created = try {
      BassBoost(0, sessionId)
    } catch (error: Throwable) {
      throw LoggeRythmAudioEffectException("bass-boost-init-failed", cause = error)
    }
    if (created.strengthSupported) {
      created.setStrength(bassBoostStrength.toShort())
    }
    created.enabled = bassBoostEnabled
    bassBoost = created
    return created
  }

  private fun applyLoudnessEnhancer(boostMillibels: Int) {
    if (boostMillibels <= 0) {
      loudnessEnhancer?.let { enhancer ->
        enhancer.setTargetGain(0)
        enhancer.enabled = false
      }
      return
    }
    val sessionId = audioSessionId
    if (sessionId <= 0 || sessionId == C.AUDIO_SESSION_ID_UNSET) return
    val enhancer = loudnessEnhancer ?: try {
      LoudnessEnhancer(sessionId).also { loudnessEnhancer = it }
    } catch (error: Throwable) {
      throw LoggeRythmAudioEffectException("loudness-enhancer-init-failed", cause = error)
    }
    enhancer.setTargetGain(boostMillibels)
    enhancer.enabled = true
  }

  private fun readEqualizerState(eq: Equalizer): LoggeRythmEqualizerState {
    val count = eq.numberOfBands.toInt()
    val range = eq.bandLevelRange
    val minMb = range[0].toInt()
    val maxMb = range[1].toInt()
    val bands = List(count) { index ->
      val band = index.toShort()
      val freqRange = eq.getBandFreqRange(band)
      LoggeRythmEqualizerBand(
        index = index,
        centerFreqHz = eq.getCenterFreq(band) / 1000,
        minFreqHz = freqRange[0] / 1000,
        maxFreqHz = freqRange[1] / 1000,
        levelMb = eq.getBandLevel(band).toInt(),
      )
    }
    return LoggeRythmEqualizerState(
      supported = count > 0,
      audioSessionId = audioSessionId,
      enabled = eq.enabled,
      minBandLevelMb = minMb,
      maxBandLevelMb = maxMb,
      bands = bands,
      preset = eqPreset,
      presets = LoggeRythmEqualizerPreset.allWireNames(),
    )
  }

  private fun syncDesiredLevels(eq: Equalizer) {
    val count = eq.numberOfBands.toInt()
    desiredBandLevelsMb = MutableList(count) { idx -> eq.getBandLevel(idx.toShort()).toInt() }
  }

  private fun releaseEffects() {
    equalizer?.let { runCatching { it.release() } }
    equalizer = null
    bassBoost?.let { runCatching { it.release() } }
    bassBoost = null
    loudnessEnhancer?.let { runCatching { it.release() } }
    loudnessEnhancer = null
  }

  companion object {
    private const val TAG = "LoggeRythmAudioEffects"
    const val CUSTOM_PRESET = "custom"
    const val MAX_BASS_BOOST_STRENGTH = 1000
    const val MIN_PLAYBACK_SPEED = 0.25f
    const val MAX_PLAYBACK_SPEED = 3.0f
    const val MIN_PLAYBACK_PITCH = 0.5f
    const val MAX_PLAYBACK_PITCH = 2.0f

    fun validatePlaybackParameters(speed: Float, pitch: Float) {
      if (!speed.isFinite() || speed < MIN_PLAYBACK_SPEED || speed > MAX_PLAYBACK_SPEED) {
        throw LoggeRythmAudioEffectException("playback-speed-invalid")
      }
      if (!pitch.isFinite() || pitch < MIN_PLAYBACK_PITCH || pitch > MAX_PLAYBACK_PITCH) {
        throw LoggeRythmAudioEffectException("playback-pitch-invalid")
      }
    }
  }
}
