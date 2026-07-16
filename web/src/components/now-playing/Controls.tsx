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
} from "@/components/icons";

/** A filled track for range inputs (accent up to `pct` percent). */
function rangeFill(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  return `linear-gradient(to right, var(--accent) 0%, var(--accent) ${p}%, #4d4d57 ${p}%, #4d4d57 100%)`;
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
      />
      <span className="w-10 text-xs tabular-nums text-muted">
        {formatTime(duration)}
      </span>
    </div>
  );
}

export function TransportRow() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;

  return (
    <div className="mt-4 flex items-center justify-center gap-5 md:mt-6 md:gap-7">
      <button
        type="button"
        onClick={toggleShuffle}
        aria-label="Zufallswiedergabe"
        aria-pressed={shuffle}
        className={shuffle ? "text-accent" : "text-muted hover:text-foreground"}
      >
        <ShuffleIcon width={22} height={22} />
      </button>
      <button
        type="button"
        onClick={prev}
        aria-label="Vorheriger Titel"
        className="text-muted transition hover:text-foreground"
      >
        <PrevIcon width={30} height={30} />
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? "Pause" : "Abspielen"}
        className="grid h-16 w-16 place-items-center rounded-full bg-accent text-white shadow-[0_0_34px_rgba(124,92,255,0.65)] transition hover:scale-105 md:h-[4.5rem] md:w-[4.5rem]"
      >
        {isPlaying ? (
          <PauseIcon width={30} height={30} />
        ) : (
          <PlayIcon width={30} height={30} />
        )}
      </button>
      <button
        type="button"
        onClick={next}
        aria-label="Nächster Titel"
        className="text-muted transition hover:text-foreground"
      >
        <NextIcon width={30} height={30} />
      </button>
      <button
        type="button"
        onClick={cycleRepeat}
        aria-label="Wiederholen"
        aria-pressed={repeat !== "off"}
        className={
          repeat !== "off" ? "text-accent" : "text-muted hover:text-foreground"
        }
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
    <div className="mt-5 hidden items-center justify-center gap-2 sm:flex">
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Ton an" : "Stummschalten"}
        className="text-muted hover:text-foreground"
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
        className="w-44"
        style={{ background: rangeFill((muted ? 0 : volume) * 100) }}
        aria-label="Lautstärke"
      />
    </div>
  );
}
