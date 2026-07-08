"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import type { StatEntry, UserStats } from "@/types";

// The backend /me/stats response also carries an additive last-30-days view.
// types.ts is off-limits, so extend it locally and read the extra fields
// defensively — but never mask a real error.
export interface UserStatsWithMonth extends UserStats {
  total_plays_month?: number;
  top_tracks_month?: StatEntry[];
  top_artists_month?: StatEntry[];
}

// Rotating card gradients so the artist ranking reads like a mixtape shelf,
// not a spreadsheet. Same utilities the collection cards use.
const ARTIST_GRADIENTS = [
  "gradient-violet",
  "gradient-teal",
  "gradient-orange",
  "gradient-blue",
  "gradient-red",
];

function StatTile({
  value,
  label,
  highlight,
}: {
  value: number;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-panel p-5">
      <div
        className={`text-4xl font-extrabold tabular-nums tracking-tight ${
          highlight
            ? "gradient-pink bg-clip-text text-transparent"
            : "text-foreground"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-sm text-muted">{label}</div>
    </div>
  );
}

function TopTrackList({ tracks }: { tracks: StatEntry[] }) {
  const max = Math.max(...tracks.map((t) => t.count), 1);
  return (
    <ol className="flex flex-col gap-1">
      {tracks.map((t, i) => (
        <li
          key={t.key}
          className="relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2 transition hover:bg-panel-hover"
        >
          {/* Play-count bar behind the row — the list doubles as a chart. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-lg bg-accent/10"
            style={{ width: `${(t.count / max) * 100}%` }}
          />
          <span
            className={`relative w-6 text-right font-semibold tabular-nums ${
              i < 3 ? "text-accent-soft" : "text-muted"
            }`}
          >
            {i + 1}
          </span>
          {t.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={t.cover}
              alt=""
              width={40}
              height={40}
              className="relative h-10 w-10 flex-shrink-0 rounded object-cover"
            />
          ) : (
            <CoverPlaceholder className="relative h-10 w-10 flex-shrink-0 rounded" />
          )}
          <div className="relative min-w-0 flex-1">
            <div className="truncate font-medium">{t.label}</div>
            {t.sublabel && (
              <div className="truncate text-sm text-muted">{t.sublabel}</div>
            )}
          </div>
          <span className="relative flex-shrink-0 text-sm text-muted tabular-nums">
            {t.count}×
          </span>
        </li>
      ))}
    </ol>
  );
}

function TopArtistGrid({ artists }: { artists: StatEntry[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {artists.map((a, i) => (
        <div
          key={a.key}
          className={`relative overflow-hidden rounded-xl p-4 hover-lift ${
            ARTIST_GRADIENTS[i % ARTIST_GRADIENTS.length]
          }`}
        >
          <span
            aria-hidden
            className="absolute -top-3 right-1 select-none text-6xl font-extrabold text-white/15"
          >
            {i + 1}
          </span>
          <div className="relative truncate font-semibold text-white">
            {a.label}
          </div>
          <div className="relative mt-7 text-sm text-white/75 tabular-nums">
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
    <section className="flex flex-col gap-8">
      {isLoading && <p className="text-muted">Lädt…</p>}
      {error && (
        <p className="text-red-400 text-sm">
          {error instanceof Error
            ? error.message
            : "Statistiken konnten nicht geladen werden."}
        </p>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              value={data.total_plays}
              label="Wiedergaben insgesamt"
              highlight
            />
            <StatTile
              value={data.total_plays_month ?? 0}
              label="Wiedergaben in den letzten 30 Tagen"
            />
          </div>

          {data.top_artists.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-semibold">Top-Künstler</h3>
              <TopArtistGrid artists={data.top_artists} />
            </div>
          )}

          {data.top_tracks.length > 0 && (
            <div className="rounded-2xl border border-white/5 bg-panel p-4 sm:p-5">
              <h3 className="mb-3 px-3 text-lg font-semibold">Top-Titel</h3>
              <TopTrackList tracks={data.top_tracks} />
            </div>
          )}

          {(data.total_plays_month ?? 0) > 0 && (
            <div className="border-t border-white/10 pt-6">
              <div className="mb-4 flex items-baseline gap-3">
                <h3 className="text-lg font-semibold">Diesen Monat</h3>
                <span className="text-sm text-muted tabular-nums">
                  {data.total_plays_month} Wiedergaben
                </span>
              </div>

              {(data.top_artists_month?.length ?? 0) > 0 && (
                <div className="mb-6">
                  <h4 className="mb-3 text-sm font-semibold text-muted">
                    Top-Künstler
                  </h4>
                  <TopArtistGrid artists={data.top_artists_month!} />
                </div>
              )}

              {(data.top_tracks_month?.length ?? 0) > 0 && (
                <div className="rounded-2xl border border-white/5 bg-panel p-4 sm:p-5">
                  <h4 className="mb-3 px-3 text-sm font-semibold text-muted">
                    Top-Titel
                  </h4>
                  <TopTrackList tracks={data.top_tracks_month!} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
