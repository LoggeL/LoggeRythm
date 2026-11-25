export type HapticStyle = 'light' | 'selection' | 'tick' | 'medium' | 'click' | 'heavy' | 'success' | 'double' | 'confirm' | 'error' | 'reject' | 'warning';

export interface HapticResult {
  performed: boolean;
  style: string;
  reason: string | null;
}

export interface ArtworkPaletteResult {
  vibrant: string | null;
  darkVibrant: string | null;
  muted: string | null;
  darkMuted: string | null;
  dominant: string;
}

export type BrowseContentStyle = 'grid' | 'list';

export type BrowseMediaType =
  | 'mixed'
  | 'music'
  | 'artist'
  | 'album'
  | 'playlist'
  | 'genre'
  | 'radio_station'
  | 'folder_mixed'
  | 'folder_albums'
  | 'folder_artists'
  | 'folder_genres'
  | 'folder_playlists'
  | 'folder_radio_stations';

export interface NativeBrowseNodeHints {
  contentStyleBrowsable?: BrowseContentStyle;
  contentStylePlayable?: BrowseContentStyle;
  mediaType?: BrowseMediaType;
  groupTitle?: string;
}

export interface EqualizerBand {
  index: number;
  centerFreqHz: number;
  minFreqHz: number;
  maxFreqHz: number;
  levelMb: number;
}

export type EqualizerPresetName =
  | 'flat'
  | 'bass_boost'
  | 'vocal'
  | 'electronic'
  | 'rock'
  | 'jazz'
  | 'classical'
  | 'acoustic'
  | 'late_night';

export interface EqualizerState {
  supported: boolean;
  audioSessionId: number;
  enabled: boolean;
  minBandLevelMb: number;
  maxBandLevelMb: number;
  bands: EqualizerBand[];
  preset: EqualizerPresetName | 'custom';
  presets: EqualizerPresetName[];
}

export interface BassBoostState {
  supported: boolean;
  audioSessionId: number;
  enabled: boolean;
  strength: number;
}

export type LoudnessPresetName = 'quiet' | 'normal' | 'loud';

export interface LoudnessConfigState {
  enabled: boolean;
  preset: LoudnessPresetName;
  enhancerAttached: boolean;
  currentBoostMb: number;
  currentVolumeScale: number;
  currentGainDb: number;
}

export interface PlaybackSpeedState {
  speed: number;
  pitch: number;
}

export interface CrossfadeConfig {
  enabled: boolean;
  durationSec: number;
}

export interface AudioOutputSwitcherResult {
  opened: boolean;
  method:
    | 'media-router2-system-switcher'
    | 'settings-media-output-panel'
    | 'systemui-media-output-dialog'
    | 'settings-volume-panel'
    | 'bluetooth-settings';
}

export interface AudioOutputDevice {
  id: string;
  name: string;
  type: 'speaker' | 'wired_headphones' | 'bluetooth' | 'bluetooth_le' | 'usb' | 'hdmi' | 'line_out' | 'tv' | 'remote_speaker' | 'other';
  isActive: boolean;
}

export interface DeviceVolumeState {
  volume: number;
  step: number;
  maxStep: number;
  muted: boolean;
}

export interface RemoteVolumeState {
  active: boolean;
  currentVolume: number;
  maxVolume: number;
  muted: boolean;
  normalizedVolume: number;
}

export interface RemoteVolumeChangeEvent {
  volume: number;
  maxVolume: number;
  normalizedVolume: number;
  muted: boolean;
  direction: 'up' | 'down' | 'set' | 'mute' | 'unmute';
}

export interface VisualizerState {
  enabled: boolean;
  bandCount: number;
  audioSessionId: number;
  captureSize: number;
  samplingRateMilliHz: number;
}

export interface VisualizerFrameEvent {
  bands: number[];
  bass: number;
  mid: number;
  treble: number;
  rms: number;
  peak: number;
  timestampMs: number;
}

export interface RollingCacheMetrics {
  cacheBytes: number;
  maxCacheBytes: number;
  entryCount: number;
  isClearing: boolean;
}

export interface RollingCacheClearResult {
  bytesBefore: number;
  bytesAfter: number;
  resourcesRemoved: number;
  verified: boolean;
}

export interface OfflineStorageMetrics {
  scope: string;
  scopeBytes: number;
  scopeTrackCount: number;
  allDownloadsBytes: number;
  rollingCacheBytes: number;
  rollingCacheMaxBytes: number;
  rollingCacheEntryCount: number;
  availableDiskBytes: number;
  wifiOnly: boolean;
}

export interface LoggeRythmPlayerConstants {
  snapshotEvent: 'LoggeRythmPlayerSnapshot';
  playerEvent: 'LoggeRythmPlayerEvent';
  progressEvent: 'LoggeRythmPlayerProgress';
  visualizerEvent: 'LoggeRythmVisualizerFrame';
  remoteVolumeEvent: 'LoggeRythmRemoteVolume';
  deviceVolumeEvent: 'LoggeRythmDeviceVolume';
}

