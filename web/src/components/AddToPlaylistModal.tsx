"use client";

import { useRef, useState } from "react";
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
import { useDialogFocus } from "@/hooks/useDialogFocus";

export default function AddToPlaylistModal() {
  const track = useAddToPlaylistStore((s) => s.track);
  const session = useAddToPlaylistStore((s) => s.session);
  const close = useAddToPlaylistStore((s) => s.close);
  const { data: me } = useMe();
  const playlistQuery = usePlaylists(!!me && !!track);
  const addToPlaylist = useAddToPlaylist();
  const createPlaylist = useCreatePlaylist();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const busy = createPlaylist.isPending || addToPlaylist.isPending;
  useDialogFocus(!!track, panelRef, close);

  // Reset the inline create form whenever the modal opens for a new track
  // ("adjust state during render" — avoids a setState-in-effect cascade).
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    setCreating(false);
    setNewName("");
    setActionError(null);
  }

  if (typeof document === "undefined" || !track) return null;

  function addTo(id: string, name: string) {
    if (submitting.current || busy) return;
    const submittedTrack = track!;
    setActionError(null);
    submitting.current = true;
    addToPlaylist.mutate({ id, track: submittedTrack }, {
      onSuccess: () => {
        toast.success(`Zu „${name}“ hinzugefügt.`);
        if (useAddToPlaylistStore.getState().session === session) close();
      },
      onError: (error) => {
        if (useAddToPlaylistStore.getState().session === session) setActionError(error.message);
      },
      onSettled: () => { submitting.current = false; },
    });
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || submitting.current || busy) return;
    const submittedTrack = track!;
    setActionError(null);
    submitting.current = true;
    createPlaylist.mutate({ name }, {
      onSuccess: (playlist) => {
        if (useAddToPlaylistStore.getState().session === session) setCreating(false);
        addToPlaylist.mutate({ id: String(playlist.id), track: submittedTrack }, {
          onSuccess: () => {
            toast.success(`Zu „${playlist.name}“ hinzugefügt.`);
            if (useAddToPlaylistStore.getState().session === session) close();
          },
          onError: (error) => {
            if (useAddToPlaylistStore.getState().session === session) setActionError(error.message);
          },
          onSettled: () => { submitting.current = false; },
        });
      },
      onError: (error) => {
        if (useAddToPlaylistStore.getState().session === session) setActionError(error.message);
        submitting.current = false;
      },
    });
  }

  const list = playlistQuery.data ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Schließen"
        onClick={close}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      />

      {/* Panel */}
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Zu Playlist hinzufügen" aria-busy={busy} tabIndex={-1} className="pop-in surface-card relative flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden shadow-2xl">
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
              aria-label="Name der neuen Playlist"
              disabled={busy}
              autoFocus
              required
              className="min-w-0 flex-1 rounded bg-background border border-white/15 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="flex-shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Speichert…" : "Erstellen"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={busy}
            className="mx-3 mb-1 flex items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-white/10"
          >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded bg-panel-hover text-foreground">
              <PlusIcon />
            </span>
            <span className="font-medium text-foreground">Neue Playlist</span>
          </button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto scroll-area px-3 pb-3">
          {actionError && <p role="alert" className="px-2 py-3 text-sm text-red-300">{actionError}</p>}
          {playlistQuery.isError ? (
            <div role="alert" className="px-2 py-4 text-sm text-red-300">
              Playlists konnten nicht geladen werden: {playlistQuery.error.message}
              <button type="button" disabled={playlistQuery.isFetching} onClick={() => void playlistQuery.refetch()} className="mt-2 block underline">Erneut versuchen</button>
            </div>
          ) : playlistQuery.isPending ? (
            <p role="status" className="px-2 py-6 text-center text-sm text-muted">Playlists werden geladen…</p>
          ) : list.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Noch keine Playlists. Erstelle oben eine neue.
            </p>
          ) : (
            list.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addTo(String(p.id), p.name)}
                disabled={busy}
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
