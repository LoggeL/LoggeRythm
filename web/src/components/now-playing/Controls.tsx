"use client";

import { usePlayerStore } from "@/store/player";
import { formatTime } from "@/lib/format";
import {
  PlayIcon,
  PauseIcon,
  NextIcon,
  PrevIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
  VolumeIcon,
  VolumeMutedIcon,
  SpinnerIcon,
} from "@/components/icons";

/** A filled track for range inputs (accent up to `pct` percent). */
function rangeFill(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `linear-gradient(to right, var(--accent) 0%, var(--accent) ${p}%, var(--border) ${p}%, var(--border) 100%)`;
}

/**
 * Store-connected transport controls for the fullscreen player. Each control
 * subscribes to exactly the store slices it renders, so the ~4×/second
 * `currentTime` ticks only re-render the seek bar — not the whole fullscreen
 * tree.
 */

export function SeekBar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const seek = usePlayerStore((s) => s.seek);
  return (
    <div className="flex w-full items-center gap-2">
      <span className="w-10 text-right text-xs tabular-nums text-muted">
        {formatTime(currentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(currentTime, duration || 0)}
        onChange={(e) => seek(Number(e.target.value))}
        disabled={!duration}
        className="flex-1"
        style={{
          background: rangeFill(duration ? (currentTime / duration) * 100 : 0),
        }}
        aria-label="Fortschritt"
        aria-valuetext={`${formatTime(currentTime)} von ${formatTime(duration)}`}
      />
      <span className="w-10 text-xs tabular-nums text-muted">
        {formatTime(duration)}
      </span>
    </div>
  );
}

export function TransportRow() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;

  return (
    <div className="mt-3 flex items-center justify-center gap-2 sm:gap-4">
      <button
        type="button"
        onClick={toggleShuffle}
        aria-label="Zufallswiedergabe"
        aria-pressed={shuffle}
        title={shuffle ? "Zufallswiedergabe ausschalten" : "Zufallswiedergabe einschalten"}
        className={`action-icon h-11 w-11 ${shuffle ? "bg-accent/10 text-accent" : ""}`}
      >
        <ShuffleIcon width={22} height={22} />
      </button>
      <button
        type="button"
        onClick={prev}
        aria-label="Vorheriger Titel"
        className="action-icon h-11 w-11"
      >
        <PrevIcon width={24} height={24} />
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? "Pause" : "Abspielen"}
        aria-busy={isBuffering}
        title={isBuffering ? "Wiedergabe wird geladen" : isPlaying ? "Pause" : "Abspielen"}
        className="action-primary grid h-14 w-14 place-items-center rounded-full p-0"
      >
        {isBuffering ? (
          <SpinnerIcon width={26} height={26} aria-hidden />
        ) : isPlaying ? (
          <PauseIcon width={26} height={26} />
        ) : (
          <PlayIcon width={26} height={26} />
        )}
      </button>
      <button
        type="button"
        onClick={next}
        aria-label="Nächster Titel"
        className="action-icon h-11 w-11"
      >
        <NextIcon width={24} height={24} />
      </button>
      <button
        type="button"
        onClick={cycleRepeat}
        aria-label={repeat === "one" ? "Wiederholen: ein Titel" : repeat === "all" ? "Wiederholen: alle Titel" : "Wiederholen: aus"}
        aria-pressed={repeat !== "off"}
        className={`action-icon h-11 w-11 ${repeat !== "off" ? "bg-accent/10 text-accent" : ""}`}
      >
        <RepeatGlyph width={22} height={22} />
      </button>
    </div>
  );
}

export function VolumeRow() {
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  return (
    <div className="mt-2 flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Ton an" : "Stummschalten"}
        aria-pressed={muted}
        className="action-icon h-11 w-11"
      >
        {muted || volume === 0 ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="w-36 sm:w-40"
        style={{ background: rangeFill((muted ? 0 : volume) * 100) }}
        aria-label="Lautstärke"
        aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} Prozent`}
      />
    </div>
  );
}
