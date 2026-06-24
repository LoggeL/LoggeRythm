"use client";

import Link from "next/link";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import LikeButton from "@/components/LikeButton";
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
  ChevronDownIcon,
} from "@/components/icons";

export default function NowPlaying({ onClose }: { onClose: () => void }) {
  const track = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);

  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);

  if (!track) return null;
  const RepeatGlyph = repeat === "one" ? RepeatOneIcon : RepeatIcon;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-gradient-to-b from-[#17112b] to-background p-6 isolate">
      {track.cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.cover}
          alt=""
          aria-hidden
          className="pointer-events-none absolute -z-10 inset-0 w-full h-full object-cover opacity-25 blur-[80px] saturate-150"
        />
      )}
      <div className="flex justify-between items-center mb-8">
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="text-muted hover:text-foreground p-2"
        >
          <ChevronDownIcon width={24} height={24} />
        </button>
        <span className="label-mono">Wird gespielt</span>
        <span className="w-10" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 min-h-0">
        {track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt={track.album}
            className="w-full max-w-sm aspect-square rounded-xl object-cover ring-1 ring-[var(--border-strong)] shadow-[0_0_60px_rgba(255,43,214,.3)]"
          />
        ) : (
          <div className="w-full max-w-sm aspect-square rounded-xl bg-panel-hover" />
        )}

        <div className="w-full max-w-md text-center">
          <div className="flex items-center justify-center gap-3">
            <h2 className="marquee text-3xl font-black neon-text" aria-label={track.title}>
              <span className="marquee__track">
                {track.title}
                <span className="px-6 text-accent-2">◆</span>
                {track.title}
                <span className="px-6 text-accent-2">◆</span>
              </span>
            </h2>
            <LikeButton track={track} />
          </div>
          <p className="text-muted mt-1">
            {track.artist_id ? (
              <Link
                href={`/artist/${track.artist_id}`}
                onClick={onClose}
                className="hover:underline hover:text-foreground"
              >
                {track.artist}
              </Link>
            ) : (
              track.artist
            )}
          </p>
        </div>
      </div>

      <div className="w-full max-w-md mx-auto mt-8">
        <div className="flex items-center gap-2 w-full">
          <span className="text-xs text-muted w-10 text-right tabular-nums">
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
            aria-label="Fortschritt"
          />
          <span className="text-xs text-muted w-10 tabular-nums">
            {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center justify-center gap-6 mt-4">
          <button
            type="button"
            onClick={toggleShuffle}
            aria-label="Zufallswiedergabe"
            className={shuffle ? "neon-cyan" : "text-muted hover:text-foreground"}
          >
            <ShuffleIcon width={22} height={22} />
          </button>
          <button
            type="button"
            onClick={prev}
            aria-label="Vorheriger Titel"
            className="text-muted hover:text-foreground"
          >
            <PrevIcon width={30} height={30} />
          </button>
          <button
            type="button"
            onClick={toggle}
            aria-label={isPlaying ? "Pause" : "Abspielen"}
            className="w-16 h-16 rounded-full play-ring text-white flex items-center justify-center"
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
            className="text-muted hover:text-foreground"
          >
            <NextIcon width={30} height={30} />
          </button>
          <button
            type="button"
            onClick={cycleRepeat}
            aria-label="Wiederholen"
            className={repeat !== "off" ? "neon-cyan" : "text-muted hover:text-foreground"}
          >
            <RepeatGlyph width={22} height={22} />
          </button>
        </div>

        <div className="flex items-center gap-2 mt-6 justify-center">
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
            className="w-40"
            aria-label="Lautstärke"
          />
        </div>
      </div>
    </div>
  );
}
