"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlaylist, useRemoveFromPlaylist, useReorderPlaylist } from "@/hooks/useLibrary";
import { usePlaylistEvents } from "@/hooks/usePlaylistEvents";
import { usePlayerStore } from "@/store/player";
import { playlistIdFromParam, playlistPath } from "@/lib/slugs";
import {
  canEditPlaylistTracks,
  playlistHeroEyebrow,
  playlistMemberCount,
} from "@/lib/playlistPermissions";
import Avatar from "@/components/Avatar";
import EmptyState from "@/components/ui/EmptyState";
import { InfoCircleIcon } from "@/components/feedbackIcons";
import { MusicNoteIcon } from "@/components/icons";
import ListFilter, { NoFilterMatch } from "@/app/library/_tabs/ListFilter";
import { matchesFilter } from "@/app/library/_tabs/filter";
import type { Playlist, PlaylistCollaboratorUser, PlaylistTrack } from "@/types";
import CollectionHero from "../_components/CollectionHero";
import CollectionPageState from "../_components/CollectionPageState";
import CollectionTracks from "../_components/CollectionTracks";
import CollaboratorAvatars from "../_components/CollaboratorAvatars";
import CollaboratorsDialog from "../_components/CollaboratorsDialog";
import DeduplicatePlaylistDialog from "../_components/DeduplicatePlaylistDialog";
import DeletePlaylistDialog from "../_components/DeletePlaylistDialog";
import EditPlaylistDialog from "../_components/EditPlaylistDialog";
import LeavePlaylistDialog from "../_components/LeavePlaylistDialog";
import PlaylistActions from "../_components/PlaylistActions";
import PlaylistCover from "../_components/PlaylistCover";
import PlaylistQuickAdd from "../_components/PlaylistQuickAdd";
import SortableTracks from "../_components/SortableTracks";
import { tracksSummary } from "../_components/collectionMeta";
import { usePlaylistCoverUpload } from "../_components/usePlaylistSettings";

type PlaylistSortKey = "custom" | "title" | "artist" | "duration" | "contributor";

function sortPlaylistTracks(tracks: PlaylistTrack[], sort: PlaylistSortKey): PlaylistTrack[] {
  if (sort === "custom") return tracks;
  const copy = [...tracks];
  if (sort === "title") return copy.sort((a, b) => a.title.localeCompare(b.title, "de"));
  if (sort === "artist") return copy.sort((a, b) => a.artist.localeCompare(b.artist, "de"));
  if (sort === "duration") return copy.sort((a, b) => (a.duration_sec || 0) - (b.duration_sec || 0));
  return copy.sort((a, b) =>
    (a.added_by?.display_name ?? "").localeCompare(b.added_by?.display_name ?? "", "de"),
  );
}

function AddedByNote({ addedBy }: { addedBy?: PlaylistCollaboratorUser | null }) {
  if (!addedBy) return <span className="text-subtle">–</span>;
  const name = addedBy.display_name || `Nutzer #${addedBy.id}`;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle" title={`Hinzugefügt von ${name}`}>
      <Avatar src={addedBy.avatar_url} name={name} size={18} />
      <Link
        href={`/users/${addedBy.id}`}
        className="truncate hover:text-foreground hover:underline"
      >
        {name}
      </Link>
    </span>
  );
}

export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = use(params);
  const id = playlistIdFromParam(slug);
  const playlist = usePlaylist(id);

  return (
    <CollectionPageState query={playlist} label="Die Playlist-Daten" missing="Playlist nicht gefunden">
      {(data) => <PlaylistView id={id} slug={slug} playlist={data} />}
    </CollectionPageState>
  );
}

