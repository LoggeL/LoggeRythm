import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectDevice, ConnectState, PartyState } from '../api/types';
import { IDLE_CONNECT_SNAPSHOT, type ConnectSessionSnapshot } from '../connect/connectModel';
import { IDLE_PARTY_SNAPSHOT } from '../party/activeParty';
import type { PartySessionSnapshot } from '../party/partySession';
import { byTestId, queryByTestId, textContent } from '../test/render';
import MiniPlayer, {
  MiniPlayerProgressBar,
  miniPlayerDragOffset,
  miniPlayerProgressRatio,
} from './MiniPlayer';

const harness = vi.hoisted(() => ({
  navigate: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
  togglePlay: vi.fn(),
  showDevicePicker: vi.fn(),
  transferPlayback: vi.fn(async () => undefined),
  sendConnectCommand: vi.fn(async () => undefined),
  connectSnapshot: null as ConnectSessionSnapshot | null,
  partySnapshot: null as PartySessionSnapshot | null,
  useProgress: vi.fn(() => ({ position: 45, duration: 180 })),
  hapticTrigger: vi.fn(() => true),
  pushCheckpoint: vi.fn(),
  reducedMotion: false,
  animatedSetValue: vi.fn(),
  animatedSpringStart: vi.fn(),
  animatedTimingStart: vi.fn(),
  tv: {
    isTv: false,
    isWidescreen: false,
    width: 390,
    height: 844,
    overscan: { top: 0, right: 0, bottom: 0, left: 0 },
    contentPaddingHorizontal: 20,
    typography: {
      label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
      caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
    },
  },
  track: {
    id: 'track-1',
    title: 'Midnight Signal',
    artist: 'Neon Drift',
    artist_id: 1,
    artists: [{ id: 1, name: 'Neon Drift' }],
    album: 'Telemetry',
    album_id: 10,
    cover: 'https://example.test/cover.jpg',
    duration_sec: 180,
    preview_url: null,
    rank: 1,
    release_date: '2025-01-01',
  },
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  useEffect: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    Value: class MockAnimatedValue {
      constructor(public value: number) {}
      setValue = harness.animatedSetValue;
      interpolate = () => 'interpolated-translateX';
    },
    View: 'Animated.View',
    spring: () => ({ start: harness.animatedSpringStart }),
    timing: () => ({ start: harness.animatedTimingStart }),
    parallel: () => ({ start: harness.animatedSpringStart }),
  },
  PanResponder: {
    create: (config: Record<string, unknown>) => ({
      panHandlers: {
        onMoveShouldSetResponderCapture: config.onMoveShouldSetPanResponderCapture,
        onResponderMove: config.onPanResponderMove,
        onResponderRelease: config.onPanResponderRelease,
        onResponderTerminate: config.onPanResponderTerminate,
      },
    }),
  },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
}));
vi.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: harness.navigate }),
}));
vi.mock('../player/player', () => ({
  PlaybackState: { Buffering: 'buffering', Playing: 'playing', Paused: 'paused' },
  useActiveMediaItem: () => ({ mediaId: 'm1' }),
  useIsPlaying: () => true,
  usePlaybackState: () => 'playing',
  useProgress: harness.useProgress,
}));
vi.mock('../player/mediaItem', () => ({ mediaItemToTrack: () => harness.track }));
vi.mock('../player/controller', () => ({
  next: harness.next,
  prev: harness.prev,
  togglePlay: harness.togglePlay,
}));
vi.mock('../player/errors', () => ({ reportPlayerError: vi.fn() }));
vi.mock('../hooks/useHaptics', () => ({
  useHaptics: () => ({ trigger: harness.hapticTrigger }),
  triggerHaptic: harness.hapticTrigger,
}));
vi.mock('../hooks/useReducedMotion', () => ({
  useReducedMotion: () => harness.reducedMotion,
  getReducedMotionSnapshot: () => harness.reducedMotion,
}));
vi.mock('../tv', () => ({
  useTvEnvironment: () => harness.tv,
  tvFocusRegistry: { pushCheckpoint: harness.pushCheckpoint },
}));
vi.mock('./TrackLikeButton', () => ({ default: 'TrackLikeButton' }));
vi.mock('./PlayerNoticeBanner', () => ({ default: 'PlayerNoticeBanner' }));
vi.mock('./AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('./ui/Artwork', () => ({ Artwork: 'Artwork' }));
vi.mock('./connect/devicePicker', () => ({ showDevicePicker: harness.showDevicePicker }));
vi.mock('../connect/activeConnect', () => ({
  useActiveConnectSnapshot: () => harness.connectSnapshot ?? IDLE_CONNECT_SNAPSHOT,
  transferActiveConnectPlayback: harness.transferPlayback,
  activeConnectRouter: () => ({
    isControllingRemote: () => (harness.connectSnapshot ?? IDLE_CONNECT_SNAPSHOT).isControllingRemote,
    activeDevice: () => (harness.connectSnapshot ?? IDLE_CONNECT_SNAPSHOT).activeDevice,
    remotePlayback: () => (harness.connectSnapshot ?? IDLE_CONNECT_SNAPSHOT).state?.playback ?? null,
    sendCommand: harness.sendConnectCommand,
  }),
}));
vi.mock('../party/activeParty', async (importOriginal) => ({
  ...await importOriginal<typeof import('../party/activeParty')>(),
  useActivePartySnapshot: () => harness.partySnapshot ?? IDLE_PARTY_SNAPSHOT,
  activePartyRouter: () => null,
}));

describe('MiniPlayer', () => {
  beforeEach(() => {
    harness.reducedMotion = false;
    harness.connectSnapshot = IDLE_CONNECT_SNAPSHOT;
    harness.partySnapshot = IDLE_PARTY_SNAPSHOT;
    harness.showDevicePicker.mockClear();
    harness.transferPlayback.mockClear();
    harness.sendConnectCommand.mockClear();
    harness.tv = {
      isTv: false,
      isWidescreen: false,
      width: 390,
      height: 844,
      overscan: { top: 0, right: 0, bottom: 0, left: 0 },
      contentPaddingHorizontal: 20,
      typography: {
        label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
        caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
      },
    };
    harness.navigate.mockClear();
    harness.next.mockClear();
    harness.prev.mockClear();
    harness.togglePlay.mockClear();
    harness.useProgress.mockClear();
    harness.hapticTrigger.mockClear();
    harness.pushCheckpoint.mockClear();
    harness.animatedSetValue.mockClear();
    harness.animatedSpringStart.mockClear();
  });

  it('computes clamped progress ratio and damped finger-tracking drag offsets', () => {
    expect(miniPlayerProgressRatio(45, 180)).toBe(0.25);
    expect(miniPlayerProgressRatio(200, 180)).toBe(1);
    expect(miniPlayerProgressRatio(-10, 180)).toBe(0);
    expect(miniPlayerProgressRatio(30, 0)).toBe(0);

    expect(miniPlayerDragOffset(-40, 2)).toEqual({ x: -30, y: 0 });
    expect(miniPlayerDragOffset(500, 0)).toEqual({ x: 96, y: 0 });
    expect(miniPlayerDragOffset(2, -40)).toEqual({ x: 0, y: -24 });
    expect(miniPlayerDragOffset(2, 40)).toEqual({ x: 0, y: 0 });
  });

  it('isolates useProgress out of MiniPlayer root and animates progress via native scaleX', () => {
    const rendered = MiniPlayer({ hasTabBar: true });
    expect(harness.useProgress).not.toHaveBeenCalled();
    expect(queryByTestId(rendered, 'mini-player-bottom-shield')).not.toBeNull();

    const progressRendered = (MiniPlayerProgressBar as unknown as { type: () => React.ReactElement }).type();
    expect(harness.useProgress).toHaveBeenCalledWith(1);
    const fill = byTestId(progressRendered, 'mini-player-progress-fill');
    const styleArray = fill.props.style as Record<string, unknown>[];
    expect(styleArray[1]).toEqual(
      expect.objectContaining({
        transform: expect.arrayContaining([
          expect.objectContaining({ scaleX: expect.anything() }),
        ]),
      }),
    );
  });

  it('tracks horizontal/upward swipes with haptics and spring snap-back', () => {
    const rendered = MiniPlayer({ hasTabBar: true });
    const bar = byTestId(rendered, 'mini-player');
    const move = bar.props.onResponderMove as (...args: unknown[]) => void;
    const release = bar.props.onResponderRelease as (...args: unknown[]) => void;

    move({}, { dx: -40, dy: 0 });
    expect(harness.animatedSetValue).toHaveBeenCalledWith(-30);

    release({}, { dx: -72, dy: 0, vx: -0.7, vy: 0 });
    expect(harness.hapticTrigger).toHaveBeenCalledWith('commit');
    expect(harness.next).toHaveBeenCalledOnce();
    expect(harness.animatedSpringStart).toHaveBeenCalled();

    release({}, { dx: 0, dy: -64, vx: 0, vy: -0.7 });
    expect(harness.hapticTrigger).toHaveBeenCalledWith('tap');
    expect(harness.navigate).toHaveBeenCalledWith('NowPlaying');
  });

  it('adapts to Android TV with D-Pad focusability, checkpoint push, and disabled touch swipe', () => {
    harness.tv = {
      isTv: true,
      isWidescreen: true,
      width: 960,
      height: 540,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
      contentPaddingHorizontal: 28,
      typography: {
        label: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
        caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
      },
    };
    const rendered = MiniPlayer({ hasTabBar: false });
    const bar = byTestId(rendered, 'mini-player');
    expect(bar.props.onMoveShouldSetResponderCapture).toBeUndefined();
    expect(queryByTestId(rendered, 'mini-player-bottom-shield')).toBeNull();

    const open = byTestId(rendered, 'mini-player-open');
    expect(open.props.focusable).toBe(true);
    expect(byTestId(rendered, 'mini-player-play-pause').props.focusable).toBe(true);
    expect(byTestId(rendered, 'mini-player-next').props.focusable).toBe(true);

    (open.props.onPress as () => void)();
    expect(harness.pushCheckpoint).toHaveBeenCalledWith('mini-player');
    expect(harness.navigate).toHaveBeenCalledWith('NowPlaying');
  });

  it('hides the device selector for a single device and shows it for >1 devices, remote playback, or an active Jam', () => {
    const phone: ConnectDevice = {
      device_id: 'dev-phone',
      name: 'Pixel 9',
      device_type: 'mobile',
      is_active: true,
      volume: 1,
      muted: false,
      connected_at: '2026-11-24T00:00:00Z',
      last_seen_at: '2026-11-24T00:00:00Z',
      capabilities: { can_play_audio: true, can_control_volume: false },
      party_code: null,
    };
    const web: ConnectDevice = {
      device_id: 'dev-web',
      name: 'Chrome',
      device_type: 'web',
      is_active: false,
      volume: 0.7,
      muted: false,
      connected_at: '2026-11-24T00:00:00Z',
      last_seen_at: '2026-11-24T00:00:00Z',
      capabilities: { can_play_audio: true, can_control_volume: true },
      party_code: null,
    };
    const baseState = (devices: ConnectDevice[], activeId: string): ConnectState => ({
      revision: 1,
      active_device_id: activeId,
      devices,
      playback: {
        queue: [harness.track],
        origins: ['context'],
        queue_context: 'Mix',
        current_index: 0,
        is_playing: true,
        position_sec: 10,
        duration_sec: 180,
        shuffle: false,
        repeat: 'off',
        volume: 0.7,
        muted: false,
        updated_at: '2026-11-24T00:00:00Z',
      },
      server_time: '2026-11-24T00:00:00Z',
    });

    // 1 device, local playback, no Jam -> device button hidden.
    harness.connectSnapshot = {
      ...IDLE_CONNECT_SNAPSHOT,
      phase: 'connected',
      selfDeviceId: 'dev-phone',
      activeDevice: phone,
      isSelfActive: true,
      state: baseState([phone], 'dev-phone'),
    };
    expect(queryByTestId(MiniPlayer({ hasTabBar: true }), 'mini-player-devices')).toBeNull();

    // >1 devices -> device button shown and opens DevicePicker.
    harness.connectSnapshot = {
      ...harness.connectSnapshot,
      state: baseState([phone, web], 'dev-phone'),
    };
    const multi = MiniPlayer({ hasTabBar: true });
    const devicesBtn = byTestId(multi, 'mini-player-devices');
    (devicesBtn.props.onPress as () => void)();
    expect(harness.showDevicePicker).toHaveBeenCalledWith('devices');
    expect(queryByTestId(multi, 'mini-player-remote-strip')).toBeNull();

    // Remote playback -> shows device button, "Listening on Chrome" strip, and Play Here button.
    harness.connectSnapshot = {
      ...harness.connectSnapshot,
      activeDevice: { ...web, is_active: true },
      isSelfActive: false,
      isControllingRemote: true,
      state: baseState([phone, { ...web, is_active: true }], 'dev-web'),
    };
    const remote = MiniPlayer({ hasTabBar: true });
    expect(byTestId(remote, 'mini-player-devices')).toBeDefined();
    expect(textContent(byTestId(remote, 'mini-player-remote-strip')).join(' ')).toContain('Chrome');
    (byTestId(remote, 'mini-player-play-here').props.onPress as () => void)();
    expect(harness.transferPlayback).toHaveBeenCalledWith('dev-phone');
    (byTestId(remote, 'mini-player-play-pause').props.onPress as () => void)();
    expect(harness.sendConnectCommand).toHaveBeenCalledWith('toggle', {});

    // Active Jam (local playback, single device) -> shows device button + Jam strip.
    harness.connectSnapshot = IDLE_CONNECT_SNAPSHOT;
    const activeParty: PartyState = {
      code: 'JAM123',
      name: 'Friday Jam',
      host_name: 'Host',
      is_host: true,
      current_index: 0,
      is_playing: true,
      position_sec: 0,
      playback_updated_at: null,
      server_time: '2026-11-24T00:00:00Z',
      guests_can_control: true,
      playback_changed_by: 'u:1',
      playback_revision: 1,
      ended: false,
      members: [{ key: 'u:1', name: 'Host', avatar_url: null, is_guest: false, is_host: true }],
      tracks: [],
      viewer_key: 'u:1',
      viewer_name: 'Host',
      viewer_is_guest: false,
    };
    harness.partySnapshot = {
      ...IDLE_PARTY_SNAPSHOT,
      code: 'JAM123',
      phase: 'live',
      party: activeParty,
    };
    const jam = MiniPlayer({ hasTabBar: true });
    expect(byTestId(jam, 'mini-player-devices')).toBeDefined();
    const jamStrip = byTestId(jam, 'mini-player-jam-strip');
    (jamStrip.props.onPress as () => void)();
    expect(harness.navigate).toHaveBeenCalledWith('Party', { code: 'JAM123' });
  });
});
