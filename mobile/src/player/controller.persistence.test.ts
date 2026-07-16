import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '@rntp/player';
import type { Track } from '../api/types';
import {
  addToQueue,
  isContextShuffleEnabled,
  resetControllerState,
  restoreControllerStateFromNativeQueue,
  toggleShuffle,
} from './controller';
import {
  queueStableIdOf,
  withQueueProductMetadata,
  type QueueOrigin,
} from './queueContract';

const player = vi.hoisted(() => ({
  queue: [] as MediaItem[],
  activeIndex: null as number | null,
  persistence: {
    contextShuffleEnabled: false,
    contextShuffleRestoreOrder: [] as string[],
  },
  getQueue: vi.fn(),
  getActiveMediaItemIndex: vi.fn(),
  isShuffleEnabled: vi.fn(),
  setShuffleEnabled: vi.fn(),
  moveMediaItem: vi.fn(),
  getQueuePersistenceState: vi.fn(),
  setQueuePersistenceState: vi.fn(),
  addMediaItem: vi.fn(),
  insertMediaItem: vi.fn(),
  getApiBase: vi.fn(),
  authenticatedHeadersFor: vi.fn(),
  clearPlayerError: vi.fn(),
}));

vi.mock('@rntp/player', () => ({
  default: {
    getQueue: player.getQueue,
    getActiveMediaItemIndex: player.getActiveMediaItemIndex,
    isShuffleEnabled: player.isShuffleEnabled,
    setShuffleEnabled: player.setShuffleEnabled,
    moveMediaItem: player.moveMediaItem,
    getQueuePersistenceState: player.getQueuePersistenceState,
    setQueuePersistenceState: player.setQueuePersistenceState,
    addMediaItem: player.addMediaItem,
    insertMediaItem: player.insertMediaItem,
  },
  Event: {
    MediaItemTransition: 'transition',
    PlaybackProgressUpdated: 'progress',
    PlaybackError: 'error',
  },
  RepeatMode: { Off: 0, All: 1, One: 2 },
}));
vi.mock('../config', () => ({ getApiBase: player.getApiBase }));
vi.mock('../api/client', () => ({
  authenticatedHeadersFor: player.authenticatedHeadersFor,
}));
vi.mock('../data/repositories', () => ({
  musicRepository: { getRadio: vi.fn(), recordPlay: vi.fn(), preloadTrack: vi.fn() },
}));
vi.mock('./errors', () => ({
  clearPlayerError: player.clearPlayerError,
  reportPlayerError: vi.fn(),
  UserFacingPlayerError: Error,
}));

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Persistence Artist',
    artist_id: 'artist-1',
    artists: [{ id: 'artist-1', name: 'Persistence Artist' }],
    album: 'Persistence Album',
    album_id: 'album-1',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 1,
    release_date: '2026-07-16',
  };
}

function item(id: string, order: number | null, origin: QueueOrigin = 'context'): MediaItem {
  const value = track(id);
  return withQueueProductMetadata(
    {
      mediaId: `fixture:${id}`,
      url: `https://music.test/api/tracks/${id}/stream`,
      title: value.title,
      extras: { track: value, radio: false },
    },
    {
      origin,
      context: { type: 'playlist', id: 'playlist-1', label: 'Persistence playlist' },
      originalContextOrder: order,
      stableId: `${origin}:${order ?? id}:${id}`,
    },
  );
}

describe('controller process restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    player.queue = [];
    player.activeIndex = null;
    player.persistence = {
      contextShuffleEnabled: false,
      contextShuffleRestoreOrder: [],
    };
    player.getQueue.mockImplementation(() => [...player.queue]);
    player.getActiveMediaItemIndex.mockImplementation(() => player.activeIndex);
    player.isShuffleEnabled.mockReturnValue(false);
    player.moveMediaItem.mockImplementation((fromIndex: number, toIndex: number) => {
      const [moved] = player.queue.splice(fromIndex, 1);
      if (moved !== undefined) player.queue.splice(toIndex, 0, moved);
    });
    player.getQueuePersistenceState.mockImplementation(() => ({ ...player.persistence }));
    player.setQueuePersistenceState.mockImplementation((state) => {
      player.persistence = {
        contextShuffleEnabled: state.contextShuffleEnabled,
        contextShuffleRestoreOrder: [...state.contextShuffleRestoreOrder],
      };
    });
    player.addMediaItem.mockImplementation((mediaItem: MediaItem) => player.queue.push(mediaItem));
    player.insertMediaItem.mockImplementation((index: number, mediaItem: MediaItem) => {
      player.queue.splice(index, 0, mediaItem);
    });
    player.getApiBase.mockResolvedValue('https://music.test');
    player.authenticatedHeadersFor.mockResolvedValue({ Cookie: 'sf_session=fresh' });
    resetControllerState();
  });

  it('clears the account-scoped player error when controller state resets', () => {
    player.clearPlayerError.mockClear();

    resetControllerState();

    expect(player.clearPlayerError).toHaveBeenCalledOnce();
  });

  it('restores product shuffle intent and its exact stable-ID restore order', async () => {
    const active = item('active', 0);
    const manual = item('manual', null, 'manual');
    const first = item('first', 1);
    const second = item('second', 2);
    const third = item('third', 3);
    player.queue = [active, manual, second, third, first];
    player.activeIndex = 0;
    player.persistence = {
      contextShuffleEnabled: true,
      contextShuffleRestoreOrder: [first, second, third].map(queueStableIdOf),
    };

    restoreControllerStateFromNativeQueue();

    expect(isContextShuffleEnabled()).toBe(true);
    await expect(toggleShuffle()).resolves.toBe(false);
    expect(player.queue.map((entry) => entry.extras?.track).map((value) => (value as Track).id))
      .toEqual(['active', 'manual', 'first', 'second', 'third']);
    expect(player.setQueuePersistenceState).toHaveBeenLastCalledWith({
      contextShuffleEnabled: false,
      contextShuffleRestoreOrder: [],
    });
  });

  it('advances the manual-item sequence beyond restored IDs to avoid collisions', async () => {
    const active = item('active', 0);
    const restoredManual = {
      ...item('repeat', null, 'manual'),
      mediaId: 'added:41:repeat',
      extras: {
        ...item('repeat', null, 'manual').extras,
        queueStableId: 'manual:added%3A41%3Arepeat',
      },
    };
    player.queue = [active, restoredManual];
    player.activeIndex = 0;

    restoreControllerStateFromNativeQueue();
    await addToQueue(track('repeat'));

    expect(player.queue[2]?.mediaId).toBe('added:42:repeat');
    expect(new Set(player.queue.map(queueStableIdOf)).size).toBe(3);
  });
});
