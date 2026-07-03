"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import AlbumCard from "@/components/AlbumCard";
import ShelfCard from "@/components/ShelfCard";
import { CardGridSkeleton } from "@/components/Skeleton";
import { CompassIcon } from "@/components/icons";
import type {
  AlbumSummary,
  Genre,
  HomeShelf,
  PlaylistSummary,
} from "@/types";

export default function DiscoverPage() {
  const collections = useQuery<HomeShelf[]>({
    queryKey: ["home-collections"],
    queryFn: () => api.homeChartsCollections(),
  });
  const genres = useQuery<Genre[]>({
    queryKey: ["genres"],
    queryFn: () => api.genres(),
  });
  const releases = useQuery<AlbumSummary[]>({
    queryKey: ["new-releases"],
    queryFn: () => api.newReleases(),
  });
  const community = useQuery<PlaylistSummary[]>({
    queryKey: ["public-playlists"],
    queryFn: () => api.publicPlaylists(),
  });

  return (
    <div className="flex flex-col gap-8 animate-in">
      {/* Header */}
      <header className="relative overflow-hidden rounded-2xl border border-white/10 gradient-aurora p-6 md:p-8 isolate">
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="flex items-center gap-4">
          <span className="flex-shrink-0 w-14 h-14 rounded-full bg-white/15 backdrop-blur flex items-center justify-center glow-sm">
            <CompassIcon width={30} height={30} />
          </span>
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold">Entdecken</h1>
            <p className="text-white/85 mt-1">
              Charts, Genres und frische Veröffentlichungen — stöbere durch die
              ganze Bibliothek.
            </p>
          </div>
        </div>
      </header>

      {/* Charts collections */}
      {(collections.isLoading || (collections.data?.length ?? 0) > 0) && (
        <section>
          <h2 className="text-2xl font-bold mb-4">Charts</h2>
          {collections.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton rounded-2xl aspect-[4/3]" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-4">
              {(collections.data ?? []).map((shelf, i) => (
                <ShelfCard
                  key={shelf.key}
                  shelf={shelf}
                  index={i}
                  variant="collection"
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Genres */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Nach Genre stöbern</h2>
        {genres.isLoading && <CardGridSkeleton count={12} />}
        {!genres.isLoading && (genres.data?.length ?? 0) === 0 && (
          <p className="text-muted">Keine Genres verfügbar.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {(genres.data ?? []).map((g) => (
            <Link
              key={String(g.id)}
              href={`/genre/${g.id}`}
              className="group relative block rounded-2xl overflow-hidden aspect-[4/3] bg-panel hover-lift transition"
            >
              {g.picture && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={g.picture}
                  alt={g.name}
                  className="absolute inset-0 w-full h-full object-cover opacity-65 transition-transform duration-300 group-hover:scale-105"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
              <span className="absolute bottom-2 left-3 right-3 font-bold text-lg drop-shadow truncate">
                {g.name}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* New releases */}
      {(releases.isLoading || (releases.data?.length ?? 0) > 0) && (
        <section>
          <h2 className="text-2xl font-bold mb-4">Neue Veröffentlichungen</h2>
          {releases.isLoading ? (
            <CardGridSkeleton count={10} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {(releases.data ?? []).map((al) => (
                <AlbumCard key={String(al.id)} album={al} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Community playlists */}
      {(community.data ?? []).length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-4">Playlists der Community</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {(community.data ?? []).map((p) => (
              <Link
                key={String(p.id)}
                href={playlistPath(p)}
                className="block bg-panel/70 border border-white/5 hover:bg-panel-hover rounded-2xl p-4 hover-lift transition"
              >
                {p.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.cover_url}
                    alt={p.name}
                    className="w-full aspect-square object-cover rounded-xl shadow-lg mb-3"
                  />
                ) : (
                  <div className="w-full aspect-square rounded-xl gradient-aurora opacity-80 flex items-center justify-center text-4xl mb-3">
                    ♪
                  </div>
                )}
                <div className="truncate font-semibold">{p.name}</div>
                <div className="truncate text-sm text-muted">
                  {p.owner_name ? `von ${p.owner_name}` : "Playlist"} ·{" "}
                  {p.track_count} Titel
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
