"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import { MusicNoteIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { decodeListeningStats } from "@/lib/listeningStats";
import { trackArtistLabel } from "@/lib/trackArtists";
import type { RecentPlay, StatEntry, UserStats } from "@/types";

const RECENT_PREVIEW = 5;
const numberFormatter = new Intl.NumberFormat("de-DE");
const playLabel = (value: number) => (value === 1 ? "Wiedergabe" : "Wiedergaben");

async function fetchListeningStats(): Promise<UserStats> {
  return decodeListeningStats(await api.stats());
}

function Ranking({ title, entries, artwork }: { title: string; entries: StatEntry[]; artwork?: boolean }) {
  const max = entries.length > 0 ? Math.max(...entries.map((entry) => entry.count)) : 0;
  return (
    <section className="min-w-0" aria-label={title}>
      <h3 className="label-mono border-b border-hairline pb-2.5">{title}</h3>
      {entries.length === 0 ? (
        <p className="py-4 text-sm leading-relaxed text-muted">In diesem Zeitraum sind noch keine Wiedergaben erfasst.</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <li key={`${entry.key}-${index}`} className="flex min-h-14 min-w-0 items-center gap-3 border-b border-hairline py-2.5">
              <span aria-hidden="true" className="w-6 shrink-0 font-mono text-xs tabular-nums text-subtle">
                {String(index + 1).padStart(2, "0")}
              </span>
              {artwork && <Cover src={entry.cover} className="h-10 w-10 rounded-art" />}
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold">{entry.label}</strong>
                {entry.sublabel && <span className="mt-0.5 block truncate text-xs text-muted">{entry.sublabel}</span>}
                <div aria-hidden="true" className="mt-2 h-0.5 overflow-hidden bg-foreground/[0.08]">
                  <span className="block h-full bg-foreground/55" style={{ width: `${(entry.count / max) * 100}%` }} />
                </div>
              </div>
              <span className="min-w-10 shrink-0 text-right font-mono text-sm font-medium tabular-nums" aria-label={`${numberFormatter.format(entry.count)} ${playLabel(entry.count)}`}>
                {numberFormatter.format(entry.count)}
                <small aria-hidden="true" className="ml-0.5 text-[0.625rem] font-normal text-subtle">
                  ×
                </small>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RecentList({ tracks }: { tracks: RecentPlay[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tracks : tracks.slice(0, RECENT_PREVIEW);
  return (
    <section className="min-w-0" aria-labelledby="recent-listening-title">
      <div className="flex min-h-11 flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-hairline pb-1">
        <h3 id="recent-listening-title" className="label-mono pb-1.5">
          Zuletzt gehört
        </h3>
        {tracks.length > RECENT_PREVIEW && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="recent-listening-list"
            onClick={() => setExpanded((value) => !value)}
            className="label-mono inline-flex min-h-11 items-center text-foreground underline-offset-4 hover:underline"
          >
            {expanded ? "Weniger anzeigen" : `Alle ${tracks.length} anzeigen`}
          </button>
        )}
      </div>
      {tracks.length === 0 ? (
        <p className="py-4 text-sm leading-relaxed text-muted">Noch keine Titel im Verlauf.</p>
      ) : (
        <ol id="recent-listening-list" className="grid gap-x-10 md:grid-cols-2">
          {visible.map((track, index) => (
            <li key={`${track.id}-${index}`} className="flex min-h-14 min-w-0 items-center gap-3 border-b border-hairline py-2">
              <Cover src={track.cover} className="h-10 w-10 rounded-art" />
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold">{track.title}</strong>
                <span className="mt-0.5 block truncate text-xs text-muted">{trackArtistLabel(track)}</span>
              </div>
              {track.duration_sec > 0 && <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{formatTime(track.duration_sec)}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StatsSkeleton() {
  return (
    <div role="status" aria-label="Hörprofil wird geladen" className="flex flex-col gap-8">
      <span className="skeleton block h-16 w-56 max-w-full rounded-lg" />
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        <span className="skeleton block h-72 rounded-[var(--radius-card)]" />
        <span className="skeleton block h-72 rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}

export default function ListeningStats() {
  const [period, setPeriod] = useState<"all" | "month">("all");
  const { data, isLoading, isFetching, error, refetch } = useQuery<UserStats>({
    queryKey: ["stats"],
    queryFn: fetchListeningStats,
    // Validate shared cached data as well as this observer's network response.
    select: decodeListeningStats,
  });
  const month = period === "month";

  return (
    <section className="flex min-w-0 flex-col gap-7" aria-labelledby="listening-stats-title" aria-busy={isFetching}>
      <header className="section-heading mb-0 flex-wrap">
        <div className="min-w-0">
          <h2 id="listening-stats-title">Dein Hörprofil</h2>
          <p className="mt-1 text-sm text-muted">Deine meistgehörten Künstler und Titel.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Zeitraum der Hörstatistik">
          <button type="button" aria-pressed={!month} onClick={() => setPeriod("all")} className="filter-chip max-sm:min-h-11">
            Gesamter Zeitraum
          </button>
          <button type="button" aria-pressed={month} onClick={() => setPeriod("month")} className="filter-chip max-sm:min-h-11">
            Letzte 30 Tage
          </button>
        </div>
      </header>

      {isLoading && <StatsSkeleton />}
      {error && (
        <div className="error-panel flex flex-wrap items-center justify-between gap-3" role="alert">
          <p className="min-w-0 [overflow-wrap:anywhere]">Hörstatistik konnte nicht geladen werden: {error.message}</p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className="action-secondary min-h-9 px-4 text-xs">
            {isFetching ? "Wird geladen…" : "Erneut versuchen"}
          </button>
        </div>
      )}
      {data && data.total_plays === 0 && (
        <EmptyState
          icon={<MusicNoteIcon />}
          title="Noch keine Wiedergaben"
          action={
            <Link href="/search" className="action-primary">
              Musik entdecken
            </Link>
          }
        >
          Sobald du Musik hörst, erscheinen hier dein Verlauf und deine Favoriten.
        </EmptyState>
      )}
      {data && data.total_plays > 0 && (
        <>
          <p className="flex flex-wrap items-end gap-x-8 gap-y-4" aria-live="polite">
            <span className="flex min-w-0 flex-col gap-2">
              <strong className="font-display text-[clamp(3rem,11vw,5.5rem)] font-extrabold leading-[0.9] tracking-[-0.05em] tabular-nums text-foreground">
                {numberFormatter.format(month ? data.total_plays_month : data.total_plays)}
              </strong>
              <span className="label-mono">
                {playLabel(month ? data.total_plays_month : data.total_plays)} {month ? "in den letzten 30 Tagen" : "insgesamt"}
              </span>
            </span>
            {month && (
              <span className="flex flex-col gap-2 border-l border-hairline pl-8">
                <span className="font-display text-3xl font-extrabold leading-none tracking-[-0.04em] tabular-nums text-foreground">
                  {Math.round((data.total_plays_month / data.total_plays) * 100)} %
                </span>
                <span className="label-mono">aller Wiedergaben</span>
              </span>
            )}
          </p>
          <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
            <Ranking title="Top-Künstler" entries={month ? data.top_artists_month : data.top_artists} />
            <Ranking title="Top-Titel" entries={month ? data.top_tracks_month : data.top_tracks} artwork />
          </div>
          <RecentList tracks={data.recent} />
        </>
      )}
    </section>
  );
}
