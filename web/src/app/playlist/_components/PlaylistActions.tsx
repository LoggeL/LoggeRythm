"use client";

import { playlistExportUrl } from "@/lib/api";
import { playlistMemberCount } from "@/lib/playlistPermissions";
import type { ContextMenuItem } from "@/components/ContextMenu";
import {
  DownloadIcon,
  DownloadedIcon,
  EditIcon,
  GlobeIcon,
  ImageIcon,
  ImportIcon,
  LockIcon,
  LogOutIcon,
  SpinnerIcon,
  TrashIcon,
  UsersIcon,
} from "@/components/icons";
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
  onManageCollaborators,
  onLeave,
}: {
  id: string;
  playlist: Playlist;
  coverUploading: boolean;
  onEdit: () => void;
  onPickCover: () => void;
  onDelete: () => void;
  onManageCollaborators: () => void;
  onLeave: () => void;
}) {
  const tracks = playlist.tracks;
  const isOwner = Boolean(playlist.is_owner);
  const isCollaborator = Boolean(playlist.is_collaborator);
  const isCollaborative = Boolean(playlist.is_collaborative);
  const memberCount = playlistMemberCount(playlist);
  const offline = usePlaylistOffline(id, playlist.name, tracks);
  const visibility = usePlaylistVisibility(id, !!playlist.is_public);
  const queueAll = useQueueAllItem(tracks);

  const items: ContextMenuItem[] = [];
  if (tracks.length > 0) items.push(queueAll);
  if (isOwner) {
    items.push(
      { label: "Details bearbeiten", icon: <EditIcon />, separated: items.length > 0, onClick: onEdit },
      { label: coverUploading ? "Cover wird hochgeladen…" : "Cover ändern", icon: <ImageIcon />, disabled: coverUploading, onClick: onPickCover },
      { label: "Mitwirkende & Einladung", icon: <UsersIcon />, onClick: onManageCollaborators },
      {
        label: visibility.pending ? "Sichtbarkeit wird geändert…" : playlist.is_public ? "Privat machen" : "Öffentlich machen",
        icon: playlist.is_public ? <LockIcon /> : <GlobeIcon />,
        disabled: visibility.pending,
        onClick: () => void visibility.toggle(),
      },
    );
  } else if (isCollaborator) {
    items.push({
      label: "Mitwirkende anzeigen",
      icon: <UsersIcon />,
      separated: items.length > 0,
      onClick: onManageCollaborators,
    });
  }
  if (tracks.length > 0) {
    items.push({ label: "Als MP3-ZIP exportieren", icon: <ImportIcon width={18} height={18} />, href: playlistExportUrl(id), download: true, onClick: () => undefined });
  }
  if (isOwner) {
    items.push({ label: "Playlist löschen", icon: <TrashIcon />, danger: true, separated: true, onClick: onDelete });
  } else if (isCollaborator) {
    items.push({ label: "Playlist verlassen", icon: <LogOutIcon />, danger: true, separated: true, onClick: onLeave });
  }

  return (
    <>
      <PlayCollectionButton tracks={tracks} context={playlist.name} />
      <ShuffleCollectionButton tracks={tracks} context={playlist.name} />
      {offline.supported && tracks.length > 0 && <OfflineButton offline={offline} />}
      {(isOwner || isCollaborator) && (
        <button
          type="button"
          onClick={onManageCollaborators}
          aria-label={isOwner ? "Mitwirkende verwalten" : "Mitwirkende anzeigen"}
          title={isOwner ? "Mitwirkende & Einladung" : "Mitwirkende"}
          className={`action-secondary h-11 min-h-0 px-3.5 text-sm ${
            isCollaborative
              ? "border-accent/45 text-foreground hover:border-accent"
              : ""
          }`}
        >
          <UsersIcon
            width={18}
            height={18}
            aria-hidden="true"
            className={isCollaborative ? "text-accent" : "text-muted"}
          />
          <span>
            {isCollaborative
              ? `Gemeinsam (${memberCount})`
              : isOwner
                ? "Teilen"
                : "Mitwirkende"}
          </span>
        </button>
      )}
      <CollectionMenu label="Weitere Optionen für diese Playlist" items={items} />
    </>
  );
}
