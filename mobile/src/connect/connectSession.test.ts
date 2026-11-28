import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConnectClientFrame,
  ConnectDevice,
  ConnectPlaybackState,
  ConnectState,
  Track,
} from '../api/types';
import { PlaybackState, RepeatMode, type PlayerSnapshot } from '../player/playerPort';
import {
  CONNECT_COMMAND_TIMEOUT_MS,
  CONNECT_RECONNECT_DELAYS_MS,
  ConnectSession,
  type ConnectSessionDependencies,
} from './connectSession';
import type { ConnectSocketHandlers } from './connectSocket';

const track: Track = {
  id: '3135556',
  title: 'Around the World',
  artist: 'Daft Punk',
  artist_id: '27',
  artists: [{ id: '27', name: 'Daft Punk' }],
  album: 'Homework',
  album_id: '302127',
  cover: '',
  duration_sec: 429,
  preview_url: null,
  rank: 1,
  release_date: '1997-01-20',
};

function device(id: string, overrides: Partial<ConnectDevice> = {}): ConnectDevice {
  return {
    device_id: id,
    name: `Device ${id}`,
    device_type: id === 'phone-1' ? 'mobile' : 'web',
    capabilities: { can_play_audio: true, can_control_volume: id !== 'phone-1' },
    volume: 0.9,
    muted: false,
    is_active: false,
    party_code: null,
    connected_at: '2026-11-24T00:00:00Z',
    last_seen_at: '2026-11-24T00:00:01Z',
    ...overrides,
  };
}

function playbackState(overrides: Partial<ConnectPlaybackState> = {}): ConnectPlaybackState {
  return {
    queue: [track],
    origins: ['context'],
    queue_context: 'Homework',
    current_index: 0,
    is_playing: true,
    position_sec: 12,
    duration_sec: 429,
    shuffle: false,
    repeat: 'off',
    volume: 0.9,
    muted: false,
    updated_at: '2026-11-24T00:00:00Z',
    ...overrides,
  };
}

function serverState(activeId: string | null, devices: ConnectDevice[]): ConnectState {
  return {
    revision: 1,
    active_device_id: activeId,
    devices: devices.map((d) => ({ ...d, is_active: d.device_id === activeId })),
    playback: playbackState(),
    server_time: '2026-11-24T00:00:01Z',
  };
}

function playerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    revision: 1,
    isSetup: true,
    queue: [
      {
        mediaId: 'queue:1:0:3135556',
        url: 'https://example.test/stream',
        extras: {
          track,
          queueOrigin: 'context',
          queueContextType: 'album',
          queueContextId: '302127',
          queueContextLabel: 'Homework',
          queueStableId: 'context:album:302127:0:3135556',
        },
      },
    ],
    activeIndex: 0,
    playbackState: PlaybackState.Ready,
    isPlaying: false,
    progress: { position: 12, duration: 429, buffered: 0, cached: 0 },
    repeatMode: RepeatMode.Off,
    autoRadioEnabled: true,
    shuffleEnabled: false,
    playbackSpeed: 1,
    volume: 1,
    sleepTimer: null,
    queuePersistence: { contextShuffleEnabled: false, contextShuffleRestoreOrder: [] },
    ...overrides,
  };
}

