"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { usePartyStore } from "@/store/party";
import { toast } from "@/store/toast";
import { startTrackRadio } from "@/lib/radio";
import { useMe } from "@/hooks/useAuth";
import { openAddToPlaylist } from "@/store/addToPlaylist";
import { MoreIcon, MusicNoteIcon, NextIcon, PlusIcon, QueueIcon, RadioIcon, TrashIcon, UserIcon } from "@/components/icons";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";

const ICON = { width: 17, height: 17 } as const;

/**
 * The actions offered for a track, shared by the "…" button and right-click.
 * `extraItems` (e.g. reordering) are listed before the destructive removal.
 */
export function useTrackMenuItems(
  track: Track,
  onRemove?: () => void,
  removeLabel = "Aus Playlist entfernen",
  extraItems: ContextMenuItem[] = [],
): ContextMenuItem[] {
  const router = useRouter();
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const partyActive = usePartyStore((s) => s.active && !s.detached);
  const { data: me } = useMe();

  const items: ContextMenuItem[] = [
    {
      label: partyActive ? "Als Nächstes in Jam" : "Als Nächstes spielen",
      icon: <NextIcon {...ICON} />,
      onClick: () => {
        playNext(track);
        toast.info(partyActive ? "Wird als Nächstes in der Jam gespielt." : "Wird als Nächstes gespielt.");
      },
    },
    {
      label: partyActive ? "Zur Jam-Warteschlange" : "Zur Warteschlange",
      icon: <QueueIcon {...ICON} />,
      onClick: () => {
        addToQueue(track);
        toast.info(partyActive ? "Zur Jam-Warteschlange hinzugefügt." : "Zur Warteschlange hinzugefügt.");
      },
    },
    {
      label: "Song-Radio starten",
      icon: <RadioIcon {...ICON} />,
      onClick: () => {
        void startTrackRadio(track).catch((error: Error) => {
          usePlayerStore.getState()._setError(error.message);
        });
      },
    },
  ];
  if (me)
    items.push({
      label: "Zu Playlist hinzufügen…",
      icon: <PlusIcon {...ICON} />,
      onClick: () => openAddToPlaylist(track),
    });
  if (track.album_id)
    items.push({
      label: "Zum Album",
      icon: <MusicNoteIcon {...ICON} />,
      separated: true,
      onClick: () => router.push(`/album/${track.album_id}`),
    });
  if (track.artist_id)
    items.push({
      label: "Zum Künstler",
      icon: <UserIcon {...ICON} />,
      separated: !track.album_id,
      onClick: () => router.push(`/artist/${track.artist_id}`),
    });
  extraItems.forEach((item, index) => items.push({ ...item, separated: item.separated ?? index === 0 }));
  if (onRemove)
    items.push({
      label: removeLabel,
      icon: <TrashIcon {...ICON} />,
      danger: true,
      separated: true,
      onClick: onRemove,
    });

  return items;
}

/** "…" button that opens the track's action menu below itself. */
export default function TrackMenu({
  track,
  onRemove,
  extraItems,
}: {
  track: Track;
  onRemove?: () => void;
  extraItems?: ContextMenuItem[];
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const items = useTrackMenuItems(track, onRemove, undefined, extraItems);

  function openMenu(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    // open anchored to the bottom-right corner of the trigger button
    setPos({ x: r.right, y: r.bottom + 4 });
  }

  return (
    <>
      <button
        type="button"
        onClick={openMenu}
        aria-label={`Weitere Optionen für ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        title="Weitere Optionen"
        className="action-icon h-9 min-h-9 w-9 aria-expanded:bg-foreground/[0.08] aria-expanded:text-foreground max-sm:h-11 max-sm:w-11"
      >
        <MoreIcon />
      </button>
      {pos && <ContextMenu x={pos.x} y={pos.y} items={items} onClose={() => setPos(null)} />}
    </>
  );
}
