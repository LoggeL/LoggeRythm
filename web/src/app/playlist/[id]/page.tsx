"use client";

import { use, useEffect, useRef, useState } from "react";
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
import { api, playlistExportUrl } from "@/lib/api";
import { playlistIdFromParam, playlistPath } from "@/lib/slugs";
import { toast } from "@/store/toast";
import TrackRow from "@/components/TrackRow";
import Modal from "@/components/Modal";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import CollectionHero from "../_components/CollectionHero";
import CollectionTracks from "../_components/CollectionTracks";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon, EditIcon, TrashIcon } from "@/components/icons";

export default function PlaylistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: playlistParam } = use(params);
  const id = playlistIdFromParam(playlistParam);
  const router = useRouter();
  const { data, isLoading, isError, error, refetch, isFetching } =
    usePlaylist(id);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const removeFromPlaylist = useRemoveFromPlaylist();
  const reorder = useReorderPlaylist();
  const updatePlaylist = useUpdatePlaylist();
  const deletePlaylist = useDeletePlaylist();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    isDownloaded,
    downloadPlaylist,
    removeDownload,
    progress,
    supported,
  } = useDownloads();

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [visibilityPending, setVisibilityPending] = useState(false);
  const visibilityRequest = useRef(false);
  const offlineRequest = useRef(false);
  const [offlinePending, setOfflinePending] = useState<
    "download" | "remove" | null
  >(null);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const canonical = playlistPath(data).replace("/playlist/", "");
    if (!editing && playlistParam !== canonical) {
      router.replace(`/playlist/${canonical}`);
    }
  }, [data, editing, playlistParam, router]);

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
    } catch (err) {
      toast.error(
        `Cover-Upload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
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
  if (isError && !data)
    return (
      <div role="alert" className="error-panel">
        Playlist konnte nicht geladen werden: {error.message}
        <button
          type="button"
          disabled={isFetching}
          onClick={() => void refetch()}
          className="ml-3 underline disabled:opacity-50"
        >
          Erneut versuchen
        </button>
      </div>
    );
  if (!data)
    throw new Error(
      "Playlist konnte nicht angezeigt werden: Die API-Antwort enthält keine Daten.",
    );

  const tracks = data.tracks ?? [];
  const isOwner = !!data.is_owner;

  function startEdit() {
    updatePlaylist.reset();
    setNameError(null);
    setName(data!.name);
    setDescription(data!.description ?? "");
    setEditing(true);
  }

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (updatePlaylist.isPending) return;
    const nextName = name.trim();
    if (!nextName) {
      setNameError("Gib einen Namen für die Playlist ein.");
      return;
    }
    setNameError(null);
    updatePlaylist.mutate(
      { id, patch: { name: nextName, description } },
      { onSuccess: () => setEditing(false) },
    );
  }

  function handleDelete() {
    if (deletePlaylist.isPending) return;
    deletePlaylist.mutate(id, { onSuccess: () => router.push("/library") });
  }

  async function toggleVisibility() {
    if (visibilityRequest.current) return;
    visibilityRequest.current = true;
    setVisibilityPending(true);
    const next = !data!.is_public;
    try {
      await api.setPlaylistVisibility(id, next);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["playlist", id] }),
        qc.invalidateQueries({ queryKey: ["playlists"] }),
      ]);
      toast.success(
        next ? "Playlist ist jetzt öffentlich." : "Playlist ist jetzt privat.",
      );
    } catch (err) {
      toast.error(
        `Sichtbarkeit konnte nicht geändert werden: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      visibilityRequest.current = false;
      setVisibilityPending(false);
    }
  }

  async function toggleOfflineDownload() {
    if (offlineRequest.current) return;
    const removing = isDownloaded(id);
    offlineRequest.current = true;
    setOfflinePending(removing ? "remove" : "download");
    try {
      if (removing) {
        await removeDownload(id, tracks);
        toast.info("Offline-Download entfernt.");
      } else {
        toast.info("Download gestartet…");
        await downloadPlaylist(id, data!.name, tracks);
      }
    } catch (error) {
      toast.error(
        `Offline-Download konnte nicht ${removing ? "entfernt" : "gespeichert"} werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      offlineRequest.current = false;
      setOfflinePending(null);
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
      {isError && (
        <div role="alert" className="error-panel mb-4">
          Playlist konnte nicht aktualisiert werden: {error.message}
          <button
            type="button"
            disabled={isFetching}
            onClick={() => void refetch()}
            className="ml-3 underline disabled:opacity-50"
          >
            Erneut versuchen
          </button>
        </div>
      )}
      <CollectionHero
        eyebrow="Playlist"
        title={data.name}
        description={data.description}
        metadata={
          <>
            {!isOwner && data.owner_name ? `von ${data.owner_name} · ` : ""}
            {tracks.length} Titel
          </>
        }
        artwork={
          <>
            {data.cover_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.cover_url}
                alt={data.name}
                className="h-full w-full rounded-2xl object-cover"
              />
            ) : (
              <CoverPlaceholder className="h-full w-full rounded-2xl" />
            )}
            {isOwner && (
              <>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  aria-label="Cover ändern"
                  className="absolute bottom-3 left-3 right-3 flex min-h-10 items-center justify-center gap-2 rounded-lg bg-black/75 px-3 py-2 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/90 disabled:cursor-wait disabled:opacity-60"
                >
                  <EditIcon width={14} height={14} />
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
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => playQueue(tracks, 0, data.name)}
              disabled={tracks.length === 0}
              className="action-primary"
            >
              <PlayIcon width={18} height={18} /> Alle abspielen
            </button>
            {tracks.length > 0 && (
              <a
                href={playlistExportUrl(id)}
                download
                aria-label="Playlist als MP3-ZIP exportieren"
                title="Playlist als ZIP mit MP3-Dateien exportieren"
                className="action-secondary"
              >
                MP3 exportieren
              </a>
            )}
            {supported &&
              tracks.length > 0 &&
              (progress && progress.id === id ? (
                <span role="status" className="text-sm text-muted">
                  Lädt… {progress.done}/{progress.total}
                </span>
              ) : isDownloaded(id) ? (
                <button
                  type="button"
                  onClick={() => void toggleOfflineDownload()}
                  disabled={offlinePending !== null}
                  aria-busy={offlinePending === "remove"}
                  className="action-secondary text-accent-soft"
                >
                  {offlinePending === "remove" ? "Wird entfernt…" : "✓ Offline"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void toggleOfflineDownload()}
                  disabled={offlinePending !== null}
                  aria-busy={offlinePending !== null}
                  className="action-secondary"
                >
                  {offlinePending === "remove"
                    ? "Wird entfernt…"
                    : offlinePending === "download"
                      ? "Wird gespeichert…"
                      : "Herunterladen"}
                </button>
              ))}
            {isOwner && (
              <>
                <button
                  type="button"
                  onClick={toggleVisibility}
                  disabled={visibilityPending}
                  aria-pressed={data.is_public}
                  title={
                    data.is_public
                      ? "Playlist privat machen"
                      : "Playlist veröffentlichen"
                  }
                  className="action-secondary"
                >
                  {visibilityPending
                    ? "Wird geändert…"
                    : data.is_public
                      ? "Öffentlich"
                      : "Privat"}
                </button>
                <button
                  type="button"
                  onClick={startEdit}
                  aria-label="Playlist bearbeiten"
                  title="Bearbeiten"
                  className="action-icon"
                >
                  <EditIcon />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deletePlaylist.reset();
                    setConfirmingDelete(true);
                  }}
                  aria-label="Playlist löschen"
                  title="Löschen"
                  className="action-icon hover:text-red-400"
                >
                  <TrashIcon />
                </button>
              </>
            )}
          </>
        }
      />

      <Modal
        open={confirmingDelete}
        onClose={() => {
          if (!deletePlaylist.isPending) setConfirmingDelete(false);
        }}
        title="Playlist löschen"
      >
        <p className="text-sm text-muted mb-4">
          „{data.name}“ wird endgültig gelöscht. Das kann nicht rückgängig
          gemacht werden.
        </p>
        {deletePlaylist.isError && (
          <p role="alert" className="text-sm text-red-400 mb-4">
            Playlist konnte nicht gelöscht werden:{" "}
            {deletePlaylist.error.message}
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            disabled={deletePlaylist.isPending}
            className="action-secondary"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deletePlaylist.isPending}
            className="px-5 py-2 rounded-full bg-red-500 text-white font-semibold hover:bg-red-400 disabled:opacity-60"
          >
            {deletePlaylist.isPending ? "Wird gelöscht…" : "Löschen"}
          </button>
        </div>
      </Modal>

      <Modal
        open={editing}
        onClose={() => {
          if (!updatePlaylist.isPending) setEditing(false);
        }}
        title="Playlist bearbeiten"
      >
        <form onSubmit={saveEdit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              required
              disabled={updatePlaylist.isPending}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "playlist-name-error" : undefined}
              className="field-input"
            />
            {nameError && (
              <span
                id="playlist-name-error"
                role="alert"
                className="text-red-400"
              >
                {nameError}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Beschreibung
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={updatePlaylist.isPending}
              rows={2}
              className="field-input resize-none"
            />
          </label>
          {updatePlaylist.isError && (
            <p role="alert" className="text-sm text-red-400">
              Playlist konnte nicht gespeichert werden:{" "}
              {updatePlaylist.error.message}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={updatePlaylist.isPending}
              className="action-secondary"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={updatePlaylist.isPending}
              className="action-primary"
            >
              {updatePlaylist.isPending ? "Wird gespeichert…" : "Speichern"}
            </button>
          </div>
        </form>
      </Modal>

      <CollectionTracks count={tracks.length}>
        {tracks.length === 0 ? (
          <p className="empty-panel">Diese Playlist ist leer.</p>
        ) : (
          <div className="flex flex-col">
            {tracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                onPlay={() => playQueue(tracks, i, data.name)}
                onRemove={
                  isOwner
                    ? () =>
                        removeFromPlaylist.mutate({
                          id,
                          deezerId: String(track.id),
                        })
                    : undefined
                }
                onMoveUp={isOwner && i > 0 ? () => move(i, i - 1) : undefined}
                onMoveDown={
                  isOwner && i < tracks.length - 1
                    ? () => move(i, i + 1)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </CollectionTracks>
    </div>
  );
}
