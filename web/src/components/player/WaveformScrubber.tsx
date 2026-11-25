"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { usePlayerStore, currentTrack } from "@/store/player";
import { useLivePlaybackTime } from "@/hooks/useLivePlaybackTime";
import { useTrackAudioMeta } from "@/hooks/useTrackAudioMeta";
import { formatTime } from "@/lib/format";
import Scrubber from "@/components/player/Scrubber";
import { heldPosition, progressRatio, scrubTrackKey, type ScrubDrag } from "./scrubState";

/**
 * "Ink, Paper, Signal" Waveform Scrubbar for NowPlaying:
 * - Renders the server-analyzed 96-bar peak profile (played lime signal bars
 *   vs unplayed subtle ink bars).
 * - Smooth drag/click seek, hover timestamp pill + preview highlight, and
 *   accessible keyboard slider navigation.
 * - Falls back cleanly to the linear `<Scrubber />` ONLY while loading or when
 *   audio-meta is unavailable — NEVER invents fake random peaks.
 */
export default function WaveformScrubber({
  disabled = false,
  className = "",
}: {
  disabled?: boolean;
  className?: string;
}) {
  const track = usePlayerStore(currentTrack);
  const trackKey = usePlayerStore(scrubTrackKey);
  const duration = usePlayerStore((s) => s.duration || 0);
  const seek = usePlayerStore((s) => s.seek);
  const liveTime = useLivePlaybackTime(true);
  const metaQuery = useTrackAudioMeta(track?.id, Boolean(track));
  const meta = metaQuery.data;

  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<ScrubDrag | null>(null);
  const [hover, setHover] = useState<{ pct: number; time: number } | null>(null);

  const peaks = meta?.peaks ?? null;
  const maxPeak = useMemo(() => {
    if (!peaks || peaks.length === 0) return 1;
    const peak = Math.max(...peaks);
    return peak > 0.05 ? peak : 1;
  }, [peaks]);

  // Clean fallback to linear Scrubber whenever waveform data is still loading,
  // errored, or unanalyzed (zero fake peaks).
  if (!peaks || peaks.length === 0 || duration <= 0) {
    return (
      <div className={className}>
        {metaQuery.isError && (
          <p role="status" className="label-mono mb-1 text-[10px] text-danger">
            Wellenform nicht verfügbar: {metaQuery.error instanceof Error ? metaQuery.error.message : String(metaQuery.error)}
          </p>
        )}
        <Scrubber showTimes disabled={disabled} />
      </div>
    );
  }

  const held = heldPosition(drag, trackKey);
  const displayTime = held ?? liveTime;
  const ratio = progressRatio(displayTime, duration);
  const barCount = peaks.length;

  const ratioFromClientX = (clientX: number): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !trackKey || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextRatio = ratioFromClientX(event.clientX);
    const nextPos = nextRatio * duration;
    setDrag({ trackKey, value: nextPos });
    setHover({ pct: nextRatio * 100, time: nextPos });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const nextRatio = ratioFromClientX(event.clientX);
    const nextPos = nextRatio * duration;
    setHover({ pct: nextRatio * 100, time: nextPos });
    if (drag && trackKey && drag.trackKey === trackKey) {
      setDrag({ trackKey, value: nextPos });
    }
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const targetPos = heldPosition(drag, trackKey);
    setDrag(null);
    if (commit && targetPos !== null && !disabled) {
      seek(targetPos);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    let target: number | null = null;
    if (event.key === "ArrowRight") target = Math.min(duration, displayTime + 5);
    else if (event.key === "ArrowLeft") target = Math.max(0, displayTime - 5);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = duration;
    if (target === null) return;
    event.preventDefault();
    seek(target);
  };

  const introPct =
    meta?.intro_end_sec != null && meta.intro_end_sec > 0.25 && meta.intro_end_sec < duration
      ? (meta.intro_end_sec / duration) * 100
      : null;
  const outroPct =
    meta?.outro_start_sec != null && meta.outro_start_sec > 0 && meta.outro_start_sec < duration - 0.5
      ? (meta.outro_start_sec / duration) * 100
      : null;

  return (
    <div className={`w-full select-none ${className}`}>
      <div
        ref={containerRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Wellenform-Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(displayTime)}
        aria-valuetext={`${formatTime(displayTime)} von ${formatTime(duration)}`}
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishDrag(e, true)}
        onPointerCancel={(e) => finishDrag(e, false)}
        onPointerLeave={() => {
          if (!drag) setHover(null);
        }}
        onKeyDown={handleKeyDown}
        className={`group relative flex h-12 w-full items-center gap-[2px] rounded-md px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        }`}
      >
        {hover && !disabled && (
          <span
            aria-hidden="true"
            style={{ left: `${Math.max(4, Math.min(96, hover.pct))}%` }}
            className="pointer-events-none absolute -top-7 z-20 -translate-x-1/2 rounded-full border border-hairline bg-panel px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-foreground shadow-[0_6px_18px_rgb(0_0_0/0.55)]"
          >
            {formatTime(hover.time)}
          </span>
        )}

        {introPct !== null && (
          <span
            aria-hidden="true"
            title={`Intro-Ende ${formatTime(meta!.intro_end_sec!)}`}
            style={{ left: `${introPct}%` }}
            className="pointer-events-none absolute inset-y-1 z-10 w-px bg-foreground/20"
          />
        )}
        {outroPct !== null && (
          <span
            aria-hidden="true"
            title={`Outro-Start ${formatTime(meta!.outro_start_sec!)}`}
            style={{ left: `${outroPct}%` }}
            className="pointer-events-none absolute inset-y-1 z-10 w-px bg-accent/35"
          />
        )}

        {peaks.map((peak, index) => {
          const barPos = (index + 0.5) / barCount;
          const played = barPos <= ratio;
          const hovered = hover !== null && barPos <= hover.pct / 100 && !played;
          const norm = Math.max(0.1, Math.min(1, peak / maxPeak));
          const heightPct = Math.round(14 + norm * 86);
          return (
            <span
              key={index}
              aria-hidden="true"
              style={{ height: `${heightPct}%` }}
              className={`min-w-0 flex-1 rounded-full transition-colors duration-100 motion-reduce:transition-none ${
                played
                  ? "bg-[var(--accent-soft)] shadow-[0_0_8px_rgb(214_255_75/0.22)]"
                  : hovered
                    ? "bg-foreground/45"
                    : "bg-foreground/18 group-hover:bg-foreground/26"
              }`}
            />
          );
        })}
      </div>

      <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums text-muted">
        <span>{formatTime(displayTime)}</span>
        {meta?.bpm != null && meta.bpm > 0 && (
          <span className="text-[10px] tracking-[0.08em] text-subtle">
            {Math.round(meta.bpm)} BPM
          </span>
        )}
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
