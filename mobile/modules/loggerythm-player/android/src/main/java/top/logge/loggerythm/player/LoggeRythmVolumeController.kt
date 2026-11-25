package top.logge.loggerythm.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Build
import androidx.media3.common.DeviceInfo
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import kotlin.math.roundToInt

internal data class LoggeRythmDeviceVolumeState(
  val volume: Double,
  val step: Int,
  val maxStep: Int,
  val muted: Boolean,
)

internal data class LoggeRythmRemoteVolumeState(
  val active: Boolean,
  val currentVolume: Int,
  val maxVolume: Int,
  val muted: Boolean,
  val normalizedVolume: Double,
)

internal data class LoggeRythmRemoteVolumeChangeEvent(
  val volume: Int,
  val maxVolume: Int,
  val normalizedVolume: Double,
  val muted: Boolean,
  val direction: String,
)

/** Pure, JVM-testable volume normalization and hardware rocker step math. */
internal object LoggeRythmVolumeMath {
  fun normalizeStep(step: Int, maxStep: Int): Double {
    if (maxStep <= 0) return 0.0
    return (step.coerceIn(0, maxStep).toDouble() / maxStep.toDouble()).coerceIn(0.0, 1.0)
  }

  fun normalizedToStep(volume: Double, maxStep: Int): Int {
    if (!volume.isFinite() || volume < 0.0 || volume > 1.0) {
      throw PlayerProtocolException("volume-invalid")
    }
    if (maxStep <= 0) throw PlayerProtocolException("device-volume-unavailable")
    return (volume * maxStep.toDouble()).roundToInt().coerceIn(0, maxStep)
  }

  fun validateRemoteConfig(
    active: Boolean,
    currentVolume: Int,
    maxVolume: Int,
    muted: Boolean,
  ): LoggeRythmRemoteVolumeState {
    if (maxVolume < 1 || maxVolume > MAX_REMOTE_VOLUME_STEPS) {
      throw PlayerProtocolException("remote-volume-max-invalid")
    }
    if (currentVolume !in 0..maxVolume) {
      throw PlayerProtocolException("remote-volume-value-invalid")
    }
    return LoggeRythmRemoteVolumeState(
      active = active,
      currentVolume = currentVolume,
      maxVolume = maxVolume,
      muted = muted,
      normalizedVolume = normalizeStep(currentVolume, maxVolume),
    )
  }

  const val MAX_REMOTE_VOLUME_STEPS = 100
}

/** Reads/writes `AudioManager.STREAM_MUSIC` and observes system volume changes. */
internal class LoggeRythmDeviceVolumeController(
  private val context: Context,
  private val onVolumeChanged: (LoggeRythmDeviceVolumeState) -> Unit,
) {
  private val appContext = context.applicationContext
  private var receiverRegistered = false
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val action = intent?.action ?: return
      if (action == ACTION_VOLUME_CHANGED) {
        val streamType = intent.getIntExtra(EXTRA_VOLUME_STREAM_TYPE, -1)
        if (streamType != AudioManager.STREAM_MUSIC) return
      }
      runCatching { getVolume() }.onSuccess(onVolumeChanged)
    }
  }

  fun getVolume(): LoggeRythmDeviceVolumeState {
    val manager = requireAudioManager()
    val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val current = manager.getStreamVolume(AudioManager.STREAM_MUSIC)
    val muted = manager.isStreamMute(AudioManager.STREAM_MUSIC) || current == 0
    return LoggeRythmDeviceVolumeState(
      volume = LoggeRythmVolumeMath.normalizeStep(current, max),
      step = current,
      maxStep = max,
      muted = muted,
    )
  }

  fun setVolume(volume: Double, muted: Boolean?): LoggeRythmDeviceVolumeState {
    val manager = requireAudioManager()
    val max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val targetStep = LoggeRythmVolumeMath.normalizedToStep(volume, max)
    if (muted == true) {
      manager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0)
    } else {
      if (muted == false && manager.isStreamMute(AudioManager.STREAM_MUSIC)) {
        manager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0)
      }
      manager.setStreamVolume(AudioManager.STREAM_MUSIC, targetStep, 0)
    }
    return getVolume()
  }

  fun startObserving() {
    if (receiverRegistered) return
    val filter = IntentFilter().apply {
      addAction(ACTION_VOLUME_CHANGED)
      addAction(AudioManager.ACTION_SPEAKERPHONE_STATE_CHANGED)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        addAction(ACTION_STREAM_MUTE_CHANGED)
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      appContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      appContext.registerReceiver(receiver, filter)
    }
    receiverRegistered = true
  }

  fun stopObserving() {
    if (!receiverRegistered) return
    receiverRegistered = false
    runCatching { appContext.unregisterReceiver(receiver) }
  }

  private fun requireAudioManager(): AudioManager =
    appContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      ?: throw PlayerProtocolException("device-volume-unavailable")

  companion object {
    private const val ACTION_VOLUME_CHANGED = "android.media.VOLUME_CHANGED_ACTION"
    private const val ACTION_STREAM_MUTE_CHANGED = "android.media.STREAM_MUTE_CHANGED_ACTION"
    private const val EXTRA_VOLUME_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
  }
}

