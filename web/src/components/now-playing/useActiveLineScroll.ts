"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const MANUAL_SCROLL_PAUSE_MS = 5_000;

/** Pure decision helper for unit testing manual-scroll auto-sync behavior. */
export function isManualScrollActive(pausedUntilMs: number | null, nowMs: number): boolean {
  return pausedUntilMs !== null && nowMs < pausedUntilMs;
}

/**
 * Keeps the active lyric line vertically centred in its scroller while
 * respecting manual user scrolling: when the listener scrolls ahead (wheel,
 * touch, or scrollbar drag), auto-scroll pauses for ~5 seconds (or until they
 * tap "Synchronisieren").
 */
export function useActiveLineScroll(active: number, lineCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const positioned = useRef(false);
  const pausedUntilRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  const centerActiveLine = useCallback((smooth: boolean) => {
    const line = activeRef.current;
    const container = scrollRef.current;
    if (!line || !container || container.clientHeight === 0) return false;
    const top = line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2;
    if (smooth) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      container.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    } else {
      container.scrollTop = top;
    }
    return true;
  }, []);

  const resumeSync = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    pausedUntilRef.current = null;
    setUserScrolled(false);
    centerActiveLine(true);
  }, [centerActiveLine]);

  // Listen for direct user scroll intent (wheel/touch/pointer drag on scrollbar).
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const noteManualScroll = () => {
      pausedUntilRef.current = Date.now() + MANUAL_SCROLL_PAUSE_MS;
      setUserScrolled(true);
      if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => {
        resumeTimerRef.current = null;
        pausedUntilRef.current = null;
        setUserScrolled(false);
        centerActiveLine(true);
      }, MANUAL_SCROLL_PAUSE_MS);
    };
    const onPointerDown = (e: PointerEvent) => {
      // Only pause when grabbing the scrollbar track or dragging inside the list.
      if (e.target === container) noteManualScroll();
    };
    container.addEventListener("wheel", noteManualScroll, { passive: true });
    container.addEventListener("touchmove", noteManualScroll, { passive: true });
    container.addEventListener("pointerdown", onPointerDown);
    return () => {
      container.removeEventListener("wheel", noteManualScroll);
      container.removeEventListener("touchmove", noteManualScroll);
      container.removeEventListener("pointerdown", onPointerDown);
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
    };
  }, [centerActiveLine, lineCount]);

  useLayoutEffect(() => {
    if (isManualScrollActive(pausedUntilRef.current, Date.now())) return;
    const position = () => {
      const ok = centerActiveLine(positioned.current);
      if (ok) positioned.current = true;
      return ok;
    };

    if (position()) return;
    const container = scrollRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (position()) observer.disconnect();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, lineCount, centerActiveLine]);

  return { scrollRef, activeRef, userScrolled, resumeSync };
}
