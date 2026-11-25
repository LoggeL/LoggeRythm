package top.logge.loggerythm.player

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.audiofx.Visualizer
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

internal class LoggeRythmVisualizerException(
  val code: String,
  message: String = code,
  cause: Throwable? = null,
) : IllegalStateException(message, cause)

internal data class LoggeRythmVisualizerFrame(
  val bands: FloatArray,
  val bass: Float,
  val mid: Float,
  val treble: Float,
  val rms: Float,
  val peak: Float,
  val timestampMs: Long,
) {
  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (other !is LoggeRythmVisualizerFrame) return false
    return bands.contentEquals(other.bands) &&
      bass == other.bass &&
      mid == other.mid &&
      treble == other.treble &&
      rms == other.rms &&
      peak == other.peak &&
      timestampMs == other.timestampMs
  }

  override fun hashCode(): Int {
    var result = bands.contentHashCode()
    result = 31 * result + bass.hashCode()
    result = 31 * result + mid.hashCode()
    result = 31 * result + treble.hashCode()
    result = 31 * result + rms.hashCode()
    result = 31 * result + peak.hashCode()
    result = 31 * result + timestampMs.hashCode()
    return result
  }
}

internal data class LoggeRythmVisualizerState(
  val enabled: Boolean,
  val bandCount: Int,
  val audioSessionId: Int,
  val captureSize: Int,
  val samplingRateMilliHz: Int,
)

/**
 * Pure, JVM-testable FFT processor converting Android `Visualizer.OnDataCaptureListener.onFftDataCapture`
 * packed bytes (`[DC, Nyquist, Re(1), Im(1), ...]`) into 28 logarithmically-spaced normalized
 * frequency bands plus bass/mid/treble/RMS/peak energy values.
 */
