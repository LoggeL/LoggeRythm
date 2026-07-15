import TrackPlayer, {
  Event,
  RepeatMode,
  type BackgroundEvent,
  type MediaItem,
  type MediaItemTransitionEvent,
  type PlaybackErrorEvent,
} from '@rntp/player';
import type { Track } from '../api/types';
import { authenticatedHeadersFor } from '../api/client';
import { getApiBase } from '../config';
import * as api from '../api/endpoints';
import { clearPlayerError, reportPlayerError } from './errors';
import { mediaItemIsRadio, mediaItemToTrack, trackToMediaItem } from './mediaItem';

let listenersInstalled = false;
let extending = false;
let queueGeneration = 0;
let itemSequence = 0;
const BACKGROUND_REQUEST_TIMEOUT_MS = 4_000;
const QUEUE_MUTATION_TIMEOUT_MS = 1_500;
const QUEUE_MUTATION_POLL_MS = 25;

export interface QueueSnapshot {
  items: MediaItem[];
  activeIndex: number | null;
}

function nextMediaId(prefix: string, track: Track): string {
  itemSequence += 1;
  return `${prefix}:${itemSequence}:${track.id}`;
}

async function mediaContext(): Promise<{ base: string; headers: Record<string, string> }> {
  const base = await getApiBase();
  const headers = await authenticatedHeadersFor(base);
  return { base, headers };
}

/** Replace the queue with `tracks`, start at `startIndex`, and play. */
export async function playTracks(
  tracks: Track[],
  startIndex = 0,
  opts: { radio?: boolean } = {},
): Promise<void> {
  if (tracks.length === 0) throw new Error('playTracks called with an empty track list');
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= tracks.length) {
    throw new Error(`playTracks startIndex ${startIndex} is outside a ${tracks.length}-track queue`);
  }
  const { base, headers } = await mediaContext();
  const generation = ++queueGeneration;
  clearPlayerError();
  TrackPlayer.setMediaItems(
    tracks.map((track, index) =>
      trackToMediaItem(track, base, headers, {
        mediaId: `queue:${generation}:${index}:${track.id}`,
        radio: opts.radio,
      }),
    ),
    startIndex,
  );
  TrackPlayer.play();
}

/** Start endless radio seeded from a track. */
export async function startRadio(seed: Track): Promise<void> {
  const similar = await api.getRadio(seed.id);
  const queue = [seed, ...similar.filter((track) => track.id !== seed.id)];
  await playTracks(queue, 0, { radio: true });
}

/** Insert a track immediately after the current one. */
export async function playNext(track: Track): Promise<void> {
  const { base, headers } = await mediaContext();
  const index = TrackPlayer.getActiveMediaItemIndex();
  const queue = TrackPlayer.getQueue();
  const at = index == null ? queue.length : index + 1;
  const radio = index == null ? false : mediaItemIsRadio(queue[index]);
  TrackPlayer.insertMediaItem(
    at,
    trackToMediaItem(track, base, headers, { mediaId: nextMediaId('next', track), radio }),
  );
}

/** Append a track to the end of the queue. */
export async function addToQueue(track: Track): Promise<void> {
  const { base, headers } = await mediaContext();
  const queue = TrackPlayer.getQueue();
  const activeIndex = TrackPlayer.getActiveMediaItemIndex();
  const radio = activeIndex == null ? false : mediaItemIsRadio(queue[activeIndex]);
  TrackPlayer.addMediaItem(
    trackToMediaItem(track, base, headers, { mediaId: nextMediaId('added', track), radio }),
  );
}

export function togglePlay(): void {
  clearPlayerError();
  if (TrackPlayer.isPlaying()) TrackPlayer.pause();
  else TrackPlayer.play();
}

export const next = (): void => TrackPlayer.skipToNext();
export const prev = (): void => TrackPlayer.skipToPrevious();
export const seekTo = (seconds: number): void => TrackPlayer.seekTo(seconds);

function requireQueueIndex(queue: MediaItem[], index: number, operation: string): MediaItem {
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
    throw new Error(`${operation} index ${index} is outside a ${queue.length}-item queue`);
  }
  return queue[index];
}

function requireUniqueMediaId(queue: MediaItem[], index: number, operation: string): string {
  const item = requireQueueIndex(queue, index, operation);
  const mediaId = item.mediaId;
  if (typeof mediaId !== 'string' || mediaId.length === 0) {
    throw new Error(`${operation} cannot verify queue item ${index} because it has no mediaId`);
  }
  const matches = queue.filter((candidate) => candidate.mediaId === mediaId).length;
  if (matches !== 1) {
    throw new Error(`${operation} cannot safely target duplicate mediaId ${mediaId}`);
  }
  return mediaId;
}

