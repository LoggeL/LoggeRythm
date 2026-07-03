"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { StatEntry, UserStats } from "@/types";

// The backend /me/stats response also carries an additive last-30-days view.
// types.ts is off-limits, so extend it locally and read the extra fields
// defensively — but never mask a real error.
interface UserStatsWithMonth extends UserStats {
  total_plays_month?: number;
  top_tracks_month?: StatEntry[];
  top_artists_month?: StatEntry[];
}

function TopTrackList({ tracks }: { tracks: StatEntry[] }) {
  return (
    <ol className="space-y-1">
      {tracks.map((t, i) => (
        <li
          key={t.key}
          className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-panel-hover transition"
        >
          <span className="w-6 text-right text-muted tabular-nums">{i + 1}</span>
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
              <div className="truncate text-sm text-muted">{t.sublabel}</div>
            )}
          </div>
          <span className="text-sm text-muted tabular-nums flex-shrink-0">
            {t.count}×
          </span>
        </li>
      ))}
    </ol>
  );
}

function TopArtistGrid({ artists }: { artists: StatEntry[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {artists.map((a) => (
        <div key={a.key} className="rounded-lg bg-background p-4 hover-lift">
          <div className="truncate font-medium">{a.label}</div>
          <div className="text-sm text-muted tabular-nums mt-1">
            {a.count} Wiedergaben
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ListeningStats() {
  const { data, isLoading, error } = useQuery<UserStatsWithMonth>({
    queryKey: ["stats"],
    queryFn: api.stats,
  });

  return (
    <section className="bg-panel rounded-lg p-6">
      <h2 className="text-xl font-bold mb-4">Deine Statistiken</h2>

      {isLoading && <p className="text-muted">Lädt…</p>}
      {error && (
        <p className="text-red-400 text-sm">
          {error instanceof Error
            ? error.message
            : "Statistiken konnten nicht geladen werden."}
        </p>
      )}

      {data && (
        <div className="flex flex-col gap-8">
          <div className="rounded-lg bg-background px-5 py-4">
            <div className="text-4xl font-extrabold tabular-nums text-accent">
              {data.total_plays}
            </div>
            <div className="text-muted mt-1">Wiedergaben insgesamt</div>
          </div>

          {data.top_artists.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Top-Künstler</h3>
              <TopArtistGrid artists={data.top_artists} />
            </div>
          )}

          {data.top_tracks.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Top-Titel</h3>
              <TopTrackList tracks={data.top_tracks} />
            </div>
          )}

          {(data.total_plays_month ?? 0) > 0 && (
            <div className="border-t border-white/10 pt-6">
              <div className="flex items-baseline gap-3 mb-4">
                <h3 className="text-lg font-semibold">Diesen Monat</h3>
                <span className="text-sm text-muted tabular-nums">
                  {data.total_plays_month} Wiedergaben
                </span>
              </div>

              {(data.top_artists_month?.length ?? 0) > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-muted mb-3">
                    Top-Künstler
                  </h4>
                  <TopArtistGrid artists={data.top_artists_month!} />
                </div>
              )}

              {(data.top_tracks_month?.length ?? 0) > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-muted mb-3">
                    Top-Titel
                  </h4>
                  <TopTrackList tracks={data.top_tracks_month!} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
