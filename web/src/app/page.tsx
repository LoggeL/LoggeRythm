"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useLocalJson } from "@/hooks/useLocalJson";
import { useMe } from "@/hooks/useAuth";
import Link from "next/link";
import Logo from "@/components/Logo";
import TrackCard from "@/components/TrackCard";
import AlbumCard from "@/components/AlbumCard";
import ShelfCard from "@/components/ShelfCard";
import { CardGridSkeleton } from "@/components/Skeleton";
import type {
  Track,
  AlbumSummary,
  Genre,
  PlaylistSummary,
  HomeShelf,
} from "@/types";

const EMPTY_TRACKS: Track[] = [];

// Chip leiste: "Top-Auswahl" = full home; the rest filter to a mood track grid.
const CHIPS: { key: string; label: string; mood?: string }[] = [
  { key: "top", label: "Top-Auswahl" },
  { key: "chill", label: "Chill", mood: "chill" },
  { key: "focus", label: "Fokus", mood: "focus" },
  { key: "workout", label: "Workout", mood: "workout" },
  { key: "party", label: "Party", mood: "party" },
];

function greeting(hour: number): string {
  if (hour < 5) return "Gute Nacht";
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}

export default function HomePage() {
  const { data: me } = useMe();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [recent] = useLocalJson<Track[]>("sf_recent_tracks", EMPTY_TRACKS);
  const [chip, setChip] = useState("top");

  const activeMood = CHIPS.find((c) => c.key === chip)?.mood;

  const mixes = useQuery<HomeShelf[]>({
    queryKey: ["home-mixes"],
    queryFn: () => api.homeMixes(),
    enabled: chip === "top",
  });
  const collections = useQuery<HomeShelf[]>({
    queryKey: ["home-collections"],
    queryFn: () => api.homeChartsCollections(),
    enabled: chip === "top",
  });
  const releases = useQuery<AlbumSummary[]>({
    queryKey: ["new-releases"],
    queryFn: () => api.newReleases(),
    enabled: chip === "top",
  });
  const genres = useQuery<Genre[]>({
    queryKey: ["genres"],
    queryFn: () => api.genres(),
    enabled: chip === "top",
  });
  const community = useQuery<PlaylistSummary[]>({
    queryKey: ["public-playlists"],
    queryFn: () => api.publicPlaylists(),
    enabled: chip === "top",
  });
  const mood = useQuery<Track[]>({
    queryKey: ["home-mood", activeMood],
    queryFn: () => api.homeMood(activeMood as string),
    enabled: !!activeMood,
  });

  const hello = greeting(new Date().getHours());
  const name = me?.display_name ? `, ${me.display_name}` : "";
  const recentFallback = (mixes.data ?? []).flatMap((shelf) => shelf.tracks);
  const displayRecent = recent.length > 0 ? recent : recentFallback;
  const recentTitle = recent.length > 0 ? "Zuletzt gehört" : "Direkt starten";

  return (
    <div className="flex flex-col gap-7 md:gap-8">
      {/* Mobile logo header (sidebar is desktop-only) */}
      <div className="flex md:hidden items-center gap-2 -mb-3">
        <Logo size={22} className="drop-glow" />
        <span className="text-base font-extrabold tracking-tight">
          <span className="text-foreground">Spoti</span>
          <span className="text-accent">frei</span>
        </span>
      </div>

      {/* Greeting */}
      <div>
        <h1 className="text-[2rem] leading-tight md:text-3xl font-extrabold mb-1">
          {hello}
          {name} <span className="align-middle">👋</span>
        </h1>
        <p className="text-muted">Entdecke neue Musik, die dich bewegt.</p>
      </div>

      {/* Chip leiste */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mt-4 md:-mt-3">
        {CHIPS.map((c) => {
          const active = c.key === chip;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              className={`press flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition ${
                active
                  ? "bg-accent text-white glow-sm"
                  : "bg-panel/70 text-muted hover:text-foreground hover:bg-panel-hover"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Mood view */}
      {activeMood && (
        <section className="animate-in">
          {mood.isLoading && <CardGridSkeleton count={10} />}
          {!mood.isLoading && (mood.data?.length ?? 0) === 0 && (
            <p className="text-muted">
              Für diese Stimmung wurden keine Titel gefunden.
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {(mood.data ?? []).map((track, i) => (
              <TrackCard
                key={track.id}
                track={track}
                onPlay={() => playQueue(mood.data ?? [], i)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Default "Top-Auswahl" home */}
      {chip === "top" && (
        <>
          {(displayRecent.length > 0 || mixes.isLoading) && (
            <section className="animate-in">
              <h2 className="text-2xl font-bold mb-4">{recentTitle}</h2>
              {mixes.isLoading && displayRecent.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7 gap-3 md:gap-4">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} className="skeleton rounded-2xl aspect-square" />
                  ))}
                </div>
              ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7 gap-3 md:gap-4">
                {displayRecent.slice(0, 7).map((track, i) => (
                  <TrackCard
                    key={track.id}
                    track={track}
                    onPlay={() => playQueue(displayRecent, i)}
                  />
                ))}
              </div>
              )}
            </section>
          )}

          {/* Für dich — curated mixes */}
          {(mixes.isLoading || (mixes.data?.length ?? 0) > 0) && (
            <section className="animate-in">
              <h2 className="text-2xl font-bold mb-4">Für dich</h2>
              {mixes.isLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton rounded-2xl min-h-[168px]" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
                  {(mixes.data ?? []).map((shelf, i) => (
                    <ShelfCard
                      key={shelf.key}
                      shelf={shelf}
                      index={i}
                      variant="hero"
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Charts — curated collections */}
          {(collections.isLoading || (collections.data?.length ?? 0) > 0) && (
            <section className="animate-in">
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

          {(genres.data ?? []).length > 0 && (
            <section className="animate-in">
              <h2 className="text-2xl font-bold mb-4">Genres</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                {(genres.data ?? []).map((g) => (
                  <Link
                    key={String(g.id)}
                    href={`/genre/${g.id}`}
                    className="relative block rounded-2xl overflow-hidden aspect-[4/3] bg-panel hover-lift transition"
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
        </>
      )}
    </div>
  );
}
