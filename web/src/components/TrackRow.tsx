"use client";

import { useState } from "react";
import Link from "next/link";
import type { Track } from "@/types";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime } from "@/lib/format";
import { toast } from "@/store/toast";
import { PlayIcon, PauseIcon, PlusIcon, DownloadedIcon } from "@/components/icons";
import { useTrackCacheState } from "@/store/downloads";
import LikeButton from "@/components/LikeButton";
import TrackMenu, { useTrackMenuItems } from "@/components/TrackMenu";
import ContextMenu from "@/components/ContextMenu";

interface TrackRowProps {
  track: Track;
  index?: number;
  // play handler: if provided, used instead of single-track play (e.g. play whole queue)
  onPlay?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  showAlbum?: boolean;
}

export default function TrackRow({
  track,
  index,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  showAlbum = true,
}: TrackRowProps) {
  const cur = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const cacheState = useTrackCacheState(track.id);

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuItems = useTrackMenuItems(track, onRemove);

  const isCurrent = cur?.id === track.id;
  const playingThis = isCurrent && isPlaying;

  function handlePlay() {
    if (isCurrent) {
      toggle();
    } else if (onPlay) {
      onPlay();
    } else {
      playTrack(track);
    }
  }

  function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      onContextMenu={handleContextMenu}
      className="group grid grid-cols-[2rem_1fr_auto] sm:grid-cols-[2rem_4fr_3fr_auto] items-center gap-3 px-3 py-2 rounded-md hover:bg-panel-hover transition"
    >
      {/* index / play */}
      <div className="w-8 flex items-center justify-center text-muted text-sm">
        <button
          type="button"
          onClick={handlePlay}
          className="hidden group-hover:flex text-foreground"
          aria-label={playingThis ? "Pause" : "Abspielen"}
        >
          {playingThis ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span
          className={`group-hover:hidden ${
            isCurrent ? "text-accent" : ""
          }`}
        >
          {playingThis ? "▶" : index !== undefined ? index + 1 : ""}
        </span>
      </div>

      {/* title + artist */}
      <div className="min-w-0 flex items-center gap-3">
        {track.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={track.cover}
            alt=""
            width={40}
            height={40}
            className="w-10 h-10 rounded object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded bg-panel-hover flex-shrink-0" />
        )}
        <div className="min-w-0">
          <div
            className={`truncate font-medium ${
              isCurrent ? "text-accent" : "text-foreground"
            }`}
          >
            {track.title}
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted min-w-0">
            {cacheState && (
              <span
                title={
                  cacheState === "local"
                    ? "Offline auf diesem Gerät verfügbar"
                    : "Auf dem Server gespeichert"
                }
                className={`inline-flex flex-shrink-0 ${
                  cacheState === "local" ? "text-green-500" : "text-muted"
                }`}
              >
                <DownloadedIcon
                  aria-label={
                    cacheState === "local"
                      ? "Offline verfügbar"
                      : "Auf dem Server gespeichert"
                  }
                />
              </span>
            )}
            <span className="truncate">
              {track.artist_id ? (
                <Link
                  href={`/artist/${track.artist_id}`}
                  className="hover:underline hover:text-foreground"
                >
                  {track.artist}
                </Link>
              ) : (
                track.artist
              )}
            </span>
          </div>
        </div>
      </div>

      {/* album (desktop) */}
      {showAlbum && (
        <div className="hidden sm:block min-w-0 text-sm text-muted truncate">
          {track.album_id ? (
            <Link
              href={`/album/${track.album_id}`}
              className="hover:underline hover:text-foreground"
            >
              {track.album}
            </Link>
          ) : (
            track.album
          )}
        </div>
      )}

      {/* actions + duration */}
      <div className="flex items-center gap-2 justify-end">
        {(onMoveUp || onMoveDown) && (
          <div className="flex flex-col opacity-0 group-hover:opacity-100 transition">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!onMoveUp}
              aria-label="Nach oben"
              className="text-muted hover:text-foreground disabled:opacity-30 leading-none text-xs"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!onMoveDown}
              aria-label="Nach unten"
              className="text-muted hover:text-foreground disabled:opacity-30 leading-none text-xs"
            >
              ▼
            </button>
          </div>
        )}
        <LikeButton track={track} />
        <button
          type="button"
          onClick={() => {
            addToQueue(track);
            toast.info("Zur Warteschlange hinzugefügt.");
          }}
          aria-label="Zur Warteschlange hinzufügen"
          title="Zur Warteschlange hinzufügen"
          className="text-muted hover:text-foreground p-1 rounded-full hover:bg-panel-hover transition press"
        >
          <PlusIcon />
        </button>
        <span className="text-sm text-muted w-10 text-right tabular-nums">
          {formatTime(track.duration_sec)}
        </span>
        <TrackMenu track={track} onRemove={onRemove} />
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
