"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useMe } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon } from "@/components/icons";
import type { HomeShelf } from "@/types";

export default function MixPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = use(params);
  const { data: me } = useMe();
  const userId = me ? String(me.id) : null;
  const playQueue = usePlayerStore((state) => state.playQueue);
  const mixes = useQuery<HomeShelf[]>({
    queryKey: ["home-mixes", userId],
    queryFn: () => api.homeMixes(),
    enabled: userId !== null,
  });

  if (mixes.isLoading) {
    return (
      <div>
        <DetailHeaderSkeleton />
        <RowListSkeleton />
      </div>
    );
  }

  if (mixes.isError && mixes.data === undefined) {
    return (
      <p className="text-red-400">
        Die generierte Playlist konnte nicht geladen werden:{" "}
        {mixes.error.message}
      </p>
    );
  }

  const mix = mixes.data?.find((candidate) => candidate.key === key);
  if (!mix) {
    return <p className="text-red-400">Playlist nicht gefunden.</p>;
  }

  const tracks = mix.tracks;

  return (
    <div className="animate-in">
      {mixes.isError && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200"
        >
          Die Playlist konnte nicht aktualisiert werden. Der zuletzt geladene
          Stand bleibt sichtbar. {mixes.error.message}
        </div>
      )}
      <header className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6 mb-6">
        <div className="relative w-40 h-40 flex-shrink-0">
          {mix.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mix.cover}
              alt={mix.title}
              className="w-40 h-40 rounded-md object-cover shadow-xl"
            />
          ) : (
            <CoverPlaceholder className="w-40 h-40 rounded-md shadow-xl" />
          )}
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={() => playQueue(tracks, 0, mix.title)}
              aria-label="Alle abspielen"
              title="Alle abspielen"
              className="absolute -bottom-3 -right-3 z-10 grid h-12 w-12 place-items-center rounded-full bg-accent text-white shadow-xl shadow-accent/30 transition hover:bg-accent-hover hover:scale-105 press"
            >
              <PlayIcon width={22} height={22} />
            </button>
          )}
        </div>
        <div className="min-w-0 max-w-full">
          <p className="text-xs uppercase tracking-wide text-muted">Playlist</p>
          <h1 className="text-4xl font-extrabold mb-2 truncate">{mix.title}</h1>
          {mix.subtitle && <p className="text-muted">{mix.subtitle}</p>}
          <p className="text-sm text-muted mt-1">{tracks.length} Titel</p>
        </div>
      </header>

      {tracks.length === 0 ? (
        <p className="text-muted">Diese Playlist ist leer.</p>
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
    </div>
  );
}
