package top.logge.loggerythm.player

import android.content.ContextWrapper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class LoggeRythmAudioVisualizerTest {
  @Test
  fun fftProcessorProducesNormalizedBandsSpectralEnergyAndEnforcesThrottling() {
    val processor = LoggeRythmVisualizerFftProcessor(
      bandCount = 28,
      minEmitIntervalMs = 33L,
      attackFactor = 1.0f,
      decayFactor = 0.5f,
    )

    // Synthetic 256-bin (512-byte) FFT with strong low-frequency bass bin (bin 2 ~= 172 Hz @ 44.1kHz)
    val bassFft = ByteArray(512)
    bassFft[4] = 100 // Re(2)
    bassFft[5] = 40  // Im(2)

    val first = processor.processFft(bassFft, 44_100_000, elapsedRealtimeMs = 1_000L)
    assertNotNull(first)
    assertEquals(28, first!!.bands.size)
    assertTrue(first.bands.all { it in 0f..1f })
    assertTrue("Expected strong bass energy", first.bass > 0.5f)
    assertTrue("Expected bass > treble on bass tone", first.bass > first.treble)
    assertTrue(first.rms > 0f)
    assertTrue(first.peak > 0.5f)

    // Throttled within 33ms
    val throttled = processor.processFft(bassFft, 44_100_000, elapsedRealtimeMs = 1_015L)
    assertNull(throttled)

    // High-frequency treble tone (bin 100 ~= 8.6 kHz @ 44.1kHz)
    val trebleFft = ByteArray(512)
    trebleFft[200] = 110
    trebleFft[201] = 20
    val second = processor.processFft(trebleFft, 44_100_000, elapsedRealtimeMs = 1_050L)
    assertNotNull(second)
    assertTrue("Expected strong treble energy", second!!.treble > 0.5f)
    assertTrue("Expected treble > bass on treble tone", second.treble > second.bass)

    // Invalid/malformed FFT payload fails loud
    val bad = assertThrows(LoggeRythmVisualizerException::class.java) {
      processor.processFft(ByteArray(3), 44_100_000, elapsedRealtimeMs = 2_000L)
    }
    assertEquals("visualizer-fft-payload-invalid", bad.code)
  }

  @Test
  fun visualizerFailsLoudlyWhenPermissionOrAudioSessionIsMissing() {
    val stubContext = object : ContextWrapper(null) {}

    val noPermission = LoggeRythmAudioVisualizerController(
      context = stubContext,
      hasRecordAudioPermission = { false },
    )
    noPermission.onAudioSessionIdChanged(42)
    val permError = assertThrows(LoggeRythmVisualizerException::class.java) {
      noPermission.setEnabled(true)
    }
    assertEquals("visualizer-permission-denied", permError.code)

    val noSession = LoggeRythmAudioVisualizerController(
      context = stubContext,
      hasRecordAudioPermission = { true },
    )
    val sessionError = assertThrows(LoggeRythmVisualizerException::class.java) {
      noSession.setEnabled(true)
    }
    assertEquals("visualizer-session-unavailable", sessionError.code)
  }
}