internal class LoggeRythmVisualizerFftProcessor(
  val bandCount: Int = DEFAULT_BAND_COUNT,
  private val minEmitIntervalMs: Long = DEFAULT_MIN_EMIT_INTERVAL_MS,
  private val attackFactor: Float = 0.65f,
  private val decayFactor: Float = 0.28f,
) {
  init {
    require(bandCount in MIN_BAND_COUNT..MAX_BAND_COUNT) { "visualizer-band-count-invalid" }
    require(minEmitIntervalMs >= 0L) { "visualizer-throttle-invalid" }
  }

  private val smoothedBands = FloatArray(bandCount)
  private var lastEmitElapsedMs = Long.MIN_VALUE

  fun reset() {
    smoothedBands.fill(0f)
    lastEmitElapsedMs = Long.MIN_VALUE
  }

  /**
   * Returns a processed frame if [elapsedRealtimeMs] passes the throttle interval, or `null` if
   * throttled. Throws [LoggeRythmVisualizerException] on malformed/empty FFT input.
   */
  fun processFft(
    fft: ByteArray,
    samplingRateMilliHz: Int,
    elapsedRealtimeMs: Long,
    wallTimestampMs: Long = elapsedRealtimeMs,
  ): LoggeRythmVisualizerFrame? {
    if (fft.size < 4 || fft.size % 2 != 0) {
      throw LoggeRythmVisualizerException("visualizer-fft-payload-invalid")
    }
    if (
      lastEmitElapsedMs != Long.MIN_VALUE &&
      elapsedRealtimeMs - lastEmitElapsedMs < minEmitIntervalMs
    ) {
      return null
    }
    lastEmitElapsedMs = elapsedRealtimeMs

    val binCount = fft.size / 2
    val sampleRateHz = if (samplingRateMilliHz > 0) {
      samplingRateMilliHz / 1_000.0
    } else {
      DEFAULT_SAMPLE_RATE_HZ
    }
    val nyquistHz = (sampleRateHz / 2.0).coerceAtLeast(1_000.0)
    val binWidthHz = nyquistHz / binCount.toDouble()

    // Extract normalized magnitudes in [0, 1] per FFT bin using log dB scaling.
    val magnitudes = FloatArray(binCount)
    magnitudes[0] = normalizeMagnitude(kotlin.math.abs(fft[0].toDouble()))
    for (k in 1 until binCount) {
      val real = fft[2 * k].toDouble()
      val imag = fft[2 * k + 1].toDouble()
      magnitudes[k] = normalizeMagnitude(hypot(real, imag))
    }

    // Group FFT bins into `bandCount` logarithmic bands from 40 Hz up to min(16 kHz, nyquist).
    val minFreq = 40.0
    val maxFreq = nyquistHz.coerceAtMost(16_000.0)
    val logMin = ln(minFreq)
    val logMax = ln(maxFreq.coerceAtLeast(minFreq * 2.0))

    val rawBands = FloatArray(bandCount)
    for (bandIndex in 0 until bandCount) {
      val f0 = kotlin.math.exp(logMin + (logMax - logMin) * (bandIndex.toDouble() / bandCount))
      val f1 = kotlin.math.exp(logMin + (logMax - logMin) * ((bandIndex + 1).toDouble() / bandCount))
      val startBin = (f0 / binWidthHz).toInt().coerceIn(1, binCount - 1)
      val endBin = (f1 / binWidthHz).roundToInt().coerceIn(startBin, binCount - 1)
      var acc = 0f
      var bandPeak = 0f
      var count = 0
      for (bin in startBin..endBin) {
        val m = magnitudes[bin]
        acc += m
        if (m > bandPeak) bandPeak = m
        count += 1
      }
      rawBands[bandIndex] = if (count > 0) {
        max(acc / count, bandPeak * 0.75f).coerceIn(0f, 1f)
      } else {
        0f
      }
    }

    var sumSq = 0.0
    var peak = 0f
    val outBands = FloatArray(bandCount)
    for (index in 0 until bandCount) {
      val target = rawBands[index]
      val prev = smoothedBands[index]
      val alpha = if (target >= prev) attackFactor else decayFactor
      val smoothed = (prev + alpha * (target - prev)).coerceIn(0f, 1f)
      smoothedBands[index] = smoothed
      outBands[index] = smoothed
      sumSq += smoothed * smoothed
      if (smoothed > peak) peak = smoothed
    }

    val bass = bandRangeAverage(magnitudes, binWidthHz, 20.0, 250.0)
    val mid = bandRangeAverage(magnitudes, binWidthHz, 250.0, 2_500.0)
    val treble = bandRangeAverage(magnitudes, binWidthHz, 2_500.0, maxFreq)
    val rms = sqrt(sumSq / bandCount.toDouble()).toFloat().coerceIn(0f, 1f)

    return LoggeRythmVisualizerFrame(
      bands = outBands,
      bass = bass,
      mid = mid,
      treble = treble,
      rms = rms,
      peak = peak,
      timestampMs = wallTimestampMs,
    )
  }

  private fun normalizeMagnitude(magnitude: Double): Float {
    // Android Visualizer bytes are signed 8-bit (-128..127), so max hypot is ~181.
    if (magnitude <= 0.5) return 0f
    val db = 20.0 * log10(magnitude / 128.0)
    // Map -48 dB .. 0 dB onto 0 .. 1 with slight perceptual curve.
    val linear = ((db + 48.0) / 48.0).coerceIn(0.0, 1.0)
    return linear.pow(1.15).toFloat().coerceIn(0f, 1f)
  }

  private fun bandRangeAverage(
    magnitudes: FloatArray,
    binWidthHz: Double,
    lowHz: Double,
    highHz: Double,
  ): Float {
    val maxBin = magnitudes.size - 1
    if (maxBin < 1) return 0f
    val start = (lowHz / binWidthHz).toInt().coerceIn(1, maxBin)
    val end = (highHz / binWidthHz).roundToInt().coerceIn(start, maxBin)
    var total = 0f
    var peakInRange = 0f
    var count = 0
    for (bin in start..end) {
      val v = magnitudes[bin]
      total += v
      if (v > peakInRange) peakInRange = v
      count += 1
    }
    if (count == 0) return 0f
    val mean = total / count
    return max(mean, peakInRange * 0.65f).coerceIn(0f, 1f)
  }

  companion object {
    const val DEFAULT_BAND_COUNT = 28
    const val MIN_BAND_COUNT = 16
    const val MAX_BAND_COUNT = 64
    const val DEFAULT_MIN_EMIT_INTERVAL_MS = 33L
    private const val DEFAULT_SAMPLE_RATE_HZ = 44_100.0
  }
}

/** In-process frame bridge from the MediaLibraryService visualizer to React Native JS. */
internal object LoggeRythmVisualizerEventBridge {
  private val lock = Any()
  private var listener: ((LoggeRythmVisualizerFrame) -> Unit)? = null

  fun attach(callback: (LoggeRythmVisualizerFrame) -> Unit) = synchronized(lock) {
    listener = callback
  }

  fun detach(callback: (LoggeRythmVisualizerFrame) -> Unit) = synchronized(lock) {
    if (listener === callback) listener = null
  }

  fun emit(frame: LoggeRythmVisualizerFrame) {
    synchronized(lock) { listener }?.invoke(frame)
  }
}

/**
 * Opt-in Android `Visualizer` FFT engine attached to ExoPlayer's `audioSessionId`.
 *
 * Strictly fail-loud:
 * - Missing `RECORD_AUDIO` permission -> throws `visualizer-permission-denied`
 * - Invalid/unset `audioSessionId` -> throws `visualizer-session-unavailable`
 * - Hardware/OS creation or enable failure -> throws `visualizer-init-failed` / `visualizer-unsupported`
 * Never silently returns zero frames pretending capture succeeded.
 */
