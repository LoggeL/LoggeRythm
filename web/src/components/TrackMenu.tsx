"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/useAuth";
import {
  usePlaylists,
  useAddToPlaylist,
  useCreatePlaylist,
} from "@/hooks/useLibrary";
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
  const { data: playlists } = usePlaylists(!!me);
  const addToPlaylist = useAddToPlaylist();
  const createPlaylist = useCreatePlaylist();

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
      onClick: async () => {
        try {
          const tracks = await api.radio(String(track.id));
          const store = usePlayerStore.getState();
          // start with the seed track, then the radio mix; endless top-up handled in PlayerBar
          store.playQueue([track, ...tracks], 0, `Radio – ${track.title}`);
          store.setRadioActive(true);
          toast.info("Radio gestartet…");
        } catch {
          toast.error("Radio konnte nicht gestartet werden.");
        }
      },
    },
  ];
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

  if (me) {
    for (const p of (playlists ?? []).slice(0, 8)) {
      items.push({
        label: `Zur Playlist: ${p.name}`,
        onClick: () => {
          addToPlaylist.mutate({ id: String(p.id), track });
          toast.success(`Zu „${p.name}“ hinzugefügt.`);
        },
      });
    }
    items.push({
      label: "Neue Playlist…",
      onClick: async () => {
        const name = window.prompt("Name der neuen Playlist:");
        if (!name?.trim()) return;
        try {
          const playlist = await createPlaylist.mutateAsync({
            name: name.trim(),
          });
          addToPlaylist.mutate({ id: String(playlist.id), track });
          toast.success(`Zu „${playlist.name}“ hinzugefügt.`);
        } catch {
          /* errors surfaced via mutation onError toasts */
        }
      },
    });
  }

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
