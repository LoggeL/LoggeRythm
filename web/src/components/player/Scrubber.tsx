"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { usePlayerStore } from "@/store/player";
import { readLivePlaybackClock } from "@/lib/playbackClock";
import { formatTime } from "@/lib/format";
import {
  heldPosition,
  progressRatio,
  resolveSmoothPosition,
  scrubTrackKey,
  type ScrubDrag,
  type SmoothClockAnchor,
} from "./scrubState";

/** Filled-track background for range inputs (filled up to `pct` percent). */
export function rangeFill(pct: number, color = "var(--accent-soft)"): string {
  const p = Math.max(0, Math.min(100, pct));
  return `linear-gradient(to right, ${color} 0%, ${color} ${p}%, rgb(244 240 230 / 0.16) ${p}%, rgb(244 240 230 / 0.16) 100%)`;
}

/**
 * Drives `--scrub-ratio` (0..1) directly on `railRef` at display refresh rate
 * via requestAnimationFrame while playing, sampling the live <audio> clock when
 * playing locally and smoothly extrapolating for remote Connect / Jam control.
 * React intentionally never writes `--scrub-ratio` via JSX `style`, so per-second
 * time-label re-renders never cause a 1-frame snap-back.
 */
function useSmoothScrubRail(
  railRef: RefObject<HTMLDivElement | null>,
  dragRef?: RefObject<ScrubDrag | null>,
) {
  const lastRenderedRef = useRef<number | null>(null);
  const syncNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    let rafId: number | null = null;
    const initial = usePlayerStore.getState();
    const anchor: SmoothClockAnchor = {
      trackKey: scrubTrackKey(initial),
      time: initial.currentTime,
      capturedAtMs: performance.now(),
    };

    const paint = (): number => {
      const state = usePlayerStore.getState();
      const trackKey = scrubTrackKey(state);
      const track = state.queue[state.index];
      const drag = dragRef ? heldPosition(dragRef.current, trackKey) : null;
      const pos = resolveSmoothPosition({
        trackKey,
        trackId: track ? String(track.id) : null,
        duration: state.duration || 0,
        isPlaying: state.isPlaying,
        isBuffering: state.isBuffering,
        suppressLocalAudio: state.suppressLocalAudio,
        seekPending: state.seekTo !== null,
        dragPosition: drag,
        anchor,
        nowMs: performance.now(),
        liveClock: readLivePlaybackClock(),
        lastRenderedTime: lastRenderedRef.current,
      });
      lastRenderedRef.current = pos;
      const ratio = progressRatio(pos, state.duration || 0);
      railRef.current?.style.setProperty("--scrub-ratio", ratio.toFixed(6));
      return pos;
    };

    const stopLoop = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const shouldRun = () => {
      const state = usePlayerStore.getState();
      const trackKey = scrubTrackKey(state);
      const dragging = dragRef ? heldPosition(dragRef.current, trackKey) !== null : false;
      return (
        !document.hidden &&
        !dragging &&
        state.isPlaying &&
        !state.isBuffering &&
        (state.duration || 0) > 0 &&
        trackKey !== null
      );
    };

    const tick = () => {
      rafId = null;
      paint();
      if (shouldRun()) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const syncLoop = () => {
      paint();
      if (shouldRun()) {
        if (rafId === null) rafId = window.requestAnimationFrame(tick);
      } else {
        stopLoop();
      }
    };

    syncNowRef.current = syncLoop;

    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      const nextKey = scrubTrackKey(state);
      const prevKey = scrubTrackKey(prev);
      const trackChanged = nextKey !== prevKey;
      const seekTriggered = state.seekTo !== null && state.seekTo !== prev.seekTo;
      if (
        trackChanged ||
        seekTriggered ||
        state.currentTime !== prev.currentTime ||
        state.isPlaying !== prev.isPlaying ||
        state.isBuffering !== prev.isBuffering ||
        state.duration !== prev.duration ||
        state.suppressLocalAudio !== prev.suppressLocalAudio
      ) {
        anchor.trackKey = nextKey;
        anchor.time = state.currentTime;
        anchor.capturedAtMs = performance.now();
        if (trackChanged || seekTriggered) {
          lastRenderedRef.current = null;
        }
        syncLoop();
      }
    });

    const onVisibility = () => syncLoop();
    document.addEventListener("visibilitychange", onVisibility);
    syncLoop();

    return () => {
      stopLoop();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      syncNowRef.current = () => {};
    };
  }, [railRef, dragRef]);

  return { lastRenderedRef, syncNowRef };
}

/**
 * Smooth 60fps seek bar with an always-visible moving knob.
 *
 * The visual progress fill and knob are driven directly on the GPU compositor
 * via `--scrub-ratio` inside requestAnimationFrame so the surrounding player
 * chrome does not re-render per frame. While a pointer holds the thumb it
 * follows continuously and commits the seek once on release; keyboard and
 * assistive-tech changes seek immediately.
 */
