"use client";

import { playlistExportUrl } from "@/lib/api";
import type { ContextMenuItem } from "@/components/ContextMenu";
import { DownloadIcon, DownloadedIcon, EditIcon, GlobeIcon, ImageIcon, ImportIcon, LockIcon, SpinnerIcon, TrashIcon } from "@/components/icons";
import type { Playlist } from "@/types";
import { CollectionMenu, PlayCollectionButton, ShuffleCollectionButton, useQueueAllItem } from "./CollectionActions";
import { usePlaylistOffline } from "./usePlaylistOffline";
import { usePlaylistVisibility } from "./usePlaylistSettings";

/** Icon toggle for the playlist's offline copy, with live download progress. */
function OfflineButton({ offline }: { offline: ReturnType<typeof usePlaylistOffline> }) {
  const { downloaded, pending, progress } = offline;
  const label = pending === "remove" ? "Offline-Download wird entfernt…" : pending === "download" ? "Wird heruntergeladen…" : downloaded ? "Offline-Download entfernen" : "Offline verfügbar machen";
  return (
    <>
      <button
        type="button"
        onClick={() => void offline.toggle()}
        disabled={pending !== null}
        aria-pressed={downloaded}
        aria-busy={pending !== null}
        aria-label={label}
        title={label}
        className="action-icon h-11 w-11"
      >
        {pending ? (
          <SpinnerIcon width={22} height={22} className="animate-spin" />
        ) : downloaded ? (
          <DownloadedIcon width={22} height={22} className="text-success" />
        ) : (
          <DownloadIcon width={24} height={24} />
        )}
      </button>
      {progress && (
        <span role="status" className="text-sm tabular-nums text-muted">
          {progress.done}/{progress.total} gespeichert
        </span>
      )}
    </>
  );
}

/**
 * The playlist hero's action row: play, shuffle, offline download and an
 * overflow menu with the rare (edit, cover, visibility, export) and
 * destructive (delete) actions. Owner-only entries are left out for guests.
 */
export default function PlaylistActions({
  id,
  playlist,
  coverUploading,
  onEdit,
  onPickCover,
  onDelete,
}: {
  id: string;
  playlist: Playlist;
  coverUploading: boolean;
  onEdit: () => void;
  onPickCover: () => void;
  onDelete: () => void;
}) {
  const tracks = playlist.tracks;
  const isOwner = !!playlist.is_owner;
  const offline = usePlaylistOffline(id, playlist.name, tracks);
  const visibility = usePlaylistVisibility(id, !!playlist.is_public);
  const queueAll = useQueueAllItem(tracks);

  const items: ContextMenuItem[] = [];
  if (tracks.length > 0) items.push(queueAll);
  if (isOwner) {
    items.push(
      { label: "Details bearbeiten", icon: <EditIcon />, separated: items.length > 0, onClick: onEdit },
      { label: coverUploading ? "Cover wird hochgeladen…" : "Cover ändern", icon: <ImageIcon />, disabled: coverUploading, onClick: onPickCover },
      {
        label: visibility.pending ? "Sichtbarkeit wird geändert…" : playlist.is_public ? "Privat machen" : "Öffentlich machen",
        icon: playlist.is_public ? <LockIcon /> : <GlobeIcon />,
        disabled: visibility.pending,
        onClick: () => void visibility.toggle(),
      },
    );
  }
  if (tracks.length > 0) {
    items.push({ label: "Als MP3-ZIP exportieren", icon: <ImportIcon width={18} height={18} />, href: playlistExportUrl(id), download: true, onClick: () => undefined });
  }
  if (isOwner) items.push({ label: "Playlist löschen", icon: <TrashIcon />, danger: true, separated: true, onClick: onDelete });

  return (
    <>
      <PlayCollectionButton tracks={tracks} context={playlist.name} />
      <ShuffleCollectionButton tracks={tracks} context={playlist.name} />
      {offline.supported && tracks.length > 0 && <OfflineButton offline={offline} />}
      <CollectionMenu label="Weitere Optionen für diese Playlist" items={items} />
    </>
  );
}
