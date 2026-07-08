"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAddToPlaylistStore } from "@/store/addToPlaylist";
import {
  usePlaylists,
  useAddToPlaylist,
  useCreatePlaylist,
} from "@/hooks/useLibrary";
import { useMe } from "@/hooks/useAuth";
import { toast } from "@/store/toast";
import { PlusIcon } from "@/components/icons";
import CoverPlaceholder from "@/components/CoverPlaceholder";

export default function AddToPlaylistModal() {
  const track = useAddToPlaylistStore((s) => s.track);
  const close = useAddToPlaylistStore((s) => s.close);
  const { data: me } = useMe();
  const { data: playlists } = usePlaylists(!!me && !!track);
  const addToPlaylist = useAddToPlaylist();
  const createPlaylist = useCreatePlaylist();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  // Reset the inline create form whenever the modal opens for a new track
  // ("adjust state during render" — avoids a setState-in-effect cascade).
  const [lastTrackId, setLastTrackId] = useState(track?.id);
  if (track?.id !== lastTrackId) {
    setLastTrackId(track?.id);
    setCreating(false);
    setNewName("");
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    if (track) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [track, close]);

  if (typeof document === "undefined" || !track) return null;

  function addTo(id: string, name: string) {
    addToPlaylist.mutate({ id, track: track! });
    toast.success(`Zu „${name}“ hinzugefügt.`);
    close();
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const playlist = await createPlaylist.mutateAsync({ name });
      addToPlaylist.mutate({ id: String(playlist.id), track: track! });
      toast.success(`Zu „${playlist.name}“ hinzugefügt.`);
      close();
    } catch {
      /* errors surfaced via mutation onError toasts */
    }
  }

  const list = playlists ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Zu Playlist hinzufügen"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Schließen"
        onClick={close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      />

      {/* Panel */}
      <div className="pop-in relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1c1c22] shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">
              Zu Playlist hinzufügen
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted">{track.title}</p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Schließen"
            className="-mr-1 -mt-1 flex-shrink-0 rounded-full p-2 text-muted transition hover:bg-panel-hover hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {creating ? (
          <form
            onSubmit={createAndAdd}
            className="mx-3 mb-1 flex items-center gap-2 rounded-lg px-2 py-2"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name der neuen Playlist"
              autoFocus
              required
              className="min-w-0 flex-1 rounded bg-background border border-white/15 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={createPlaylist.isPending}
              className="flex-shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {createPlaylist.isPending ? "…" : "Erstellen"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mx-3 mb-1 flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-white/10"
          >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded bg-panel-hover text-foreground">
              <PlusIcon />
            </span>
            <span className="font-medium text-foreground">Neue Playlist</span>
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto scroll-area px-3 pb-3">
          {list.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Noch keine Playlists. Erstelle oben eine neue.
            </p>
          ) : (
            list.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addTo(String(p.id), p.name)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/10"
              >
                {p.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.cover_url}
                    alt=""
                    width={44}
                    height={44}
                    className="h-11 w-11 flex-shrink-0 rounded object-cover"
                  />
                ) : (
                  <CoverPlaceholder className="h-11 w-11 flex-shrink-0 rounded" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {p.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {p.track_count} Titel
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
