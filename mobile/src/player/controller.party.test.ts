import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import {
  activePartyItemId,
  releasePartyQueue,
  partyQueueStableId,
  syncPartyQueue,
  type PartyQueueTarget,
} from './controller';
import { queueContextOf, queueStableIdOf } from './queueContract';

type FakeItem = { mediaId?: string; url: string; extras?: Record<string, unknown>; title?: string };

const player = vi.hoisted(() => ({
  queue: [] as FakeItem[],
  activeIndex: null as number | null,
  position: 0,
  getQueue: vi.fn(),
  getActiveMediaItemIndex: vi.fn(),
  getProgress: vi.fn(),
  replaceQueue: vi.fn(),
  clear: vi.fn(),
  removeMediaItem: vi.fn((index: number) => { player.queue.splice(index, 1); }),
  pause: vi.fn(),
  isShuffleEnabled: vi.fn(),
  setQueuePersistenceState: vi.fn(),
}));

vi.mock('./player', async () => {
  const { Event, RepeatMode } = await import('./playerPort');
  return {
    default: {
      getQueue: player.getQueue,
      getActiveMediaItemIndex: player.getActiveMediaItemIndex,
      getProgress: player.getProgress,
      replaceQueue: player.replaceQueue,
      clear: player.clear,
      removeMediaItem: player.removeMediaItem,
      pause: player.pause,
      isShuffleEnabled: player.isShuffleEnabled,
      setQueuePersistenceState: player.setQueuePersistenceState,
    },
    Event,
    RepeatMode,
  };
});
vi.mock('../api/client', () => ({
  authenticatedHeadersFor: vi.fn(async () => ({ Cookie: 'sf_session=test' })),
}));
vi.mock('../config', () => ({ getApiBase: vi.fn(async () => 'https://music.test') }));
vi.mock('../offline/registry', () => ({ offlineUriForTrack: vi.fn(() => null) }));
vi.mock('../data/repositories', () => ({
  musicRepository: { getRadio: vi.fn(), recordPlay: vi.fn(), preloadTrack: vi.fn() },
}));
vi.mock('./errors', () => ({
  clearPlayerError: vi.fn(),
  reportPlayerError: vi.fn(),
  UserFacingPlayerError: Error,
}));

function track(id: string): Track {
  return {
    id,
    title: `Song ${id}`,
    artist: 'Artist',
    artist_id: '1',
    artists: [{ id: '1', name: 'Artist' }],
    album: 'Album',
    album_id: '2',
    cover: '',
    duration_sec: 200,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

function target(overrides: Partial<PartyQueueTarget> = {}): PartyQueueTarget {
  return {
    code: 'ABC123',
    label: 'Friday',
    entries: [
      { itemId: 11, track: track('100') },
      { itemId: 12, track: track('200') },
      { itemId: 13, track: track('100') },
    ],
    currentIndex: 1,
    startPosition: 42,
    playing: true,
    keepLocalPlayState: false,
    ...overrides,
  };
}

function contextItem(id: string, stableId: string): FakeItem {
  return {
    mediaId: stableId,
    url: `https://music.test/${id}`,
    title: `Song ${id}`,
    extras: { queueStableId: stableId, track: track(id) },
  };
}

describe('party queue sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    player.queue = [];
    player.activeIndex = null;
    player.position = 0;
    player.getQueue.mockImplementation(() => [...player.queue]);
    player.getActiveMediaItemIndex.mockImplementation(() => player.activeIndex);
    player.getProgress.mockImplementation(() => ({ position: player.position, duration: 200, buffered: 0, cached: 0 }));
    player.isShuffleEnabled.mockReturnValue(false);
    player.replaceQueue.mockImplementation((items: FakeItem[], index: number) => {
      player.queue = [...items];
      player.activeIndex = index;
    });
    player.clear.mockImplementation(() => {
      player.queue = [];
      player.activeIndex = null;
    });
  });

  it('mirrors the party queue with per-entry identities and the party context', async () => {
    await expect(syncPartyQueue(target())).resolves.toBe('replaced');

    expect(player.queue.map(queueStableIdOf)).toEqual([
      partyQueueStableId('ABC123', 11),
      partyQueueStableId('ABC123', 12),
      partyQueueStableId('ABC123', 13),
    ]);
    expect(queueContextOf(player.queue[0] as never)).toEqual({ type: 'party', id: 'ABC123', label: 'Friday' });
    // A fresh entry starts where the host is.
    expect(player.replaceQueue).toHaveBeenCalledWith(expect.any(Array), 1, 42, true);
    expect(player.pause).not.toHaveBeenCalled();
    expect(activePartyItemId('ABC123')).toBe(12);
    expect(activePartyItemId('OTHER1')).toBeNull();
  });

  it('is a no-op when the player already matches, and keeps the playhead across edits', async () => {
    await syncPartyQueue(target());
    player.replaceQueue.mockClear();
    await expect(syncPartyQueue(target())).resolves.toBe('unchanged');
    expect(player.replaceQueue).not.toHaveBeenCalled();

    // Someone removed the first entry: the running entry shifts but keeps playing in place.
    player.position = 77;
    await expect(syncPartyQueue(target({
      entries: target().entries.slice(1),
      currentIndex: 0,
      startPosition: 0,
    }))).resolves.toBe('replaced');
    expect(player.replaceQueue).toHaveBeenLastCalledWith(expect.any(Array), 0, 77, true);
  });

  it('adopts the host’s own running song without restarting it when a party starts', async () => {
    player.queue = [contextItem('100', 'context:album:1:0:100'), contextItem('200', 'context:album:1:1:200')];
    player.activeIndex = 1;
    player.position = 63;

    await syncPartyQueue(target({ startPosition: 60, keepLocalPlayState: true }));
    // Host authority: resume=false leaves the native play-when-ready flag alone.
    expect(player.replaceQueue).toHaveBeenCalledWith(expect.any(Array), 1, 63, false);
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('pauses a follower when the party is paused and clears the player without a current entry', async () => {
    await syncPartyQueue(target({ playing: false }));
    expect(player.replaceQueue).toHaveBeenCalledWith(expect.any(Array), 1, 42, false);
    expect(player.pause).toHaveBeenCalledOnce();

    await expect(syncPartyQueue(target({ entries: [], currentIndex: -1 }))).resolves.toBe('cleared');
    expect(player.clear).toHaveBeenCalledOnce();
    await expect(syncPartyQueue(target({ entries: [], currentIndex: -1 }))).resolves.toBe('unchanged');
  });

  it('releases only this party and retains a personal track in a mixed queue', async () => {
    await syncPartyQueue(target());
    const personal = contextItem('300', 'context:album:1:0:300');
    player.queue.unshift(personal);
    player.activeIndex = 0;
    await releasePartyQueue('OTHER1');
    expect(player.queue).toHaveLength(4);
    await releasePartyQueue('ABC123');
    expect(player.queue).toEqual([personal]);
    expect(player.clear).not.toHaveBeenCalled();
  });

  it('rejects impossible targets loudly', async () => {
    await expect(syncPartyQueue(target({ currentIndex: 3 }))).rejects.toThrow(
      'Party current index 3 is outside a 3-entry party queue',
    );
    await expect(syncPartyQueue(target({ startPosition: Number.NaN }))).rejects.toThrow(
      /start position/,
    );
    await expect(syncPartyQueue(target({
      entries: [{ itemId: 5, track: track('1') }, { itemId: 5, track: track('2') }],
      currentIndex: 0,
    }))).rejects.toThrow('Party ABC123 has duplicate queue entry IDs');
  });
});