/**
 * In-process remote volume event bridge from [LoggeRythmSessionPlayer] (inside
 * `LoggeRythmMediaLibraryService`) to [LoggeRythmPlayerModule] (React Native JS).
 */
internal object LoggeRythmRemoteVolumeEventBridge {
  private val lock = Any()
  private var listener: ((LoggeRythmRemoteVolumeChangeEvent) -> Unit)? = null

  fun attach(callback: (LoggeRythmRemoteVolumeChangeEvent) -> Unit) = synchronized(lock) {
    listener = callback
  }

  fun detach(callback: (LoggeRythmRemoteVolumeChangeEvent) -> Unit) = synchronized(lock) {
    if (listener === callback) listener = null
  }

  fun emit(event: LoggeRythmRemoteVolumeChangeEvent) {
    synchronized(lock) { listener }?.invoke(event)
  }
}

/**
 * Media3 [ForwardingPlayer] wrapper that switches the `MediaLibrarySession` between local
 * playback volume and remote `VolumeProvider` mode (`DeviceInfo.PLAYBACK_TYPE_REMOTE`).
 *
 * When remote volume control is active (e.g. controlling Web or Android TV via Connect), Android
 * routes hardware volume rockers — even with the phone locked in a pocket — straight to this
 * player, emitting [LoggeRythmRemoteVolumeChangeEvent] back to JavaScript.
 */
