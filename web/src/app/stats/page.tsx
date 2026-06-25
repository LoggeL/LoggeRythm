"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import { RowListSkeleton } from "@/components/Skeleton";

export default function StatsPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const playQueue = usePlayerStore((s) => s.playQueue);

  const { data: stats, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats,
    enabled: !!me,
  });

  if (meLoading) return <RowListSkeleton />;

  if (!me) {
    return (
      <div>
        <h1 className="text-3xl font-extrabold mb-3">Deine Statistiken</h1>
        <p className="text-muted mb-4">
          Melde dich an, um deine Hörstatistiken zu sehen.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 rounded-full bg-accent text-white hover:bg-accent-hover"
        >
          Anmelden
        </Link>
      </div>
    );
  }

  if (isLoading) return <RowListSkeleton />;

  const recent = stats?.recent ?? [];

  return (
    <div className="animate-in space-y-10">
      <h1 className="text-3xl font-extrabold">Deine Statistiken</h1>

      <section className="rounded-lg bg-panel p-6">
        <div className="text-5xl font-extrabold tabular-nums text-accent">
          {stats?.total_plays ?? 0}
        </div>
        <div className="text-muted mt-1">Wiedergaben insgesamt</div>
      </section>

      {(stats?.top_tracks?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Top-Titel</h2>
          <ol className="space-y-1">
            {stats!.top_tracks.map((t, i) => (
              <li
                key={t.key}
                className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-panel-hover transition"
              >
                <span className="w-6 text-right text-muted tabular-nums">
                  {i + 1}
                </span>
                {t.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.cover}
                    alt=""
                    width={40}
                    height={40}
                    className="w-10 h-10 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded bg-panel-hover flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{t.label}</div>
                  {t.sublabel && (
                    <div className="truncate text-sm text-muted">
                      {t.sublabel}
                    </div>
                  )}
                </div>
                <span className="text-sm text-muted tabular-nums flex-shrink-0">
                  {t.count}×
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(stats?.top_artists?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Top-Künstler</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {stats!.top_artists.map((a) => (
              <div
                key={a.key}
                className="rounded-lg bg-panel p-4 hover-lift"
              >
                <div className="truncate font-medium">{a.label}</div>
                <div className="text-sm text-muted tabular-nums mt-1">
                  {a.count} Wiedergaben
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4">Zuletzt gehört</h2>
          <div>
            {recent.map((track, i) => (
              <TrackRow
                key={`${track.id}-${i}`}
                track={track}
                index={i}
                onPlay={() => playQueue(recent, i)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
