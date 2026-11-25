"use client";

import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAddToPlaylistStore } from "@/store/addToPlaylist";
import {
  usePlaylists,
  useAddToPlaylist,
  useCreatePlaylist,
} from "@/hooks/useLibrary";
import { useMe } from "@/hooks/useAuth";
import { canEditPlaylistTracks, isOwnedLibraryPlaylist } from "@/lib/playlistPermissions";
import { isSameRecording } from "@/lib/trackIdentity";
import { toast } from "@/store/toast";
import { CheckIcon, PlusIcon, UsersIcon } from "@/components/icons";
import Cover from "@/components/ui/Cover";
import QueryError from "@/components/ui/QueryError";
import Modal from "@/components/Modal";
import type { Playlist } from "@/types";

const FILTER_THRESHOLD = 4;

export default function AddToPlaylistModal() {
  const track = useAddToPlaylistStore((s) => s.track);
  const session = useAddToPlaylistStore((s) => s.session);
  const close = useAddToPlaylistStore((s) => s.close);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const playlistQuery = usePlaylists(!!me && !!track);
  const addToPlaylist = useAddToPlaylist();
  const createPlaylist = useCreatePlaylist();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCollaborative, setNewCollaborative] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savingBatch, setSavingBatch] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const submitting = useRef(false);
  const busy = createPlaylist.isPending || addToPlaylist.isPending || savingBatch;

  const [lastSession, setLastSession] = useState(session);
  if (session !== lastSession) {
    setLastSession(session);
    setCreating(false);
    setNewName("");
    setNewCollaborative(false);
    setFilter("");
    setSelectedIds([]);
    setSavingBatch(false);
    setActionError(null);
  }

  if (!track) return null;

  function isTrackInCachedPlaylist(playlistId: string): boolean {
    const cached = qc.getQueryData<Playlist>(["playlist", playlistId]);
    if (!cached?.tracks) return false;
    return cached.tracks.some((entry) => isSameRecording(entry, track!));
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

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

  async function addToSelected() {
    if (submitting.current || busy || selectedIds.length === 0) return;
    const submittedTrack = track!;
    const targets = [...selectedIds];
    setActionError(null);
    submitting.current = true;
    setSavingBatch(true);
    try {
      const results = await Promise.allSettled(
        targets.map((id) => addToPlaylist.mutateAsync({ id, track: submittedTrack })),
      );
      const failures = results.filter((res): res is PromiseRejectedResult => res.status === "rejected");
      const succeeded = results.length - failures.length;
      if (failures.length > 0) {
        const msg = failures
          .map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason)))
          .join("; ");
        if (useAddToPlaylistStore.getState().session === session) {
          setActionError(`${failures.length} von ${targets.length} fehlgeschlagen: ${msg}`);
        }
        return;
      }
      toast.success(
        succeeded === 1
          ? "Zu 1 Playlist hinzugefügt."
          : `Zu ${succeeded} Playlists hinzugefügt.`,
      );
      if (useAddToPlaylistStore.getState().session === session) close();
    } finally {
      submitting.current = false;
      setSavingBatch(false);
    }
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
  const needle = filter.trim().toLowerCase();
  const visible =
    editable && needle
      ? editable.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            (p.owner_name ?? "").toLowerCase().includes(needle),
        )
      : editable;

  return (
    <Modal
      open
      onClose={close}
      title="Zu Playlist hinzufügen"
      description={<span className="block truncate">{track.title} · {track.artist}</span>}
      footer={
        selectedIds.length > 0 ? (
          <>
            <button type="button" onClick={() => setSelectedIds([])} disabled={busy} className="action-secondary">
              Auswahl aufheben
            </button>
            <button type="button" onClick={() => void addToSelected()} disabled={busy} className="action-primary">
              {savingBatch
                ? "Speichert…"
                : selectedIds.length === 1
                  ? "Zu 1 Playlist hinzufügen"
                  : `Zu ${selectedIds.length} Playlists hinzufügen`}
            </button>
          </>
        ) : undefined
      }
    >
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
            {editable.length > FILTER_THRESHOLD && (
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Playlists filtern…"
                aria-label="Playlists filtern"
                className="field-input mt-3 min-h-10 text-sm"
              />
            )}
            <p className="label-mono flex items-center justify-between pb-1 pt-4">
              <span>Deine Playlists</span>
              <span className="tabular-nums">{visible?.length ?? 0}</span>
            </p>
            {visible && visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Keine Playlist passt zu „{filter.trim()}“.
              </p>
            ) : (
              visible?.map((p) => {
                const pid = String(p.id);
                const owned = isOwnedLibraryPlaylist(p);
                const checked = selectedIds.includes(pid);
                const alreadyIn = isTrackInCachedPlaylist(pid);
                const sublabel = !owned
                  ? p.owner_name
                    ? `Gemeinsam · von ${p.owner_name}`
                    : "Gemeinsam"
                  : p.is_collaborative
                    ? "Gemeinsam"
                    : null;
                return (
                  <div key={p.id} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggleSelected(pid)}
                      aria-label={`„${p.name}“ für Mehrfachauswahl markieren`}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => (selectedIds.length > 0 ? toggleSelected(pid) : addTo(pid, p.name))}
                      disabled={busy}
                      className={ROW}
                    >
                      <Cover src={p.cover_url} className="h-11 w-11 rounded-art" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[15px] font-medium">{p.name}</span>
                          {p.is_collaborative && (
                            <UsersIcon width={14} height={14} aria-label="Gemeinsame Playlist" className="shrink-0 text-accent" />
                          )}
                          {alreadyIn && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-success/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-success">
                              <CheckIcon width={10} height={10} aria-hidden="true" />
                              Enthalten
                            </span>
                          )}
                        </span>
                        {sublabel && (
                          <span className="mt-0.5 block truncate text-xs text-muted">{sublabel}</span>
                        )}
                      </span>
                      <span className="label-mono shrink-0 tabular-nums">{p.track_count} Titel</span>
                    </button>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

const ROW = "group flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-control)] px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.06] disabled:opacity-50 disabled:hover:bg-transparent";
