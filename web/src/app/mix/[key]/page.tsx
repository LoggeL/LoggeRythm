"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon } from "@/components/icons";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import CollectionTracks from "@/app/playlist/_components/CollectionTracks";
import type { HomeShelf } from "@/types";

export default function MixPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = use(params);
  const account = useMe();
  const me = account.data;
  const userId = me ? String(me.id) : null;
  const playQueue = usePlayerStore((state) => state.playQueue);
  const mixes = useQuery<HomeShelf[]>({
    queryKey: ["home-mixes", userId],
    queryFn: () => api.homeMixes(),
    enabled: userId !== null,
  });

  if (account.isLoading || mixes.isLoading) {
    return (
      <div>
        <DetailHeaderSkeleton />
        <RowListSkeleton />
      </div>
    );
  }

  if (account.isError && !me) {
    return (
      <p role="alert" className="error-panel">
        Dein Konto konnte nicht geladen werden: {account.error.message}
        <button
          type="button"
          onClick={() => void account.refetch()}
          disabled={account.isFetching}
          className="ml-3 underline disabled:opacity-50"
        >
          Erneut versuchen
        </button>
      </p>
    );
  }

  if (!me) {
    return (
      <div className="empty-panel">
        <p className="mb-4">Melde dich an, um deine Mixe zu hören.</p>
        <Link href="/login" className="action-primary">
          Anmelden
        </Link>
      </div>
    );
  }

  if (mixes.isError && mixes.data === undefined) {
    return (
      <p role="alert" className="error-panel">
        Die generierte Playlist konnte nicht geladen werden:{" "}
        {mixes.error.message}
      </p>
    );
  }

  const mix = mixes.data?.find((candidate) => candidate.key === key);
  if (!mix) {
    return (
      <p role="alert" className="error-panel">
        Playlist nicht gefunden.
      </p>
    );
  }

  const tracks = mix.tracks;

  return (
    <div className="animate-in">
      {account.isError && (
        <p role="alert" className="error-panel mb-4">
          Dein Konto konnte nicht aktualisiert werden: {account.error.message}
        </p>
      )}
      {mixes.isError && (
        <div role="alert" className="error-panel mb-4">
          Die Playlist konnte nicht aktualisiert werden. Der zuletzt geladene
          Stand bleibt sichtbar. {mixes.error.message}
        </div>
      )}
      <CollectionHero
        eyebrow="Playlist"
        title={mix.title}
        description={mix.subtitle}
        metadata={`${tracks.length} Titel`}
        artwork={
          mix.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mix.cover}
              alt={mix.title}
              className="h-full w-full rounded-2xl object-cover"
            />
          ) : (
            <CoverPlaceholder className="h-full w-full rounded-2xl" />
          )
        }
        actions={
          <button
            type="button"
            onClick={() => playQueue(tracks, 0, mix.title)}
            disabled={tracks.length === 0}
            className="action-primary"
          >
            <PlayIcon width={18} height={18} /> Alle abspielen
          </button>
        }
      />
      <CollectionTracks count={tracks.length}>
        {tracks.length === 0 ? (
          <p className="empty-panel">Diese Playlist ist leer.</p>
        ) : (
          <div className="flex flex-col">
            {tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                onPlay={() => playQueue(tracks, index, mix.title)}
              />
            ))}
          </div>
        )}
      </CollectionTracks>
    </div>
  );
}
