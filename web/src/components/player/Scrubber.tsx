"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "@/store/player";
import { formatTime } from "@/lib/format";
import { heldPosition, scrubTrackKey, type ScrubDrag } from "./scrubState";

/** Filled-track background for range inputs (filled up to `pct` percent). */
export function rangeFill(pct: number, color = "var(--accent-soft)"): string {
  const p = Math.max(0, Math.min(100, pct));
  return `linear-gradient(to right, ${color} 0%, ${color} ${p}%, rgb(244 240 230 / 0.16) ${p}%, rgb(244 240 230 / 0.16) 100%)`;
}

/**
 * Seek bar. Subscribes to the playhead itself so the surrounding player chrome
 * does not re-render on every time update. While a pointer holds the thumb it
 * follows the pointer and the seek is committed once on release — the audio
 * does not stutter through every intermediate position. Every other value
 * change (keyboard, assistive technology) seeks at once, because no release
 * event is guaranteed to follow it.
 */
export default function Scrubber({
  showTimes = true,
  className = "",
  disabled = false,
}: {
  showTimes?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const trackKey = usePlayerStore(scrubTrackKey);
  const seek = usePlayerStore((s) => s.seek);
  const [drag, setDrag] = useState<ScrubDrag | null>(null);
  const held = useRef<ScrubDrag | null>(null);
  const pointerDown = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const max = duration || 0;
  // A drag made on a track that has since ended no longer moves the thumb.
  const position = Math.min(heldPosition(drag, trackKey) ?? currentTime, max);

  /** Ends a pointer drag and seeks once, unless the track changed under it. */
  const release = useCallback(() => {
    pointerDown.current = false;
    const pending = held.current;
    held.current = null;
    setDrag(null);
    const player = usePlayerStore.getState();
    const target = heldPosition(pending, scrubTrackKey(player));
    if (target !== null) player.seek(target);
  }, []);

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
      seek(value);
      return;
    }
    held.current = { value, trackKey };
    setDrag(held.current);
  }

  return (
    <div className={`flex w-full items-center gap-2 ${className}`}>
      {showTimes && <span className="w-10 text-right font-mono text-[11px] tabular-nums text-muted">{formatTime(position)}</span>}
      <input
        ref={input}
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={position}
        onChange={(e) => handleChange(Number(e.target.value))}
        onPointerDown={() => {
          pointerDown.current = true;
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onBlur={release}
        disabled={disabled || trackKey === null || !max}
        className="min-w-0 flex-1"
        style={{ background: rangeFill(max ? (position / max) * 100 : 0) }}
        aria-label="Fortschritt"
        aria-valuetext={`${formatTime(position)} von ${formatTime(max)}`}
      />
      {showTimes && <span className="w-10 font-mono text-[11px] tabular-nums text-muted">{formatTime(max)}</span>}
    </div>
  );
}

/** Hairline progress indicator for the compact mobile player. */
export function ProgressLine() {
  const pct = usePlayerStore((s) => (s.duration ? (s.currentTime / s.duration) * 100 : 0));
  return (
    <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-white/10">
      <div className="h-full rounded-full bg-accent-soft" style={{ width: `${pct}%` }} />
    </div>
  );
}
