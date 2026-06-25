"use client";

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePlaylist,
  useRemoveFromPlaylist,
  useReorderPlaylist,
  useUpdatePlaylist,
  useDeletePlaylist,
} from "@/hooks/useLibrary";
import { usePlayerStore } from "@/store/player";
import { useDownloads } from "@/hooks/useDownloads";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";
import TrackRow from "@/components/TrackRow";
import Modal from "@/components/Modal";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon, EditIcon, TrashIcon } from "@/components/icons";

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data, isLoading, isError } = usePlaylist(id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const removeFromPlaylist = useRemoveFromPlaylist();
  const reorder = useReorderPlaylist();
  const updatePlaylist = useUpdatePlaylist();
  const deletePlaylist = useDeletePlaylist();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { isDownloaded, downloadPlaylist, removeDownload, progress, supported } =
    useDownloads();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);

  async function onCoverPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadPlaylistCover(id, file);
      qc.invalidateQueries({ queryKey: ["playlist", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      toast.success("Cover aktualisiert.");
    } catch {
      toast.error("Cover-Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
    }
  }

  if (isLoading)
    return (
      <div>
        <DetailHeaderSkeleton />
        <RowListSkeleton />
      </div>
    );
  if (isError || !data)
    return <p className="text-red-400">Playlist nicht gefunden.</p>;

  const tracks = data.tracks ?? [];
  const isOwner = !!data.is_owner;

  function startEdit() {
    setName(data!.name);
    setDescription(data!.description ?? "");
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    await updatePlaylist.mutateAsync({ id, patch: { name, description } });
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm("Diese Playlist wirklich löschen?")) return;
    await deletePlaylist.mutateAsync(id);
    router.push("/library");
  }

  async function toggleVisibility() {
    const next = !data!.is_public;
    try {
      await api.setPlaylistVisibility(id, next);
      qc.invalidateQueries({ queryKey: ["playlist", id] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
      toast.success(next ? "Playlist ist jetzt öffentlich." : "Playlist ist jetzt privat.");
    } catch {
      toast.error("Sichtbarkeit konnte nicht geändert werden.");
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= tracks.length) return;
    const ids = tracks.map((t) => String(t.id));
    const [m] = ids.splice(from, 1);
    ids.splice(to, 0, m);
    reorder.mutate({ id, deezerIds: ids });
  }

  return (
    <div className="animate-in">
      <header className="flex items-end gap-6 mb-6">
        <div className="relative w-40 h-40 flex-shrink-0 group">
          {data.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.cover_url}
              alt={data.name}
              className="w-40 h-40 rounded-md object-cover shadow-xl"
            />
          ) : (
            <div className="w-40 h-40 rounded-md bg-panel-hover flex items-center justify-center text-5xl shadow-xl">
              ♪
            </div>
          )}
          {isOwner && (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                aria-label="Cover ändern"
                className="absolute inset-0 rounded-md bg-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-1 text-sm font-medium disabled:opacity-100"
              >
                <EditIcon />
                {uploading ? "Lädt…" : "Cover ändern"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onCoverPick}
                className="hidden"
              />
            </>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">Playlist</p>
          <h1 className="text-4xl font-extrabold mb-2 truncate">{data.name}</h1>
          {data.description && <p className="text-muted">{data.description}</p>}
          <p className="text-sm text-muted mt-1">
            {!isOwner && data.owner_name ? `von ${data.owner_name} · ` : ""}
            {tracks.length} Titel
          </p>
        </div>
      </header>

      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => playQueue(tracks, 0)}
          disabled={tracks.length === 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover disabled:opacity-40"
        >
          <PlayIcon /> Alle abspielen
        </button>
        {supported && tracks.length > 0 && (
          progress && progress.id === id ? (
            <span className="text-sm text-muted">
              Lädt… {progress.done}/{progress.total}
            </span>
          ) : isDownloaded(id) ? (
            <button
              type="button"
              onClick={() => {
                removeDownload(id, tracks);
                toast.info("Offline-Download entfernt.");
              }}
              className="press px-4 py-2 rounded-full border border-accent text-accent text-sm font-medium"
            >
              ✓ Offline
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                downloadPlaylist(id, data.name, tracks);
                toast.info("Download gestartet…");
              }}
              className="press px-4 py-2 rounded-full border border-white/20 text-sm font-medium hover:border-white/60 transition"
            >
              Herunterladen
            </button>
          )
        )}
        {isOwner && (
          <>
            <button
              type="button"
              onClick={toggleVisibility}
              className="px-4 py-2 rounded-full border border-white/20 text-sm font-medium hover:border-white/60 transition"
            >
              {data.is_public ? "Öffentlich" : "Privat"}
            </button>
            <button
              type="button"
              onClick={startEdit}
              aria-label="Playlist bearbeiten"
              title="Bearbeiten"
              className="text-muted hover:text-foreground p-2 rounded-full hover:bg-panel-hover"
            >
              <EditIcon />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Playlist löschen"
              title="Löschen"
              className="text-muted hover:text-red-400 p-2 rounded-full hover:bg-panel-hover"
            >
              <TrashIcon />
            </button>
          </>
        )}
      </div>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Playlist bearbeiten"
      >
        <form onSubmit={saveEdit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Beschreibung
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="bg-background border border-white/15 rounded px-3 py-2 outline-none focus:border-accent resize-none"
            />
          </label>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-4 py-2 rounded-full text-muted hover:text-foreground"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover"
            >
              Speichern
            </button>
          </div>
        </form>
      </Modal>

      {tracks.length === 0 ? (
        <p className="text-muted">Diese Playlist ist leer.</p>
      ) : (
        <div className="flex flex-col">
          {tracks.map((track, i) => (
            <TrackRow
              key={track.id}
              track={track}
              index={i}
              onPlay={() => playQueue(tracks, i)}
              onRemove={
                isOwner
                  ? () =>
                      removeFromPlaylist.mutate({ id, deezerId: String(track.id) })
                  : undefined
              }
              onMoveUp={isOwner && i > 0 ? () => move(i, i - 1) : undefined}
              onMoveDown={
                isOwner && i < tracks.length - 1 ? () => move(i, i + 1) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
