"use client";

import { usePlayerStore } from "@/store/player";
import { rangeFill } from "@/components/player/Scrubber";
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

/**
 * Store-connected transport controls for the fullscreen player. Each control
 * subscribes to exactly the store slices it renders; seeking is handled by the
 * shared drag-safe {@link Scrubber}.
 */

export function TransportRow({ className = "" }: { className?: string }) {
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
    <div className={`flex items-center justify-between gap-1 sm:justify-center sm:gap-4 ${className}`}>
      <button
        type="button"
        onClick={toggleShuffle}
        aria-label="Zufallswiedergabe"
        aria-pressed={shuffle}
        title={shuffle ? "Zufallswiedergabe ausschalten" : "Zufallswiedergabe einschalten"}
        className="action-icon h-11 w-11"
      >
        <ShuffleIcon width={22} height={22} />
      </button>
      <button
        type="button"
        onClick={prev}
        aria-label="Vorheriger Titel"
        className="action-icon h-12 w-12 text-foreground"
      >
        <PrevIcon width={30} height={30} />
      </button>
      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? "Pause" : "Abspielen"}
        aria-busy={isBuffering}
        title={isBuffering ? "Wiedergabe wird geladen" : isPlaying ? "Pause" : "Abspielen"}
        className="play-fab h-16 w-16"
      >
        {isBuffering ? (
          <SpinnerIcon width={28} height={28} aria-hidden className="animate-spin motion-reduce:animate-none" />
        ) : isPlaying ? (
          <PauseIcon width={28} height={28} />
        ) : (
          <PlayIcon width={28} height={28} />
        )}
      </button>
      <button
        type="button"
        onClick={next}
        aria-label="Nächster Titel"
        className="action-icon h-12 w-12 text-foreground"
      >
        <NextIcon width={30} height={30} />
      </button>
      <button
        type="button"
        onClick={cycleRepeat}
        aria-label={repeat === "one" ? "Wiederholen: ein Titel" : repeat === "all" ? "Wiederholen: alle Titel" : "Wiederholen: aus"}
        aria-pressed={repeat !== "off"}
        className="action-icon h-11 w-11"
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
    <div className="flex w-full max-w-60 items-center gap-1">
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
        className="min-w-0 flex-1"
        style={{ background: rangeFill((muted ? 0 : volume) * 100) }}
        aria-label="Lautstärke"
        aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)} Prozent`}
      />
    </div>
  );
}
