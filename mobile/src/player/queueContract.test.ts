import type { MediaItem } from './player';
import { describe, expect, it } from 'vitest';
import {
  assertManualQueuePriority,
  assertMovePreservesManualPriority,
  captureUpcomingContextOrder,
  hasUpcomingManualItems,
  manualQueueTailIndex,
  nextOriginalContextOrder,
  queueContextOf,
  queueOriginalContextOrderOf,
  queueOriginOf,
  queueProductMetadataOf,
  queueStableIdOf,
  restoreUpcomingContext,
  shuffleUpcomingContext,
  uniqueTracksNotInQueue,
  withQueueOrigin,
  withQueueProductMetadata,
  type QueueContext,
  type QueueOrigin,
} from './queueContract';

function item(id: string, origin?: QueueOrigin): MediaItem {
  const base: MediaItem = {
    mediaId: id,
    url: `https://music.test/${id}`,
    extras: { retained: `metadata:${id}` },
  };
  return origin === undefined ? base : withQueueOrigin(base, origin);
}

function productItem(
  id: string,
  origin: QueueOrigin,
  order: number | null,
  context: QueueContext = {
    type: 'playlist',
    id: 'playlist-42',
    label: 'Road-trip mix',
  },
): MediaItem {
  return withQueueProductMetadata(item(id), {
    origin,
    context,
    originalContextOrder: order,
    stableId: `${origin}:${order ?? id}:${id}`,
  });
}

