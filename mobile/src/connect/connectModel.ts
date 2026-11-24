import type {
  ConnectDevice,
  ConnectDeviceCapabilities,
  ConnectDeviceType,
  ConnectPlaybackInput,
  ConnectPlaybackState,
  ConnectQueueOrigin,
  ConnectRepeatMode,
  ConnectState,
  Track,
} from '../api/types';
import type { AppIconName } from '../components/AppIcon';
import { strings } from '../localization';
import { mediaItemToTrack } from '../player/mediaItem';
import { PlaybackState, RepeatMode, type PlayerSnapshot } from '../player/playerPort';
import { queueContextOf, queueOriginOf } from '../player/queueContract';

export type ConnectPhase =
  | 'idle'
  | 'disabled'
  | 'offline'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface ConnectSessionSnapshot {
  readonly phase: ConnectPhase;
  readonly enabled: boolean;
  readonly selfDeviceId: string | null;
  readonly selfDeviceName: string;
  readonly selfDeviceType: ConnectDeviceType;
  readonly state: ConnectState | null;
  readonly activeDevice: ConnectDevice | null;
  readonly isSelfActive: boolean;
  readonly isControllingRemote: boolean;
  readonly transferringToDeviceId: string | null;
  readonly error: string | null;
}

/** Mobile Media3 player plays audio natively but intentionally does not expose remote volume mutation. */
export const MOBILE_CONNECT_CAPABILITIES: Readonly<ConnectDeviceCapabilities> = Object.freeze({
  can_play_audio: true,
  can_control_volume: false,
});

export function validateConnectDeviceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('Device name cannot be empty');
  }
  if (trimmed.length > 60) {
    throw new Error('Device name cannot exceed 60 characters');
  }
  return trimmed;
}

export const IDLE_CONNECT_SNAPSHOT: ConnectSessionSnapshot = Object.freeze({
  phase: 'idle',
  enabled: true,
  selfDeviceId: null,
  selfDeviceName: '',
  selfDeviceType: 'mobile',
  state: null,
  activeDevice: null,
  isSelfActive: false,
  isControllingRemote: false,
  transferringToDeviceId: null,
  error: null,
});

export function deviceTypeIcon(type: ConnectDeviceType): AppIconName {
  switch (type) {
    case 'web':
      return 'web';
    case 'mobile':
      return 'cellphone';
    case 'tablet':
      return 'tablet';
    case 'desktop':
      return 'laptop';
    case 'tv':
      return 'television';
    case 'speaker':
      return 'speaker';
    case 'other':
      return 'devices';
  }
}

export function deviceTypeLabel(type: ConnectDeviceType): string {
  return strings.connect.deviceTypes[type];
}

/**
 * Locked visibility rule (#8):
 * Show the Spotify-style device selector button in the compact player bar when
 * > 1 devices are connected OR controlling a remote device OR in an active Jam.
 */
export function shouldShowDeviceSelectorInBar(
  connect: Pick<ConnectSessionSnapshot, 'state' | 'isControllingRemote'>,
  partyActive: boolean,
): boolean {
  if (partyActive) return true;
  if (connect.isControllingRemote) return true;
  return (connect.state?.devices.length ?? 0) > 1;
}

export function activeRemoteTrack(playback: ConnectPlaybackState | null): Track | null {
  if (playback === null) return null;
  if (playback.current_index < 0 || playback.current_index >= playback.queue.length) {
    return null;
  }
  return playback.queue[playback.current_index] ?? null;
}

/** Extrapolate remote playback playhead between WS updates while playing. */
export function extrapolatedConnectPosition(
  playback: Pick<ConnectPlaybackState, 'is_playing' | 'position_sec' | 'duration_sec' | 'updated_at'>,
  nowMs: number,
): number {
  if (!playback.is_playing || playback.updated_at === null) {
    return Math.max(0, playback.position_sec);
  }
  const updatedAt = Date.parse(playback.updated_at);
  if (!Number.isFinite(updatedAt)) {
    throw new Error(`Connect playback timestamp ${playback.updated_at} is not a date`);
  }
  const elapsed = Math.max(0, (nowMs - updatedAt) / 1000);
  const candidate = Math.max(0, playback.position_sec + elapsed);
  return playback.duration_sec > 0 ? Math.min(candidate, playback.duration_sec) : candidate;
}

export function repeatModeToConnect(mode: RepeatMode): ConnectRepeatMode {
  switch (mode) {
    case RepeatMode.Off:
      return 'off';
    case RepeatMode.All:
      return 'all';
    case RepeatMode.One:
      return 'one';
  }
}

export function connectRepeatToPlayer(mode: ConnectRepeatMode): RepeatMode {
  switch (mode) {
    case 'off':
      return RepeatMode.Off;
    case 'all':
      return RepeatMode.All;
    case 'one':
      return RepeatMode.One;
  }
}

/**
 * Project the local native Media3 snapshot into the strict ConnectPlaybackInput
 * wire schema. Fails loudly if a non-empty queue contains an item without Track data.
 */
export function localSnapshotToConnectPlayback(
  snapshot: Readonly<PlayerSnapshot>,
  contextShuffleEnabled: boolean,
): ConnectPlaybackInput {
  const queue: Track[] = [];
  const origins: ConnectQueueOrigin[] = [];
  for (let index = 0; index < snapshot.queue.length; index += 1) {
    const item = snapshot.queue[index];
    const track = mediaItemToTrack(item);
    if (track === null) {
      throw new Error(`Local queue item at index ${index} has no Track metadata for Connect sync`);
    }
    queue.push(track);
    origins.push(queueOriginOf(item) === 'manual' ? 'manual' : 'context');
  }

  const currentIndex =
    snapshot.activeIndex !== null
    && snapshot.activeIndex >= 0
    && snapshot.activeIndex < queue.length
      ? snapshot.activeIndex
      : -1;
  const activeItem = currentIndex >= 0 ? snapshot.queue[currentIndex] : null;
  const queueContext = activeItem !== null ? queueContextOf(activeItem)?.label ?? null : null;
  const position =
    Number.isFinite(snapshot.progress.position) && snapshot.progress.position >= 0
      ? snapshot.progress.position
      : 0;
  const rawDuration = snapshot.progress.duration;
  const activeTrackDuration = currentIndex >= 0 ? queue[currentIndex].duration_sec : 0;
  const duration =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : activeTrackDuration;
  const isPlaying =
    currentIndex >= 0
    && (snapshot.isPlaying || snapshot.playbackState === PlaybackState.Buffering);
  const volume =
    Number.isFinite(snapshot.volume) && snapshot.volume >= 0 && snapshot.volume <= 1
      ? snapshot.volume
      : 1;

  return {
    queue,
    origins,
    queue_context: queueContext,
    current_index: currentIndex,
    is_playing: isPlaying,
    position_sec: currentIndex >= 0 ? position : 0,
    duration_sec: currentIndex >= 0 ? duration : 0,
    shuffle: contextShuffleEnabled,
    repeat: repeatModeToConnect(snapshot.repeatMode),
    volume,
    muted: false,
  };
}
