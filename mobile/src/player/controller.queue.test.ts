import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearUpcomingQueue,
  getQueueSnapshot,
  moveQueueItem,
  removeQueueItem,
  skipToQueueItem,
} from './controller';
import { queueStableIdOf } from './queueContract';

const player = vi.hoisted(() => ({
  queue: [] as { mediaId?: string; url: string }[],
  activeIndex: null as number | null,
  getQueue: vi.fn(),
  getActiveMediaItemIndex: vi.fn(),
  skipToIndex: vi.fn(),
  removeMediaItem: vi.fn(),
  removeMediaItems: vi.fn(),
  moveMediaItem: vi.fn(),
  isShuffleEnabled: vi.fn(),
  setShuffleEnabled: vi.fn(),
  setQueuePersistenceState: vi.fn(),
}));

vi.mock('@rntp/player', () => ({
  default: {
    getQueue: player.getQueue,
    getActiveMediaItemIndex: player.getActiveMediaItemIndex,
    skipToIndex: player.skipToIndex,
    removeMediaItem: player.removeMediaItem,
    removeMediaItems: player.removeMediaItems,
    moveMediaItem: player.moveMediaItem,
    isShuffleEnabled: player.isShuffleEnabled,
    setShuffleEnabled: player.setShuffleEnabled,
    setQueuePersistenceState: player.setQueuePersistenceState,
  },
  Event: { MediaItemTransition: 'transition', PlaybackError: 'error' },
  RepeatMode: { Off: 0, All: 1, One: 2 },
}));
vi.mock('../api/client', () => ({ authenticatedHeadersFor: vi.fn() }));
vi.mock('../config', () => ({ getApiBase: vi.fn() }));
vi.mock('../data/repositories', () => ({
  musicRepository: { getRadio: vi.fn(), recordPlay: vi.fn(), preloadTrack: vi.fn() },
}));
vi.mock('./errors', () => ({
  clearPlayerError: vi.fn(),
  reportPlayerError: vi.fn(),
  UserFacingPlayerError: Error,
}));

function item(mediaId: string, stableId = mediaId) {
  return {
    mediaId,
    url: `https://music.test/${mediaId}`,
    extras: { queueStableId: stableId },
  };
}

const expectedQueue = () => player.queue.map(queueStableIdOf);

