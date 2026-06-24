"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Track } from "@/types";
import { useMe } from "@/hooks/useAuth";
import {
  usePlaylists,
  useAddToPlaylist,
  useCreatePlaylist,
} from "@/hooks/useLibrary";
import { PlusIcon } from "@/components/icons";

export default function AddToPlaylistMenu({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { data: me } = useMe();
  const { data: playlists } = usePlaylists(!!me && open);
  const addToPlaylist = useAddToPlaylist();
  const createPlaylist = useCreatePlaylist();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function handleToggle() {
    if (!me) {
      router.push("/login");
      return;
    }
    setOpen((o) => !o);
  }

  async function add(playlistId: string) {
    await addToPlaylist.mutateAsync({ id: playlistId, track });
    setOpen(false);
  }

  async function createAndAdd() {
    const name = window.prompt("Name der neuen Playlist?");
    if (!name) return;
    const pl = await createPlaylist.mutateAsync({ name });
    await addToPlaylist.mutateAsync({ id: String(pl.id), track });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={handleToggle}
        aria-label="Zur Playlist hinzufügen"
        title="Zur Playlist hinzufügen"
        className="text-muted hover:text-foreground p-1 rounded-full hover:bg-panel-hover transition"
      >
        <PlusIcon />
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-2 z-50 w-56 max-h-72 overflow-auto scroll-area rounded-md bg-[#282828] shadow-xl border border-white/10 py-1 text-sm">
          <button
            type="button"
            onClick={createAndAdd}
            className="w-full text-left px-3 py-2 hover:bg-white/10 flex items-center gap-2 text-accent"
          >
            <PlusIcon /> Neue Playlist
          </button>
          <div className="my-1 h-px bg-white/10" />
          {playlists && playlists.length > 0 ? (
            playlists.map((p) => (
              <button
                key={String(p.id)}
                type="button"
                onClick={() => add(String(p.id))}
                className="w-full text-left px-3 py-2 hover:bg-white/10 truncate"
              >
                {p.name}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-muted">Keine Playlists</div>
          )}
        </div>
      )}
    </div>
  );
}
