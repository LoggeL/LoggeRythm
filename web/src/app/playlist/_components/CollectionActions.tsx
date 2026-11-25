"use client";

import { useMemo, useState, type MouseEvent } from "react";
import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { openSaveAsPlaylist } from "@/store/saveAsPlaylist";
import { toast } from "@/store/toast";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { isCollectionQueue } from "./collectionPlayback";
import { MoreIcon, PauseIcon, PlayIcon, QueueIcon, SavePlaylistIcon, ShuffleIcon } from "@/components/icons";

/**
 * The hero's main control: plays the collection from the top, or pauses and
 * resumes it while it is the one playing. `context` is the queue label.
 */
export function PlayCollectionButton({ tracks, context }: { tracks: Track[]; context: string }) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const toggle = usePlayerStore((state) => state.toggle);
  const index = usePlayerStore((state) => state.index);
  const queue = usePlayerStore((state) => state.queue);
  const origins = usePlayerStore((state) => state.origins);
  const queueContext = usePlayerStore((state) => state.queueContext);
  const active = useMemo(() => isCollectionQueue({ index, queue, origins, queueContext }, context, tracks), [index, queue, origins, queueContext, context, tracks]);
  const playing = usePlayerStore((state) => state.isPlaying) && active;

  return (
    <button
      type="button"
      onClick={() => (active ? toggle() : playQueue(tracks, 0, context))}
      disabled={tracks.length === 0}
      aria-label={playing ? `${context} pausieren` : `${context} abspielen`}
      title={playing ? "Pausieren" : "Abspielen"}
      className="play-fab h-14 w-14"
    >
      {playing ? <PauseIcon width={28} height={28} /> : <PlayIcon width={28} height={28} />}
    </button>
  );
}

/** Starts the collection at a random track with shuffle switched on. */
export function ShuffleCollectionButton({ tracks, context }: { tracks: Track[]; context: string }) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const shuffle = usePlayerStore((state) => state.shuffle);

  function shufflePlay() {
    if (!shuffle) toggleShuffle();
    playQueue(tracks, Math.floor(Math.random() * tracks.length), context);
  }

  return (
    <button type="button" onClick={shufflePlay} disabled={tracks.length === 0} aria-label="Zufällig abspielen" title="Zufällig abspielen" className="action-icon h-11 w-11">
      <ShuffleIcon width={22} height={22} />
    </button>
  );
}

/** Menu entry that batch-appends the whole collection to the queue in one update. */
export function useQueueAllItem(tracks: Track[]): ContextMenuItem {
  const addManyToQueue = usePlayerStore((state) => state.addManyToQueue);
  return {
    label: "Zur Warteschlange hinzufügen",
    icon: <QueueIcon width={18} height={18} />,
    disabled: tracks.length === 0,
    onClick: () => {
      addManyToQueue(tracks);
      toast.info(`${tracks.length} Titel zur Warteschlange hinzugefügt.`);
    },
  };
}

/** Menu entry that saves an ephemeral track collection as a new permanent playlist. */
export function useSaveAsPlaylistItem(
  defaultName: string,
  tracks: Track[],
  description?: string,
): ContextMenuItem {
  return {
    label: "Als Playlist speichern",
    icon: <SavePlaylistIcon width={18} height={18} />,
    disabled: tracks.length === 0,
    onClick: () => openSaveAsPlaylist({ defaultName, description, tracks }),
  };
}

/** "…" button holding the rare and destructive actions of a collection. */
export function CollectionMenu({ label, items }: { label: string; items: ContextMenuItem[] }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  if (items.length === 0) return null;

  function open(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ x: rect.left, y: rect.bottom + 6 });
  }

  return (
    <>
      <button type="button" onClick={open} aria-label={label} aria-haspopup="menu" aria-expanded={position !== null} title={label} className="action-icon h-11 w-11">
        <MoreIcon width={22} height={22} />
      </button>
      {position && <ContextMenu x={position.x} y={position.y} items={items} onClose={() => setPosition(null)} />}
    </>
  );
}