@OptIn(UnstableApi::class)
internal class LoggeRythmAudioVisualizerController(
  private val context: Context,
  private val onFrame: (LoggeRythmVisualizerFrame) -> Unit = LoggeRythmVisualizerEventBridge::emit,
  private val hasRecordAudioPermission: () -> Boolean = {
    ContextCompat.checkSelfPermission(
      context.applicationContext,
      Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED
  },
) {
  private val processor = LoggeRythmVisualizerFftProcessor()
  private var audioSessionId: Int = C.AUDIO_SESSION_ID_UNSET
  private var visualizer: Visualizer? = null
  private var enabled: Boolean = false
  private var activeCaptureSize: Int = 0
  private var activeSamplingRateMilliHz: Int = 0

  fun state(): LoggeRythmVisualizerState = LoggeRythmVisualizerState(
    enabled = enabled,
    bandCount = processor.bandCount,
    audioSessionId = audioSessionId,
    captureSize = activeCaptureSize,
    samplingRateMilliHz = activeSamplingRateMilliHz,
  )

  fun onAudioSessionIdChanged(newSessionId: Int) {
    if (newSessionId == audioSessionId) return
    val wasEnabled = enabled
    teardownVisualizer()
    audioSessionId = newSessionId
    if (wasEnabled && newSessionId > 0 && newSessionId != C.AUDIO_SESSION_ID_UNSET) {
      try {
        startInternal()
      } catch (error: Throwable) {
        enabled = false
        Log.e(
          VISUALIZER_TAG,
          "Visualizer re-attach failed for session=$newSessionId (${error.javaClass.simpleName})",
        )
      }
    }
  }

  fun setEnabled(enable: Boolean): LoggeRythmVisualizerState {
    if (!enable) {
      teardownVisualizer()
      enabled = false
      processor.reset()
      return state()
    }
    if (enabled && visualizer != null) {
      return state()
    }
    startInternal()
    return state()
  }

  fun release() {
    teardownVisualizer()
    enabled = false
    audioSessionId = C.AUDIO_SESSION_ID_UNSET
    processor.reset()
  }

  private fun startInternal() {
    if (!hasRecordAudioPermission()) {
      throw LoggeRythmVisualizerException(
        "visualizer-permission-denied",
        "RECORD_AUDIO permission is required to start the audio visualizer",
      )
    }
    val sessionId = audioSessionId
    if (sessionId <= 0 || sessionId == C.AUDIO_SESSION_ID_UNSET) {
      throw LoggeRythmVisualizerException(
        "visualizer-session-unavailable",
        "Audio session is not initialized for visualizer capture",
      )
    }
    val created = try {
      Visualizer(sessionId)
    } catch (error: UnsupportedOperationException) {
      throw LoggeRythmVisualizerException("visualizer-unsupported", cause = error)
    } catch (error: Throwable) {
      throw LoggeRythmVisualizerException("visualizer-init-failed", cause = error)
    }

    try {
      val range = Visualizer.getCaptureSizeRange()
      val minSize = range[0]
      val maxSize = range[1]
      val preferred = 512.coerceIn(minSize, maxSize)
      val sizeResult = created.setCaptureSize(preferred)
      if (sizeResult != Visualizer.SUCCESS) {
        throw LoggeRythmVisualizerException("visualizer-capture-size-failed")
      }
      val maxRate = Visualizer.getMaxCaptureRate()
      val captureRate = maxRate.coerceAtMost(20_000) // ~20 Hz hardware callback, throttled to <= 30fps
      val listenerResult = created.setDataCaptureListener(
        object : Visualizer.OnDataCaptureListener {
          override fun onWaveFormDataCapture(
            visualizer: Visualizer?,
            waveform: ByteArray?,
            samplingRate: Int,
          ) = Unit

          override fun onFftDataCapture(
            visualizer: Visualizer?,
            fft: ByteArray?,
            samplingRate: Int,
          ) {
            if (fft == null || fft.size < 4) return
            val frame = processor.processFft(
              fft = fft,
              samplingRateMilliHz = samplingRate,
              elapsedRealtimeMs = SystemClock.elapsedRealtime(),
              wallTimestampMs = System.currentTimeMillis(),
            ) ?: return
            onFrame(frame)
          }
        },
        captureRate,
        /* waveform = */ false,
        /* fft = */ true,
      )
      if (listenerResult != Visualizer.SUCCESS) {
        throw LoggeRythmVisualizerException("visualizer-listener-failed")
      }
      val enableResult = created.setEnabled(true)
      if (enableResult != Visualizer.SUCCESS) {
        throw LoggeRythmVisualizerException("visualizer-enable-failed")
      }
      visualizer = created
      activeCaptureSize = created.captureSize
      activeSamplingRateMilliHz = created.samplingRate
      enabled = true
    } catch (error: Throwable) {
      runCatching { created.enabled = false }
      runCatching { created.release() }
      if (error is LoggeRythmVisualizerException) throw error
      throw LoggeRythmVisualizerException("visualizer-init-failed", cause = error)
    }
  }

  private fun teardownVisualizer() {
    visualizer?.let { instance ->
      runCatching { instance.setDataCaptureListener(null, 0, false, false) }
      runCatching { instance.enabled = false }
      runCatching { instance.release() }
    }
    visualizer = null
    activeCaptureSize = 0
    activeSamplingRateMilliHz = 0
  }

  private companion object {
    const val VISUALIZER_TAG = "LoggeRythmVisualizer"
  }
}
