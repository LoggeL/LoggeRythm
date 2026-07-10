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
      <p className="text-red-400">
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
    <div>
      {isError && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200"
        >
          Albumdaten konnten nicht aktualisiert werden. Der zuletzt geladene
          Stand bleibt sichtbar. {error.message}
        </div>
      )}
      <header className="flex items-end gap-6 mb-6">
        {data.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.cover}
            alt={data.title}
            className="w-40 h-40 rounded-md object-cover shadow-xl"
          />
        ) : (
          <CoverPlaceholder className="w-40 h-40 rounded-md" />
        )}
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Album</p>
          <h1 className="text-4xl font-extrabold mb-2">{data.title}</h1>
          <p className="text-muted">
            {data.artist_id ? (
              <Link
                href={`/artist/${data.artist_id}`}
                className="font-semibold text-foreground hover:underline"
              >
                {data.artist}
              </Link>
            ) : (
              <span className="font-semibold text-foreground">{data.artist}</span>
            )}
          </p>
          <p className="text-sm text-muted mt-1">{meta}</p>
        </div>
      </header>

      <div className="mb-4">
        <button
          type="button"
          onClick={() => playQueue(tracks, 0, data.title)}
          disabled={tracks.length === 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-white font-semibold hover:bg-accent-hover disabled:opacity-40"
        >
          <PlayIcon /> Alle abspielen
        </button>
      </div>

      <div className="flex flex-col">
        {tracks.map((track, i) => (
          <TrackRow
            key={track.id}
            track={track}
            index={i}
            showAlbum={false}
            onPlay={() => playQueue(tracks, i, data.title)}
          />
        ))}
      </div>
    </div>
  );
}