describe('native queue mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    player.queue = [item('a'), item('b'), item('c')];
    player.activeIndex = 1;
    player.getQueue.mockImplementation(() => [...player.queue]);
    player.getActiveMediaItemIndex.mockImplementation(() => player.activeIndex);
    player.skipToIndex.mockImplementation((index: number) => {
      player.activeIndex = index;
    });
    player.removeMediaItem.mockImplementation((index: number) => {
      player.queue.splice(index, 1);
      if (player.activeIndex !== null && index < player.activeIndex) player.activeIndex -= 1;
    });
    player.removeMediaItems.mockImplementation((fromIndex: number, toIndex: number) => {
      player.queue.splice(fromIndex, toIndex - fromIndex);
      if (player.activeIndex !== null && player.activeIndex >= fromIndex) {
        player.activeIndex = null;
      }
    });
    player.moveMediaItem.mockImplementation((fromIndex: number, toIndex: number) => {
      const [moved] = player.queue.splice(fromIndex, 1);
      if (moved) player.queue.splice(toIndex, 0, moved);
    });
    player.isShuffleEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the canonical queue with its active index', () => {
    expect(getQueueSnapshot()).toEqual({ items: player.queue, activeIndex: 1 });

    player.activeIndex = 4;
    expect(() => getQueueSnapshot()).toThrow(
      'Native player reported active index 4 for a 3-item queue',
    );
  });

  it('skips to a validated queue item and treats the active row as an intentional no-op', async () => {
    await expect(skipToQueueItem(2, expectedQueue())).resolves.toBeUndefined();
    expect(player.skipToIndex).toHaveBeenCalledWith(2);
    expect(player.activeIndex).toBe(2);

    player.skipToIndex.mockClear();
    await expect(skipToQueueItem(2, expectedQueue())).resolves.toBeUndefined();
    expect(player.skipToIndex).not.toHaveBeenCalled();
  });

  it('removes only non-active items', async () => {
    await expect(removeQueueItem(0, expectedQueue())).resolves.toBeUndefined();
    expect(player.queue.map((entry) => entry.mediaId)).toEqual(['b', 'c']);

    await expect(removeQueueItem(0, expectedQueue())).rejects.toThrow(
      'The currently playing queue item cannot be removed',
    );
    expect(player.removeMediaItem).toHaveBeenCalledTimes(1);
  });

  it('moves an item only when both endpoints are in bounds', async () => {
    player.activeIndex = 0;
    await expect(moveQueueItem(2, 1, expectedQueue())).resolves.toBeUndefined();
    expect(player.queue.map((entry) => entry.mediaId)).toEqual(['a', 'c', 'b']);

    await expect(moveQueueItem(0, 3, expectedQueue())).rejects.toThrow(
      'Move destination index 3 is outside a 3-item queue',
    );
    expect(player.moveMediaItem).toHaveBeenCalledTimes(1);
  });

  it('never moves an item across the currently playing track', async () => {
    await expect(moveQueueItem(2, 1, expectedQueue())).rejects.toThrow(
      'Queue items cannot be moved across the currently playing track',
    );
    await expect(moveQueueItem(1, 0, expectedQueue())).rejects.toThrow(
      'Queue items cannot be moved across the currently playing track',
    );
    expect(player.moveMediaItem).not.toHaveBeenCalled();
  });

  it('rejects corrupt duplicate stable queue IDs before touching native state', async () => {
    player.queue = [item('same'), item('same')];
    player.activeIndex = 0;

    await expect(moveQueueItem(1, 0, ['same', 'same'])).rejects.toThrow(
      'Move cannot safely target duplicate stable queue id same',
    );
    expect(player.moveMediaItem).not.toHaveBeenCalled();
  });

  it('targets repeated media IDs by persisted stable queue identity', async () => {
    player.queue = [
      item('same-track', 'instance-active'),
      item('same-track', 'instance-second'),
      item('same-track', 'instance-third'),
    ];
    player.activeIndex = 0;

    await expect(skipToQueueItem(1, expectedQueue())).resolves.toBeUndefined();
    expect(player.activeIndex).toBe(1);

    player.activeIndex = 0;
    await expect(moveQueueItem(2, 1, expectedQueue())).resolves.toBeUndefined();
    expect(player.queue.map(queueStableIdOf)).toEqual([
      'instance-active',
      'instance-third',
      'instance-second',
    ]);

    await expect(removeQueueItem(1, expectedQueue())).resolves.toBeUndefined();
    expect(player.queue.map(queueStableIdOf)).toEqual([
      'instance-active',
      'instance-second',
    ]);
  });

  it('rejects when a native queue call silently does nothing', async () => {
    vi.useFakeTimers();
    player.skipToIndex.mockImplementationOnce(() => undefined);

    const assertion = expect(skipToQueueItem(2, expectedQueue())).rejects.toThrow(
      'Queue skip was not applied by the native player',
    );
    await vi.advanceTimersByTimeAsync(1_600);
    await assertion;
  });

  it('rejects a stale rendered queue before touching native state', async () => {
    const rendered = expectedQueue();
    player.queue = [item('c'), item('a'), item('b')];

    await expect(removeQueueItem(0, rendered)).rejects.toThrow(
      'Remove was cancelled because the native queue changed',
    );
    expect(player.removeMediaItem).not.toHaveBeenCalled();
  });

  it('clears only future items while preserving history and the active item', async () => {
    player.queue = [item('history'), item('active'), item('future-1'), item('future-2')];
    player.activeIndex = 1;

    await expect(clearUpcomingQueue(expectedQueue())).resolves.toBeUndefined();

    expect(player.removeMediaItems).toHaveBeenCalledWith(2, 4);
    expect(player.queue.map((entry) => entry.mediaId)).toEqual(['history', 'active']);
    expect(player.activeIndex).toBe(1);
  });

  it('clears an inactive native queue because every item is upcoming', async () => {
    player.activeIndex = null;

    await expect(clearUpcomingQueue(expectedQueue())).resolves.toBeUndefined();

    expect(player.removeMediaItems).toHaveBeenCalledWith(0, 3);
    expect(player.queue).toEqual([]);
    expect(player.activeIndex).toBeNull();
  });

  it('treats clear upcoming at the queue end as a native no-op', async () => {
    player.activeIndex = 2;

    await expect(clearUpcomingQueue(expectedQueue())).resolves.toBeUndefined();

    expect(player.removeMediaItems).not.toHaveBeenCalled();
    expect(player.queue.map((entry) => entry.mediaId)).toEqual(['a', 'b', 'c']);
  });

  it('rejects stale clear-upcoming state before removing any native items', async () => {
    const rendered = expectedQueue();
    player.queue = [item('a'), item('changed'), item('c')];

    await expect(clearUpcomingQueue(rendered)).rejects.toThrow(
      'Clear upcoming was cancelled because the native queue changed',
    );
    expect(player.removeMediaItems).not.toHaveBeenCalled();
  });
});
