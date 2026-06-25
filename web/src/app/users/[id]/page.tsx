"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
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

  return (
    <div className="animate-in">
      <header className="flex items-end gap-6 mb-10">
        <Avatar src={data.avatar_url} name={data.display_name} size={128} />
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Profil</p>
          <h1 className="text-4xl font-extrabold">{data.display_name}</h1>
        </div>
      </header>

      <section className="mb-10">
        <h2 className="text-2xl font-bold mb-4">Öffentliche Playlists</h2>
        {playlists.length === 0 ? (
          <p className="text-muted">Keine öffentlichen Playlists.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {playlists.map((pl) => (
              <Link
                key={String(pl.id)}
                href={`/playlist/${pl.id}`}
                className="group block bg-panel hover:bg-panel-hover rounded-lg p-4 transition hover-lift"
              >
                {pl.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pl.cover_url}
                    alt={pl.name}
                    className="w-full aspect-square object-cover rounded-md mb-3 shadow-lg"
                  />
                ) : (
                  <div className="w-full aspect-square rounded-md bg-panel-hover mb-3" />
                )}
                <div className="truncate font-semibold">{pl.name}</div>
                <div className="text-sm text-muted">
                  {pl.track_count} Titel
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-bold mb-4">Künstler</h2>
        {artists.length === 0 ? (
          <p className="text-muted">Keine gefolgten Künstler.</p>
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
