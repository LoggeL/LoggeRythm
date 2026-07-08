"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useMe } from "@/hooks/useAuth";
import { useFollowedIds, useToggleFollow } from "@/hooks/useFollows";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import PopularTrackTable from "@/components/PopularTrackTable";
import ArtistSongSearch from "@/components/ArtistSongSearch";
import ArtistAbout from "@/components/ArtistAbout";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon, MoreIcon, VerifiedIcon } from "@/components/icons";
import { formatCompact } from "@/lib/format";
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

  const fans = data.fans ?? 0;

  return (
    <div>
      {/* Hero header with decorative aurora */}
      <div className="relative -mx-4 sm:-mx-8 px-4 sm:px-8 overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/artist-aurora.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 h-[360px] w-[70%] object-cover opacity-90 [mask-image:linear-gradient(to_left,black,transparent)]"
          style={{ mixBlendMode: "screen" }}
        />

        <header className="relative flex items-center gap-8 pt-10 pb-8 pl-2">
          <div className="relative flex-shrink-0">
            <div className="absolute -inset-2.5 rounded-full bg-[conic-gradient(from_210deg,#3b82ff,#7c5cff,#c46bff,#3b82ff)] blur-md opacity-80" />
            <div className="absolute -inset-1 rounded-full bg-[conic-gradient(from_210deg,#3b82ff,#7c5cff,#c46bff,#3b82ff)]" />
            {data.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.picture}
                alt={data.name}
                className="relative w-44 h-44 rounded-full object-cover ring-2 ring-white/10"
              />
            ) : (
              <CoverPlaceholder className="relative w-44 h-44 rounded-full" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-3">
              <VerifiedIcon className="text-accent" width={20} height={20} />
              <span className="text-[13px] font-semibold uppercase tracking-wider text-muted">
                Künstler
              </span>
            </div>
            <h1 className="text-6xl lg:text-7xl font-bold tracking-tight leading-none mb-4">
              {data.name}
            </h1>
            {fans > 0 && (
              <p className="text-sm text-muted mb-8">
                {formatCompact(fans)} monatliche Hörer*innen
              </p>
            )}

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => playQueue(tracks, 0, data.name)}
                disabled={tracks.length === 0}
                className="inline-flex items-center gap-2.5 pl-6 pr-7 py-3 rounded-full bg-accent text-white font-semibold shadow-lg shadow-accent/25 hover:bg-accent-hover disabled:opacity-40 press"
              >
                <PlayIcon width={18} height={18} /> Abspielen
              </button>
              <button
                type="button"
                onClick={() =>
                  toggleFollow.mutate({
                    artist: { id: data.id, name: data.name, picture: data.picture },
                    following,
                  })
                }
                className={`px-8 py-2.5 rounded-full border font-semibold transition press ${
                  following
                    ? "border-accent text-accent"
                    : "border-white/25 hover:border-white/60"
                }`}
              >
                {following ? "Gefolgt" : "Folgen"}
              </button>
              <button
                type="button"
                aria-label="Weitere Optionen"
                className="grid h-12 w-12 place-items-center rounded-full border border-white/25 text-muted hover:text-foreground hover:border-white/60 transition press"
              >
                <MoreIcon width={20} height={20} />
              </button>
            </div>
          </div>
        </header>
      </div>

      <div className="pt-6">
        {tracks.length > 0 && (
          <section className="mb-10">
            <h2 className="text-2xl font-bold mb-4">Beliebt</h2>
            <PopularTrackTable
              tracks={tracks.slice(0, 10)}
              context={data.name}
              showPlays
            />
          </section>
        )}

        <ArtistSongSearch artistId={String(data.id)} artistName={data.name} />
      </div>

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

      <ArtistAbout
        name={data.name}
        picture={data.picture}
        albumsCount={data.albums_count}
      />
    </div>
  );
}
