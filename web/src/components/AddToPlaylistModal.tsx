"use client";

import { useState, useRef } from "react";
import { useAddToPlaylistStore } from "@/store/addToPlaylist";
import {
  usePlaylists,
  useAddToPlaylist,
  useCreatePlaylist,
} from "@/hooks/useLibrary";
import { useMe } from "@/hooks/useAuth";
import { canEditPlaylistTracks, isOwnedLibraryPlaylist } from "@/lib/playlistPermissions";
import { toast } from "@/store/toast";
import { PlusIcon, UsersIcon } from "@/components/icons";
import Cover from "@/components/ui/Cover";
import QueryError from "@/components/ui/QueryError";
import Modal from "@/components/Modal";

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
  const [newCollaborative, setNewCollaborative] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const submitting = useRef(false);
  const busy = createPlaylist.isPending || addToPlaylist.isPending;

  // Reset the inline create form whenever the modal opens for a new track
  // ("adjust state during render" — avoids a setState-in-effect cascade).
  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    setCreating(false);
    setNewName("");
    setNewCollaborative(false);
    setActionError(null);
  }

  if (!track) return null;

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
    createPlaylist.mutate({ name, is_collaborative: newCollaborative }, {
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

  const list = playlistQuery.data;
  const editable = list?.filter(canEditPlaylistTracks);

  return (
    <Modal open onClose={close} title="Zu Playlist hinzufügen" description={<span className="block truncate">{track.title} · {track.artist}</span>}>
      <div aria-busy={busy} className="flex flex-col">
        {creating ? (
          <form onSubmit={createAndAdd} className="flex flex-col gap-3 border-y border-hairline py-3">
            <label htmlFor="add-to-playlist-name" className="label-mono">
              Neue Playlist
            </label>
            <div className="flex items-center gap-2">
              <input
                id="add-to-playlist-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name der neuen Playlist"
                aria-label="Name der neuen Playlist"
                maxLength={120}
                disabled={busy}
                autoFocus
                required
                className="field-input min-w-0 flex-1"
              />
              <button type="submit" disabled={busy || !newName.trim()} className="action-primary shrink-0">
                {busy ? "Speichert…" : "Erstellen"}
              </button>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={newCollaborative}
                onChange={(e) => setNewCollaborative(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              <span>Als gemeinsame Playlist anlegen</span>
            </label>
          </form>
        ) : (
          <div className="border-y border-hairline py-1">
            <button type="button" onClick={() => setCreating(true)} disabled={busy} className={ROW}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-art border border-dashed border-border text-muted transition-colors group-hover:border-foreground/40 group-hover:text-foreground">
                <PlusIcon width={18} height={18} />
              </span>
              <span className="font-display text-[15px] font-bold tracking-tight">Neue Playlist</span>
            </button>
          </div>
        )}

        {actionError && (
          <p role="alert" className="error-panel mt-3">
            Titel konnte nicht hinzugefügt werden: {actionError}
          </p>
        )}
        <QueryError label="Playlists" query={playlistQuery} className="mt-3" />
        {playlistQuery.isPending && (
          <div role="status" aria-label="Playlists werden geladen" className="pt-2">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-3 py-2">
                <span className="skeleton h-11 w-11 shrink-0 rounded-art" />
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="skeleton h-3.5 w-1/2 rounded" />
                  <span className="skeleton h-3 w-1/4 rounded" />
                </span>
              </div>
            ))}
          </div>
        )}
        {editable && !playlistQuery.isError && editable.length === 0 && (
          <p className="py-8 text-center text-sm leading-relaxed text-muted">
            {list && list.length > 0
              ? "Derzeit ist keine deiner Playlists bearbeitbar. Lege oben mit „Neue Playlist“ eine neue an."
              : "Du hast noch keine Playlist. Lege oben mit „Neue Playlist“ deine erste an."}
          </p>
        )}
        {editable && !playlistQuery.isError && editable.length > 0 && (
          <>
            <p className="label-mono flex items-center justify-between pb-1 pt-4">
              <span>Deine Playlists</span>
              <span className="tabular-nums">{editable.length}</span>
            </p>
            {editable.map((p) => {
              const owned = isOwnedLibraryPlaylist(p);
              const sublabel = !owned
                ? p.owner_name
                  ? `Gemeinsam · von ${p.owner_name}`
                  : "Gemeinsam"
                : p.is_collaborative
                  ? "Gemeinsam"
                  : null;
              return (
                <button key={p.id} type="button" onClick={() => addTo(String(p.id), p.name)} disabled={busy} className={ROW}>
                  <Cover src={p.cover_url} className="h-11 w-11 rounded-art" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium">{p.name}</span>
                      {p.is_collaborative && (
                        <UsersIcon width={14} height={14} aria-label="Gemeinsame Playlist" className="shrink-0 text-accent" />
                      )}
                    </span>
                    {sublabel && (
                      <span className="mt-0.5 block truncate text-xs text-muted">{sublabel}</span>
                    )}
                  </span>
                  <span className="label-mono shrink-0 tabular-nums">{p.track_count} Titel</span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </Modal>
  );
}

const ROW = "group -mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center gap-3 rounded-[var(--radius-control)] px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] disabled:opacity-50 disabled:hover:bg-transparent";
