import { describe, expect, it } from 'vitest';
import type { ConnectDevice, ConnectPlaybackState, ConnectState, Track } from '../api/types';
import { PlaybackState, RepeatMode, type PlayerSnapshot } from '../player/playerPort';
import {
  activeRemoteTrack,
  connectRepeatToPlayer,
  deviceTypeIcon,
  extrapolatedConnectPosition,
  IDLE_CONNECT_SNAPSHOT,
  localSnapshotToConnectPlayback,
  repeatModeToConnect,
  shouldShowDeviceSelectorInBar,
} from './connectModel';

const track: Track = {
  id: '3135556',
  title: 'Harder, Better, Faster, Stronger',
  artist: 'Daft Punk',
  artist_id: '27',
  artists: [{ id: '27', name: 'Daft Punk' }],
  album: 'Discovery',
  album_id: '302127',
  cover: 'https://cdn.example/cover.jpg',
  duration_sec: 224,
  preview_url: null,
  rank: 1,
  release_date: '2001-03-12',
};

function device(id: string, overrides: Partial<ConnectDevice> = {}): ConnectDevice {
  return {
    device_id: id,
    name: `Device ${id}`,
    device_type: 'web',
    capabilities: { can_play_audio: true, can_control_volume: true },
    volume: 0.8,
    muted: false,
    is_active: false,
    party_code: null,
    connected_at: '2026-11-24T00:00:00Z',
    last_seen_at: '2026-11-24T00:00:05Z',
    ...overrides,
  };
}

function connectState(devices: ConnectDevice[], activeId: string | null = null): ConnectState {
  const playback: ConnectPlaybackState = {
    queue: [track],
    origins: ['context'],
    queue_context: 'Discovery',
    current_index: 0,
    is_playing: true,
    position_sec: 30,
    duration_sec: 224,
    shuffle: false,
    repeat: 'off',
    volume: 0.8,
    muted: false,
    updated_at: '2026-11-24T00:00:00Z',
  };
  return {
    revision: 1,
    active_device_id: activeId,
    devices,
    playback,
    server_time: '2026-11-24T00:00:05Z',
  };
}

describe('Connect model', () => {
  it('shows the bar device selector only when >1 device, remote controlling, or in a Jam', () => {
    expect(shouldShowDeviceSelectorInBar(IDLE_CONNECT_SNAPSHOT, false)).toBe(false);
    expect(
      shouldShowDeviceSelectorInBar(
        { ...IDLE_CONNECT_SNAPSHOT, state: connectState([device('d1', { is_active: true })], 'd1') },
        false,
      ),
    ).toBe(false);
    expect(
      shouldShowDeviceSelectorInBar(
        {
          ...IDLE_CONNECT_SNAPSHOT,
          state: connectState([device('d1'), device('d2')], 'd1'),
        },
        false,
      ),
    ).toBe(true);
    expect(
      shouldShowDeviceSelectorInBar(
        { ...IDLE_CONNECT_SNAPSHOT, isControllingRemote: true },
        false,
      ),
    ).toBe(true);
    expect(shouldShowDeviceSelectorInBar(IDLE_CONNECT_SNAPSHOT, true)).toBe(true);
  });

  it('extrapolates remote playback position only while playing and rejects invalid dates', () => {
    const now = Date.parse('2026-11-24T00:00:12.5Z');
    expect(
      extrapolatedConnectPosition(
        { is_playing: true, position_sec: 30, duration_sec: 224, updated_at: '2026-11-24T00:00:00Z' },
        now,
      ),
    ).toBe(42.5);
    expect(
      extrapolatedConnectPosition(
        { is_playing: false, position_sec: 30, duration_sec: 224, updated_at: '2026-11-24T00:00:00Z' },
        now,
      ),
    ).toBe(30);
    expect(
      extrapolatedConnectPosition(
        { is_playing: true, position_sec: 220, duration_sec: 224, updated_at: '2026-11-24T00:00:00Z' },
        now,
      ),
    ).toBe(224);
    expect(() =>
      extrapolatedConnectPosition(
        { is_playing: true, position_sec: 10, duration_sec: 100, updated_at: 'not-a-date' },
        now,
      ),
    ).toThrow(/not a date/);
  });

  it('projects local player snapshots to strict ConnectPlaybackInput and rejects missing Track metadata', () => {
    const playerSnap: PlayerSnapshot = {
      revision: 3,
      isSetup: true,
      queue: [
        {
          mediaId: 'queue:1:0:3135556',
          url: 'https://example.test/stream',
          extras: {
            track,
            queueOrigin: 'manual',
            queueContextType: 'album',
            queueContextId: '302127',
            queueContextLabel: 'Discovery',
            queueStableId: 'manual:1',
          },
        },
      ],
      activeIndex: 0,
      playbackState: PlaybackState.Ready,
      isPlaying: true,
      progress: { position: 42, duration: 224, buffered: 60, cached: 0 },
      repeatMode: RepeatMode.All,
      autoRadioEnabled: true,
      shuffleEnabled: false,
      playbackSpeed: 1,
      volume: 1,
      sleepTimer: null,
      queuePersistence: { contextShuffleEnabled: true, contextShuffleRestoreOrder: [] },
    };

    const projected = localSnapshotToConnectPlayback(playerSnap, true);
    expect(projected).toEqual({
      queue: [track],
      origins: ['manual'],
      queue_context: 'Discovery',
      current_index: 0,
      is_playing: true,
      position_sec: 42,
      duration_sec: 224,
      shuffle: true,
      repeat: 'all',
      volume: 1,
      muted: false,
    });

    expect(() =>
      localSnapshotToConnectPlayback(
        { ...playerSnap, queue: [{ mediaId: 'bad', url: 'https://x', extras: {} }] },
        false,
      ),
    ).toThrow(/missing Track metadata/);
  });

  it('maps repeat modes, remote active tracks, and device icons accurately', () => {
    expect(connectRepeatToPlayer(repeatModeToConnect(RepeatMode.One))).toBe(RepeatMode.One);
    expect(deviceTypeIcon('tv')).toBe('television');
    expect(deviceTypeIcon('web')).toBe('web');
    expect(deviceTypeIcon('mobile')).toBe('cellphone');
    expect(activeRemoteTrack(connectState([], null).playback)).toEqual(track);
    expect(activeRemoteTrack(null)).toBeNull();
  });
});
