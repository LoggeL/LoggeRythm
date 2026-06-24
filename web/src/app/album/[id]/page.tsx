"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
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
  const { data, isLoading, isError } = useQuery<Album>({
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
  if (isError || !data)
    return <p className="text-red-400">Album nicht gefunden.</p>;

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
      <header className="relative flex items-end gap-6 mb-6 isolate">
        {data.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.cover}
            alt=""
            aria-hidden
            className="pointer-events-none absolute -z-10 -top-10 left-0 w-72 h-72 object-cover opacity-40 blur-[60px] saturate-150 rounded-full"
          />
        )}
        {data.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.cover}
            alt={data.title}
            className="w-44 h-44 md:w-48 md:h-48 rounded-xl object-cover ring-1 ring-[var(--border-strong)] shadow-[0_0_40px_rgba(255,43,214,.25)]"
          />
        ) : (
          <div className="w-44 h-44 md:w-48 md:h-48 rounded-xl bg-panel-hover" />
        )}
        <div>
          <p className="label-mono">Album</p>
          <h1 className="text-5xl md:text-6xl font-black tracking-tight neon-text mb-2">
            {data.title}
          </h1>
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
          onClick={() => playQueue(tracks, 0)}
          disabled={tracks.length === 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full play-ring text-white font-semibold disabled:opacity-40"
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
            onPlay={() => playQueue(tracks, i)}
          />
        ))}
      </div>
    </div>
  );
}
