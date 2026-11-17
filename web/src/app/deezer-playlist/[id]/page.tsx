"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import CollectionPageState from "@/app/playlist/_components/CollectionPageState";
import CollectionTracks from "@/app/playlist/_components/CollectionTracks";
import { CollectionMenu, PlayCollectionButton, ShuffleCollectionButton, useQueueAllItem } from "@/app/playlist/_components/CollectionActions";
import { tracksSummary } from "@/app/playlist/_components/collectionMeta";
import type { DeezerPlaylistDetail } from "@/types";

export default function DeezerPlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const id = decodeURIComponent(rawId);
  // Same key as the search card's play button, so opening a played playlist is instant.
  const playlist = useQuery<DeezerPlaylistDetail>({
    queryKey: ["deezer-playlist", id],
    queryFn: () => api.deezerPlaylist(id),
  });

  return (
    <CollectionPageState query={playlist} label="Die Playlistdaten" missing="Playlist nicht gefunden">
      {(data) => <DeezerPlaylistView playlist={data} />}
    </CollectionPageState>
  );
}

function DeezerPlaylistView({ playlist }: { playlist: DeezerPlaylistDetail }) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const tracks = playlist.tracks;
  const queueAll = useQueueAllItem(tracks);

  return (
    <>
      <CollectionHero
        eyebrow="Playlist"
        title={playlist.name}
        coverUrl={playlist.cover}
        artwork={<Cover src={playlist.cover} alt={`Cover von ${playlist.name}`} eager />}
        metadata={<>Deezer · {tracksSummary(tracks)}</>}
        actions={
          <>
            <PlayCollectionButton tracks={tracks} context={playlist.name} />
            <ShuffleCollectionButton tracks={tracks} context={playlist.name} />
            {tracks.length > 0 && <CollectionMenu label="Weitere Optionen für diese Playlist" items={[queueAll]} />}
          </>
        }
      />
      <CollectionTracks count={tracks.length}>
        {tracks.length === 0 ? (
          <EmptyState
            title="Diese Playlist enthält keine Titel"
            action={
              <Link href="/search" className="action-secondary">
                Zur Suche
              </Link>
            }
          >
            Für diese Playlist sind keine abspielbaren Titel hinterlegt.
          </EmptyState>
        ) : (
          tracks.map((track, index) => <TrackRow key={track.id} track={track} index={index} onPlay={() => playQueue(tracks, index, playlist.name)} />)
        )}
      </CollectionTracks>
    </>
  );
}
