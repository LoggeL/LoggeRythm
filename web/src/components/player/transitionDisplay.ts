import type {
  Track,
  TrackTransition,
  TrackTransitionEnd,
  TrackTransitionKind,
} from "@/types";
import {
  resolveTransitionProgress,
  type LiveTransitionClockSample,
} from "@/lib/playbackClock";

/** Duration (ms) for the outgoing track to leave after a transition completes naturally. */
export const TRANSITION_EXIT_MS = 320;

export type TransitionVisualPhase = "idle" | "active" | "exiting";

export interface IdleTransitionDisplay {
  phase: "idle";
}

export interface ActiveTransitionDisplay {
  phase: "active";
  id: number;
  kind: TrackTransitionKind;
  outgoing: Track;
  incoming: Track;
  progress: number;
  durationMs: number;
  remainingSec: number;
}

export interface ExitingTransitionDisplay {
  phase: "exiting";
  id: number;
  kind: TrackTransitionKind;
  outgoing: Track;
  incoming: Track;
  exitProgress: number;
  remainingExitMs: number;
}

export type TransitionDisplayState =
  | IdleTransitionDisplay
  | ActiveTransitionDisplay
  | ExitingTransitionDisplay;

export function transitionKindLabel(kind: TrackTransitionKind): string {
  switch (kind) {
    case "smart-crossfade":
      return "Smart-Übergang";
    case "crossfade":
      return "Übergang";
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unbekannter Übergangstyp: ${String(exhaustive)}`);
    }
  }
}

/**
 * Format remaining transition seconds for compact player chrome.
 * Fails loud on invalid numeric values instead of displaying NaN/0s silently.
 */
export function formatTransitionRemaining(remainingSec: number): string {
  if (!Number.isFinite(remainingSec) || remainingSec < 0) {
    throw new RangeError(
      `Verbleibende Übergangszeit muss eine nicht-negative endliche Zahl sein; erhalten: ${String(remainingSec)}.`,
    );
  }
  if (remainingSec < 0.95) {
    return `${Math.max(0.1, remainingSec).toFixed(1).replace(".", ",")} s`;
  }
  return `${Math.ceil(remainingSec)} s`;
}

/**
 * Compute remaining milliseconds in the post-completion outgoing-track exit window.
 * Returns 0 once the window has elapsed.
 */
export function computeRemainingExitMs(
  endedAtMs: number,
  nowMs: number,
  exitDurationMs = TRANSITION_EXIT_MS,
): number {
  if (!Number.isFinite(endedAtMs) || !Number.isFinite(nowMs)) {
    throw new RangeError(
      `Übergangszeitstempel müssen endlich sein (endedAtMs=${String(endedAtMs)}, nowMs=${String(nowMs)}).`,
    );
  }
  if (!Number.isFinite(exitDurationMs) || exitDurationMs < 0) {
    throw new RangeError(
      `Exit-Dauer muss nicht-negativ und endlich sein; erhalten: ${String(exitDurationMs)}.`,
    );
  }
  if (exitDurationMs === 0) return 0;
  const elapsed = nowMs - endedAtMs;
  if (elapsed < 0 || elapsed >= exitDurationMs) return 0;
  return exitDurationMs - elapsed;
}

/**
 * Check whether a completed transition end is eligible to animate the outgoing
 * track leaving on the currently active track.
 */
export function isExitEligible(
  currentTrack: Track | null,
  lastTransitionEnd: TrackTransitionEnd | null,
): lastTransitionEnd is TrackTransitionEnd {
  return (
    lastTransitionEnd !== null &&
    lastTransitionEnd.outcome === "completed" &&
    currentTrack !== null &&
    String(currentTrack.id) === String(lastTransitionEnd.incoming.id)
  );
}

/**
 * Pure visual state resolver for track transitions across PlayerBar & NowPlaying.
 *
 * - While `transition` is active, both outgoing and incoming tracks stay visible
 *   for the full overlap duration (`phase: "active"`).
 * - Only once a transition completes naturally (`outcome === "completed"`) and
 *   reduced motion is off does the outgoing track run its brief exit window
 *   (`phase: "exiting"`).
 * - Cancelled transitions (manual skip, seek, pause, error, queue change) or
 *   reduced-motion mode snap directly to `"idle"` with zero lingering ghost.
 */
export function resolveTransitionDisplay(input: {
  currentTrack: Track | null;
  transition: TrackTransition | null;
  lastTransitionEnd: TrackTransitionEnd | null;
  liveClock?: LiveTransitionClockSample | null;
  nowMs: number;
  exitDurationMs?: number;
  reducedMotion?: boolean;
}): TransitionDisplayState {
  const {
    currentTrack,
    transition,
    lastTransitionEnd,
    liveClock = null,
    nowMs,
    exitDurationMs = TRANSITION_EXIT_MS,
    reducedMotion = false,
  } = input;

  if (!Number.isFinite(nowMs)) {
    throw new RangeError(`nowMs muss endlich sein; erhalten: ${String(nowMs)}.`);
  }
  if (!Number.isFinite(exitDurationMs) || exitDurationMs < 0) {
    throw new RangeError(
      `exitDurationMs muss nicht-negativ und endlich sein; erhalten: ${String(exitDurationMs)}.`,
    );
  }

  if (transition !== null) {
    if (!Number.isFinite(transition.durationMs) || transition.durationMs <= 0) {
      throw new RangeError(
        `Übergangsdauer muss positiv und endlich sein; erhalten: ${String(transition.durationMs)}.`,
      );
    }
    const progress = resolveTransitionProgress(transition, liveClock);
    const remainingMs =
      liveClock !== null && liveClock.id === transition.id
        ? Math.max(0, liveClock.remainingMs)
        : Math.max(0, (1 - progress) * transition.durationMs);
    return {
      phase: "active",
      id: transition.id,
      kind: transition.kind,
      outgoing: transition.outgoing,
      incoming: transition.incoming,
      progress,
      durationMs: transition.durationMs,
      remainingSec: remainingMs / 1000,
    };
  }

  if (!reducedMotion && isExitEligible(currentTrack, lastTransitionEnd)) {
    const remainingExitMs = computeRemainingExitMs(
      lastTransitionEnd.endedAtMs,
      nowMs,
      exitDurationMs,
    );
    if (remainingExitMs > 0) {
      return {
        phase: "exiting",
        id: lastTransitionEnd.id,
        kind: lastTransitionEnd.kind,
        outgoing: lastTransitionEnd.outgoing,
        incoming: lastTransitionEnd.incoming,
        exitProgress: 1 - remainingExitMs / exitDurationMs,
        remainingExitMs,
      };
    }
  }

  return { phase: "idle" };
}

/**
 * Pure visual weight breakdown for tests and inline fallbacks.
 * Outgoing and incoming tracks stay visibly legible throughout `[0, 1]`
 * (neither drops to 0 mid-transition).
 */
export function transitionBlendWeights(progress: number): {
  outgoingCoverOpacity: number;
  outgoingTextOpacity: number;
  incomingCoverOpacity: number;
  incomingTextOpacity: number;
  outgoingBackdropOpacity: number;
  incomingBackdropOpacity: number;
} {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError(
      `Übergangsfortschritt muss im Bereich [0, 1] liegen; erhalten: ${String(progress)}.`,
    );
  }
  return {
    outgoingCoverOpacity: 1 - progress * 0.36,
    outgoingTextOpacity: 1 - progress * 0.42,
    incomingCoverOpacity: 0.68 + progress * 0.32,
    incomingTextOpacity: 0.72 + progress * 0.28,
    outgoingBackdropOpacity: 0.5 * (1 - progress),
    incomingBackdropOpacity: 0.5 * progress,
  };
}
