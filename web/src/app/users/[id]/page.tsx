"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { playlistPath } from "@/lib/slugs";
import ArtistCard from "@/components/ArtistCard";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import Avatar from "@/components/Avatar";
import { DetailHeaderSkeleton } from "@/components/Skeleton";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import type { PublicProfile } from "@/types";

export default function UserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<PublicProfile>({
      queryKey: ["public-profile", id],
      queryFn: () => api.publicProfile(id),
      enabled: !!id,
    });

  if (isLoading) return <DetailHeaderSkeleton />;
  if (!data) {
    return (
      <div role="alert" className="error-panel">
        {isError
          ? `Profil konnte nicht geladen werden: ${error.message}`
          : "Profil nicht gefunden."}
        {isError && (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="ml-3 underline disabled:opacity-50"
          >
            Erneut versuchen
          </button>
        )}
      </div>
    );
  }

  const playlists = data.playlists ?? [];
  const artists = data.top_artists ?? [];
  const name = data.display_name || "Unbekannt";
  const totalTracks = playlists.reduce((n, p) => n + (p.track_count || 0), 0);

  return (
    <div className="animate-in">
      {isError && (
        <p role="alert" className="error-panel mb-4">
          Profil konnte nicht aktualisiert werden: {error.message}
        </p>
      )}
      <CollectionHero
        eyebrow="Profil"
        title={name}
        roundArtwork
        artwork={
          <Avatar
            src={data.avatar_url}
            name={name}
            size={224}
            className="h-full! w-full!"
          />
        }
        metadata={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stat n={playlists.length} label="Playlists" />
            <Dot />
            <Stat n={artists.length} label="Künstler" />
            <Dot />
            <Stat n={totalTracks} label="Titel" />
          </span>
        }
      />

      {/* Public playlists */}
      <section className="mb-10">
        <h2 className="section-heading mb-4">Öffentliche Playlists</h2>
        {playlists.length === 0 ? (
          <EmptyCard>Keine öffentlichen Playlists.</EmptyCard>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {playlists.map((pl) => (
              <Link
                key={String(pl.id)}
                href={playlistPath(pl)}
                className="music-card group block p-3"
              >
                {pl.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pl.cover_url}
                    alt={pl.name}
                    className="w-full aspect-square object-cover rounded-xl mb-3 shadow-lg shadow-black/30"
                  />
                ) : (
                  <CoverPlaceholder className="w-full aspect-square rounded-xl mb-3" />
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
        <h2 className="section-heading mb-4">Künstler</h2>
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
      <span className="font-bold text-foreground tabular-nums">{n}</span>{" "}
      {label}
    </span>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-white/25">
      •
    </span>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return <div className="empty-panel">{children}</div>;
}
