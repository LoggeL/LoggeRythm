import type { TrackTransition } from "@/types";

/**
 * Lightweight bridge allowing visual playhead indicators (Scrubber, ProgressLine)
 * to sample the active HTMLAudioElement's hardware media clock inside
 * requestAnimationFrame without triggering React re-renders.
 */
export interface LivePlaybackClockSample {
  trackId: string;
  currentTime: number;
  paused: boolean;
  seeking: boolean;
}

export type LivePlaybackClockReader = () => LivePlaybackClockSample | null;

export interface LiveTransitionClockSample {
  id: number;
  /** Normalized 0..1 progress of the active audio crossfade. */
  progress: number;
  /** Remaining wall-clock overlap duration in milliseconds (>= 0). */
  remainingMs: number;
}

export type LiveTransitionClockReader = () => LiveTransitionClockSample | null;

let activeClockReader: LivePlaybackClockReader | null = null;
let activeTransitionClockReader: LiveTransitionClockReader | null = null;

export function registerLivePlaybackClock(reader: LivePlaybackClockReader): () => void {
  activeClockReader = reader;
  return () => {
    if (activeClockReader === reader) {
      activeClockReader = null;
    }
  };
}

export function readLivePlaybackClock(): LivePlaybackClockSample | null {
  return activeClockReader ? activeClockReader() : null;
}

export function registerLiveTransitionClock(reader: LiveTransitionClockReader): () => void {
  activeTransitionClockReader = reader;
  return () => {
    if (activeTransitionClockReader === reader) {
      activeTransitionClockReader = null;
    }
  };
}

export function readLiveTransitionClock(): LiveTransitionClockSample | null {
  return activeTransitionClockReader ? activeTransitionClockReader() : null;
}

/**
 * Resolve the normalized 0..1 progress of an active `TrackTransition`:
 * - Uses the live hardware-timed transition clock when it matches `transition.id`
 *   (60fps inside requestAnimationFrame during real audio playback).
 * - Otherwise uses `transition.progress` verbatim (deterministic unit tests,
 *   SSR, and frozen store-injected visual snapshots).
 * Fails loudly on non-finite or out-of-range progress values.
 */
export function resolveTransitionProgress(
  transition: Pick<TrackTransition, "id" | "progress">,
  liveClock: LiveTransitionClockSample | null = readLiveTransitionClock(),
): number {
  if (
    !Number.isFinite(transition.progress) ||
    transition.progress < 0 ||
    transition.progress > 1
  ) {
    throw new RangeError(
      `Transition progress must be in [0, 1]; received ${transition.progress}.`,
    );
  }
  if (liveClock !== null && liveClock.id === transition.id) {
    if (
      !Number.isFinite(liveClock.progress) ||
      liveClock.progress < 0 ||
      liveClock.progress > 1
    ) {
      throw new RangeError(
        `Live transition clock progress must be in [0, 1]; received ${liveClock.progress}.`,
      );
    }
    return liveClock.progress;
  }
  return transition.progress;
}
