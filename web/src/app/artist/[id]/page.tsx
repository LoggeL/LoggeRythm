"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useMe } from "@/hooks/useAuth";
import { useFollowedIds, useToggleFollow } from "@/hooks/useFollows";
import TrackRow from "@/components/TrackRow";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon } from "@/components/icons";
import type { Artist } from "@/types";

export default function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError } = useQuery<Artist>({
    queryKey: ["artist", id],
    queryFn: () => api.artist(id),
    enabled: !!id,
  });
  const playQueue = usePlayerStore((s) => s.playQueue);
  const { data: me } = useMe();
  const followedIds = useFollowedIds(!!me);
  const toggleFollow = useToggleFollow();

  if (isLoading)
    return (
      <div>
        <DetailHeaderSkeleton />
        <RowListSkeleton />
      </div>
    );
  if (isError || !data)
    return <p className="text-red-400">Künstler nicht gefunden.</p>;

  const tracks = data.top ?? [];
  const albums = data.albums ?? [];
  const related = data.related ?? [];
  const following = followedIds.has(String(data.id));

  return (
    <div>
      <header className="relative flex items-end gap-6 mb-6 isolate">
        {data.picture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.picture}
            alt=""
            aria-hidden
            className="pointer-events-none absolute -z-10 -top-10 left-0 w-72 h-72 object-cover opacity-40 blur-[60px] saturate-150 rounded-full"
          />
        )}
        {data.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.picture}
            alt={data.name}
            className="w-44 h-44 md:w-48 md:h-48 rounded-full object-cover ring-1 ring-[var(--border-strong)] shadow-[0_0_40px_rgba(255,43,214,.25)]"
          />
        ) : (
          <div className="w-44 h-44 md:w-48 md:h-48 rounded-full bg-panel-hover" />
        )}
        <div>
          <p className="label-mono">Künstler</p>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight neon-text mb-2">
            {data.name}
          </h1>
        </div>
      </header>

      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={() => playQueue(tracks, 0)}
          disabled={tracks.length === 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full play-ring text-white font-semibold disabled:opacity-40"
        >
          <PlayIcon /> Abspielen
        </button>
        <button
          type="button"
          onClick={() =>
            toggleFollow.mutate({
              artist: { id: data.id, name: data.name, picture: data.picture },
              following,
            })
          }
          className={`px-5 py-2.5 rounded-full border font-semibold transition ${
            following
              ? "border-accent text-accent neon-text"
              : "border-white/30 hover:border-white/70"
          }`}
        >
          {following ? "Gefolgt" : "Folgen"}
        </button>
      </div>

      {tracks.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-3">Beliebt</h2>
          <div className="flex flex-col">
            {tracks.slice(0, 10).map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                onPlay={() => playQueue(tracks, i)}
              />
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4">Diskografie</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {albums.map((al) => (
              <AlbumCard key={String(al.id)} album={al} />
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4">Ähnliche Künstler</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {related.map((a) => (
              <ArtistCard key={String(a.id)} artist={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
