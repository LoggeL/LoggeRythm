"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { DetailHeaderSkeleton, RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon } from "@/components/icons";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import CollectionTracks from "@/app/playlist/_components/CollectionTracks";
import type { Album } from "@/types";

function totalRuntime(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60);
  return `${h} Std. ${m % 60} Min.`;
}

export default function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError, error } = useQuery<Album>({
    queryKey: ["album", id],
    queryFn: () => api.album(id),
    enabled: !!id,
  });
  const playQueue = usePlayerStore((s) => s.playQueue);

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
          ? `Album konnte nicht geladen werden: ${error.message}`
          : "Album nicht gefunden."}
      </p>
    );
  }

  const tracks = data.tracks ?? [];
  const year = data.release_date ? data.release_date.slice(0, 4) : "";
  const runtime = tracks.reduce((s, t) => s + (t.duration_sec || 0), 0);
  const meta = [
    year,
    `${tracks.length} Titel`,
    runtime > 0 ? totalRuntime(runtime) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="animate-in">
      {isError && (
        <div role="alert" className="error-panel mb-4">
          Albumdaten konnten nicht aktualisiert werden. Der zuletzt geladene
          Stand bleibt sichtbar. {error.message}
        </div>
      )}
      <CollectionHero
        eyebrow="Album"
        title={data.title}
        artwork={
          data.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.cover}
              alt={data.title}
              className="h-full w-full rounded-2xl object-cover"
            />
          ) : (
            <CoverPlaceholder className="h-full w-full rounded-2xl" />
          )
        }
        description={
          data.artist_id ? (
            <Link
              href={`/artist/${data.artist_id}`}
              className="font-semibold text-foreground hover:underline"
            >
              {data.artist}
            </Link>
          ) : (
            <span className="font-semibold text-foreground">{data.artist}</span>
          )
        }
        metadata={meta}
        actions={
          <button
            type="button"
            onClick={() => playQueue(tracks, 0, data.title)}
            disabled={tracks.length === 0}
            className="action-primary"
          >
            <PlayIcon /> Alle abspielen
          </button>
        }
      />
      <CollectionTracks count={tracks.length}>
        {tracks.length === 0 && (
          <p className="empty-panel">Dieses Album enthält keine Titel.</p>
        )}
        {tracks.map((track, i) => (
          <TrackRow
            key={track.id}
            track={track}
            index={i}
            showAlbum={false}
            onPlay={() => playQueue(tracks, i, data.title)}
          />
        ))}
      </CollectionTracks>
    </div>
  );
}
