"use client";

import type { Track } from "@/types";
import { usePlayerStore, currentTrack } from "@/store/player";
import { PlayIcon, PauseIcon } from "@/components/icons";

interface TrackCardProps {
  track: Track;
  onPlay?: () => void;
}

export default function TrackCard({ track, onPlay }: TrackCardProps) {
  const cur = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);

  const isCurrent = cur?.id === track.id;
  const playingThis = isCurrent && isPlaying;

  function handlePlay() {
    if (isCurrent) toggle();
    else if (onPlay) onPlay();
    else playTrack(track);
  }

  return (
    <div className="group relative bg-panel hover:bg-panel-hover rounded-lg p-4 transition cursor-default">
      <div className="relative mb-3">
        {track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt={track.album}
            className="w-full aspect-square object-cover rounded-md shadow-lg"
          />
        ) : (
          <div className="w-full aspect-square rounded-md bg-[#333]" />
        )}
        <button
          type="button"
          onClick={handlePlay}
          aria-label={playingThis ? "Pause" : "Abspielen"}
          className="absolute bottom-2 right-2 w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center shadow-lg opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition hover:bg-accent-hover hover:scale-105"
        >
          {playingThis ? (
            <PauseIcon width={22} height={22} />
          ) : (
            <PlayIcon width={22} height={22} />
          )}
        </button>
      </div>
      <div className="min-w-0">
        <div
          className={`truncate font-semibold ${
            isCurrent ? "text-accent" : "text-foreground"
          }`}
        >
          {track.title}
        </div>
        <div className="truncate text-sm text-muted">{track.artist}</div>
      </div>
    </div>
  );
}
