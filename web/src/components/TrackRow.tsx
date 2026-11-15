"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import type { Track } from "@/types";
import { usePlayerStore, currentTrack } from "@/store/player";
import { formatTime, formatCompact, formatRelativeDate } from "@/lib/format";
import type { TrackPlays } from "@/hooks/usePlays";
import { PlayIcon, PauseIcon } from "@/components/icons";
import CacheMarker from "@/components/CacheMarker";
import ArtistLinks from "@/components/ArtistLinks";
import LikeButton from "@/components/LikeButton";
import EqualizerBars from "@/components/EqualizerBars";
import TrackMenu, { useTrackMenuItems } from "@/components/TrackMenu";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import Cover from "@/components/ui/Cover";
import styles from "./trackList.module.css";

/** Map a Deezer rank (0–~1,000,000) to a 0–100 popularity percentage. */
function popularityPct(rank: number): number {
  return Math.max(2, Math.min(100, Math.round((rank / 1_000_000) * 100)));
}

/** True when the event started on a control that handles its own activation. */
function fromControl(event: MouseEvent): boolean {
  return event.target instanceof Element && event.target.closest("a, button, input, [role='menu']") !== null;
}

interface TrackRowProps {
  track: Track;
  index?: number;
  /** Used instead of single-track playback, e.g. to play the whole list. */
  onPlay?: () => void;
  onRemove?: () => void;
  /** Reordering: offered in the overflow menu (and by `dragHandle`). */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Drag-and-drop grip rendered with the row's actions (see SortableTracks). */
  dragHandle?: ReactNode;
  showAlbum?: boolean;
  /** Album pages repeat one cover on every row; hide it there. */
  showCover?: boolean;
  // Show a popularity indicator (only meaningful for search / artist results):
  // the real Last.fm play count when known, otherwise the Deezer popularity bar.
  showPopularity?: boolean;
  plays?: TrackPlays;
}

/**
 * One track in a list. Desktop: a table row (# · title · album · duration) —
 * double-click plays, like and overflow menu appear on hover/focus. Phone:
 * cover, title and menu — a tap anywhere on the row plays.
 */
export default function TrackRow({
  track,
  index,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  dragHandle,
  showAlbum = true,
  showCover = true,
  showPopularity = false,
  plays,
}: TrackRowProps) {
  const cur = usePlayerStore(currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggle = usePlayerStore((s) => s.toggle);

  const moveItems: ContextMenuItem[] = [];
  if (onMoveUp) moveItems.push({ label: "Nach oben verschieben", onClick: onMoveUp });
  if (onMoveDown) moveItems.push({ label: "Nach unten verschieben", onClick: onMoveDown });

  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuItems = useTrackMenuItems(track, onRemove, undefined, moveItems);

  const isCurrent = cur?.id === track.id;
  const playingThis = isCurrent && isPlaying;
  const titleClass = `block truncate text-[0.9375rem] font-medium leading-snug ${isCurrent ? "text-accent" : "text-foreground"}`;

  function start() {
    if (onPlay) onPlay();
    else playTrack(track);
  }

  function handlePlay() {
    if (isCurrent) toggle();
    else start();
  }

  function handleDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (fromControl(event) || playingThis) return;
    handlePlay();
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    // Events from the open menu (a portal) bubble here through React.
    if (event.target instanceof Element && event.target.closest("[role='menu']")) return;
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
  }

  return (
    <div
      data-track-id={String(track.id)}
      data-current={isCurrent}
      data-album={showAlbum}
      data-popularity={showPopularity}
      data-handle={dragHandle !== undefined}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      className={styles.row}
    >
      {/* index / play */}
      <div className={styles.index}>
        <button
          type="button"
          onClick={handlePlay}
          className={`track-row-play ${styles.play}`}
          aria-label={`${playingThis ? "Pausieren" : "Abspielen"}: ${track.title}`}
        >
          {playingThis ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span className={styles.indexLabel}>
          {isCurrent ? <EqualizerBars bars={4} height={16} isPlaying={playingThis} /> : index !== undefined ? index + 1 : ""}
        </span>
      </div>

      {/* cover + title + artist */}
      <div className="flex min-w-0 items-center gap-3">
        {showCover && <Cover src={track.cover} className="h-11 w-11 rounded-md" />}
        <div className="min-w-0">
          {track.album_id ? (
            // Only as wide as the title, and above the phone's row-wide play
            // target, so the link is tappable without swallowing the row.
            <span className="flex min-w-0">
              <Link href={`/album/${track.album_id}`} className={`${titleClass} ${styles.above} hover:underline`}>
                {track.title}
              </Link>
            </span>
          ) : (
            <span className={titleClass}>{track.title}</span>
          )}
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.8125rem] leading-snug text-muted">
            <CacheMarker trackId={track.id} className={styles.above} />
            <ArtistLinks track={track} className="truncate" linkClassName={`${styles.above} hover:text-foreground hover:underline`} />
            {/* Release recency — only radar tracks carry release_date, so this
                stays invisible in playlists/search without a special prop. */}
            {track.release_date && (
              <span className="shrink-0 text-accent-soft before:mr-1.5 before:text-subtle before:content-['·']" title={track.release_date}>
                {formatRelativeDate(track.release_date)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* album (desktop) */}
      {showAlbum && (
        <div className={`${styles.album} min-w-0 truncate text-[0.8125rem] text-muted`}>
          {track.album_id ? (
            <Link href={`/album/${track.album_id}`} className="hover:text-foreground hover:underline">
              {track.album}
            </Link>
          ) : (
            track.album
          )}
        </div>
      )}

      {/* actions + duration */}
      <div className={styles.trailing}>
        {showPopularity && plays && plays.plays > 0 ? (
          <span
            className={`${styles.popularity} mr-auto items-center gap-1.5 text-xs tabular-nums text-muted`}
            title={`${plays.plays.toLocaleString("de-DE")} Wiedergaben · ${plays.listeners.toLocaleString("de-DE")} Hörer (Last.fm)`}
          >
            <PlayIcon width={11} height={11} className="opacity-70" aria-hidden="true" />
            {formatCompact(plays.plays)}
          </span>
        ) : showPopularity && track.rank ? (
          <span className={`${styles.popularity} mr-auto items-center`} role="img" aria-label={`Popularität ${popularityPct(track.rank)} %`} title={`Popularität ${popularityPct(track.rank)} %`}>
            <span className="h-1 w-14 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${popularityPct(track.rank)}%` }} />
            </span>
          </span>
        ) : null}
        {dragHandle !== undefined && <span className={`${styles.reveal} flex`}>{dragHandle}</span>}
        <span className={`${styles.reveal} flex`}>
          <LikeButton key={track.id} track={track} />
        </span>
        <span className={styles.duration}>{formatTime(track.duration_sec)}</span>
        <span className={`${styles.reveal} flex`}>
          <TrackMenu track={track} onRemove={onRemove} extraItems={moveItems} />
        </span>
      </div>

      {menuPos && <ContextMenu x={menuPos.x} y={menuPos.y} items={menuItems} onClose={() => setMenuPos(null)} />}
    </div>
  );
}
