import type { MediaItem } from './player';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import contractData from '../../../contracts/product-queue.v1.json';
import type { Track } from '../api/types';
import {
  addToQueue,
  clearUpcomingQueue,
  isContextShuffleEnabled,
  moveQueueItem,
  playNext,
  removeQueueItem,
  resetControllerState,
  toggleShuffle,
} from './controller';
import {
  PRODUCT_QUEUE_CONTRACT_ID,
  queueOriginOf,
  queueStableIdOf,
  withQueueProductMetadata,
  type QueueOrigin,
} from './queueContract';

type FixtureItem = {
  id: string;
  origin: QueueOrigin;
  originalContextOrder: number | null;
};

type ExpectedState = {
  items: string[];
  origins: QueueOrigin[];
  active: string;
  shuffle: boolean;
};

type FixtureStep = {
  operation: 'add' | 'play-next' | 'toggle-shuffle' | 'move' | 'remove' | 'clear-upcoming';
  item?: FixtureItem;
  itemId?: string;
  from?: string;
  to?: string;
  random?: number[];
  expected?: ExpectedState;
  expectedError?: 'manual-context-boundary' | 'active-item';
};

type GoldenContract = {
  $id: string;
  version: number;
  origins: QueueOrigin[];
  rules: {
    sections: string[];
    upcomingOrder: QueueOrigin[];
  };
  cases: {
    id: string;
    initial: { items: FixtureItem[]; active: string };
    steps: FixtureStep[];
  }[];
};

const contract = contractData as unknown as GoldenContract;

const player = vi.hoisted(() => ({
  queue: [] as MediaItem[],
  activeIndex: null as number | null,
  getQueue: vi.fn(),
  getActiveMediaItemIndex: vi.fn(),
  insertMediaItem: vi.fn(),
  addMediaItem: vi.fn(),
  removeMediaItem: vi.fn(),
  removeMediaItems: vi.fn(),
  moveMediaItem: vi.fn(),
  isShuffleEnabled: vi.fn(),
  setShuffleEnabled: vi.fn(),
  setQueuePersistenceState: vi.fn(),
  getApiBase: vi.fn(),
  authenticatedHeadersFor: vi.fn(),
  clearPlayerError: vi.fn(),
}));

vi.mock('./player', async () => {
  const { Event, RepeatMode } = await import('./playerPort');
  return {
    default: {
      getQueue: player.getQueue,
      getActiveMediaItemIndex: player.getActiveMediaItemIndex,
      insertMediaItem: player.insertMediaItem,
      addMediaItem: player.addMediaItem,
      removeMediaItem: player.removeMediaItem,
      removeMediaItems: player.removeMediaItems,
      moveMediaItem: player.moveMediaItem,
      isShuffleEnabled: player.isShuffleEnabled,
      setShuffleEnabled: player.setShuffleEnabled,
      setQueuePersistenceState: player.setQueuePersistenceState,
    },
    Event,
    RepeatMode,
  };
});
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
    title: `Golden ${id}`,
    artist: 'Queue Contract',
    artist_id: 'queue-contract',
    artists: [{ id: 'queue-contract', name: 'Queue Contract' }],
    album: 'Product Queue v1',
    album_id: 'product-queue-v1',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 1,
    release_date: '2026-07-16',
  };
}

function media(item: FixtureItem): MediaItem {
  const value = track(item.id);
  return withQueueProductMetadata(
    {
      mediaId: `golden:${item.id}`,
      url: `https://music.test/api/tracks/${item.id}/stream`,
      title: value.title,
      extras: { track: value, radio: false },
    },
    {
      origin: item.origin,
      context: { type: 'playlist', id: 'golden-v1', label: 'Product Queue v1' },
      originalContextOrder: item.originalContextOrder,
      stableId: `golden:${item.id}`,
    },
  );
}

function trackId(item: MediaItem): string {
  const value = item.extras?.track as Track | undefined;
  if (value === undefined) throw new Error(`Golden item ${String(item.mediaId)} has no track`);
  return value.id;
}

function itemIndex(id: string): number {
  const matches = player.queue
    .map((item, index) => ({ id: trackId(item), index }))
    .filter((item) => item.id === id);
  if (matches.length !== 1) throw new Error(`Golden fixture item ${id} must be unique`);
  return matches[0].index;
}

function expectedStableIds(): string[] {
  return player.queue.map(queueStableIdOf);
}

function randomSource(samples: readonly number[] = []): {
  random: () => number;
  assertConsumed: () => void;
} {
  let index = 0;
  return {
    random: () => {
      if (index >= samples.length) throw new Error('Golden shuffle exhausted random samples');
      const sample = samples[index];
      index += 1;
      return sample;
    },
    assertConsumed: () => expect(index).toBe(samples.length),
  };
}

