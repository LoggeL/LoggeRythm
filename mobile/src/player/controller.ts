import TrackPlayer, { Event, RepeatMode } from '@rntp/player';
import type { Track } from '../api/types';
import { getApiBase } from '../config';
import * as api from '../api/endpoints';
import { mediaItemToTrack, trackToMediaItem } from './mediaItem';

/**
 * Playback controller — a thin, app-friendly layer over RNTP's native queue.
 * RNTP owns the queue; we translate Tracks to MediaItems and drive it.
 */

let radioActive = false;
let extending = false;
let listenersInstalled = false;

/** Replace the queue with `tracks`, start at `startIndex`, and play. */
export async function playTracks(
  tracks: Track[],
  startIndex = 0,
  opts: { radio?: boolean } = {},
): Promise<void> {
  if (tracks.length === 0) throw new Error('playTracks called with an empty track list');
  const base = await getApiBase();
  TrackPlayer.setMediaItems(tracks.map((t) => trackToMediaItem(t, base)), startIndex);
  TrackPlayer.play();
  radioActive = opts.radio ?? false;
}

/** Start endless radio seeded from a track (plays it, then auto-extends with similar tracks). */
export async function startRadio(seed: Track): Promise<void> {
  const similar = await api.getRadio(seed.id);
  const queue = [seed, ...similar.filter((t) => t.id !== seed.id)];
  await playTracks(queue, 0, { radio: true });
}

/** Insert a track to play immediately after the current one. */
export async function playNext(track: Track): Promise<void> {
  const base = await getApiBase();
  const idx = TrackPlayer.getActiveMediaItemIndex();
  const at = idx == null ? TrackPlayer.getQueue().length : idx + 1;
  TrackPlayer.insertMediaItem(at, trackToMediaItem(track, base));
}

/** Append a track to the end of the queue. */
export async function addToQueue(track: Track): Promise<void> {
  const base = await getApiBase();
  TrackPlayer.addMediaItem(trackToMediaItem(track, base));
}

export function togglePlay(): void {
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
    current === RepeatMode.Off ? RepeatMode.All : current === RepeatMode.All ? RepeatMode.One : RepeatMode.Off;
  TrackPlayer.setRepeatMode(nextMode);
  return nextMode;
}

export function toggleShuffle(): boolean {
  const enabled = !TrackPlayer.isShuffleEnabled();
  TrackPlayer.setShuffleEnabled(enabled);
  return enabled;
}

/** Install one-time event listeners for play recording and radio auto-extend. */
export function installPlaybackListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;

  TrackPlayer.addEventListener(Event.MediaItemTransition, ({ item, index }) => {
    const track = mediaItemToTrack(item);
    if (track) {
      api.recordPlay(track).catch((e) => console.warn('recordPlay failed:', e.message));
    }
    void maybeExtendRadio(index);
  });

  // A track can fail to stream (e.g. the backend returns 502 while materializing
  // from Deezer). Mirror the web app and auto-advance to the next track after a
  // short grace period, but only when there's somewhere to go — otherwise a dead
  // backend would race through the whole queue.
  TrackPlayer.addEventListener(Event.PlaybackError, (e) => {
    console.warn('playback error:', e);
    const index = TrackPlayer.getActiveMediaItemIndex();
    const queue = TrackPlayer.getQueue();
    if (index != null && index < queue.length - 1) {
      setTimeout(() => TrackPlayer.skipToNext(), 1500);
    }
  });
}

/**
 * When radio is active and the queue is running low, fetch similar tracks for
 * the current song and append up to 5 fresh ones (Spotify-style endless radio,
 * mirroring web/src/components/PlayerBar.tsx).
 */
async function maybeExtendRadio(activeIndex: number): Promise<void> {
  if (!radioActive || extending) return;
  const queue = TrackPlayer.getQueue();
  if (queue.length - activeIndex > 2) return;

  const seed = mediaItemToTrack(queue[activeIndex]);
  if (!seed) return;

  extending = true;
  try {
    const base = await getApiBase();
    const similar = await api.getRadio(seed.id);
    const existing = new Set(queue.map((q) => q.mediaId));
    const fresh = similar.filter((t) => !existing.has(String(t.id))).slice(0, 5);
    if (fresh.length > 0) {
      TrackPlayer.addMediaItems(fresh.map((t) => trackToMediaItem(t, base)));
    }
  } catch (e) {
    console.warn('radio auto-extend failed:', (e as Error).message);
  } finally {
    extending = false;
  }
}
