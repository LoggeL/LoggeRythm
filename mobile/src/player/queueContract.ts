import type { MediaItem } from './player';

export const PRODUCT_QUEUE_CONTRACT_ID = 'loggerythm.product-queue.v1';
export type QueueOrigin = 'manual' | 'context';

export type QueueContextType =
  | 'album'
  | 'artist'
  | 'chart'
  | 'collection'
  | 'discover'
  | 'genre'
  | 'home'
  | 'liked'
  | 'playlist'
  | 'radio'
  | 'recent'
  | 'search';

export interface QueueContext {
  type: QueueContextType;
  id: string;
  /** Human-readable source title persisted with every newly-created context queue. */
  label: string;
}

/** Read shape for queues created before context labels were introduced. */
export interface QueueContextMetadata {
  type: QueueContextType;
  id: string;
  label: string | null;
}

export interface QueueProductMetadata {
  origin: QueueOrigin;
  context: QueueContextMetadata | null;
  originalContextOrder: number | null;
  stableId: string;
}

const QUEUE_ORIGIN_EXTRA = 'queueOrigin';
const QUEUE_CONTEXT_TYPE_EXTRA = 'queueContextType';
const QUEUE_CONTEXT_ID_EXTRA = 'queueContextId';
const QUEUE_CONTEXT_LABEL_EXTRA = 'queueContextLabel';
const QUEUE_ORIGINAL_CONTEXT_ORDER_EXTRA = 'queueOriginalContextOrder';
const QUEUE_STABLE_ID_EXTRA = 'queueStableId';
const QUEUE_CONTEXT_TYPES: ReadonlySet<string> = new Set<QueueContextType>([
  'album',
  'artist',
  'chart',
  'collection',
  'discover',
  'genre',
  'home',
  'liked',
  'playlist',
  'radio',
  'recent',
  'search',
]);

function itemLabel(item: MediaItem): string {
  return String(item.mediaId);
}

