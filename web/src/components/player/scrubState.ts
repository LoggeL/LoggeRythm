import type { LivePlaybackClockSample } from "@/lib/playbackClock";

/** A thumb position the listener is holding, tied to the track it was made on. */
export interface ScrubDrag {
  value: number;
  trackKey: string;
}

/** Max seconds to extrapolate past the last store update when no live audio clock exists. */
export const MAX_CLOCK_EXTRAPOLATION_SEC = 1.25;

/** Tiny backward delta (e.g. remote heartbeat arriving slightly behind extrapolation) ignored to prevent 1px jitter. */
const BACKWARD_JITTER_TOLERANCE_SEC = 0.15;

export interface SmoothClockAnchor {
  trackKey: string | null;
  time: number;
  capturedAtMs: number;
}

/** Identifies the playing queue entry; null while nothing is loaded. */
export function scrubTrackKey(state: { index: number; queue: readonly { id: string | number }[] }): string | null {
  const track = state.queue[state.index];
  return track ? `${state.index}:${String(track.id)}` : null;
}

/**
 * The position a held drag applies to the playing track, or null when there is
 * nothing to apply. A drag made on another track is void: its seconds belong to
 * the track that has since ended, not to the one playing now.
 */
export function heldPosition(drag: ScrubDrag | null, trackKey: string | null): number | null {
  return drag !== null && drag.trackKey === trackKey ? drag.value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Normalized 0..1 progress ratio for GPU transforms (`scaleX` / `translate3d`). */
export function progressRatio(position: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return 0;
  return clamp(position / duration, 0, 1);
}

/**
 * Compute the smooth visual playhead position for the current animation frame.
 *
 * - While dragging: follows the held pointer position immediately.
 * - While playing locally: samples the active HTMLAudioElement's hardware clock
 *   directly (except while a seek is still pending/in-flight, avoiding flashback).
 * - While playing remotely (Connect / Jam control-only): smoothly extrapolates
 *   between periodic store ticks, capped at `MAX_CLOCK_EXTRAPOLATION_SEC` and
 *   protected against tiny backward network-jitter twitches.
 */
export function resolveSmoothPosition(input: {
  trackKey: string | null;
  trackId: string | null;
  duration: number;
  isPlaying: boolean;
  isBuffering: boolean;
  suppressLocalAudio: boolean;
  seekPending: boolean;
  dragPosition: number | null;
  anchor: SmoothClockAnchor;
  nowMs: number;
  liveClock: LivePlaybackClockSample | null;
  lastRenderedTime: number | null;
}): number {
  const { duration, trackKey } = input;
  if (!Number.isFinite(duration) || duration <= 0 || trackKey === null) return 0;
  if (input.dragPosition !== null && Number.isFinite(input.dragPosition)) {
    return clamp(input.dragPosition, 0, duration);
  }

  const base = input.anchor.trackKey === trackKey && Number.isFinite(input.anchor.time) ? input.anchor.time : 0;

  if (!input.isPlaying || input.isBuffering || input.seekPending) {
    return clamp(base, 0, duration);
  }

  if (
    !input.suppressLocalAudio &&
    input.liveClock !== null &&
    input.trackId !== null &&
    input.liveClock.trackId === input.trackId &&
    !input.liveClock.paused &&
    !input.liveClock.seeking &&
    Number.isFinite(input.liveClock.currentTime)
  ) {
    return clamp(input.liveClock.currentTime, 0, duration);
  }

  const elapsedSec = clamp((input.nowMs - input.anchor.capturedAtMs) / 1000, 0, MAX_CLOCK_EXTRAPOLATION_SEC);
  const candidate = clamp(base + elapsedSec, 0, duration);

  if (
    input.lastRenderedTime !== null &&
    input.lastRenderedTime > candidate &&
    input.lastRenderedTime - candidate <= BACKWARD_JITTER_TOLERANCE_SEC
  ) {
    return clamp(input.lastRenderedTime, 0, duration);
  }

  return candidate;
}