export default function Scrubber({
  showTimes = true,
  showHoverTime = !showTimes,
  className = "",
  disabled = false,
}: {
  showTimes?: boolean;
  /** Floating mm:ss pill tracking pointer X along the rail (default on when inline times are hidden). */
  showHoverTime?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const currentSec = usePlayerStore((s) => Math.floor(s.currentTime));
  const duration = usePlayerStore((s) => s.duration);
  const trackKey = usePlayerStore(scrubTrackKey);
  const isTransitioning = usePlayerStore((s) => s.transition !== null);
  const seek = usePlayerStore((s) => s.seek);
  const [drag, setDrag] = useState<ScrubDrag | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ ratio: number; sec: number } | null>(null);
  const held = useRef<ScrubDrag | null>(null);
  const pointerDown = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const rail = useRef<HTMLDivElement>(null);

  const { lastRenderedRef, syncNowRef } = useSmoothScrubRail(rail, held);

  const max = duration || 0;
  const hasTrack = trackKey !== null && max > 0;
  const isDisabled = disabled || !hasTrack;
  // A drag made on a track that has since ended no longer moves the thumb.
  const position = Math.min(heldPosition(drag, trackKey) ?? currentSec, max);

  function updateHover(clientX: number) {
    if (!showHoverTime || isDisabled || !rail.current) return;
    const rect = rail.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHoverPreview({ ratio, sec: ratio * max });
  }

  /** Ends a pointer drag and seeks once, unless the track changed under it. */
  const release = useCallback(() => {
    pointerDown.current = false;
    setDragging(false);
    const pending = held.current;
    held.current = null;
    setDrag(null);
    const player = usePlayerStore.getState();
    const target = heldPosition(pending, scrubTrackKey(player));
    if (target !== null) {
      lastRenderedRef.current = target;
      rail.current?.style.setProperty("--scrub-ratio", progressRatio(target, player.duration || 0).toFixed(6));
      player.seek(target);
    }
    syncNowRef.current();
  }, [lastRenderedRef, syncNowRef]);

  // The native `change` event marks the end of a drag even when the pointer is
  // released outside the slider; React's onChange only reports `input`.
  useEffect(() => {
    const element = input.current;
    if (!element) throw new Error("Der Fortschrittsregler wurde nicht eingebunden.");
    element.addEventListener("change", release);
    return () => element.removeEventListener("change", release);
  }, [release]);

  function handleChange(value: number) {
    if (!pointerDown.current || trackKey === null) {
      lastRenderedRef.current = value;
      rail.current?.style.setProperty("--scrub-ratio", progressRatio(value, max).toFixed(6));
      seek(value);
      return;
    }
    held.current = { value, trackKey };
    lastRenderedRef.current = value;
    rail.current?.style.setProperty("--scrub-ratio", progressRatio(value, max).toFixed(6));
    setDrag(held.current);
    syncNowRef.current();
  }

  return (
    <div className={`flex w-full items-center gap-2 ${className}`}>
      {showTimes && <span className="w-10 text-right font-mono text-[11px] tabular-nums text-foreground/80 [text-shadow:0_1px_6px_rgb(0_0_0/0.7)]">{formatTime(position)}</span>}
      <div
        ref={rail}
        data-scrubber-rail=""
        data-empty={hasTrack ? undefined : "true"}
        data-disabled={isDisabled ? "true" : undefined}
        data-dragging={dragging ? "true" : undefined}
        data-transitioning={isTransitioning ? "true" : undefined}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" || dragging) updateHover(e.clientX);
        }}
        onPointerLeave={() => {
          if (!dragging) setHoverPreview(null);
        }}
        className="scrubber-rail relative flex min-w-0 flex-1 items-center"
      >
        {showHoverTime && hoverPreview && !isDisabled && (
          <span
            aria-hidden="true"
            style={{ left: `clamp(2rem, ${(hoverPreview.ratio * 100).toFixed(2)}%, calc(100% - 2rem))` }}
            className="pointer-events-none absolute -top-7 z-20 -translate-x-1/2 rounded-md border border-white/15 bg-[#0f0e11]/92 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-foreground shadow-[0_6px_18px_rgb(0_0_0/0.6)] backdrop-blur-md"
          >
            {formatTime(dragging ? position : hoverPreview.sec)}
          </span>
        )}
        <div aria-hidden="true" className="scrubber-track">
          <div className="scrubber-fill" />
        </div>
        <div aria-hidden="true" className="scrubber-knob-track">
          <div className="scrubber-knob-travel">
            <span className="scrubber-knob" />
          </div>
        </div>
        <input
          ref={input}
          type="range"
          min={0}
          max={max}
          step={0.05}
          value={position}
          onChange={(e) => handleChange(Number(e.target.value))}
          onPointerDown={(e) => {
            pointerDown.current = true;
            setDragging(true);
            updateHover(e.clientX);
          }}
          onPointerUp={() => {
            release();
            setHoverPreview(null);
          }}
          onPointerCancel={() => {
            release();
            setHoverPreview(null);
          }}
          onLostPointerCapture={release}
          onBlur={release}
          disabled={isDisabled}
          className="scrubber-input"
          aria-label="Fortschritt"
          aria-valuetext={`${formatTime(position)} von ${formatTime(max)}`}
        />
      </div>
      {showTimes && <span className="w-10 font-mono text-[11px] tabular-nums text-foreground/80 [text-shadow:0_1px_6px_rgb(0_0_0/0.7)]">{formatTime(max)}</span>}
    </div>
  );
}

/** Smooth 60fps hairline progress indicator for the compact mobile player. */
export function ProgressLine() {
  const rail = useRef<HTMLDivElement>(null);
  const hasTrack = usePlayerStore((s) => scrubTrackKey(s) !== null && (s.duration || 0) > 0);
  const isTransitioning = usePlayerStore((s) => s.transition !== null);
  useSmoothScrubRail(rail);

  return (
    <div
      ref={rail}
      aria-hidden="true"
      data-empty={hasTrack ? undefined : "true"}
      data-transitioning={isTransitioning ? "true" : undefined}
      className="progress-line absolute inset-x-0 bottom-0 h-[3px] bg-white/10"
    >
      <div className="progress-line-fill h-full w-full origin-left bg-accent-soft" />
      <div className="progress-line-knob-track">
        <div className="progress-line-knob-travel">
          <span className="progress-line-knob" />
        </div>
      </div>
    </div>
  );
}