@UnstableApi
internal class LoggeRythmSessionPlayer(
  delegate: ExoPlayer,
  private val onRemoteVolumeChanged: (LoggeRythmRemoteVolumeChangeEvent) -> Unit =
    LoggeRythmRemoteVolumeEventBridge::emit,
) : ForwardingPlayer(delegate) {
  private val listeners = linkedSetOf<Player.Listener>()
  private var remoteState = LoggeRythmRemoteVolumeState(
    active = false,
    currentVolume = 50,
    maxVolume = 100,
    muted = false,
    normalizedVolume = 0.5,
  )

  fun remoteVolumeState(): LoggeRythmRemoteVolumeState = remoteState

  fun setRemoteVolumeControl(
    active: Boolean,
    currentVolume: Int,
    maxVolume: Int,
    muted: Boolean = false,
  ): LoggeRythmRemoteVolumeState {
    val validated = LoggeRythmVolumeMath.validateRemoteConfig(
      active = active,
      currentVolume = currentVolume,
      maxVolume = maxVolume,
      muted = muted,
    )
    val wasActive = remoteState.active
    val previousMax = remoteState.maxVolume
    remoteState = validated
    val snapshotListeners = listeners.toList()
    if (wasActive != validated.active || previousMax != validated.maxVolume) {
      val info = deviceInfo
      val available = availableCommands
      snapshotListeners.forEach { listener ->
        listener.onDeviceInfoChanged(info)
        listener.onAvailableCommandsChanged(available)
      }
    }
    snapshotListeners.forEach { listener ->
      listener.onDeviceVolumeChanged(deviceVolume, isDeviceMuted)
    }
    return validated
  }

  override fun addListener(listener: Player.Listener) {
    listeners.add(listener)
    super.addListener(listener)
  }

  override fun removeListener(listener: Player.Listener) {
    listeners.remove(listener)
    super.removeListener(listener)
  }

  override fun getAvailableCommands(): Player.Commands {
    val base = super.getAvailableCommands()
    if (!remoteState.active) return base
    return base.buildUpon()
      .add(Player.COMMAND_GET_DEVICE_VOLUME)
      .add(Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS)
      .add(Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS)
      .build()
  }

  override fun isCommandAvailable(command: Int): Boolean {
    if (
      remoteState.active && (
        command == Player.COMMAND_GET_DEVICE_VOLUME ||
          command == Player.COMMAND_SET_DEVICE_VOLUME_WITH_FLAGS ||
          command == Player.COMMAND_ADJUST_DEVICE_VOLUME_WITH_FLAGS
        )
    ) {
      return true
    }
    return super.isCommandAvailable(command)
  }

  override fun getDeviceInfo(): DeviceInfo {
    if (!remoteState.active) return super.getDeviceInfo()
    return DeviceInfo.Builder(DeviceInfo.PLAYBACK_TYPE_REMOTE)
      .setMinVolume(0)
      .setMaxVolume(remoteState.maxVolume)
      .build()
  }

  override fun getDeviceVolume(): Int =
    if (remoteState.active) remoteState.currentVolume else super.getDeviceVolume()

  override fun isDeviceMuted(): Boolean =
    if (remoteState.active) remoteState.muted else super.isDeviceMuted()

  @Deprecated("Deprecated in Media3 Player")
  override fun setDeviceVolume(volume: Int) {
    if (remoteState.active) applyRemoteVolume(volume, remoteState.muted, "set")
    else @Suppress("DEPRECATION") super.setDeviceVolume(volume)
  }

  override fun setDeviceVolume(volume: Int, flags: Int) {
    if (remoteState.active) applyRemoteVolume(volume, remoteState.muted, "set")
    else super.setDeviceVolume(volume, flags)
  }

  @Deprecated("Deprecated in Media3 Player")
  override fun increaseDeviceVolume() {
    if (remoteState.active) {
      applyRemoteVolume(remoteState.currentVolume + 1, false, "up")
    } else {
      @Suppress("DEPRECATION") super.increaseDeviceVolume()
    }
  }

  override fun increaseDeviceVolume(flags: Int) {
    if (remoteState.active) {
      applyRemoteVolume(remoteState.currentVolume + 1, false, "up")
    } else {
      super.increaseDeviceVolume(flags)
    }
  }

  @Deprecated("Deprecated in Media3 Player")
  override fun decreaseDeviceVolume() {
    if (remoteState.active) {
      applyRemoteVolume(remoteState.currentVolume - 1, remoteState.muted, "down")
    } else {
      @Suppress("DEPRECATION") super.decreaseDeviceVolume()
    }
  }

  override fun decreaseDeviceVolume(flags: Int) {
    if (remoteState.active) {
      applyRemoteVolume(remoteState.currentVolume - 1, remoteState.muted, "down")
    } else {
      super.decreaseDeviceVolume(flags)
    }
  }

  @Deprecated("Deprecated in Media3 Player")
  override fun setDeviceMuted(muted: Boolean) {
    if (remoteState.active) applyRemoteVolume(remoteState.currentVolume, muted, if (muted) "mute" else "unmute")
    else @Suppress("DEPRECATION") super.setDeviceMuted(muted)
  }

  override fun setDeviceMuted(muted: Boolean, flags: Int) {
    if (remoteState.active) applyRemoteVolume(remoteState.currentVolume, muted, if (muted) "mute" else "unmute")
    else super.setDeviceMuted(muted, flags)
  }

  private fun applyRemoteVolume(targetVolume: Int, muted: Boolean, direction: String) {
    val clamped = targetVolume.coerceIn(0, remoteState.maxVolume)
    val next = remoteState.copy(
      currentVolume = clamped,
      muted = muted,
      normalizedVolume = LoggeRythmVolumeMath.normalizeStep(clamped, remoteState.maxVolume),
    )
    remoteState = next
    listeners.toList().forEach { listener ->
      listener.onDeviceVolumeChanged(next.currentVolume, next.muted)
    }
    onRemoteVolumeChanged(
      LoggeRythmRemoteVolumeChangeEvent(
        volume = next.currentVolume,
        maxVolume = next.maxVolume,
        normalizedVolume = next.normalizedVolume,
        muted = next.muted,
        direction = direction,
      ),
    )
  }
}
