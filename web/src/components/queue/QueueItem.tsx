"use client";

import { useState } from "react";
import type { Track } from "@/types";
import { formatTime } from "@/lib/format";
import { PlayIcon, CloseIcon, MoreIcon, ChevronDownIcon } from "@/components/icons";
import { GripIcon } from "@/components/feedbackIcons";
import TrackContext from "@/components/TrackContext";
import CacheMarker from "@/components/CacheMarker";
import TrackTitle from "@/components/TrackTitle";
import ArtistLinks from "@/components/ArtistLinks";
import Cover from "@/components/ui/Cover";
import type { DropEdge, QueueRowDragProps } from "./useQueueReorder";

/**
 * One upcoming track. Drag the row (or Alt+↑/↓) to reorder; the remove button
 * appears on hover, focus and touch; "Mehr" reveals move buttons for devices
 * without drag and drop.
 */
export default function QueueItem({
  track,
  index,
  dragging,
  dropEdge,
  dragProps,
  canMoveUp,
  canMoveDown,
  onMove,
  onPlay,
  onRemove,
  onNavigate,
}: {
  track: Track;
  /** Position in the full queue. */
  index: number;
  dragging: boolean;
  dropEdge: DropEdge | null;
  dragProps: QueueRowDragProps;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
  onPlay: () => void;
  onRemove: () => void;
  /** Called when a title/artist link navigates away (closes an overlay). */
  onNavigate?: () => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <li
      {...dragProps}
      data-queue-index={index}
      tabIndex={0}
      aria-label={`${track.title}, ${track.artist}. Mit Alt und Pfeiltasten verschieben.`}
      className={`group relative flex flex-wrap items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.08] focus-within:bg-white/[0.08] ${dragging ? "opacity-40" : ""}`}
    >
      {dropEdge && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-accent shadow-[0_0_10px_var(--accent)] ${dropEdge === "before" ? "-top-px" : "-bottom-px"}`}
        />
      )}
      <TrackContext track={track} onRemove={onRemove} removeLabel="Aus Warteschlange entfernen" className="contents">
        <span aria-hidden="true" className="-ml-1 hidden shrink-0 cursor-grab text-subtle transition-colors active:cursor-grabbing group-hover:text-muted [@media(hover:hover)]:block">
          <GripIcon />
        </span>
        <button type="button" onClick={onPlay} aria-label={`${track.title} abspielen`} className="group/cover relative shrink-0">
          <Cover src={track.cover} className="h-11 w-11 rounded-lg" />
          <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/55 opacity-0 transition-opacity group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100">
            <PlayIcon width={16} height={16} className="text-white" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <TrackTitle track={track} onNavigate={onNavigate} className="block truncate text-sm font-medium hover:underline" />
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <CacheMarker trackId={track.id} />
            <ArtistLinks track={track} onNavigate={onNavigate} className="truncate text-xs text-muted" linkClassName="hover:text-foreground hover:underline" />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${track.title} aus Warteschlange entfernen`}
          title="Entfernen"
          className="action-icon h-10 min-h-10 w-9 opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        >
          <CloseIcon width={16} height={16} />
        </button>
        <button
          type="button"
          onClick={() => setActionsOpen((open) => !open)}
          aria-label={`Verschieben: ${track.title}`}
          aria-expanded={actionsOpen}
          className="action-icon h-10 min-h-10 w-8"
        >
          <MoreIcon width={18} height={18} />
        </button>
      </TrackContext>
      {actionsOpen && (
        <div className="flex w-full items-center justify-end gap-1 border-t border-hairline pt-1.5">
          <span className="mr-auto pl-1 text-xs tabular-nums text-muted">{formatTime(track.duration_sec)}</span>
          <button type="button" onClick={() => onMove(-1)} disabled={!canMoveUp} aria-label={`${track.title} nach oben verschieben`} className="action-icon h-10 min-h-10 w-10">
            <ChevronDownIcon className="rotate-180" width={18} height={18} />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={!canMoveDown} aria-label={`${track.title} nach unten verschieben`} className="action-icon h-10 min-h-10 w-10">
            <ChevronDownIcon width={18} height={18} />
          </button>
        </div>
      )}
    </li>
  );
}
