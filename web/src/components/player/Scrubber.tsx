"use client";

import { useState } from "react";
import { usePlayerStore } from "@/store/player";
import { formatTime } from "@/lib/format";

/** Filled-track background for range inputs (filled up to `pct` percent). */
export function rangeFill(pct: number, color = "var(--foreground)"): string {
  const p = Math.max(0, Math.min(100, pct));
  return `linear-gradient(to right, ${color} 0%, ${color} ${p}%, rgb(255 255 255 / 0.16) ${p}%, rgb(255 255 255 / 0.16) 100%)`;
}

/**
 * Seek bar. Subscribes to the playhead itself so the surrounding player chrome
 * does not re-render on every time update. While the user drags, the thumb
 * follows the pointer and the seek is committed once on release — the audio
 * does not stutter through every intermediate position.
 */
export default function Scrubber({ showTimes = true, className = "" }: { showTimes?: boolean; className?: string }) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const hasTrack = usePlayerStore((s) => s.index >= 0);
  const seek = usePlayerStore((s) => s.seek);
  const [drag, setDrag] = useState<number | null>(null);

  const max = duration || 0;
  const position = Math.min(drag ?? currentTime, max);
  const commit = () => {
    if (drag === null) return;
    seek(drag);
    setDrag(null);
  };

  return (
    <div className={`flex w-full items-center gap-2 ${className}`}>
      {showTimes && <span className="w-10 text-right text-[11px] tabular-nums text-muted">{formatTime(position)}</span>}
      <input
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={position}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        disabled={!hasTrack || !max}
        className="min-w-0 flex-1"
        style={{ background: rangeFill(max ? (position / max) * 100 : 0) }}
        aria-label="Fortschritt"
        aria-valuetext={`${formatTime(position)} von ${formatTime(max)}`}
      />
      {showTimes && <span className="w-10 text-[11px] tabular-nums text-muted">{formatTime(max)}</span>}
    </div>
  );
}

/** Hairline progress indicator for the compact mobile player. */
export function ProgressLine() {
  const pct = usePlayerStore((s) => (s.duration ? (s.currentTime / s.duration) * 100 : 0));
  return (
    <div aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/15">
      <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
    </div>
  );
}
