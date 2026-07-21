package top.logge.loggerythm.player

import org.json.JSONObject

internal object LoggeRythmLoudnessNormalization {
  private const val KEY = "loudnessNormalization"
  private const val GAIN_LINEAR = "gainLinear"

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
}