export interface LoggeRythmPlayerNativeSpec {
  getConstants(): LoggeRythmPlayerConstants;
  setup(optionsJson: string): Promise<{ snapshotJson: string }>;
  command(name: string, payloadJson: string): Promise<{ snapshotJson: string }>;
  setBrowseTree(treeJson: string): Promise<{ revision: number }>;
  setNotificationFavoriteState(mediaId: string | null, liked: boolean | null): Promise<null>;
  setLikedTrackIds(trackIdsJson: string | null): Promise<null>;
  clearPersistedState(): Promise<{ snapshotJson: string; cleared: boolean; cacheVerified: boolean }>;
  clearCache(): Promise<{
    snapshotJson: string;
    cleared: boolean;
    cacheBytesBefore: number;
    cacheBytesAfter: number;
    cacheResourcesRemoved: number;
    cacheVerified: boolean;
  }>;
  claimPlaybackEvents(maxEvents: number, leaseMs: number): Promise<string>;
  ackPlaybackEvent(leaseId: string, eventId: string): Promise<null>;
  retryPlaybackEvent(leaseId: string, eventId: string, notBeforeEpochMs: number): Promise<null>;
  completeRadioPlaybackEvent(leaseId: string, eventId: string, payloadJson: string): Promise<null>;
  completeFavoritePlaybackEvent(leaseId: string, eventId: string): Promise<null>;
  failFavoritePlaybackEvent(leaseId: string, eventId: string): Promise<null>;

  // Wave 1 native extensions
  performHaptic(style: HapticStyle): Promise<HapticResult>;
  extractArtworkPalette(uri: string): Promise<ArtworkPaletteResult>;
  getAudioSessionId(): Promise<number>;
  getEqualizerState(): Promise<EqualizerState>;
  setEqualizerEnabled(enabled: boolean): Promise<EqualizerState>;
  setEqualizerBandLevel(bandIndex: number, levelMb: number): Promise<EqualizerState>;
  setEqualizerBandLevels(levelsMb: number[]): Promise<EqualizerState>;
  setEqualizerPreset(presetName: EqualizerPresetName): Promise<EqualizerState>;
  getBassBoostState(): Promise<BassBoostState>;
  setBassBoost(enabled: boolean, strength: number): Promise<BassBoostState>;
  getLoudnessConfig(): Promise<LoudnessConfigState>;
  setLoudnessConfig(enabled: boolean, preset: LoudnessPresetName): Promise<LoudnessConfigState>;
  getPlaybackSpeed(): Promise<PlaybackSpeedState>;
  setPlaybackSpeed(speed: number, pitch: number): Promise<PlaybackSpeedState>;
  getCrossfadeConfig(): Promise<CrossfadeConfig>;
  setCrossfadeConfig(enabled: boolean, durationSec: number): Promise<CrossfadeConfig>;
  openAudioOutputSwitcher(): Promise<AudioOutputSwitcherResult>;
  getAudioOutputDevices(): Promise<AudioOutputDevice[]>;
  getDeviceVolume(): Promise<DeviceVolumeState>;
  setDeviceVolume(volume: number, muted: boolean | null): Promise<DeviceVolumeState>;
  setRemoteVolumeControl(
    active: boolean,
    currentVolume: number,
    maxVolume: number,
    muted: boolean | null,
  ): Promise<RemoteVolumeState>;
  setVisualizerEnabled(enabled: boolean): Promise<VisualizerState>;
  getVisualizerState(): Promise<VisualizerState>;
  getRollingCacheMetrics(): Promise<RollingCacheMetrics>;
  clearRollingCache(): Promise<RollingCacheClearResult>;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export interface OfflineDownloadsNativeSpec {
  getConstants(): { progressEvent: 'OfflineDownloadProgress' };
  hydrate(scope: string): Promise<unknown>;
  persistManifest(scope: string, generation: number, manifestJson: string): Promise<null>;
  startPlaylistDownload(
    scope: string,
    generation: number,
    playlistId: string,
    tracks: { trackId: string; fileName: string; url: string; headers: { Cookie: string } }[],
  ): Promise<unknown>;
  removeFiles(scope: string, generation: number, fileNames: string[]): Promise<{ availableDiskBytes: number }>;
  clearScope(scope: string): Promise<{ generation: number }>;
  clearAllScopes(): Promise<{ cleanupGeneration: number; cleared: true }>;

  // Wave 1 native extensions
  setWifiOnly(enabled: boolean): Promise<{ wifiOnly: boolean }>;
  getWifiOnly(): Promise<{ wifiOnly: boolean }>;
  cancelDownload(): Promise<{ cancelled: boolean }>;
  getStorageMetrics(scope: string): Promise<OfflineStorageMetrics>;
  clearRollingCache(): Promise<RollingCacheClearResult>;

  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

declare const emptyExport: Record<string, never>;
export default emptyExport;