function assertExpectedQueue(
  queue: MediaItem[],
  expectedMediaIds: readonly string[],
  operation: string,
): void {
  if (queue.length !== expectedMediaIds.length) {
    throw new Error(`${operation} was cancelled because the native queue changed`);
  }
  const seen = new Set<string>();
  queue.forEach((item, index) => {
    const mediaId = item.mediaId;
    if (typeof mediaId !== 'string' || mediaId.length === 0) {
      throw new Error(`${operation} cannot verify queue item ${index} because it has no mediaId`);
    }
    if (seen.has(mediaId)) {
      throw new Error(`${operation} cannot safely target duplicate mediaId ${mediaId}`);
    }
    seen.add(mediaId);
    if (mediaId !== expectedMediaIds[index]) {
      throw new Error(`${operation} was cancelled because the native queue changed`);
    }
  });
}

function waitForNativeQueueMutation(
  operation: string,
  predicate: () => boolean,
): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const inspect = () => {
      try {
        if (predicate()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() - startedAt >= QUEUE_MUTATION_TIMEOUT_MS) {
        reject(new Error(`${operation} was not applied by the native player`));
        return;
      }
      setTimeout(inspect, QUEUE_MUTATION_POLL_MS);
    };
    setTimeout(inspect, 0);
  });
}

/** Read the canonical native queue together with its active canonical index. */
export function getQueueSnapshot(): QueueSnapshot {
  const items = TrackPlayer.getQueue();
  const activeIndex = TrackPlayer.getActiveMediaItemIndex();
  if (
    activeIndex !== null &&
    (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= items.length)
  ) {
    throw new Error(
      `Native player reported active index ${activeIndex} for a ${items.length}-item queue`,
    );
  }
  return { items, activeIndex };
}

/** Jump to an item in the native queue and verify that the transition happened. */
export async function skipToQueueItem(
  index: number,
  expectedMediaIds: readonly string[],
): Promise<void> {
  const { items, activeIndex } = getQueueSnapshot();
  assertExpectedQueue(items, expectedMediaIds, 'Skip');
  const mediaId = requireUniqueMediaId(items, index, 'Skip');
  if (activeIndex === index) return;

  TrackPlayer.skipToIndex(index);
  await waitForNativeQueueMutation('Queue skip', () => {
    const snapshot = getQueueSnapshot();
    return snapshot.activeIndex === index && snapshot.items[index]?.mediaId === mediaId;
  });
}

/** Remove a non-active item from the native queue and verify that it disappeared. */
export async function removeQueueItem(
  index: number,
  expectedMediaIds: readonly string[],
): Promise<void> {
  const { items, activeIndex } = getQueueSnapshot();
  assertExpectedQueue(items, expectedMediaIds, 'Remove');
  if (activeIndex === index) throw new Error('The currently playing queue item cannot be removed');
  const activeMediaId =
    activeIndex === null ? null : requireUniqueMediaId(items, activeIndex, 'Remove');
  const mediaId = requireUniqueMediaId(items, index, 'Remove');
  const originalLength = items.length;

  queueGeneration += 1;
  TrackPlayer.removeMediaItem(index);
  await waitForNativeQueueMutation('Queue removal', () => {
    const snapshot = getQueueSnapshot();
    const activeItem =
      snapshot.activeIndex === null ? null : snapshot.items[snapshot.activeIndex];
    return (
      snapshot.items.length === originalLength - 1 &&
      !snapshot.items.some((item) => item.mediaId === mediaId) &&
      (activeMediaId === null || activeItem?.mediaId === activeMediaId)
    );
  });
}