function requireNonEmptyMetadataString(
  item: MediaItem,
  key: string,
  value: unknown,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(
      `Queue item ${itemLabel(item)} has invalid ${key} ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Android Auto and queues restored from an older APK do not carry LoggeRythm's
 * origin extra. They are catalog/context queues by definition, so missing
 * metadata deliberately falls back to context. An explicit unknown value is a
 * corrupt contract and must not be silently reclassified.
 */
export function queueOriginOf(item: MediaItem): QueueOrigin {
  const value = item.extras?.[QUEUE_ORIGIN_EXTRA];
  if (value === undefined) return 'context';
  if (value === 'manual' || value === 'context') return value;
  throw new Error(
    `Queue item ${String(item.mediaId)} has invalid ${QUEUE_ORIGIN_EXTRA} ${JSON.stringify(value)}`,
  );
}

export function withQueueOrigin(item: MediaItem, origin: QueueOrigin): MediaItem {
  return {
    ...item,
    extras: {
      ...item.extras,
      [QUEUE_ORIGIN_EXTRA]: origin,
    },
  };
}

/**
 * Return the semantic source for a product-created queue item. Legacy queues
 * have neither field and deliberately return null. A half-present or unknown
 * context is corrupt metadata because it cannot be restored deterministically.
 */
export function queueContextOf(item: MediaItem): QueueContextMetadata | null {
  const typeValue = item.extras?.[QUEUE_CONTEXT_TYPE_EXTRA];
  const idValue = item.extras?.[QUEUE_CONTEXT_ID_EXTRA];
  const labelValue = item.extras?.[QUEUE_CONTEXT_LABEL_EXTRA];
  if (typeValue === undefined && idValue === undefined && labelValue === undefined) return null;
  const type = requireNonEmptyMetadataString(
    item,
    QUEUE_CONTEXT_TYPE_EXTRA,
    typeValue,
  );
  if (!QUEUE_CONTEXT_TYPES.has(type)) {
    throw new Error(
      `Queue item ${itemLabel(item)} has invalid ${QUEUE_CONTEXT_TYPE_EXTRA} ${JSON.stringify(type)}`,
    );
  }
  const id = requireNonEmptyMetadataString(item, QUEUE_CONTEXT_ID_EXTRA, idValue);
  const label =
    labelValue === undefined
      ? null
      : requireNonEmptyMetadataString(item, QUEUE_CONTEXT_LABEL_EXTRA, labelValue);
  return { type: type as QueueContextType, id, label };
}

/** Missing order means a queue restored from an older APK, not order zero. */
export function queueOriginalContextOrderOf(item: MediaItem): number | null {
  const value = item.extras?.[QUEUE_ORIGINAL_CONTEXT_ORDER_EXTRA];
  if (value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(
      `Queue item ${itemLabel(item)} has invalid ${QUEUE_ORIGINAL_CONTEXT_ORDER_EXTRA} ${JSON.stringify(value)}`,
    );
  }
  return value as number;
}

/**
 * Product-created items carry a stable id independent of list position.
 * Older/native-created items safely fall back to their unique media id.
 */
export function queueStableIdOf(item: MediaItem): string {
  const value = item.extras?.[QUEUE_STABLE_ID_EXTRA];
  if (value !== undefined) {
    return requireNonEmptyMetadataString(item, QUEUE_STABLE_ID_EXTRA, value);
  }
  const mediaId = item.mediaId;
  if (typeof mediaId !== 'string' || mediaId.length === 0) {
    throw new Error(
      `Queue item ${itemLabel(item)} has neither ${QUEUE_STABLE_ID_EXTRA} nor a mediaId`,
    );
  }
  return mediaId;
}

export function queueProductMetadataOf(item: MediaItem): QueueProductMetadata {
  return {
    origin: queueOriginOf(item),
    context: queueContextOf(item),
    originalContextOrder: queueOriginalContextOrderOf(item),
    stableId: queueStableIdOf(item),
  };
}

/** Attach all queue fields in one operation so new items cannot be half-tagged. */
export function withQueueProductMetadata(
  item: MediaItem,
  metadata: {
    origin: QueueOrigin;
    context?: QueueContextMetadata | null;
    originalContextOrder?: number | null;
    stableId: string;
  },
): MediaItem {
  const context = metadata.context ?? null;
  const originalContextOrder = metadata.originalContextOrder ?? null;
  const candidate: MediaItem = {
    ...item,
    extras: {
      ...item.extras,
      [QUEUE_ORIGIN_EXTRA]: metadata.origin,
      ...(context === null
        ? {}
        : {
            [QUEUE_CONTEXT_TYPE_EXTRA]: context.type,
            [QUEUE_CONTEXT_ID_EXTRA]: context.id,
            ...(context.label === null
              ? {}
              : { [QUEUE_CONTEXT_LABEL_EXTRA]: context.label }),
          }),
      ...(originalContextOrder === null
        ? {}
        : { [QUEUE_ORIGINAL_CONTEXT_ORDER_EXTRA]: originalContextOrder }),
      [QUEUE_STABLE_ID_EXTRA]: metadata.stableId,
    },
  };
  // Reuse the read-side validation so writers and restored/native data obey
  // exactly the same contract.
  const parsed = queueProductMetadataOf(candidate);
  if (parsed.origin === 'manual' && parsed.originalContextOrder !== null) {
    throw new Error('Manual queue items cannot have an original context order');
  }
  if (parsed.origin === 'context' && parsed.context === null) {
    throw new Error('New context queue items require context metadata');
  }
  if (parsed.origin === 'context' && parsed.originalContextOrder === null) {
    throw new Error('New context queue items require an original context order');
  }
  return candidate;
}

/** Next canonical order for radio or other context items appended over time. */
export function nextOriginalContextOrder(queue: readonly MediaItem[]): number {
  let next = 0;
  for (const item of queue) {
    if (queueOriginOf(item) !== 'context') continue;
    const order = queueOriginalContextOrderOf(item);
    if (order !== null) next = Math.max(next, order + 1);
    else next += 1;
  }
  return next;
}

function upcomingContextIndexes(
  queue: readonly MediaItem[],
  activeIndex: number,
): number[] {
  if (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= queue.length) {
    throw new Error(
      `Queue context order requires an active index inside the ${queue.length}-item queue`,
    );
  }
  assertManualQueuePriority(queue, activeIndex);
  const indexes: number[] = [];
  for (let index = activeIndex + 1; index < queue.length; index += 1) {
    if (queueOriginOf(queue[index]) === 'context') indexes.push(index);
  }
  return indexes;
}

function assertUniqueStableIds(items: readonly MediaItem[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    const stableId = queueStableIdOf(item);
    if (seen.has(stableId)) {
      throw new Error(`Queue context contains duplicate stable id ${stableId}`);
    }
    seen.add(stableId);
  }
}

export function captureUpcomingContextOrder(
  queue: readonly MediaItem[],
  activeIndex: number,
): string[] {
  const items = upcomingContextIndexes(queue, activeIndex).map((index) => queue[index]);
  assertUniqueStableIds(items);
  return items.map(queueStableIdOf);
}

/** Fisher-Yates with an injected RNG makes the queue policy directly testable. */
export function shuffleUpcomingContext(
  queue: readonly MediaItem[],
  activeIndex: number,
  random: () => number,
): MediaItem[] {
  const indexes = upcomingContextIndexes(queue, activeIndex);
  const shuffled = indexes.map((index) => queue[index]);
  assertUniqueStableIds(shuffled);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error(`Queue shuffle random source returned ${String(sample)}`);
    }
    const swapIndex = Math.floor(sample * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const result = [...queue];
  indexes.forEach((queueIndex, index) => {
    result[queueIndex] = shuffled[index];
  });
  return result;
}

/**
 * Restore canonical metadata order. When any legacy item lacks order metadata,
 * the exact pre-shuffle stable-id snapshot is the compatibility fallback.
 */
export function restoreUpcomingContext(
  queue: readonly MediaItem[],
  activeIndex: number,
  fallbackStableIds: readonly string[],
): MediaItem[] {
  const indexes = upcomingContextIndexes(queue, activeIndex);
  const contextItems = indexes.map((index) => queue[index]);
  assertUniqueStableIds(contextItems);
  const orders = contextItems.map(queueOriginalContextOrderOf);
  const fallbackRank = new Map(fallbackStableIds.map((stableId, index) => [stableId, index]));
  if (fallbackRank.size !== fallbackStableIds.length) {
    throw new Error('Queue shuffle restore snapshot contains duplicate stable ids');
  }

  const ranked = contextItems.map((item, currentIndex) => ({
    item,
    currentIndex,
    stableId: queueStableIdOf(item),
    order: orders[currentIndex],
  }));
  if (orders.every((order) => order !== null)) {
    ranked.sort((left, right) =>
      (left.order as number) - (right.order as number) ||
      left.currentIndex - right.currentIndex,
    );
  } else {
    ranked.sort((left, right) => {
      const leftRank = fallbackRank.get(left.stableId) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = fallbackRank.get(right.stableId) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.currentIndex - right.currentIndex;
    });
  }

  const result = [...queue];
  indexes.forEach((queueIndex, index) => {
    result[queueIndex] = ranked[index].item;
  });
  return result;
}

/** Assert the Spotify-style invariant for items that have not played yet. */
export function assertManualQueuePriority(queue: readonly MediaItem[], activeIndex: number): void {
  let contextIndex: number | null = null;
  for (let index = activeIndex + 1; index < queue.length; index += 1) {
    const origin = queueOriginOf(queue[index]);
    if (origin === 'context') {
      contextIndex ??= index;
    } else if (contextIndex !== null) {
      throw new Error(
        `Manual queue priority is invalid: manual item ${index} follows context item ${contextIndex}`,
      );
    }
  }
}

/**
 * Ordinary "Add to queue" goes behind existing manual additions but before
 * the first remaining playlist/album/radio item.
 */
export function manualQueueTailIndex(queue: readonly MediaItem[], activeIndex: number): number {
  assertManualQueuePriority(queue, activeIndex);
  for (let index = activeIndex + 1; index < queue.length; index += 1) {
    if (queueOriginOf(queue[index]) === 'context') return index;
  }
  return queue.length;
}

export function hasUpcomingManualItems(
  queue: readonly MediaItem[],
  activeIndex: number,
): boolean {
  assertManualQueuePriority(queue, activeIndex);
  for (let index = activeIndex + 1; index < queue.length; index += 1) {
    if (queueOriginOf(queue[index]) === 'manual') return true;
  }
  return false;
}

/** Do not allow a UI reorder to destroy the primary/secondary queue boundary. */
export function assertMovePreservesManualPriority(
  queue: readonly MediaItem[],
  activeIndex: number | null,
  fromIndex: number,
  toIndex: number,
): void {
  if (activeIndex === null || fromIndex <= activeIndex || toIndex <= activeIndex) return;
  assertManualQueuePriority(queue, activeIndex);
  if (queueOriginOf(queue[fromIndex]) !== queueOriginOf(queue[toIndex])) {
    throw new Error('Queue items cannot be moved across the manual/context boundary');
  }
}

/** Filter both ids already queued and duplicate ids returned by a radio API call. */
export function uniqueTracksNotInQueue<T extends { id: string }>(
  candidates: readonly T[],
  queuedIds: ReadonlySet<string>,
  limit: number,
): T[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`Radio append limit must be a non-negative integer, received ${limit}`);
  }
  if (limit === 0) return [];
  const seen = new Set(queuedIds);
  const selected: T[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    selected.push(candidate);
    if (selected.length === limit) break;
  }
  return selected;
}
