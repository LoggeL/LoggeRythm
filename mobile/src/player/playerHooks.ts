import { useSyncExternalStore } from 'react';
import { getDefaultPlayerPort } from './nativePlayerPort';
import type { MediaItem, PlaybackState, PlayerPort, Progress } from './playerPort';

type SubscribeFn = (listener: () => void) => () => void;

interface ActiveMediaItemCacheEntry {
  raw: MediaItem | null;
  stable: MediaItem | null;
}

const subscribeByPlayer = new WeakMap<PlayerPort, SubscribeFn>();
const activeMediaItemByPlayer = new WeakMap<PlayerPort, ActiveMediaItemCacheEntry>();

function getStableSubscribe(player: PlayerPort): SubscribeFn {
  let subscribe = subscribeByPlayer.get(player);
  if (subscribe === undefined) {
    subscribe = (listener: () => void) => player.subscribe(listener);
    subscribeByPlayer.set(player, subscribe);
  }
  return subscribe;
}

function deepValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== 'object'
    || left === null
    || typeof right !== 'object'
    || right === null
  ) {
    return false;
  }
  const leftIsArray = Array.isArray(left);
  if (leftIsArray !== Array.isArray(right)) return false;
  if (leftIsArray) {
    const rightArray = right as readonly unknown[];
    if (left.length !== rightArray.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepValueEqual(left[index], rightArray[index])) return false;
    }
    return true;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) return false;
    if (!deepValueEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}

function mediaItemsEqual(left: MediaItem | null, right: MediaItem | null): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  return (
    left.mediaId === right.mediaId
    && left.title === right.title
    && left.artist === right.artist
    && left.albumTitle === right.albumTitle
    && left.duration === right.duration
    && left.isLive === right.isLive
    && left.mimeType === right.mimeType
    && deepValueEqual(left.url, right.url)
    && deepValueEqual(left.artworkUrl, right.artworkUrl)
    && deepValueEqual(left.extras, right.extras)
  );
}

function getStableActiveMediaItem(player: PlayerPort): MediaItem | null {
  const candidate = player.getActiveMediaItem();
  const cached = activeMediaItemByPlayer.get(player);
  if (cached !== undefined) {
    if (cached.raw === candidate) return cached.stable;
    if (mediaItemsEqual(cached.stable, candidate)) {
      cached.raw = candidate;
      return cached.stable;
    }
  }
  activeMediaItemByPlayer.set(player, { raw: candidate, stable: candidate });
  return candidate;
}

function extractActiveTrackId(item: MediaItem | null): string | null {
  if (item === null) return null;
  const extrasTrack = item.extras?.track;
  if (extrasTrack !== undefined) {
    if (typeof extrasTrack !== 'object' || extrasTrack === null) {
      throw new Error(`Active media item ${String(item.mediaId)} contains invalid extras.track`);
    }
    const rawId = (extrasTrack as Record<string, unknown>).id;
    if (typeof rawId === 'string' && rawId.trim().length > 0) return rawId.trim();
    if (typeof rawId === 'number' && Number.isFinite(rawId)) return String(rawId);
    throw new Error(`Active media item ${String(item.mediaId)} extras.track is missing a valid id`);
  }
  return item.mediaId ?? null;
}

function usePlayerSelector<T>(selector: (player: PlayerPort) => T): T {
  const player = getDefaultPlayerPort();
  const subscribe = getStableSubscribe(player);
  return useSyncExternalStore(
    subscribe,
    () => selector(player),
    () => selector(player),
  );
}

/**
 * Returns the active MediaItem with a reference stabilized across progress-only
 * snapshots so consumers do not re-render every second while the same track plays.
 */
export function useActiveMediaItem(): MediaItem | null {
  return usePlayerSelector(getStableActiveMediaItem);
}

/** True whenever a track is loaded in the player; avoids re-renders on progress or track skips. */
export function useHasActiveTrack(): boolean {
  return usePlayerSelector((player) => player.getActiveMediaItem() !== null);
}

/**
 * Stable primitive track ID (`extras.track.id`, or `mediaId` for raw player
 * items without Track extras) of the active item, or `null` when idle/empty.
 */
export function useActiveTrackId(): string | null {
  return usePlayerSelector((player) => extractActiveTrackId(player.getActiveMediaItem()));
}

export function useIsPlaying(): boolean {
  return usePlayerSelector((player) => player.isPlaying());
}

export function usePlaybackState(): PlaybackState {
  return usePlayerSelector((player) => player.getPlaybackState());
}

/**
 * Progress arrives through immutable native snapshots. `updateInterval` is kept
 * for drop-in call-site compatibility; native controls the actual event cadence.
 */
export function useProgress(updateInterval = 1): Progress {
  if (!Number.isFinite(updateInterval) || updateInterval <= 0) {
    throw new RangeError('Progress update interval must be positive');
  }
  return usePlayerSelector((player) => player.getSnapshot().progress as Progress);
}