async function applyStep(step: FixtureStep): Promise<void> {
  if (step.operation === 'add' || step.operation === 'play-next') {
    if (step.item === undefined) throw new Error(`${step.operation} requires an item`);
    if (step.item.origin !== 'manual') throw new Error(`${step.operation} item must be manual`);
    await (step.operation === 'add' ? addToQueue : playNext)(track(step.item.id));
    return;
  }
  if (step.operation === 'toggle-shuffle') {
    const source = randomSource(step.random);
    await toggleShuffle(undefined, source.random);
    source.assertConsumed();
    return;
  }
  if (step.operation === 'move') {
    if (step.from === undefined || step.to === undefined) {
      throw new Error('move requires from and to fixture IDs');
    }
    await moveQueueItem(itemIndex(step.from), itemIndex(step.to), expectedStableIds());
    return;
  }
  if (step.operation === 'remove') {
    if (step.itemId === undefined) throw new Error('remove requires an itemId');
    await removeQueueItem(itemIndex(step.itemId), expectedStableIds());
    return;
  }
  if (step.operation === 'clear-upcoming') {
    await clearUpcomingQueue(expectedStableIds());
    return;
  }
  throw new Error(`Unsupported golden queue operation ${String(step.operation)}`);
}

function snapshot(): ExpectedState {
  if (player.activeIndex === null) throw new Error('Golden queue lost its active item');
  return {
    items: player.queue.map(trackId),
    origins: player.queue.map(queueOriginOf),
    active: trackId(player.queue[player.activeIndex]),
    shuffle: isContextShuffleEnabled(),
  };
}

function errorCode(error: unknown): FixtureStep['expectedError'] {
  if (!(error instanceof Error)) throw error;
  if (error.message.includes('manual/context boundary')) return 'manual-context-boundary';
  if (
    error.message.includes('currently playing queue item') ||
    error.message.includes('currently playing track')
  ) {
    return 'active-item';
  }
  throw error;
}

function assertActiveExactlyOnce(activeId: string): void {
  expect(snapshot().active).toBe(activeId);
  expect(player.queue.filter((item) => trackId(item) === activeId)).toHaveLength(1);
}

describe('shared product queue v1 golden contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    player.queue = [];
    player.activeIndex = null;
    player.getQueue.mockImplementation(() => [...player.queue]);
    player.getActiveMediaItemIndex.mockImplementation(() => player.activeIndex);
    player.insertMediaItem.mockImplementation((index: number, item: MediaItem) => {
      player.queue.splice(index, 0, item);
    });
    player.addMediaItem.mockImplementation((item: MediaItem) => {
      player.queue.push(item);
    });
    player.removeMediaItem.mockImplementation((index: number) => {
      player.queue.splice(index, 1);
      if (player.activeIndex !== null && index < player.activeIndex) player.activeIndex -= 1;
    });
    player.removeMediaItems.mockImplementation((fromIndex: number, toIndex: number) => {
      player.queue.splice(fromIndex, toIndex - fromIndex);
    });
    player.moveMediaItem.mockImplementation((fromIndex: number, toIndex: number) => {
      const active = player.activeIndex === null ? null : player.queue[player.activeIndex];
      const [moved] = player.queue.splice(fromIndex, 1);
      if (moved !== undefined) player.queue.splice(toIndex, 0, moved);
      if (active !== null) player.activeIndex = player.queue.indexOf(active);
    });
    player.isShuffleEnabled.mockReturnValue(false);
    player.getApiBase.mockResolvedValue('https://music.test');
    player.authenticatedHeadersFor.mockResolvedValue({ Cookie: 'sf_session=golden' });
    resetControllerState();
  });

  it('runs every shared golden case against the Android native queue adapter', async () => {
    expect(contract.$id).toBe(PRODUCT_QUEUE_CONTRACT_ID);
    expect(contract.version).toBe(1);
    expect(contract.origins).toEqual(['manual', 'context']);
    expect(contract.rules.sections).toEqual(['history', 'current', 'manual', 'context']);
    expect(contract.rules.upcomingOrder).toEqual(['manual', 'context']);
    expect(contract.cases.length).toBeGreaterThan(0);

    for (const goldenCase of contract.cases) {
      resetControllerState();
      player.queue = goldenCase.initial.items.map(media);
      player.activeIndex = itemIndex(goldenCase.initial.active);
      assertActiveExactlyOnce(goldenCase.initial.active);

      for (const step of goldenCase.steps) {
        if (step.expectedError !== undefined) {
          const before = snapshot();
          let caught: unknown;
          try {
            await applyStep(step);
          } catch (error) {
            caught = error;
          }
          expect(errorCode(caught)).toBe(step.expectedError);
          expect(snapshot()).toEqual(before);
        } else {
          await applyStep(step);
          expect(snapshot(), `${goldenCase.id}: ${step.operation}`).toEqual(step.expected);
        }
        assertActiveExactlyOnce(goldenCase.initial.active);
      }
    }
  });
});
