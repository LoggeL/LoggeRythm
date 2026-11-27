"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import {
  readLiveTransitionClock,
  resolveTransitionProgress,
} from "@/lib/playbackClock";
import type { TrackTransitionEnd } from "@/types";
import {
  TRANSITION_EXIT_MS,
  computeRemainingExitMs,
  isExitEligible,
  resolveTransitionDisplay,
  type TransitionDisplayState,
} from "./transitionDisplay";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const media = window.matchMedia(REDUCED_MOTION_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

const getReducedMotionServerSnapshot = (): boolean => false;

// Shared client external store managing the post-completion exit window across
// PlayerBar and NowPlaying so late mounts never replay a stale exit animation
// and cancellations/skips clear every mounted surface synchronously.
let activeExitEnd: TrackTransitionEnd | null = null;
let expiredEndRef: TrackTransitionEnd | null = null;
let exitTimer: number | null = null;
let storeUnsubscribe: (() => void) | null = null;
const exitListeners = new Set<() => void>();

function clearExitTimer(): void {
  if (exitTimer !== null) {
    window.clearTimeout(exitTimer);
    exitTimer = null;
  }
}

function emitExitChange(): void {
  for (const listener of exitListeners) listener();
}

function syncExitWindow(notify: boolean): void {
  const state = usePlayerStore.getState();
  const track = currentTrack(state);
  const candidate =
    state.transition === null && isExitEligible(track, state.lastTransitionEnd)
      ? state.lastTransitionEnd
      : null;

  if (!candidate || candidate === expiredEndRef) {
    clearExitTimer();
    if (activeExitEnd !== null) {
      activeExitEnd = null;
      if (notify) emitExitChange();
    }
    return;
  }

  const remainingMs = computeRemainingExitMs(
    candidate.endedAtMs,
    performance.now(),
    TRANSITION_EXIT_MS,
  );
  if (remainingMs <= 0) {
    expiredEndRef = candidate;
    clearExitTimer();
    if (activeExitEnd !== null) {
      activeExitEnd = null;
      if (notify) emitExitChange();
    }
    return;
  }

  const changed = activeExitEnd !== candidate;
  activeExitEnd = candidate;
  if (changed || exitTimer === null) {
    clearExitTimer();
    const targetEnd = candidate;
    exitTimer = window.setTimeout(() => {
      exitTimer = null;
      expiredEndRef = targetEnd;
      if (activeExitEnd === targetEnd) {
        activeExitEnd = null;
        emitExitChange();
      }
    }, Math.ceil(remainingMs));
  }
  if (changed && notify) emitExitChange();
}

function subscribeActiveExit(listener: () => void): () => void {
  exitListeners.add(listener);
  if (typeof window !== "undefined" && storeUnsubscribe === null) {
    storeUnsubscribe = usePlayerStore.subscribe(() => {
      syncExitWindow(true);
    });
    syncExitWindow(true);
  }
  return () => {
    exitListeners.delete(listener);
    if (exitListeners.size === 0) {
      clearExitTimer();
      storeUnsubscribe?.();
      storeUnsubscribe = null;
      activeExitEnd = null;
    }
  };
}

function getActiveExitSnapshot(): TrackTransitionEnd | null {
  return activeExitEnd;
}

const getActiveExitServerSnapshot = (): TrackTransitionEnd | null => null;

/**
 * Subscribe to live song-transition visual state (`idle` | `active` | `exiting`).
 * Safe for SSR, deterministic snapshots, and reduced-motion environments.
 */
export function useTrackTransition(): TransitionDisplayState {
  const track = usePlayerStore(currentTrack);
  const transition = usePlayerStore((s) => s.transition);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const exitingEnd = useSyncExternalStore(
    subscribeActiveExit,
    getActiveExitSnapshot,
    getActiveExitServerSnapshot,
  );

  if (transition !== null) {
    return resolveTransitionDisplay({
      currentTrack: track,
      transition,
      lastTransitionEnd: null,
      liveClock: null,
      nowMs: transition.startedAtMs,
      reducedMotion,
    });
  }

  if (!reducedMotion && exitingEnd !== null && isExitEligible(track, exitingEnd)) {
    return {
      phase: "exiting",
      id: exitingEnd.id,
      kind: exitingEnd.kind,
      outgoing: exitingEnd.outgoing,
      incoming: exitingEnd.incoming,
      exitProgress: 0,
      remainingExitMs: TRANSITION_EXIT_MS,
    };
  }

  return { phase: "idle" };
}

/**
 * Drives `--transition-p` (0..1) on `elementRef` at display refresh rate while
 * a live <audio> crossfade clock is registered, without 60Hz React re-renders.
 * When no live audio clock exists (e.g. deterministic tests/screenshots), it
 * holds the exact store snapshot `display.progress`.
 */
export function useLiveTransitionProgress(
  elementRef: RefObject<HTMLElement | null>,
  display: TransitionDisplayState,
): void {
  const activeId = display.phase === "active" ? display.id : null;
  const snapshotProgress =
    display.phase === "active" ? display.progress : display.phase === "exiting" ? 1 : null;

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;
    if (snapshotProgress === null) {
      el.style.removeProperty("--transition-p");
      return;
    }

    el.style.setProperty("--transition-p", snapshotProgress.toFixed(4));
    if (activeId === null) return;

    let rafId: number | null = null;
    const stop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const paint = (): boolean => {
      const target = elementRef.current;
      const liveTransition = usePlayerStore.getState().transition;
      if (!target || !liveTransition || liveTransition.id !== activeId) {
        return false;
      }
      const clock = readLiveTransitionClock();
      const progress = resolveTransitionProgress(liveTransition, clock);
      target.style.setProperty("--transition-p", progress.toFixed(4));
      return !document.hidden && clock !== null && clock.id === activeId;
    };

    const tick = () => {
      rafId = null;
      if (paint()) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const sync = () => {
      if (paint()) {
        if (rafId === null) rafId = window.requestAnimationFrame(tick);
      } else {
        stop();
      }
    };

    const onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);
    sync();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [elementRef, activeId, snapshotProgress]);
}
