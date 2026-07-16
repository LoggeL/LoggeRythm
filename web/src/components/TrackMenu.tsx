"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import { startTrackRadio } from "@/lib/radio";
import { useMe } from "@/hooks/useAuth";
import { openAddToPlaylist } from "@/store/addToPlaylist";
import { MoreIcon } from "@/components/icons";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";

export function useTrackMenuItems(
  track: Track,
  onRemove?: () => void
): ContextMenuItem[] {
  const router = useRouter();
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const { data: me } = useMe();

  const items: ContextMenuItem[] = [
    {
      label: "Als Nächstes spielen",
      onClick: () => {
        playNext(track);
        toast.info("Zur Warteschlange hinzugefügt.");
      },
    },
    {
      label: "Zur Warteschlange",
      onClick: () => {
        addToQueue(track);
        toast.info("Zur Warteschlange hinzugefügt.");
      },
    },
    {
      label: "Song-Radio starten",
      onClick: () => startTrackRadio(track),
    },
  ];
  if (me)
    items.push({
      label: "Zu Playlist hinzufügen…",
      onClick: () => openAddToPlaylist(track),
    });
  if (track.album_id)
    items.push({
      label: "Zum Album",
      onClick: () => router.push(`/album/${track.album_id}`),
    });
  if (track.artist_id)
    items.push({
      label: "Zum Künstler",
      onClick: () => router.push(`/artist/${track.artist_id}`),
    });
  if (onRemove)
    items.push({
      label: "Aus Playlist entfernen",
      danger: true,
      onClick: onRemove,
    });

  return items;
}

export default function TrackMenu({
  track,
  onRemove,
}: {
  track: Track;
  onRemove?: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const items = useTrackMenuItems(track, onRemove);

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
        aria-label="Weitere Optionen"
        title="Weitere Optionen"
        className="text-muted hover:text-foreground p-1 rounded-full hover:bg-panel-hover transition"
      >
        <MoreIcon />
      </button>
      {pos && (
        <ContextMenu
          x={pos.x}
          y={pos.y}
          items={items}
          onClose={() => setPos(null)}
        />
      )}
    </>
  );
}
