import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { PartyState, PartyTrack } from '../api/types';
import { strings } from '../localization';
import { PlaybackState, type PlayerSnapshot } from '../player/playerPort';
import type { PartyQueueTarget } from '../player/controller';
import type { PartyStreamHandlers } from './partyStream';
import {
  PARTY_BROADCAST_INTERVAL_MS,
  PARTY_FOLLOW_INTERVAL_MS,
  PARTY_RECONNECT_DELAYS_MS,
  PartySession,
  type PartySessionDependencies,
} from './partySession';

vi.mock('../api/client', () => {
  class FakeApiError extends Error {
    constructor(public status: number, public body: string, message: string) {
      super(message);
    }
  }
  return { ApiError: FakeApiError };
});

function entry(id: number, overrides: Partial<PartyTrack> = {}): PartyTrack {
  return {
    id,
    deezer_id: String(id * 100),
    title: `Song ${id}`,
    artist: 'Artist',
    artist_id: '1',
    artists: [{ id: '1', name: 'Artist' }],
    album: 'Album',
    album_id: '2',
    cover: '',
    duration_sec: 200,
    added_by: 'Host',
    added_by_member: 'u:1',
    load_state: 'ready',
    load_error: null,
    ...overrides,
  };
}

function party(overrides: Partial<PartyState> = {}): PartyState {
  return {
    code: 'ABC123',
    name: 'Friday',
    host_name: 'Host',
    is_host: false,
    current_index: 0,
    is_playing: true,
    position_sec: 10,
    playback_updated_at: '2026-11-20T12:00:00Z',
    members: [{ name: 'Host', avatar_url: null, is_guest: false }],
    tracks: [entry(1), entry(2), entry(3)],
    viewer_key: 'u:2',
    viewer_name: 'Me',
    viewer_is_guest: false,
    ...overrides,
  };
}

const NOW = Date.parse('2026-11-20T12:00:05Z');

function snapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    revision: 1,
    isSetup: true,
    queue: [{ mediaId: 'x', url: 'u' }] as PlayerSnapshot['queue'],
    activeIndex: 0,
    playbackState: PlaybackState.Ready,
    isPlaying: true,
    progress: { position: 15, duration: 200, buffered: 0, cached: 0 },
    repeatMode: 'off' as PlayerSnapshot['repeatMode'],
    shuffleEnabled: false,
    autoRadioEnabled: false,
    playbackSpeed: 1,
    volume: 1,
    sleepTimer: null as unknown as PlayerSnapshot['sleepTimer'],
    queuePersistence: { contextShuffleEnabled: false, contextShuffleRestoreOrder: [] },
    ...overrides,
  };
}

