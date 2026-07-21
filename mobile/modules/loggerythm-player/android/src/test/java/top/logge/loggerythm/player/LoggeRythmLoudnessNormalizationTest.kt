package top.logge.loggerythm.player

import org.junit.Assert.assertEquals
import org.junit.Test

class LoggeRythmLoudnessNormalizationTest {
  @Test
  fun extractsBoundedLinearGainFromQueueExtras() {
    assertEquals(
      0.5f,
      LoggeRythmLoudnessNormalization.gainLinearFromExtras(
        """{"loudnessNormalization":{"gainLinear":0.5,"gainDb":-6}}""",
      ),
      0.000001f,
    )
  }

  @Test
  fun defaultsToNeutralForMissingMalformedOrBoostingMetadata() {
    assertEquals(1f, LoggeRythmLoudnessNormalization.gainLinearFromExtras("{}"), 0f)
    assertEquals(1f, LoggeRythmLoudnessNormalization.gainLinearFromExtras("not-json"), 0f)
    assertEquals(
      1f,
      LoggeRythmLoudnessNormalization.gainLinearFromExtras(
        """{"loudnessNormalization":{"gainLinear":2}}""",
      ),
      0f,
    )
  }
}
