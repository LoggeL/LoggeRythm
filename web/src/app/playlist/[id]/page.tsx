"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePlaylist, useRemoveFromPlaylist, useReorderPlaylist } from "@/hooks/useLibrary";
import { usePlayerStore } from "@/store/player";
import { playlistIdFromParam, playlistPath } from "@/lib/slugs";
import EmptyState from "@/components/ui/EmptyState";
import { MusicNoteIcon } from "@/components/icons";
import type { Playlist } from "@/types";
import CollectionHero from "../_components/CollectionHero";
import CollectionPageState from "../_components/CollectionPageState";
import CollectionTracks from "../_components/CollectionTracks";
import DeletePlaylistDialog from "../_components/DeletePlaylistDialog";
import EditPlaylistDialog from "../_components/EditPlaylistDialog";
import PlaylistActions from "../_components/PlaylistActions";
import PlaylistCover from "../_components/PlaylistCover";
import SortableTracks from "../_components/SortableTracks";
import { tracksSummary } from "../_components/collectionMeta";
import { usePlaylistCoverUpload } from "../_components/usePlaylistSettings";

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
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);

  const tracks = playlist.tracks;
  const isOwner = !!playlist.is_owner;

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
    const ids = tracks.map((track) => String(track.id));
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    reorder.mutate({ id, deezerIds: ids });
  }

  return (
    <>
      <CollectionHero
        eyebrow={!isOwner ? "Playlist" : playlist.is_public ? "Öffentliche Playlist" : "Private Playlist"}
        title={playlist.name}
        description={playlist.description}
        coverUrl={playlist.cover_url}
        metadata={
          <>
            {!isOwner && playlist.owner_name && (
              <>
                von <strong>{playlist.owner_name}</strong> ·{" "}
              </>
            )}
            {tracksSummary(tracks)}
          </>
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
          />
        }
      />

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

      <CollectionTracks count={tracks.length} reorderable={isOwner}>
        {tracks.length === 0 ? (
          <EmptyState
            icon={<MusicNoteIcon width={26} height={26} />}
            title="Diese Playlist ist noch leer"
            action={
              isOwner && (
                <Link href="/search" className="action-primary">
                  Musik suchen
                </Link>
              )
            }
          >
            {isOwner ? "Füge Titel über das Menü „…“ eines Songs hinzu." : "Hier wurden noch keine Titel hinzugefügt."}
          </EmptyState>
        ) : (
          <SortableTracks
            tracks={tracks}
            onPlay={(index) => playQueue(tracks, index, playlist.name)}
            onRemove={isOwner ? (track) => removeTrack.mutate({ id, deezerId: String(track.id) }) : undefined}
            onReorder={isOwner ? moveTrack : undefined}
          />
        )}
      </CollectionTracks>

      {dialog === "edit" && <EditPlaylistDialog id={id} playlist={playlist} onClose={() => setDialog(null)} />}
      {dialog === "delete" && <DeletePlaylistDialog id={id} name={playlist.name} onClose={() => setDialog(null)} />}
    </>
  );
}