function harness(initialActive: number | null = 1) {
  const timers: { callback: () => void; ms: number; interval: boolean; cleared: boolean }[] = [];
  const playerListeners = new Set<() => void>();
  const streams: PartyStreamHandlers[] = [];
  const state = {
    snapshot: snapshot(),
    activeItemId: initialActive,
  };
  const deps = {
    repository: {
      joinParty: vi.fn(async () => party()),
      getParty: vi.fn(async () => party()),
      leaveParty: vi.fn(async () => undefined),
      partyAddTrack: vi.fn(async () => undefined),
      partySetCurrent: vi.fn(async () => undefined),
      partySetPlayback: vi.fn(async () => undefined),
    },
    openStream: vi.fn(async (_code: string, handlers: PartyStreamHandlers) => {
      streams.push(handlers);
      return vi.fn();
    }),
    player: {
      subscribe: vi.fn((listener: () => void) => {
        playerListeners.add(listener);
        return () => playerListeners.delete(listener);
      }),
      getSnapshot: vi.fn(() => state.snapshot),
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
    },
    syncQueue: vi.fn(async (_target: PartyQueueTarget) => 'replaced' as const),
    releaseQueue: vi.fn(async (_code: string) => true),
    activePartyItemId: vi.fn(() => state.activeItemId),
    now: vi.fn(() => NOW),
    setTimeout: vi.fn((callback: () => void, ms: number) => {
      const timer = { callback, ms, interval: false, cleared: false };
      timers.push(timer);
      return timer;
    }),
    clearTimeout: vi.fn((handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    }),
    setInterval: vi.fn((callback: () => void, ms: number) => {
      const timer = { callback, ms, interval: true, cleared: false };
      timers.push(timer);
      return timer;
    }),
    clearInterval: vi.fn((handle: unknown) => {
      (handle as { cleared: boolean }).cleared = true;
    }),
  } satisfies PartySessionDependencies;
  const session = new PartySession(deps);
  const tick = (ms: number) => {
    for (const timer of timers.filter((candidate) => candidate.ms === ms && !candidate.cleared)) {
      timer.callback();
      if (!timer.interval) timer.cleared = true;
    }
  };
  const playerChanged = () => {
    for (const listener of [...playerListeners]) listener();
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { session, deps, state, streams, timers, tick, playerChanged, settle };
}

describe('PartySession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('joins, opens the live stream and mirrors the party into the player', async () => {
    const h = harness();
    h.session.enter('ABC123');
    expect(h.session.getSnapshot()).toMatchObject({ code: 'ABC123', phase: 'joining' });
    await h.settle();

    expect(h.deps.repository.joinParty).toHaveBeenCalledWith('ABC123');
    expect(h.deps.openStream).toHaveBeenCalledWith('ABC123', expect.any(Object));
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'live', error: null, detached: false });
    expect(h.deps.syncQueue).toHaveBeenCalledWith(expect.objectContaining({
      code: 'ABC123',
      label: 'Friday',
      currentIndex: 0,
      playing: true,
      // A follower starts where the host is now: 10 s + 5 s since the broadcast.
      startPosition: 15,
      keepLocalPlayState: false,
    }));
    expect(h.session.isFollowingParty()).toBe(true);
  });

  it('shows why joining failed and joins again on retry', async () => {
    const h = harness();
    h.deps.repository.joinParty.mockRejectedValueOnce(
      new ApiError(404, JSON.stringify({ detail: 'Party not found' }), 'not found'),
    );
    h.session.enter('ABC123');
    await h.settle();
    expect(h.session.getSnapshot()).toMatchObject({
      phase: 'join-failed',
      error: strings.party.joinFailed('Party not found'),
    });
    expect(h.deps.openStream).not.toHaveBeenCalled();

    h.session.retryJoin();
    await h.settle();
    expect(h.session.getSnapshot().phase).toBe('live');
  });

  it('marks the party stale when the stream closes and reconnects with back-off', async () => {
    const h = harness();
    h.session.enter('ABC123');
    await h.settle();
    h.streams[0].onClosed(new Error('Netz weg'));
    expect(h.session.getSnapshot()).toMatchObject({
      phase: 'stale',
      error: strings.party.loadFailed('Netz weg'),
    });
    h.tick(PARTY_RECONNECT_DELAYS_MS[0]);
    await h.settle();
    expect(h.deps.openStream).toHaveBeenCalledTimes(2);

    h.streams[1].onState(party({ current_index: 1 }));
    expect(h.session.getSnapshot()).toMatchObject({ phase: 'live', error: null });
    expect(h.session.getSnapshot().party?.current_index).toBe(1);
  });

  it('reports a failed player sync instead of hiding it', async () => {
    const h = harness();
    h.deps.syncQueue.mockRejectedValueOnce(new Error('native queue refused'));
    h.session.enter('ABC123');
    await h.settle();
    await h.settle();
    expect(h.session.getSnapshot().playbackError).toBe(strings.party.syncFailed('native queue refused'));
  });

  it('as host broadcasts skips and play/pause, and ticks the position', async () => {
    const h = harness(1);
    const created = party({ is_host: true, viewer_key: 'u:1' });
    h.session.enter('ABC123', created);
    await h.settle();
    expect(h.deps.repository.joinParty).not.toHaveBeenCalled();
    expect(h.deps.syncQueue).toHaveBeenCalledWith(expect.objectContaining({ keepLocalPlayState: true }));

    // The track ended and the player moved on to entry 2.
    h.state.activeItemId = 2;
    h.playerChanged();
    expect(h.deps.repository.partySetCurrent).toHaveBeenCalledWith('ABC123', 1);

    // Paused locally.
    h.state.snapshot = snapshot({ isPlaying: false, progress: { position: 33, duration: 200, buffered: 0, cached: 0 } });
    h.playerChanged();
    expect(h.deps.repository.partySetPlayback).toHaveBeenLastCalledWith('ABC123', {
      is_playing: false,
      position_sec: 33,
    });

    // Buffering is not a pause.
    h.state.snapshot = snapshot({ isPlaying: false, playbackState: PlaybackState.Buffering });
    h.playerChanged();
    expect(h.deps.repository.partySetPlayback).toHaveBeenLastCalledWith('ABC123', {
      is_playing: true,
      position_sec: 15,
    });

    h.deps.repository.partySetPlayback.mockClear();
    h.state.activeItemId = 1;
    h.tick(PARTY_BROADCAST_INTERVAL_MS);
    expect(h.deps.repository.partySetPlayback).toHaveBeenCalledOnce();
  });

  it('surfaces a failed host broadcast', async () => {
    const h = harness(1);
    h.deps.repository.partySetPlayback.mockRejectedValue(new ApiError(0, '', 'offline'));
    h.session.enter('ABC123', party({ is_host: true }));
    await h.settle();
    h.tick(PARTY_BROADCAST_INTERVAL_MS);
    await h.settle();
    expect(h.session.getSnapshot().playbackError).toBe(
      strings.party.broadcastFailed(strings.party.serverUnreachable),
    );
  });

  it('pulls a follower back to the host’s play state and position', async () => {
    const h = harness(1);
    h.session.enter('ABC123');
    await h.settle();

    h.state.snapshot = snapshot({ isPlaying: false, progress: { position: 3, duration: 200, buffered: 0, cached: 0 } });
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.player.play).toHaveBeenCalledOnce();
    expect(h.deps.player.seekTo).toHaveBeenCalledWith(15);

    h.deps.player.seekTo.mockClear();
    h.state.snapshot = snapshot({ progress: { position: 15.5, duration: 200, buffered: 0, cached: 0 } });
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.player.seekTo).not.toHaveBeenCalled();

    // The follower skipped on its own: the next tick puts it back on the host's entry.
    h.deps.syncQueue.mockClear();
    h.state.activeItemId = 3;
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.syncQueue).toHaveBeenCalledOnce();
  });

  it('detaches when other music starts and follows again on request', async () => {
    const h = harness(1);
    h.session.enter('ABC123');
    await h.settle();

    h.state.activeItemId = null;
    h.playerChanged();
    expect(h.session.getSnapshot().detached).toBe(true);
    expect(h.session.isFollowingParty()).toBe(false);

    h.deps.syncQueue.mockClear();
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    expect(h.deps.syncQueue).not.toHaveBeenCalled();

    h.session.rejoinPlayback();
    await h.settle();
    expect(h.session.getSnapshot().detached).toBe(false);
    expect(h.deps.syncQueue).toHaveBeenCalledOnce();
  });

  it('listens at the host: releases the party from this device and stops steering it', async () => {
    const h = harness(1);
    h.session.enter('ABC123');
    await h.settle();
    expect(h.session.getSnapshot().listenMode).toBe('device');

    h.session.setListenMode('host');
    await h.settle();
    expect(h.session.getSnapshot()).toMatchObject({ listenMode: 'host', detached: false });
    expect(h.deps.releaseQueue).toHaveBeenCalledWith('ABC123');
    expect(h.session.isFollowingParty()).toBe(false);

    // New frames keep the party off this device instead of syncing it back.
    h.deps.syncQueue.mockClear();
    h.state.activeItemId = null;
    h.state.snapshot = snapshot({ queue: [], activeIndex: null, isPlaying: false });
    h.streams[0].onState(party({ current_index: 1 }));
    await h.settle();
    expect(h.deps.syncQueue).not.toHaveBeenCalled();

    // Neither the follower loop nor a player change touches the player.
    h.state.snapshot = snapshot({ isPlaying: false });
    h.tick(PARTY_FOLLOW_INTERVAL_MS);
    h.playerChanged();
    expect(h.deps.player.play).not.toHaveBeenCalled();
    expect(h.deps.player.seekTo).not.toHaveBeenCalled();
    expect(h.session.getSnapshot().detached).toBe(false);

    h.session.setListenMode('device');
    await h.settle();
    expect(h.session.getSnapshot().listenMode).toBe('device');
    expect(h.deps.syncQueue).toHaveBeenCalledWith(expect.objectContaining({ currentIndex: 1 }));
    expect(h.session.isFollowingParty()).toBe(true);
  });

  it('routes queue actions to the party at the host only while no own music is queued', async () => {
    const h = harness(1);
    h.session.enter('ABC123');
    await h.settle();
    expect(h.session.routesQueueActionsToParty()).toBe(true);

    h.session.setListenMode('host');
    await h.settle();
    h.state.snapshot = snapshot({ queue: [], activeIndex: null });
    expect(h.session.routesQueueActionsToParty()).toBe(true);
    h.state.snapshot = snapshot();
    expect(h.session.routesQueueActionsToParty()).toBe(false);
  });

  it('surfaces a failed release and refuses to send the host elsewhere', async () => {
    const h = harness(1);
    h.deps.releaseQueue.mockRejectedValueOnce(new Error('native clear timed out'));
    h.session.enter('ABC123');
    await h.settle();
    h.session.setListenMode('host');
    await h.settle();
    expect(h.session.getSnapshot().playbackError).toBe(strings.party.syncFailed('native clear timed out'));

    const host = harness(1);
    host.session.enter('ABC123', party({ is_host: true }));
    await host.settle();
    expect(() => host.session.setListenMode('host')).toThrow(
      'The host plays the party on this device and cannot listen elsewhere',
    );
  });

  it('leaves only after the server confirmed it and stops every timer', async () => {
    const h = harness();
    h.session.enter('ABC123');
    await h.settle();
    h.deps.repository.leaveParty.mockRejectedValueOnce(new Error('503'));
    await expect(h.session.leave()).rejects.toThrow('503');
    expect(h.session.getSnapshot().code).toBe('ABC123');

    await h.session.leave();
    expect(h.session.getSnapshot()).toMatchObject({ code: null, party: null, phase: 'idle' });
    expect(h.timers.every((timer) => timer.cleared || !timer.interval)).toBe(true);
  });

  it('adds songs for everyone and refuses a frame of another party', async () => {
    const h = harness();
    h.session.enter('ABC123');
    await h.settle();
    const song = { ...entry(9) } as never;
    await h.session.addTrack(song);
    expect(h.deps.repository.partyAddTrack).toHaveBeenCalledWith('ABC123', song);

    expect(() => h.streams[0].onState(party({ code: 'ZZZ999' }))).toThrow(
      'Party frame for ZZZ999 arrived on the ABC123 session',
    );
  });
});
