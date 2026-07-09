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
