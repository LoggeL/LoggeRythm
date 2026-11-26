import * as ReactNative from 'react-native';
import type {
  ArtworkPaletteResult,
  AudioOutputDevice,
  AudioOutputSwitcherResult,
  BassBoostState,
  CrossfadeConfig,
  DeviceVolumeState,
  EqualizerPresetName,
  EqualizerState,
  LoggeRythmPlayerNativeSpec,
  LoudnessConfigState,
  LoudnessPresetName,
  PlaybackSpeedState,
  RemoteVolumeChangeEvent,
  RemoteVolumeState,
  VisualizerFrameEvent,
  VisualizerState,
} from '../../modules/loggerythm-player/src';

export type ArtworkPalette = ArtworkPaletteResult;
export type LoudnessConfig = LoudnessConfigState;
export type LoudnessPreset = LoudnessPresetName;
export type RemoteVolumeControlState = RemoteVolumeState;
export type RemoteVolumeEvent = RemoteVolumeChangeEvent;

export type {
  ArtworkPaletteResult,
  AudioOutputDevice,
  AudioOutputSwitcherResult,
  BassBoostState,
  CrossfadeConfig,
  DeviceVolumeState,
  EqualizerPresetName,
  EqualizerState,
  LoudnessConfigState,
  LoudnessPresetName,
  PlaybackSpeedState,
  RemoteVolumeChangeEvent,
  RemoteVolumeState,
  VisualizerFrameEvent,
  VisualizerState,
};

export const EQUALIZER_PRESET_NAMES: readonly EqualizerPresetName[] = [
  'flat',
  'bass_boost',
  'vocal',
  'electronic',
  'rock',
  'jazz',
  'classical',
  'acoustic',
  'late_night',
] as const;

export const PLAYBACK_SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;
export const LOUDNESS_PRESETS: readonly LoudnessPreset[] = ['quiet', 'normal', 'loud'] as const;

function resolveNativePlayer(): Partial<LoggeRythmPlayerNativeSpec> | null {
  if (!Object.keys(ReactNative).includes('NativeModules')) return null;
  const modules = (ReactNative as { NativeModules?: Record<string, unknown> }).NativeModules;
  const mod = modules?.LoggeRythmPlayer as Partial<LoggeRythmPlayerNativeSpec> | undefined;
  return mod && typeof mod === 'object' ? mod : null;
}

function requireMethod<K extends keyof LoggeRythmPlayerNativeSpec>(
  name: K,
): LoggeRythmPlayerNativeSpec[K] {
  const mod = resolveNativePlayer();
  const fn = mod?.[name];
  if (typeof fn !== 'function') {
    throw new Error(`NativeModules.LoggeRythmPlayer.${String(name)} is not available`);
  }
  return fn.bind(mod) as LoggeRythmPlayerNativeSpec[K];
}

export function isNativeAudioCraftAvailable(): boolean {
  const mod = resolveNativePlayer();
  return typeof mod?.getEqualizerState === 'function';
}

export function isNativeMethodAvailable<K extends keyof LoggeRythmPlayerNativeSpec>(
  name: K,
): boolean {
  const mod = resolveNativePlayer();
  return typeof mod?.[name] === 'function';
}

function createPlayerEventEmitter(): ReactNative.NativeEventEmitter {
  const mod = resolveNativePlayer();
  const EmitterCtor = (
    ReactNative as { NativeEventEmitter?: typeof ReactNative.NativeEventEmitter }
  ).NativeEventEmitter;
  if (!mod || typeof EmitterCtor !== 'function') {
    throw new Error('NativeModules.LoggeRythmPlayer is not available for event subscriptions');
  }
  return new EmitterCtor(mod as never);
}

export function getEqualizerState(): Promise<EqualizerState> {
  return requireMethod('getEqualizerState')();
}

export function setEqualizerEnabled(enabled: boolean): Promise<EqualizerState> {
  return requireMethod('setEqualizerEnabled')(enabled);
}

export function setEqualizerBandLevel(bandIndex: number, levelMb: number): Promise<EqualizerState> {
  return requireMethod('setEqualizerBandLevel')(bandIndex, Math.round(levelMb));
}

export function setEqualizerBandLevels(levelsMb: number[]): Promise<EqualizerState> {
  return requireMethod('setEqualizerBandLevels')(levelsMb.map((value) => Math.round(value)));
}

export function setEqualizerPreset(presetName: EqualizerPresetName): Promise<EqualizerState> {
  return requireMethod('setEqualizerPreset')(presetName);
}