describe('manual/context queue contract', () => {
  it('round-trips explicit origins and treats legacy or Android Auto items as context', () => {
    const legacy = item('legacy');
    const manual = withQueueOrigin(legacy, 'manual');
    const context = withQueueOrigin(manual, 'context');

    expect(queueOriginOf(legacy)).toBe('context');
    expect(queueOriginOf(manual)).toBe('manual');
    expect(queueOriginOf(context)).toBe('context');
    expect(manual.extras).toEqual({ retained: 'metadata:legacy', queueOrigin: 'manual' });
  });

  it('fails loudly for explicit corrupt origin metadata', () => {
    const corrupt = {
      ...item('corrupt'),
      extras: { queueOrigin: 'recommendation' },
    };
    expect(() => queueOriginOf(corrupt)).toThrow(
      'Queue item corrupt has invalid queueOrigin "recommendation"',
    );
  });

  it('defines the exact primary/manual then secondary/context order', () => {
    const golden = [
      item('history', 'context'),
      item('active', 'context'),
      item('manual-1', 'manual'),
      item('manual-2', 'manual'),
      item('context-1', 'context'),
      item('context-2', 'context'),
    ];

    expect(() => assertManualQueuePriority(golden, 1)).not.toThrow();
    expect(manualQueueTailIndex(golden, 1)).toBe(4);
    expect(hasUpcomingManualItems(golden, 1)).toBe(true);

    const contextOnly = golden.filter((entry) => queueOriginOf(entry) === 'context');
    expect(manualQueueTailIndex(contextOnly, 1)).toBe(2);
    expect(hasUpcomingManualItems(contextOnly, 1)).toBe(false);

    const manualOnly = [item('active', 'context'), item('m1', 'manual'), item('m2', 'manual')];
    expect(manualQueueTailIndex(manualOnly, 0)).toBe(3);
  });

  it('rejects a manual item stranded behind remaining context', () => {
    const invalid = [
      item('active', 'context'),
      item('manual-1', 'manual'),
      item('context-1', 'context'),
      item('manual-2', 'manual'),
    ];
    expect(() => assertManualQueuePriority(invalid, 0)).toThrow(
      'Manual queue priority is invalid: manual item 3 follows context item 2',
    );
    expect(() => manualQueueTailIndex(invalid, 0)).toThrow('Manual queue priority is invalid');
  });

  it('allows reordering inside an origin section but not across its boundary', () => {
    const queue = [
      item('active', 'context'),
      item('m1', 'manual'),
      item('m2', 'manual'),
      item('c1', 'context'),
      item('c2', 'context'),
    ];
    expect(() => assertMovePreservesManualPriority(queue, 0, 1, 2)).not.toThrow();
    expect(() => assertMovePreservesManualPriority(queue, 0, 3, 4)).not.toThrow();
    expect(() => assertMovePreservesManualPriority(queue, 0, 2, 3)).toThrow(
      'Queue items cannot be moved across the manual/context boundary',
    );
  });

  it('deduplicates radio candidates against the live queue and against themselves', () => {
    const candidates = [
      { id: 'queued' },
      { id: 'new-1' },
      { id: 'new-1' },
      { id: 'new-2' },
      { id: 'new-3' },
      { id: 'new-4' },
    ];
    expect(uniqueTracksNotInQueue(candidates, new Set(['queued']), 3)).toEqual([
      { id: 'new-1' },
      { id: 'new-2' },
      { id: 'new-3' },
    ]);
    expect(uniqueTracksNotInQueue(candidates, new Set(), 0)).toEqual([]);
    expect(() => uniqueTracksNotInQueue(candidates, new Set(), -1)).toThrow(
      'Radio append limit must be a non-negative integer',
    );
  });

  it('round-trips complete product metadata while retaining unrelated extras', () => {
    const value = productItem('duplicate-track-id', 'context', 3);

    expect(queueProductMetadataOf(value)).toEqual({
      origin: 'context',
      context: { type: 'playlist', id: 'playlist-42', label: 'Road-trip mix' },
      originalContextOrder: 3,
      stableId: 'context:3:duplicate-track-id',
    });
    expect(value.extras?.retained).toBe('metadata:duplicate-track-id');
    expect(queueContextOf(item('legacy'))).toBeNull();
    expect(queueOriginalContextOrderOf(item('legacy'))).toBeNull();
    expect(queueStableIdOf(item('legacy'))).toBe('legacy');
  });

  it('reads pre-label semantic contexts without inventing a persisted title', () => {
    expect(
      queueContextOf({
        ...item('pre-label'),
        extras: {
          queueContextType: 'playlist',
          queueContextId: 'playlist-42',
        },
      }),
    ).toEqual({ type: 'playlist', id: 'playlist-42', label: null });
  });

  it('fails loudly for corrupt context, order, and stable-id metadata', () => {
    expect(() =>
      queueContextOf({
        ...item('half-context'),
        extras: { queueContextType: 'playlist' },
      }),
    ).toThrow('invalid queueContextId');
    expect(() =>
      queueContextOf({
        ...item('bad-context'),
        extras: { queueContextType: 'podcast', queueContextId: 'show-1' },
      }),
    ).toThrow('invalid queueContextType "podcast"');
    expect(() =>
      queueContextOf({
        ...item('bad-context-label'),
        extras: {
          queueContextType: 'playlist',
          queueContextId: 'playlist-42',
          queueContextLabel: '   ',
        },
      }),
    ).toThrow('invalid queueContextLabel "   "');
    expect(() =>
      queueOriginalContextOrderOf({
        ...item('bad-order'),
        extras: { queueOriginalContextOrder: -1 },
      }),
    ).toThrow('invalid queueOriginalContextOrder -1');
    expect(() =>
      queueStableIdOf({ ...item('bad-stable-id'), extras: { queueStableId: '' } }),
    ).toThrow('invalid queueStableId ""');
  });

  it('shuffles only upcoming context and leaves history, active, and manual priority pinned', () => {
    const queue = [
      productItem('history', 'context', 0),
      productItem('active', 'context', 1),
      productItem('manual-1', 'manual', null),
      productItem('manual-2', 'manual', null),
      productItem('context-a', 'context', 2),
      productItem('context-b', 'context', 3),
      productItem('context-c', 'context', 4),
    ];
    const samples = [0, 0];
    const shuffled = shuffleUpcomingContext(queue, 1, () => samples.shift() ?? 0);

    expect(shuffled.map((entry) => entry.mediaId)).toEqual([
      'history',
      'active',
      'manual-1',
      'manual-2',
      'context-b',
      'context-c',
      'context-a',
    ]);
    expect(queue.map((entry) => entry.mediaId)).toEqual([
      'history',
      'active',
      'manual-1',
      'manual-2',
      'context-a',
      'context-b',
      'context-c',
    ]);
    expect(() => assertManualQueuePriority(shuffled, 1)).not.toThrow();
  });

  it('restores metadata order exactly even when duplicate catalog track ids exist', () => {
    const original = [
      productItem('active', 'context', 0),
      productItem('duplicate', 'context', 1),
      productItem('duplicate', 'context', 2),
      productItem('other', 'context', 3),
    ];
    const fallback = captureUpcomingContextOrder(original, 0);
    const shuffled = shuffleUpcomingContext(original, 0, () => 0);
    const restored = restoreUpcomingContext(shuffled, 0, fallback);

    expect(restored.map(queueStableIdOf)).toEqual(original.map(queueStableIdOf));
    expect(restored.map((entry) => entry.mediaId)).toEqual([
      'active',
      'duplicate',
      'duplicate',
      'other',
    ]);
  });

  it('restores a legacy queue from the captured stable-id order and appends new items', () => {
    const original = [item('active'), item('legacy-a'), item('legacy-b'), item('legacy-c')];
    const fallback = captureUpcomingContextOrder(original, 0);
    const shuffled = shuffleUpcomingContext(original, 0, () => 0);
    const withNewItem = [...shuffled, item('legacy-appended')];

    expect(
      restoreUpcomingContext(withNewItem, 0, fallback).map((entry) => entry.mediaId),
    ).toEqual(['active', 'legacy-a', 'legacy-b', 'legacy-c', 'legacy-appended']);
  });

  it('computes the next original order across legacy and metadata-backed context items', () => {
    expect(
      nextOriginalContextOrder([
        item('legacy'),
        productItem('context-4', 'context', 4),
        productItem('manual', 'manual', null),
      ]),
    ).toBe(5);
  });

  it('rejects invalid random samples and duplicate restore ids deterministically', () => {
    const queue = [
      productItem('active', 'context', 0),
      productItem('one', 'context', 1),
      productItem('two', 'context', 2),
    ];
    expect(() => shuffleUpcomingContext(queue, 0, () => 1)).toThrow(
      'Queue shuffle random source returned 1',
    );
    expect(() => restoreUpcomingContext(queue, 0, ['same', 'same'])).toThrow(
      'Queue shuffle restore snapshot contains duplicate stable ids',
    );
  });
});
