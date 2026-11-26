package top.logge.loggerythm.player

internal data class LoggeRythmPlaybackSpeedState(
  val speed: Float,
  val pitch: Float,
)

/**
 * Service-side Audio Craft, Crossfade, Visualizer, and Remote Volume control interface owned by
 * [LoggeRythmMediaLibraryService]. Carries no URLs, cookies, or account credentials.
 */
internal interface LoggeRythmAudioCraftServiceControl {
  fun getAudioSessionId(): Int
  fun getEqualizerState(): LoggeRythmEqualizerState
  fun setEqualizerEnabled(enabled: Boolean): LoggeRythmEqualizerState
  fun setEqualizerBandLevel(bandIndex: Int, levelMb: Int): LoggeRythmEqualizerState
  fun setEqualizerBandLevels(levelsMb: List<Int>): LoggeRythmEqualizerState
  fun setEqualizerPreset(presetName: String): LoggeRythmEqualizerState
  fun getBassBoostState(): LoggeRythmBassBoostState
  fun setBassBoost(enabled: Boolean, strength: Int): LoggeRythmBassBoostState
  fun getLoudnessConfig(): LoggeRythmLoudnessState
  fun setLoudnessConfig(enabled: Boolean, preset: String): LoggeRythmLoudnessState
  fun getPlaybackSpeed(): LoggeRythmPlaybackSpeedState
  fun setPlaybackSpeed(speed: Float, pitch: Float): LoggeRythmPlaybackSpeedState
  fun getCrossfadeConfig(): LoggeRythmCrossfadeConfig
  fun setCrossfadeConfig(enabled: Boolean, durationSec: Double): LoggeRythmCrossfadeConfig
  fun getDjTransitionsEnabled(): Boolean
  fun setDjTransitionsEnabled(enabled: Boolean): Boolean
  fun setRemoteVolumeControl(
    active: Boolean,
    currentVolume: Int,
    maxVolume: Int,
    muted: Boolean,
  ): LoggeRythmRemoteVolumeState
  fun getRemoteVolumeState(): LoggeRythmRemoteVolumeState
  fun setVisualizerEnabled(enabled: Boolean): LoggeRythmVisualizerState
  fun getVisualizerState(): LoggeRythmVisualizerState
  fun resetForAccountBoundary()
}

internal object LoggeRythmAudioCraftServiceBridge {
  private val lock = Any()
  private var control: LoggeRythmAudioCraftServiceControl? = null

  fun attach(value: LoggeRythmAudioCraftServiceControl) = synchronized(lock) {
    if (control != null && control !== value) {
      throw LoggeRythmAudioEffectException("audio-craft-service-active")
    }
    control = value
  }

  fun detach(value: LoggeRythmAudioCraftServiceControl) = synchronized(lock) {
    if (control === value) control = null
  }

  fun requireControl(): LoggeRythmAudioCraftServiceControl = synchronized(lock) {
    control ?: throw LoggeRythmAudioEffectException("player-service-unavailable")
  }

  fun resetForAccountBoundaryIfAttached() {
    synchronized(lock) { control }?.resetForAccountBoundary()
  }
}