function harness(options: { enabled?: boolean; online?: boolean } = {}) {
  const timers: { callback: () => void; ms: number; interval: boolean; cleared: boolean }[] = [];
  const playerListeners = new Set<() => void>();
  const connectivityListeners = new Set<() => void>();
  const sentFrames: ConnectClientFrame[] = [];
  const sockets: { handlers: ConnectSocketHandlers; close: ReturnType<typeof vi.fn> }[] = [];
  const state = {
    online: options.online ?? true,
    snapshot: playerSnapshot(),
    party: { code: null as string | null, isHost: false, controlOnly: false },
  };

  const deps: ConnectSessionDependencies = {
    loadIdentity: vi.fn(async () => ({
      deviceId: 'phone-1',
      name: 'Pixel 9',
      deviceType: 'mobile' as const,
      enabled: options.enabled ?? true,
    })),
    saveDeviceName: vi.fn(async (name: string) => name),
    saveEnabled: vi.fn(async () => undefined),
    openSocket: vi.fn(async (handlers: ConnectSocketHandlers) => {
      const close = vi.fn();
      sockets.push({ handlers, close });
      return {
        send: (frame: ConnectClientFrame) => {
          sentFrames.push(frame);
        },
        close,
      };
    }),
    player: {
      subscribe: vi.fn((listener: () => void) => {
        playerListeners.add(listener);
        return () => playerListeners.delete(listener);
      }),
      getSnapshot: vi.fn(() => state.snapshot),
      isContextShuffleEnabled: vi.fn(() => false),
      pause: vi.fn(),
      applyActivatedPlayback: vi.fn(async () => undefined),
      executeRemoteCommand: vi.fn(async () => undefined),
    },
    isOnline: vi.fn(() => state.online),
    subscribeConnectivity: vi.fn((listener: () => void) => {
      connectivityListeners.add(listener);
      return () => connectivityListeners.delete(listener);
    }),
    getActivePartyState: vi.fn(() => state.party),
    now: vi.fn(() => Date.parse('2026-11-24T00:00:05Z')),
    setTimeout: vi.fn((callback: () => void, ms: number) => {
      const entry = { callback, ms, interval: false, cleared: false };
      timers.push(entry);
      return entry;
    }),
    clearTimeout: vi.fn((handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    }),
    setInterval: vi.fn((callback: () => void, ms: number) => {
      const entry = { callback, ms, interval: true, cleared: false };
      timers.push(entry);
      return entry;
    }),
    clearInterval: vi.fn((handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    }),
  };

  const session = new ConnectSession(deps);
  const tick = (ms: number) => {
    for (const timer of timers.filter((t) => t.ms === ms && !t.cleared)) {
      timer.callback();
      if (!timer.interval) timer.cleared = true;
    }
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const emitPlayerChange = () => {
    for (const listener of [...playerListeners]) listener();
  };
  const emitConnectivityChange = () => {
    for (const listener of [...connectivityListeners]) listener();
  };
  return { session, deps, state, sentFrames, sockets, timers, tick, settle, emitPlayerChange, emitConnectivityChange };
}

describe('ConnectSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers on open with mobile capabilities and enters connected state on welcome', async () => {
    const h = harness();
    await h.session.start();
    await h.settle();

    expect(h.sockets).toHaveLength(1);
    h.sockets[0].handlers.onOpen();
    expect(h.sentFrames[0]).toMatchObject({
      type: 'register',
      device_id: 'phone-1',
      name: 'Pixel 9',
      device_type: 'mobile',
      capabilities: { can_play_audio: true, can_control_volume: true },
    });

    h.sockets[0].handlers.onFrame({
      type: 'welcome',
      self_device_id: 'phone-1',
      heartbeat_interval_sec: 20,
      state: serverState('web-1', [device('phone-1'), device('web-1')]),
    });

    const snap = h.session.getSnapshot();
    expect(snap.phase).toBe('connected');
    expect(snap.isSelfActive).toBe(false);
    expect(snap.isControllingRemote).toBe(true);
    expect(snap.activeDevice?.device_id).toBe('web-1');
  });

  it('sends commands and surfaces command_result failures loudly instead of swallowing', async () => {
    const h = harness();
    await h.session.start();
    h.sockets[0].handlers.onOpen();
    h.sockets[0].handlers.onFrame({
      type: 'welcome',
      self_device_id: 'phone-1',
      heartbeat_interval_sec: 20,
      state: serverState('web-1', [device('phone-1'), device('web-1')]),
    });

    const okPromise = h.session.sendCommand('toggle', {});
    const sentOk = h.sentFrames[h.sentFrames.length - 1] as { request_id: string };
    h.sockets[0].handlers.onFrame({
      type: 'command_result',
      request_id: sentOk.request_id,
      command_id: 'c1',
      ok: true,
      error: null,
    });
    await expect(okPromise).resolves.toBeUndefined();

    const failPromise = h.session.sendCommand('play', {});
    const sentFail = h.sentFrames[h.sentFrames.length - 1] as { request_id: string };
    h.sockets[0].handlers.onFrame({
      type: 'command_result',
      request_id: sentFail.request_id,
      command_id: 'c2',
      ok: false,
      error: 'Autoplay blocked by browser',
    });
    await expect(failPromise).rejects.toThrow('Autoplay blocked by browser');

    const timeoutPromise = h.session.sendCommand('next', {});
    h.tick(CONNECT_COMMAND_TIMEOUT_MS);
    await expect(timeoutPromise).rejects.toThrow(/timed out/);
  });

  it('executes incoming commands including set_volume on local player and pauses on deactivated', async () => {
    const h = harness();
    await h.session.start();
    h.sockets[0].handlers.onOpen();
    h.sockets[0].handlers.onFrame({
      type: 'welcome',
      self_device_id: 'phone-1',
      heartbeat_interval_sec: 20,
      state: serverState('phone-1', [device('phone-1'), device('web-1')]),
    });

    h.sockets[0].handlers.onFrame({
      type: 'command',
      command_id: 'cmd-vol',
      request_id: 'req-1',
      from_device_id: 'web-1',
      action: 'set_volume',
      payload: { volume: 0.5 },
    });
    await h.settle();
    expect(h.deps.player.executeRemoteCommand).toHaveBeenCalledWith('set_volume', { volume: 0.5 });
    expect(h.sentFrames).toContainEqual(
      expect.objectContaining({ type: 'command_ack', command_id: 'cmd-vol', ok: true }),
    );

    h.sockets[0].handlers.onFrame({
      type: 'command',
      command_id: 'cmd-next',
      request_id: 'req-2',
      from_device_id: 'web-1',
      action: 'next',
      payload: {},
    });
    await h.settle();
    expect(h.deps.player.executeRemoteCommand).toHaveBeenCalledWith('next', {});
    expect(h.sentFrames).toContainEqual(
      expect.objectContaining({ type: 'command_ack', command_id: 'cmd-next', ok: true }),
    );

    h.sockets[0].handlers.onFrame({
      type: 'deactivated',
      new_active_device_id: 'web-1',
      reason: 'transferred',
    });
    expect(h.deps.player.pause).toHaveBeenCalledOnce();
  });

  it('hydrates local player on activate and resolves transfers on matching state update', async () => {
    const h = harness();
    await h.session.start();
    h.sockets[0].handlers.onOpen();
    h.sockets[0].handlers.onFrame({
      type: 'welcome',
      self_device_id: 'phone-1',
      heartbeat_interval_sec: 20,
      state: serverState('web-1', [device('phone-1'), device('web-1')]),
    });

    const transferPromise = h.session.transferPlayback('phone-1', true);
    expect(h.sentFrames[h.sentFrames.length - 1]).toMatchObject({
      type: 'transfer',
      target_device_id: 'phone-1',
      play: true,
    });
    const pb = playbackState({ position_sec: 55 });
    h.sockets[0].handlers.onFrame({ type: 'activate', from_device_id: 'web-1', playback: pb });
    h.sockets[0].handlers.onFrame({
      type: 'state',
      state: serverState('phone-1', [device('phone-1'), device('web-1')]),
    });
    await expect(transferPromise).resolves.toBeUndefined();
    expect(h.deps.player.applyActivatedPlayback).toHaveBeenCalledWith(pb);
    expect(h.session.getSnapshot().isSelfActive).toBe(true);
  });

  it('pauses on offline, reconnects with backoff on transient drop, and stops on 4401 auth failure', async () => {
    const h = harness();
    await h.session.start();
    h.sockets[0].handlers.onOpen();
    h.sockets[0].handlers.onClosed({ code: 1006, reason: 'network drop', authFailed: false, replaced: false });
    expect(h.session.getSnapshot().phase).toBe('reconnecting');

    h.tick(CONNECT_RECONNECT_DELAYS_MS[0]);
    await h.settle();
    expect(h.sockets).toHaveLength(2);

    h.sockets[1].handlers.onClosed({ code: 4401, reason: 'Auth required', authFailed: true, replaced: false });
    expect(h.session.getSnapshot().phase).toBe('error');
    h.tick(CONNECT_RECONNECT_DELAYS_MS[1]);
    await h.settle();
    expect(h.sockets).toHaveLength(2);

    h.state.online = false;
    h.emitConnectivityChange();
    expect(h.session.getSnapshot().phase).toBe('offline');
  });

  it('preserves surfaced errors across routine state broadcasts until explicit retry or new action', async () => {
    const h = harness();
    await h.session.start();
    h.sockets[0].handlers.onOpen();
    h.sockets[0].handlers.onFrame({
      type: 'welcome',
      self_device_id: 'phone-1',
      heartbeat_interval_sec: 20,
      state: serverState('web-1', [device('phone-1'), device('web-1')]),
    });

    h.sockets[0].handlers.onFrame({
      type: 'error',
      code: 'device_unreachable',
      detail: 'Speaker timed out',
      request_id: null,
    });
    const surfacedError = h.session.getSnapshot().error;
    expect(surfacedError).toContain('Speaker timed out');

    // Routine 3s state broadcasts must NOT erase the visible error.
    h.sockets[0].handlers.onFrame({
      type: 'state',
      state: serverState('web-1', [device('phone-1'), device('web-1')]),
    });
    expect(h.session.getSnapshot().error).toBe(surfacedError);

    // Explicit new user command clears stale error.
    const cmd = h.session.sendCommand('toggle', {});
    expect(h.session.getSnapshot().error).toBeNull();
    const sent = h.sentFrames[h.sentFrames.length - 1] as { request_id: string };
    h.sockets[0].handlers.onFrame({
      type: 'command_result',
      request_id: sent.request_id,
      command_id: 'c-clear',
      ok: true,
      error: null,
    });
    await expect(cmd).resolves.toBeUndefined();
  });

  it('prevents non-host Jam followers from claiming Connect active on register and fails loud on corrupt local queue', async () => {
    const follower = harness();
    follower.state.party = { code: 'JAM123', isHost: false, controlOnly: false };
    follower.state.snapshot = playerSnapshot({ isPlaying: true, activeIndex: 0 });
    await follower.session.start();
    follower.sockets[0].handlers.onOpen();

    expect(follower.sentFrames).toHaveLength(1);
    const registerFrame = follower.sentFrames[0] as Record<string, unknown>;
    expect(registerFrame.type).toBe('register');
    expect(registerFrame.take_active).toBe(false);
    expect(registerFrame.party_code).toBe('JAM123');
    expect('playback' in registerFrame).toBe(false);

    // Corrupt local queue item fails connect loudly instead of registering silently.
    const corrupt = harness();
    corrupt.state.snapshot = playerSnapshot({
      queue: [{ mediaId: 'corrupt-1', url: 'https://x', extras: {} }],
      activeIndex: 0,
      isPlaying: true,
    });
    await corrupt.session.start();
    corrupt.sockets[0].handlers.onOpen();
    expect(corrupt.sentFrames).toHaveLength(0);
    expect(corrupt.sockets[0].close).toHaveBeenCalledOnce();
    expect(corrupt.session.getSnapshot().phase).toBe('error');
    expect(corrupt.session.getSnapshot().error).toContain('corrupt-1');
  });

  it('uses reference-counted remote-apply depth so overlapping commands never leak local player events', async () => {
    const h = harness();
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    let calls = 0;
    vi.mocked(h.deps.player.executeRemoteCommand).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          calls += 1;
          if (calls === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        }),
    );

    await h.session.start();
    h.sockets[0].handlers.onOpen();
    h.sockets[0].handlers.onFrame({
      type: 'welcome',
      self_device_id: 'phone-1',
      heartbeat_interval_sec: 20,
      state: serverState('phone-1', [device('phone-1'), device('web-1')]),
    });
    h.sentFrames.length = 0;

    // Launch two overlapping remote commands.
    h.sockets[0].handlers.onFrame({
      type: 'command',
      command_id: 'cmd-1',
      request_id: 'r1',
      from_device_id: 'web-1',
      action: 'next',
      payload: {},
    });
    h.sockets[0].handlers.onFrame({
      type: 'command',
      command_id: 'cmd-2',
      request_id: 'r2',
      from_device_id: 'web-1',
      action: 'seek',
      payload: { position_sec: 30 },
    });

    // Finish first command while second is still in flight.
    resolveFirst();
    await h.settle();
    const framesAfterFirst = h.sentFrames.length;

    // Local player listener fires while second command is still awaiting -> must be suppressed!
    h.state.snapshot = playerSnapshot({
      progress: { position: 99, duration: 429, buffered: 0, cached: 0 },
    });
    h.emitPlayerChange();
    expect(h.sentFrames.length).toBe(framesAfterFirst);

    // Finish second command -> sends ack and publishes authoritative state.
    resolveSecond();
    await h.settle();
    expect(h.sentFrames).toContainEqual(
      expect.objectContaining({ type: 'command_ack', command_id: 'cmd-2', ok: true }),
    );
  });
});
