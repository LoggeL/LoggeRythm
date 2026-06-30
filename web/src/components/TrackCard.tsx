"use client";

import { useState } from "react";
import Link from "next/link";
import type { Track } from "@/types";
import { usePlayerStore, currentTrack } from "@/store/player";
import { toast } from "@/store/toast";
import { PlayIcon, PauseIcon, MoreIcon, PlusIcon } from "@/components/icons";
import { useTrackMenuItems } from "@/components/TrackMenu";
import ArtistLinks from "@/components/ArtistLinks";
import ContextMenu from "@/components/ContextMenu";

interface TrackCardProps {
  track: Track;
  onPlay?: () => void;
}

export default function TrackCard({ track, onPlay }: TrackCardProps) {
  const cur = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuItems = useTrackMenuItems(track);

  const isCurrent = cur?.id === track.id;
  const playingThis = isCurrent && isPlaying;

  function handlePlay() {
    if (isCurrent) toggle();
    else if (onPlay) onPlay();
    else playTrack(track);
  }

  function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      onContextMenu={handleContextMenu}
      className="group relative bg-panel/70 hover:bg-panel-hover border border-white/5 rounded-2xl p-4 transition hover-lift cursor-default"
    >
      <div className="relative mb-3">
        {track.album_id ? (
          <Link
            href={`/album/${track.album_id}`}
            aria-label={`Album ${track.album}`}
            className="block overflow-hidden rounded-xl"
          >
            {track.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={track.cover}
                alt={track.album}
                className="w-full aspect-square object-cover rounded-xl shadow-lg transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="w-full aspect-square rounded-xl gradient-violet opacity-80" />
            )}
          </Link>
        ) : track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt={track.album}
            className="w-full aspect-square object-cover rounded-xl shadow-lg"
          />
        ) : (
          <div className="w-full aspect-square rounded-xl gradient-violet opacity-80" />
        )}
        {playingThis && (
          <div className="absolute bottom-2 left-2 flex items-end gap-[3px] h-5 px-2 py-1 rounded-full bg-black/55 backdrop-blur-sm">
            {[0, 0.15, 0.3].map((d, i) => (
              <span
                key={i}
                className="eq-bar w-[3px] h-full bg-accent-soft rounded-full"
                style={{ animationDelay: `${d}s` }}
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={handlePlay}
          aria-label={playingThis ? "Pause" : "Abspielen"}
          className="absolute bottom-2 right-2 w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center shadow-lg glow-sm opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition hover:bg-accent-hover hover:scale-105 press"
        >
          {playingThis ? (
            <PauseIcon width={22} height={22} />
          ) : (
            <PlayIcon width={22} height={22} />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            addToQueue(track);
            toast.info("Zur Warteschlange hinzugefügt.");
          }}
          aria-label="Zur Warteschlange hinzufügen"
          title="Zur Warteschlange hinzufügen"
          className="absolute top-2 right-12 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-black/80 press"
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuPos({ x: r.right, y: r.bottom + 4 });
          }}
          aria-label="Weitere Optionen"
          title="Weitere Optionen"
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-black/80"
        >
          <MoreIcon />
        </button>
      </div>
      <div className="min-w-0">
        {track.album_id ? (
          <Link
            href={`/album/${track.album_id}`}
            className={`block truncate font-semibold hover:underline ${
              isCurrent ? "text-accent" : "text-foreground"
            }`}
          >
            {track.title}
          </Link>
        ) : (
          <div
            className={`truncate font-semibold ${
              isCurrent ? "text-accent" : "text-foreground"
            }`}
          >
            {track.title}
          </div>
        )}
        <ArtistLinks track={track} className="block truncate text-sm text-muted" />
      </div>

      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
}
