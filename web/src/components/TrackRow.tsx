"use client";

import { useState } from "react";
import Link from "next/link";
import type { Track } from "@/types";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime, formatCompact, formatRelativeDate } from "@/lib/format";
import { toast } from "@/store/toast";
import type { TrackPlays } from "@/hooks/usePlays";
import { PlayIcon, PauseIcon, PlusIcon } from "@/components/icons";
import CacheMarker from "@/components/CacheMarker";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import TrackMenu, { useTrackMenuItems } from "@/components/TrackMenu";
import ContextMenu from "@/components/ContextMenu";
import CoverPlaceholder from "@/components/CoverPlaceholder";

/** Map a Deezer rank (0–~1,000,000) to a 0–100 popularity percentage. */
function popularityPct(rank: number): number {
  return Math.max(2, Math.min(100, Math.round((rank / 1_000_000) * 100)));
}

interface TrackRowProps {
  track: Track;
  index?: number;
  // play handler: if provided, used instead of single-track play (e.g. play whole queue)
  onPlay?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  showAlbum?: boolean;
  // Show a popularity indicator (only meaningful for search / artist results):
  // the real Last.fm play count when known, otherwise the Deezer popularity bar.
  showPopularity?: boolean;
  plays?: TrackPlays;
}

export default function TrackRow({
  track,
  index,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  showAlbum = true,
  showPopularity = false,
  plays,
}: TrackRowProps) {
  const cur = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

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
          <CoverPlaceholder className="w-10 h-10 rounded flex-shrink-0" />
        )}
        <div className="min-w-0">
          {track.album_id ? (
            <Link
              href={`/album/${track.album_id}`}
              className={`block truncate font-medium hover:underline ${
                isCurrent ? "text-accent" : "text-foreground"
              }`}
            >
              {track.title}
            </Link>
          ) : (
            <div
              className={`truncate font-medium ${
                isCurrent ? "text-accent" : "text-foreground"
              }`}
            >
              {track.title}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-sm text-muted min-w-0">
            <CacheMarker trackId={track.id} />
            <ArtistLinks track={track} className="truncate" />
            {/* Release recency — only radar tracks carry release_date, so this
                stays invisible in playlists/search without a special prop. */}
            {track.release_date && (
              <span
                className="flex-shrink-0 text-accent/90 before:content-['·'] before:mr-1.5 before:text-muted"
                title={track.release_date}
              >
                {formatRelativeDate(track.release_date)}
              </span>
            )}
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
        {showPopularity && plays && plays.plays > 0 ? (
          <span
            className="hidden sm:flex items-center gap-1.5 mr-1 text-xs text-muted tabular-nums"
            title={`${plays.plays.toLocaleString("de-DE")} Wiedergaben · ${plays.listeners.toLocaleString("de-DE")} Hörer (Last.fm)`}
          >
            <PlayIcon width={11} height={11} className="opacity-70" />
            {formatCompact(plays.plays)}
          </span>
        ) : showPopularity && track.rank ? (
          <div
            className="hidden sm:flex items-center gap-1.5 mr-1"
            title={`Popularität ${popularityPct(track.rank)}%`}
          >
            <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${popularityPct(track.rank)}%` }}
              />
            </div>
          </div>
        ) : null}
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
