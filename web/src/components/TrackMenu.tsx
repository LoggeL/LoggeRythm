"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";
import { MoreIcon } from "@/components/icons";

interface Item {
  label: string;
  onClick: () => void;
}

export default function TrackMenu({
  track,
  onRemove,
}: {
  track: Track;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items: Item[] = [
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
    items.push({ label: "Aus Playlist entfernen", onClick: onRemove });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Weitere Optionen"
        title="Weitere Optionen"
        className="text-muted hover:text-foreground p-1 rounded-full hover:bg-panel-hover transition"
      >
        <MoreIcon />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-2 z-50 w-52 rounded-md bg-[#282828] shadow-xl border border-white/10 py-1 text-sm">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                it.onClick();
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 hover:bg-white/10 truncate"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
