"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";
import Shelf from "@/components/browse/Shelf";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import CollectionPageState from "@/app/playlist/_components/CollectionPageState";
import CollectionTracks from "@/app/playlist/_components/CollectionTracks";
import { PlayCollectionButton, ShuffleCollectionButton } from "@/app/playlist/_components/CollectionActions";
import type { GenreDetail } from "@/types";

const TOP_TRACK_LIMIT = 10;

export default function GenrePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const genre = useQuery<GenreDetail>({
    queryKey: ["genre", id],
    queryFn: () => api.genre(id),
    enabled: !!id,
  });

  return (
    <CollectionPageState query={genre} label="Die Genredaten" missing="Genre nicht gefunden">
      {(data) => <GenreView genre={data} />}
    </CollectionPageState>
  );
}

function Count({ value }: { value: number }) {
  return <span className="label-mono shrink-0 tabular-nums">{value}</span>;
}

function GenreView({ genre }: { genre: GenreDetail }) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const tracks = genre.tracks ?? [];
  const albums = genre.albums ?? [];
  const artists = genre.artists ?? [];
  const topTracks = tracks.slice(0, TOP_TRACK_LIMIT);
  const metadata = [tracks.length > 0 ? `${tracks.length} Top-Titel` : "", artists.length > 0 ? `${artists.length} Künstler` : "", albums.length > 0 ? `${albums.length} Alben` : ""]
    .filter(Boolean)
    .join(" · ");
  const empty = tracks.length === 0 && albums.length === 0 && artists.length === 0;

  return (
    <>
      <CollectionHero
        eyebrow="Genre"
        title={genre.name}
        coverUrl={genre.picture}
        artwork={<Cover src={genre.picture} eager />}
        metadata={metadata || undefined}
        actions={
          tracks.length > 0 && (
            <>
              <PlayCollectionButton tracks={tracks} context={genre.name} />
              <ShuffleCollectionButton tracks={tracks} context={genre.name} />
            </>
          )
        }
      />

      {empty && (
        <EmptyState
          title="Für dieses Genre gibt es gerade nichts zu hören"
          action={
            <Link href="/genre" className="action-secondary">
              Alle Genres
            </Link>
          }
        >
          Es sind weder Titel noch Alben oder Künstler hinterlegt.
        </EmptyState>
      )}

      <div className="flex flex-col gap-9 md:gap-11">
        {topTracks.length > 0 && (
          <CollectionTracks count={topTracks.length} title="Top-Titel">
            {topTracks.map((track, index) => (
              <TrackRow key={track.id} track={track} index={index} onPlay={() => playQueue(tracks, index, genre.name)} />
            ))}
          </CollectionTracks>
        )}

        {artists.length > 0 && (
          <section aria-labelledby="genre-artists">
            <SectionHeader id="genre-artists" title="Künstler" action={<Count value={artists.length} />} />
            <Shelf label={`Künstler aus ${genre.name}`}>
              {artists.map((artist) => (
                <ArtistCard key={String(artist.id)} artist={artist} />
              ))}
            </Shelf>
          </section>
        )}

        {albums.length > 0 && (
          <section aria-labelledby="genre-albums">
            <SectionHeader id="genre-albums" title="Alben" action={<Count value={albums.length} />} />
            <Shelf label={`Alben aus ${genre.name}`}>
              {albums.map((album) => (
                <AlbumCard key={String(album.id)} album={album} />
              ))}
            </Shelf>
          </section>
        )}
      </div>
    </>
  );
}