export function getBassBoostState(): Promise<BassBoostState> {
  return requireMethod('getBassBoostState')();
}

export function setBassBoost(enabled: boolean, strength: number): Promise<BassBoostState> {
  const clamped = Math.max(0, Math.min(1000, Math.round(strength)));
  return requireMethod('setBassBoost')(enabled, clamped);
}

export function getLoudnessConfig(): Promise<LoudnessConfig> {
  return requireMethod('getLoudnessConfig')();
}

export function setLoudnessConfig(
  enabled: boolean,
  preset: LoudnessPreset,
): Promise<LoudnessConfig> {
  return requireMethod('setLoudnessConfig')(enabled, preset);
}

export function getPlaybackSpeed(): Promise<PlaybackSpeedState> {
  return requireMethod('getPlaybackSpeed')();
}

export function setPlaybackSpeed(speed: number, pitch = 1.0): Promise<PlaybackSpeedState> {
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 3.0) {
    throw new Error(`Playback speed must be between 0.25 and 3.0, got ${String(speed)}`);
  }
  if (!Number.isFinite(pitch) || pitch < 0.5 || pitch > 2.0) {
    throw new Error(`Playback pitch must be between 0.5 and 2.0, got ${String(pitch)}`);
  }
  return requireMethod('setPlaybackSpeed')(speed, pitch);
}

export function getCrossfadeConfig(): Promise<CrossfadeConfig> {
  return requireMethod('getCrossfadeConfig')();
}

export function setCrossfadeConfig(
  enabled: boolean,
  durationSec: number,
): Promise<CrossfadeConfig> {
  const clamped = Math.max(0, Math.min(12, Math.round(durationSec)));
  return requireMethod('setCrossfadeConfig')(enabled, clamped);
}

export function getDjTransitionsEnabled(): Promise<boolean> {
  return requireMethod('getDjTransitionsEnabled')();
}

export function setDjTransitionsEnabled(enabled: boolean): Promise<boolean> {
  return requireMethod('setDjTransitionsEnabled')(enabled);
}

export function openAudioOutputSwitcher(): Promise<AudioOutputSwitcherResult> {
  return requireMethod('openAudioOutputSwitcher')();
}

export function getAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  return requireMethod('getAudioOutputDevices')();
}

export function getDeviceVolume(): Promise<DeviceVolumeState> {
  return requireMethod('getDeviceVolume')();
}

export function setDeviceVolume(
  volume: number,
  muted: boolean | null = null,
): Promise<DeviceVolumeState> {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error(`Device volume must be between 0 and 1, got ${String(volume)}`);
  }
  return requireMethod('setDeviceVolume')(volume, muted);
}

export function setRemoteVolumeControl(
  active: boolean,
  currentVolume: number,
  maxVolume = 100,
  muted: boolean | null = null,
): Promise<RemoteVolumeControlState> {
  const safeMax = Math.max(1, Math.round(maxVolume));
  const safeCurrent = Math.max(0, Math.min(safeMax, Math.round(currentVolume)));
  return requireMethod('setRemoteVolumeControl')(active, safeCurrent, safeMax, muted);
}

export function extractArtworkPalette(uri: string): Promise<ArtworkPalette> {
  const trimmed = uri.trim();
  if (trimmed.length === 0) {
    return Promise.reject(new Error('Artwork URI must not be empty'));
  }
  return requireMethod('extractArtworkPalette')(trimmed);
}

export function setVisualizerEnabled(enabled: boolean): Promise<VisualizerState> {
  return requireMethod('setVisualizerEnabled')(enabled);
}

export function getVisualizerState(): Promise<VisualizerState> {
  return requireMethod('getVisualizerState')();
}

export function subscribeVisualizerFrames(
  listener: (frame: VisualizerFrameEvent) => void,
): () => void {
  const emitter = createPlayerEventEmitter();
  const subscription = emitter.addListener('LoggeRythmVisualizerFrame', listener);
  return () => {
    subscription.remove();
  };
}

export function subscribeRemoteVolumeEvents(
  listener: (event: RemoteVolumeEvent) => void,
): () => void {
  const emitter = createPlayerEventEmitter();
  const subscription = emitter.addListener('LoggeRythmRemoteVolume', listener);
  return () => {
    subscription.remove();
  };
}

export function subscribeDeviceVolumeEvents(
  listener: (event: DeviceVolumeState) => void,
): () => void {
  const emitter = createPlayerEventEmitter();
  const subscription = emitter.addListener('LoggeRythmDeviceVolume', listener);
  return () => {
    subscription.remove();
  };
}