function PlaylistView({ id, slug, playlist }: { id: string; slug: string; playlist: Playlist }) {
  const router = useRouter();
  const playQueue = usePlayerStore((state) => state.playQueue);
  const removeTrack = useRemoveFromPlaylist();
  const reorder = useReorderPlaylist();
  const cover = usePlaylistCoverUpload(id);
  const coverInput = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<"edit" | "delete" | "collaborators" | "leave" | "deduplicate" | null>(null);
  const [filterTerm, setFilterTerm] = useState("");
  const [sort, setSort] = useState<PlaylistSortKey>("custom");

  const tracks = playlist.tracks;
  const isOwner = Boolean(playlist.is_owner);
  const isCollaborator = Boolean(playlist.is_collaborator);
  const isCollaborative = Boolean(playlist.is_collaborative);
  const canEditTracks = canEditPlaylistTracks(playlist);
  const collaborators = playlist.collaborators ?? [];
  const memberCount = playlistMemberCount(playlist);
  const hasCollaborationContext =
    isCollaborative || isCollaborator || collaborators.length > 0;
  usePlaylistEvents(id, hasCollaborationContext, playlist.revision);
  const hasExternalContributorTrack = tracks.some(
    (track) =>
      Boolean(track.added_by) &&
      playlist.owner_id != null &&
      track.added_by!.id !== playlist.owner_id,
  );
  const showAttribution =
    hasCollaborationContext || hasExternalContributorTrack;

  const isFiltered = filterTerm.trim().length > 0;
  const displayedTracks = useMemo(() => {
    const filtered = isFiltered
      ? tracks.filter((track) =>
          matchesFilter(
            filterTerm,
            track.title,
            track.artist,
            track.album,
            track.added_by?.display_name ?? undefined,
          ),
        )
      : tracks;
    return sortPlaylistTracks(filtered, sort);
  }, [tracks, filterTerm, isFiltered, sort]);
  const reorderEnabled = canEditTracks && !isFiltered && sort === "custom";
  const existingTrackIds = useMemo(
    () => new Set(tracks.map((track) => String(track.id))),
    [tracks],
  );

  // Keep the address on the playlist's current slug. Not while editing: a
  // rename changes the slug and the dialog must survive that.
  const canonical = playlistPath(playlist);
  useEffect(() => {
    if (dialog !== "edit" && `/playlist/${slug}` !== canonical) router.replace(canonical);
  }, [canonical, dialog, slug, router]);

  function pickCover() {
    if (!coverInput.current) throw new Error("Die Cover-Auswahl ist nicht eingebunden.");
    coverInput.current.click();
  }

  function moveTrack(from: number, to: number) {
    const allHaveEntryIds = tracks.every(
      (track) => typeof track.playlist_entry_id === "number",
    );
    if (allHaveEntryIds) {
      const entryIds = tracks.map((track) => track.playlist_entry_id as number);
      const [moved] = entryIds.splice(from, 1);
      entryIds.splice(to, 0, moved);
      reorder.mutate({ id, entryIds });
      return;
    }
    const ids = tracks.map((track) => String(track.id));
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    reorder.mutate({ id, deezerIds: ids });
  }

  return (
    <>
      <CollectionHero
        eyebrow={playlistHeroEyebrow(playlist)}
        title={playlist.name}
        description={playlist.description}
        coverUrl={playlist.cover_url}
        metadata={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {hasCollaborationContext && (
              <>
                <CollaboratorAvatars
                  ownerName={playlist.owner_name}
                  ownerAvatarUrl={playlist.owner_avatar_url}
                  collaborators={collaborators}
                  totalCount={memberCount}
                  onClick={
                    isOwner || isCollaborator
                      ? () => setDialog("collaborators")
                      : undefined
                  }
                />
                <span aria-hidden="true" className="text-subtle">
                  ·
                </span>
              </>
            )}
            {!isOwner && playlist.owner_name && (
              <>
                <span>
                  von{" "}
                  {playlist.owner_id ? (
                    <Link href={`/users/${playlist.owner_id}`}>
                      {playlist.owner_name}
                    </Link>
                  ) : (
                    <strong>{playlist.owner_name}</strong>
                  )}
                </span>
                <span aria-hidden="true" className="text-subtle">
                  ·
                </span>
              </>
            )}
            <span>{tracksSummary(tracks)}</span>
          </span>
        }
        artwork={<PlaylistCover src={playlist.cover_url} editable={isOwner} uploading={cover.uploading} inputRef={coverInput} onUpload={(file) => void cover.upload(file)} />}
        actions={
          <PlaylistActions
            id={id}
            playlist={playlist}
            coverUploading={cover.uploading}
            onEdit={() => setDialog("edit")}
            onPickCover={pickCover}
            onDelete={() => setDialog("delete")}
            onManageCollaborators={() => setDialog("collaborators")}
            onLeave={() => setDialog("leave")}
            onDeduplicate={() => setDialog("deduplicate")}
          />
        }
      />

      {isCollaborator && !isCollaborative && (
        <div className="mb-5 flex items-start gap-3 rounded-[var(--radius-control)] border border-hairline bg-panel/70 px-4 py-3 text-sm text-muted">
          <InfoCircleIcon width={18} height={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Die gemeinsame Bearbeitung wurde pausiert. Du kannst diese Playlist weiterhin anhören, aber derzeit keine Titel ändern.
          </span>
        </div>
      )}

      {reorder.isError && (
        <p role="alert" className="error-panel mb-4">
          Die neue Reihenfolge konnte nicht gespeichert werden und wurde zurückgesetzt: {reorder.error.message}
        </p>
      )}
      {removeTrack.isError && (
        <p role="alert" className="error-panel mb-4">
          Der Titel konnte nicht entfernt werden: {removeTrack.error.message}
        </p>
      )}

      {tracks.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <ListFilter
            label="In dieser Playlist suchen"
            value={filterTerm}
            onChange={setFilterTerm}
            className="flex-1 sm:max-w-72"
          />
          <select
            aria-label="Playlist sortieren"
            value={sort}
            onChange={(event) => setSort(event.target.value as PlaylistSortKey)}
            className="field-input w-auto shrink-0 rounded-full py-2 pl-4 pr-3 text-xs font-semibold sm:min-h-10"
          >
            <option value="custom">Eigene Reihenfolge</option>
            <option value="title">Titel A–Z</option>
            <option value="artist">Künstler A–Z</option>
            <option value="duration">Dauer</option>
            {showAttribution && <option value="contributor">Hinzugefügt von</option>}
          </select>
          {canEditTracks && (isFiltered || sort !== "custom") && (
            <button
              type="button"
              onClick={() => {
                setFilterTerm("");
                setSort("custom");
              }}
              className="label-mono min-h-9 px-2 text-accent-soft hover:underline"
            >
              Zurücksetzen zum Umsortieren
            </button>
          )}
        </div>
      )}

      <CollectionTracks
        count={displayedTracks.length}
        reorderable={reorderEnabled}
        noteLabel={showAttribution ? "Hinzugefügt von" : undefined}
      >
        {tracks.length === 0 ? (
          <EmptyState
            icon={<MusicNoteIcon width={26} height={26} />}
            title="Diese Playlist ist noch leer"
            action={
              canEditTracks && (
                <Link href="/search" className="action-primary">
                  Musik suchen
                </Link>
              )
            }
          >
            {canEditTracks ? "Füge Titel direkt unten über die Schnellsuche oder das Menü „…“ eines Songs hinzu." : "Hier wurden noch keine Titel hinzugefügt."}
          </EmptyState>
        ) : displayedTracks.length === 0 ? (
          <NoFilterMatch term={filterTerm} onReset={() => setFilterTerm("")} />
        ) : (
          <SortableTracks
            tracks={displayedTracks}
            onPlay={(index) => playQueue(displayedTracks, index, playlist.name)}
            onRemove={
              canEditTracks
                ? (track) =>
                    removeTrack.mutate({
                      id,
                      deezerId: String(track.id),
                      entryId: track.playlist_entry_id,
                    })
                : undefined
            }
            onReorder={reorderEnabled ? moveTrack : undefined}
            renderNote={
              showAttribution
                ? (track) => <AddedByNote addedBy={track.added_by} />
                : undefined
            }
          />
        )}
      </CollectionTracks>

      {canEditTracks && <PlaylistQuickAdd playlistId={id} existingTrackIds={existingTrackIds} />}

      {dialog === "edit" && <EditPlaylistDialog id={id} playlist={playlist} onClose={() => setDialog(null)} />}
      {dialog === "delete" && <DeletePlaylistDialog id={id} name={playlist.name} onClose={() => setDialog(null)} />}
      {dialog === "collaborators" && (
        <CollaboratorsDialog
          id={id}
          playlist={playlist}
          onClose={() => setDialog(null)}
          onRequestLeave={() => setDialog("leave")}
        />
      )}
      {dialog === "leave" && (
        <LeavePlaylistDialog
          id={id}
          name={playlist.name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "deduplicate" && (
        <DeduplicatePlaylistDialog
          id={id}
          name={playlist.name}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