/** Move an item within the canonical native queue and verify its destination. */
export async function moveQueueItem(
  fromIndex: number,
  toIndex: number,
  expectedMediaIds: readonly string[],
): Promise<void> {
  const { items, activeIndex } = getQueueSnapshot();
  assertExpectedQueue(items, expectedMediaIds, 'Move');
  const mediaId = requireUniqueMediaId(items, fromIndex, 'Move');
  requireQueueIndex(items, toIndex, 'Move destination');
  if (fromIndex === toIndex) return;
  const activeMediaId =
    activeIndex === null ? null : requireUniqueMediaId(items, activeIndex, 'Move');
  if (
    activeIndex !== null &&
    (fromIndex === activeIndex ||
      toIndex === activeIndex ||
      (fromIndex < activeIndex) !== (toIndex < activeIndex))
  ) {
    throw new Error('Queue items cannot be moved across the currently playing track');
  }

  queueGeneration += 1;
  TrackPlayer.moveMediaItem(fromIndex, toIndex);
  await waitForNativeQueueMutation('Queue move', () => {
    const snapshot = getQueueSnapshot();
    const activeItem =
      snapshot.activeIndex === null ? null : snapshot.items[snapshot.activeIndex];
    return (
      snapshot.items.length === items.length &&
      snapshot.items[toIndex]?.mediaId === mediaId &&
      (activeMediaId === null || activeItem?.mediaId === activeMediaId)
    );
  });
}

/** Cycle Off → All → One → Off, returning the new mode. */
export function cycleRepeat(): RepeatMode {
  const current = TrackPlayer.getRepeatMode();
  const nextMode =
    current === RepeatMode.Off
      ? RepeatMode.All
      : current === RepeatMode.All
        ? RepeatMode.One
        : RepeatMode.Off;
  TrackPlayer.setRepeatMode(nextMode);
  return nextMode;
}

export function toggleShuffle(): boolean {
  const enabled = !TrackPlayer.isShuffleEnabled();
  TrackPlayer.setShuffleEnabled(enabled);
  return enabled;
}

async function handleMediaItemTransition(
  event: MediaItemTransitionEvent,
  requestTimeoutMs?: number,
): Promise<void> {
  const operations: Promise<void>[] = [];
  const track = mediaItemToTrack(event.item);
  if (track !== null) operations.push(api.recordPlay(track, requestTimeoutMs));
  operations.push(maybeExtendRadio(event.index, requestTimeoutMs));
  const results = await Promise.allSettled(operations);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));
  if (failures.length > 0) {
    throw new Error(`Playback transition side effects failed: ${failures.join('; ')}`);
  }
}

function playbackError(error: PlaybackErrorEvent): Error {
  return new Error(`${error.code}: ${error.message}`);
}

/** Called by Android's headless playback task while the UI is backgrounded. */
export async function handleBackgroundPlaybackEvent(event: BackgroundEvent): Promise<void> {
  if (event.type === Event.MediaItemTransition) {
    await handleMediaItemTransition(event, BACKGROUND_REQUEST_TIMEOUT_MS);
  } else if (event.type === Event.PlaybackError) {
    throw playbackError(event);
  }
}

/** Install one-time foreground listeners for play recording, radio, and errors. */
export function installPlaybackListeners(): void {
  if (listenersInstalled) return;
  TrackPlayer.addEventListener(Event.MediaItemTransition, (event) => {
    void handleMediaItemTransition(event).catch((error) =>
      reportPlayerError('Playback bookkeeping failed', error),
    );
  });
  TrackPlayer.addEventListener(Event.PlaybackError, (error) => {
    reportPlayerError('Playback failed', playbackError(error));
  });
  listenersInstalled = true;
}

async function maybeExtendRadio(activeIndex: number, requestTimeoutMs?: number): Promise<void> {
  if (extending) return;
  const generation = queueGeneration;
  const queue = TrackPlayer.getQueue();
  const active = queue[activeIndex];
  if (!mediaItemIsRadio(active) || queue.length - activeIndex > 2) return;
  const seed = mediaItemToTrack(active);
  if (seed === null) throw new Error(`Radio queue item ${activeIndex} has no Track metadata`);

  extending = true;
  try {
    const { base, headers } = await mediaContext();
    const similar = await api.getRadio(seed.id, undefined, requestTimeoutMs);
    if (generation !== queueGeneration) return;
    const existing = new Set(
      queue.map((item) => mediaItemToTrack(item)?.id).filter((id): id is string => id !== undefined),
    );
    const fresh = similar.filter((track) => !existing.has(track.id)).slice(0, 5);
    if (fresh.length > 0) {
      TrackPlayer.addMediaItems(
        fresh.map((track) =>
          trackToMediaItem(track, base, headers, {
            mediaId: nextMediaId('radio', track),
            radio: true,
          }),
        ),
      );
    }
  } finally {
    extending = false;
  }
}

export function resetControllerState(): void {
  extending = false;
  queueGeneration += 1;
  clearPlayerError();
}

export function currentQueue(): MediaItem[] {
  return TrackPlayer.getQueue();
}
