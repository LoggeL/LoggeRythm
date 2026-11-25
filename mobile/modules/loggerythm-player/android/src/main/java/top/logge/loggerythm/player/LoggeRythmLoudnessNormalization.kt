package top.logge.loggerythm.player

import java.util.Locale
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt
import org.json.JSONObject

internal enum class LoggeRythmLoudnessPreset(
  val wireName: String,
  val offsetDb: Double,
) {
  QUIET("quiet", -3.0),
  NORMAL("normal", 0.0),
  LOUD("loud", 3.0);

  companion object {
    fun parse(raw: String): LoggeRythmLoudnessPreset = when (raw.trim().lowercase(Locale.ROOT)) {
      "quiet", "low" -> QUIET
      "normal", "balanced", "default" -> NORMAL
      "loud", "high" -> LOUD
      else -> throw PlayerProtocolException("loudness-preset-invalid")
    }
  }
}

/**
 * Split gain plan applied across ExoPlayer attenuation (`volumeScale` in `[0, 1]`) and Android's
 * `LoudnessEnhancer` (`boostMillibels` in `0..1200`) so quiet tracks receive true positive
 * ReplayGain lift without clipping.
 */
internal data class LoggeRythmLoudnessPlan(
  val volumeScale: Float,
  val boostMillibels: Int,
  val effectiveGainDb: Double,
  val rawGainDb: Double?,
)

internal object LoggeRythmLoudnessNormalization {
  private const val KEY = "loudnessNormalization"
  private const val GAIN_LINEAR = "gainLinear"
  private const val GAIN_DB = "gainDb"
  private const val PEAK = "peak"
  private const val TRACK_KEY = "track"
  private const val TRACK_GAIN_DB = "loudness_gain_db"
  private const val TRACK_PEAK = "loudness_peak"
  internal const val MAX_BOOST_DB = 12.0
  internal const val MAX_BOOST_MILLIBELS = 1200
  internal const val MIN_GAIN_DB = -30.0

  /** Backwards-compatible linear attenuation helper (clamped to `[0, 1]`). */
  fun gainLinearFromExtras(extrasJson: String): Float {
    if (extrasJson.isBlank() || extrasJson == "{}") return 1f
    val root = try {
      JSONObject(extrasJson)
    } catch (_: Exception) {
      return 1f
    }
    val value = root.opt(KEY)
    val gain = when (value) {
      is JSONObject -> value.optDouble(GAIN_LINEAR, 1.0)
      else -> 1.0
    }
    if (!gain.isFinite()) return 1f
    return gain.coerceIn(0.0, 1.0).toFloat()
  }

  /**
   * Computes a full ReplayGain attenuation + positive `LoudnessEnhancer` boost plan from track
   * extras and user loudness normalization preferences.
   */
  fun computePlan(
    extrasJson: String,
    enabled: Boolean = true,
    preset: LoggeRythmLoudnessPreset = LoggeRythmLoudnessPreset.NORMAL,
  ): LoggeRythmLoudnessPlan {
    if (!enabled) {
      return LoggeRythmLoudnessPlan(
        volumeScale = 1f,
        boostMillibels = 0,
        effectiveGainDb = 0.0,
        rawGainDb = null,
      )
    }
    val parsed = parseMetadata(extrasJson)
    if (parsed == null) {
      return LoggeRythmLoudnessPlan(
        volumeScale = 1f,
        boostMillibels = 0,
        effectiveGainDb = 0.0,
        rawGainDb = null,
      )
    }
    var targetDb = (parsed.gainDb + preset.offsetDb).coerceIn(MIN_GAIN_DB, MAX_BOOST_DB)
    // Peak headroom limiter: never push true peak above 0 dBFS.
    if (parsed.peak != null && parsed.peak > 0.0 && parsed.peak.isFinite()) {
      val maxSafeDb = -20.0 * log10(parsed.peak)
      if (targetDb > maxSafeDb) {
        targetDb = maxSafeDb.coerceIn(MIN_GAIN_DB, MAX_BOOST_DB)
      }
    }
    return if (targetDb <= 0.0) {
      val linear = 10.0.pow(targetDb / 20.0).coerceIn(0.0, 1.0).toFloat()
      LoggeRythmLoudnessPlan(
        volumeScale = linear,
        boostMillibels = 0,
        effectiveGainDb = targetDb,
        rawGainDb = parsed.gainDb,
      )
    } else {
      val boostMb = (targetDb * 100.0).roundToInt().coerceIn(0, MAX_BOOST_MILLIBELS)
      LoggeRythmLoudnessPlan(
        volumeScale = 1f,
        boostMillibels = boostMb,
        effectiveGainDb = boostMb / 100.0,
        rawGainDb = parsed.gainDb,
      )
    }
  }

  private data class ParsedLoudness(val gainDb: Double, val peak: Double?)

  private fun parseMetadata(extrasJson: String): ParsedLoudness? {
    if (extrasJson.isBlank() || extrasJson == "{}") return null
    val root = try {
      JSONObject(extrasJson)
    } catch (_: Exception) {
      return null
    }
    val norm = root.optJSONObject(KEY)
    if (norm != null) {
      val peak = optionalFiniteDouble(norm, PEAK)
      val explicitDb = optionalFiniteDouble(norm, GAIN_DB)
      if (explicitDb != null) {
        return ParsedLoudness(gainDb = explicitDb, peak = peak)
      }
      val linear = optionalFiniteDouble(norm, GAIN_LINEAR)
      if (linear != null && linear > 0.0) {
        val db = 20.0 * (ln(linear) / ln(10.0))
        return ParsedLoudness(gainDb = db, peak = peak)
      }
    }
    val track = root.optJSONObject(TRACK_KEY)
    if (track != null) {
      val trackGainDb = optionalFiniteDouble(track, TRACK_GAIN_DB)
      if (trackGainDb != null) {
        return ParsedLoudness(
          gainDb = trackGainDb,
          peak = optionalFiniteDouble(track, TRACK_PEAK),
        )
      }
    }
    return null
  }

  private fun optionalFiniteDouble(obj: JSONObject, key: String): Double? {
    if (!obj.has(key) || obj.isNull(key)) return null
    val raw = obj.opt(key) as? Number ?: return null
    val value = raw.toDouble()
    return if (value.isFinite()) value else null
  }
}
