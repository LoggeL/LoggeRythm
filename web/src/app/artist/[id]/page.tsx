"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useMe } from "@/hooks/useAuth";
import { useFollowing, useToggleFollow } from "@/hooks/useFollows";
import AlbumCard from "@/components/AlbumCard";
import ArtistCard from "@/components/ArtistCard";
import PopularTrackTable from "@/components/PopularTrackTable";
import ArtistSongSearch from "@/components/ArtistSongSearch";
import ArtistAbout from "@/components/ArtistAbout";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon } from "@/components/icons";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import { formatCompact } from "@/lib/format";
import type { Artist } from "@/types";

export default function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError, error } = useQuery<Artist>({
    queryKey: ["artist", id],
    queryFn: () => api.artist(id),
    enabled: !!id,
  });
  const playQueue = usePlayerStore((s) => s.playQueue);
  const account = useMe();
  const me = account.data;
  const follows = useFollowing(!!me);
  const toggleFollow = useToggleFollow();

  if (isLoading)
    return (
      <div>
        <DetailHeaderSkeleton />
        <RowListSkeleton />
      </div>
    );
  if (!data) {
    return (
      <p role="alert" className="error-panel">
        {isError
          ? `Künstler konnte nicht geladen werden: ${error.message}`
          : "Künstler nicht gefunden."}
      </p>
    );
  }

  const tracks = data.top ?? [];
  const albums = data.albums ?? [];
  const related = data.related ?? [];
  const following =
    follows.data?.some((artist) => String(artist.id) === String(data.id)) ??
    false;

  const fans = data.fans ?? 0;

  return (
    <div className="animate-in">
      {isError && (
        <div role="alert" className="error-panel mb-4">
          Künstlerdaten konnten nicht aktualisiert werden. Der zuletzt geladene
          Stand bleibt sichtbar. {error.message}
        </div>
      )}
      <CollectionHero
        eyebrow="Künstler"
        title={data.name}
        roundArtwork
        artwork={
          data.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.picture}
              alt={data.name}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <CoverPlaceholder className="h-full w-full rounded-full" />
          )
        }
        metadata={fans > 0 ? `${formatCompact(fans)} Fans` : undefined}
        actions={
          <>
            <button
              type="button"
              onClick={() => playQueue(tracks, 0, data.name)}
              disabled={tracks.length === 0}
              className="action-primary"
            >
              <PlayIcon width={18} height={18} /> Abspielen
            </button>
            {account.isLoading ? (
              <button type="button" disabled className="action-secondary">
                Wird geladen…
              </button>
            ) : me ? (
              <button
                type="button"
                onClick={() =>
                  toggleFollow.mutate({
                    artist: {
                      id: data.id,
                      name: data.name,
                      picture: data.picture,
                    },
                    following,
                  })
                }
                disabled={
                  follows.isLoading ||
                  follows.isError ||
                  account.isError ||
                  toggleFollow.isPending
                }
                aria-pressed={following}
                className="action-secondary"
              >
                {follows.isLoading
                  ? "Wird geladen…"
                  : follows.isError
                    ? "Folgestatus unbekannt"
                    : toggleFollow.isPending
                      ? "Wird geändert…"
                      : following
                        ? "Gefolgt"
                        : "Folgen"}
              </button>
            ) : account.isError ? (
              <button type="button" disabled className="action-secondary">
                Folgen
              </button>
            ) : (
              <Link
                href="/login"
                className="action-secondary"
                title="Melde dich an, um Künstlern zu folgen."
              >
                Folgen
              </Link>
            )}
          </>
        }
      />
      {account.isError && (
        <p role="alert" className="error-panel mb-4">
          Dein Konto konnte nicht geladen werden: {account.error.message}
        </p>
      )}
      {me && follows.isError && (
        <p role="alert" className="error-panel mb-4">
          Gefolgte Künstler konnten nicht geladen werden:{" "}
          {follows.error.message}
          <button
            type="button"
            onClick={() => void follows.refetch()}
            disabled={follows.isFetching}
            className="ml-3 underline disabled:opacity-50"
          >
            Erneut versuchen
          </button>
        </p>
      )}

      <div className="border-t border-border pt-6">
        {tracks.length > 0 && (
          <section className="mb-10">
            <h2 className="section-heading mb-4">Beliebt</h2>
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
          <h2 className="section-heading mb-4">Diskografie</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {albums.map((al) => (
              <AlbumCard key={String(al.id)} album={al} />
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mb-10">
          <h2 className="section-heading mb-4">Ähnliche Künstler</h2>
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
