"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useLocalJson } from "@/hooks/useLocalJson";
import Link from "next/link";
import TrackCard from "@/components/TrackCard";
import AlbumCard from "@/components/AlbumCard";
import { CardGridSkeleton } from "@/components/Skeleton";
import type { Track, AlbumSummary, Genre, PlaylistSummary } from "@/types";

const EMPTY_TRACKS: Track[] = [];

export default function HomePage() {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [recent] = useLocalJson<Track[]>("sf_recent_tracks", EMPTY_TRACKS);

  const charts = useQuery<Track[]>({ queryKey: ["charts"], queryFn: () => api.charts() });
  const releases = useQuery<AlbumSummary[]>({
    queryKey: ["new-releases"],
    queryFn: () => api.newReleases(),
  });
  const genres = useQuery<Genre[]>({ queryKey: ["genres"], queryFn: () => api.genres() });
  const community = useQuery<PlaylistSummary[]>({
    queryKey: ["public-playlists"],
    queryFn: () => api.publicPlaylists(),
  });

  return (
    <div className="flex flex-col gap-10">
      <div>
        <h1 className="text-3xl font-extrabold mb-1">Willkommen bei Spotifrei</h1>
        <p className="text-muted">Entdecke neue Musik</p>
      </div>

      {recent.length > 0 && (
        <section className="animate-in">
          <h2 className="text-2xl font-bold mb-4">Zuletzt gespielt</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {recent.slice(0, 6).map((track, i) => (
              <TrackCard
                key={track.id}
                track={track}
                onPlay={() => playQueue(recent, i)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="animate-in">
        <h2 className="text-2xl font-bold mb-4">Charts</h2>
        {charts.isLoading && <CardGridSkeleton count={10} />}
        {charts.isError && (
          <p className="text-red-400">Charts konnten nicht geladen werden.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {(charts.data ?? []).map((track, i) => (
            <TrackCard
              key={track.id}
              track={track}
              onPlay={() => playQueue(charts.data ?? [], i)}
            />
          ))}
        </div>
      </section>

      <section className="animate-in">
        <h2 className="text-2xl font-bold mb-4">Neue Veröffentlichungen</h2>
        {releases.isLoading && <CardGridSkeleton count={10} />}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {(releases.data ?? []).map((al) => (
            <AlbumCard key={String(al.id)} album={al} />
          ))}
        </div>
      </section>

      {(community.data ?? []).length > 0 && (
        <section className="animate-in">
          <h2 className="text-2xl font-bold mb-4">Playlists der Community</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {(community.data ?? []).map((p) => (
              <Link
                key={String(p.id)}
                href={`/playlist/${p.id}`}
                className="block bg-panel hover:bg-panel-hover rounded-lg p-4 hover-lift transition"
              >
                {p.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.cover_url}
                    alt={p.name}
                    className="w-full aspect-square object-cover rounded-md shadow-lg mb-3"
                  />
                ) : (
                  <div className="w-full aspect-square rounded-md bg-panel-hover flex items-center justify-center text-4xl mb-3">
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

      {(genres.data ?? []).length > 0 && (
        <section className="animate-in">
          <h2 className="text-2xl font-bold mb-4">Genres</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {(genres.data ?? []).map((g) => (
              <Link
                key={String(g.id)}
                href={`/genre/${g.id}`}
                className="relative block rounded-lg overflow-hidden aspect-[4/3] bg-panel hover-lift transition"
              >
                {g.picture && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.picture}
                    alt={g.name}
                    className="absolute inset-0 w-full h-full object-cover opacity-70"
                  />
                )}
                <span className="absolute bottom-2 left-3 font-bold text-lg drop-shadow">
                  {g.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
