"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useLocalJson } from "@/hooks/useLocalJson";
import TrackCard from "@/components/TrackCard";
import AlbumCard from "@/components/AlbumCard";
import { CardGridSkeleton } from "@/components/Skeleton";
import type { Track, AlbumSummary, Genre } from "@/types";

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

  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="label-mono mb-1">{"// Now streaming"}</p>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight text-gradient">
          Willkommen bei Spotifrei
        </h1>
        <p className="text-muted mt-1">Entdecke neue Musik</p>
      </div>

      {recent.length > 0 && (
        <section>
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

      <section>
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

      <section>
        <h2 className="text-2xl font-bold mb-4">Neue Veröffentlichungen</h2>
        {releases.isLoading && <CardGridSkeleton count={10} />}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {(releases.data ?? []).map((al) => (
            <AlbumCard key={String(al.id)} album={al} />
          ))}
        </div>
      </section>

      {(genres.data ?? []).length > 0 && (
        <section>
          <h2 className="text-2xl font-bold mb-4">Genres</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {(genres.data ?? []).map((g) => (
              <div
                key={String(g.id)}
                className="relative rounded-lg overflow-hidden aspect-[4/3] bg-panel"
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
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
