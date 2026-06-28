"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon } from "@/components/icons";
import type { GenreDetail } from "@/types";

export default function GenrePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError } = useQuery<GenreDetail>({
    queryKey: ["genre", id],
    queryFn: () => api.genre(id),
    enabled: !!id,
  });
  const playQueue = usePlayerStore((s) => s.playQueue);

  if (isLoading)
    return (
      <div>
        <DetailHeaderSkeleton />
        <RowListSkeleton />
      </div>
    );
  if (isError || !data)
    return <p className="text-red-400">Genre nicht gefunden.</p>;

  const tracks = data.tracks ?? [];
  const albums = data.albums ?? [];
  const artists = data.artists ?? [];

  return (
    <div className="animate-in">
      <header className="relative flex items-end gap-6 mb-6 rounded-xl overflow-hidden p-6 min-h-44 isolate">
        {data.picture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.picture}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-10 w-full h-full object-cover opacity-40"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-black/50" />
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Genre</p>
          <h1 className="text-5xl font-extrabold">{data.name}</h1>
        </div>
      </header>

      {tracks.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-2xl font-bold">Top-Titel</h2>
            <button
              type="button"
              onClick={() => playQueue(tracks, 0, data.name)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition press"
            >
              <PlayIcon width={16} height={16} /> Abspielen
            </button>
          </div>
          <div className="flex flex-col">
            {tracks.slice(0, 10).map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                onPlay={() => playQueue(tracks, i, data.name)}
              />
            ))}
          </div>
        </section>
      )}

      {artists.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4">Künstler</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {artists.map((a) => (
              <ArtistCard key={String(a.id)} artist={a} />
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4">Alben</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {albums.map((al) => (
              <AlbumCard key={String(al.id)} album={al} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
