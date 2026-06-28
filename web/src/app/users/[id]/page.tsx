"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import ArtistCard from "@/components/ArtistCard";
import Avatar from "@/components/Avatar";
import { DetailHeaderSkeleton } from "@/components/Skeleton";
import type { PublicProfile } from "@/types";

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError } = useQuery<PublicProfile>({
    queryKey: ["public-profile", id],
    queryFn: () => api.publicProfile(id),
    enabled: !!id,
  });

  if (isLoading) return <DetailHeaderSkeleton />;
  if (isError || !data)
    return <p className="text-red-400">Profil nicht gefunden.</p>;

  const playlists = data.playlists ?? [];
  const artists = data.top_artists ?? [];
  const name = data.display_name || "Unbekannt";
  const totalTracks = playlists.reduce((n, p) => n + (p.track_count || 0), 0);

  return (
    <div className="animate-in">
      {/* Hero banner */}
      <header className="relative overflow-hidden rounded-3xl border border-white/10 mb-8">
        <div className="absolute inset-0 gradient-violet opacity-25" />
        <div className="absolute -top-24 -right-10 w-72 h-72 rounded-full bg-accent/40 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
        <div className="relative flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:items-end sm:gap-6 sm:p-8 sm:text-left">
          <Avatar
            src={data.avatar_url}
            name={name}
            size={140}
            className="ring-4 ring-background shadow-2xl shadow-black/40"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-soft">
              Profil
            </p>
            <h1 className="text-4xl font-extrabold sm:text-5xl break-words">
              {name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-muted sm:justify-start">
              <Stat n={playlists.length} label="Playlists" />
              <Dot />
              <Stat n={artists.length} label="Künstler" />
              <Dot />
              <Stat n={totalTracks} label="Titel" />
            </div>
          </div>
        </div>
      </header>

      {/* Public playlists */}
      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4">Öffentliche Playlists</h2>
        {playlists.length === 0 ? (
          <EmptyCard>Keine öffentlichen Playlists.</EmptyCard>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {playlists.map((pl) => (
              <Link
                key={String(pl.id)}
                href={playlistPath(pl)}
                className="group block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover-lift hover:bg-white/[0.06]"
              >
                {pl.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pl.cover_url}
                    alt={pl.name}
                    className="w-full aspect-square object-cover rounded-xl mb-3 shadow-lg shadow-black/30"
                  />
                ) : (
                  <div className="w-full aspect-square rounded-xl gradient-violet opacity-80 mb-3" />
                )}
                <div className="truncate font-semibold">{pl.name}</div>
                <div className="text-sm text-muted">{pl.track_count} Titel</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Followed artists */}
      <section>
        <h2 className="text-2xl font-bold mb-4">Künstler</h2>
        {artists.length === 0 ? (
          <EmptyCard>Keine gefolgten Künstler.</EmptyCard>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            {artists.map((a) => (
              <ArtistCard key={String(a.id)} artist={a} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <span className="font-bold text-foreground tabular-nums">{n}</span> {label}
    </span>
  );
}

function Dot() {
  return <span aria-hidden className="text-white/25">•</span>;
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-8 text-center text-muted">
      {children}
    </div>
  );
}
