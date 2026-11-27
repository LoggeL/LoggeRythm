"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import { MusicNoteIcon, PlayIcon, SavePlaylistIcon, SparklesIcon, SpinnerIcon } from "@/components/icons";
import WrappedStoryModal from "@/components/wrapped/WrappedStoryModal";
import WrappedStudioModal from "@/components/wrapped/WrappedStudioModal";
import {
  CardsStackIcon,
  DEFAULT_WRAPPED_CARD_OPTIONS,
  ExternalPageIcon,
  useWrappedReport,
} from "@/components/wrapped/WrappedExperience";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import {
  INSIGHTS_RANGES,
  decodeUserStatsInsights,
  formatListeningHours,
} from "@/lib/statsInsights";
import type { WrappedCardOptions, WrappedCardTemplateId } from "@/lib/wrapped";
import { trackArtistLabel } from "@/lib/trackArtists";
import { usePlayerStore } from "@/store/player";
import { openSaveAsPlaylist } from "@/store/saveAsPlaylist";
import { toast } from "@/store/toast";
import type {
  StatEntry,
  StatsInsightsRange,
  TimestampedPlay,
  Track,
  UserStatsInsights,
} from "@/types";

const RECENT_PREVIEW = 6;
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const numberFormatter = new Intl.NumberFormat("de-DE");
const playLabel = (value: number) => (value === 1 ? "Wiedergabe" : "Wiedergaben");
const NUMERIC_ID_RE = /^\d+$/;

async function fetchStatsInsights(range: StatsInsightsRange): Promise<UserStatsInsights> {
  return decodeUserStatsInsights(await api.statsInsights(range));
}

function recentToTrack(entry: TimestampedPlay): Track {
  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    artist_id: entry.artist_id || undefined,
    artists: entry.artists.length > 0 ? entry.artists : undefined,
    album: entry.album,
    album_id: entry.album_id || undefined,
    cover: entry.cover,
    duration_sec: entry.duration_sec,
  };
}

function formatPlayedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMin = Math.round((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "Gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `vor ${diffHours} Std.`;
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-[var(--radius-card)] border border-hairline bg-panel/60 p-4">
      <dt className="label-mono truncate">{label}</dt>
      <dd className="font-display mt-2 text-2xl font-extrabold leading-none tracking-[-0.04em] tabular-nums sm:text-3xl">
        {value}
      </dd>
      {hint && <p className="mt-1.5 truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}

function ActivityHeatmaps({
  hourly,
  weekday,
}: {
  hourly: number[];
  weekday: number[];
}) {
  const maxHour = Math.max(1, ...hourly);
  const maxDay = Math.max(1, ...weekday);
  const peakHour = hourly.indexOf(Math.max(...hourly));
  const peakDay = weekday.indexOf(Math.max(...weekday));
  const hasData = hourly.some((n) => n > 0) || weekday.some((n) => n > 0);
  if (!hasData) return null;

  return (
    <section aria-label="Hörzeiten-Heatmaps" className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-[var(--radius-panel)] border border-hairline bg-panel/50 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="label-mono">Tageszeit (24 Std.)</h3>
          <span className="font-mono text-[11px] text-muted">
            Peak: {String(peakHour).padStart(2, "0")}:00 Uhr
          </span>
        </div>
        <div className="grid h-24 grid-cols-24 items-end gap-1" role="img" aria-label="Verteilung der Wiedergaben über 24 Stunden">
          {hourly.map((count, hour) => {
            const ratio = count / maxHour;
            const heightPct = count === 0 ? 6 : Math.max(14, Math.round(ratio * 100));
            return (
              <div
                key={hour}
                title={`${String(hour).padStart(2, "0")}:00 Uhr · ${count} ${playLabel(count)}`}
                style={{ height: `${heightPct}%` }}
                className={`rounded-t-sm transition-colors ${
                  count === 0
                    ? "bg-foreground/10"
                    : ratio > 0.65
                      ? "bg-accent"
                      : ratio > 0.3
                        ? "bg-accent/55"
                        : "bg-foreground/35"
                }`}
              />
            );
          })}
        </div>
        <div aria-hidden="true" className="mt-2 flex justify-between font-mono text-[10px] text-subtle">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-hairline bg-panel/50 p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="label-mono">Wochentage</h3>
          <span className="font-mono text-[11px] text-muted">
            Favorit: {WEEKDAYS[peakDay]}
          </span>
        </div>
        <div className="grid h-24 grid-cols-7 items-end gap-2" role="img" aria-label="Verteilung der Wiedergaben nach Wochentag">
          {weekday.map((count, idx) => {
            const ratio = count / maxDay;
            const heightPct = count === 0 ? 8 : Math.max(16, Math.round(ratio * 100));
            return (
              <div key={WEEKDAYS[idx]} className="flex h-full flex-col items-center justify-end gap-1.5">
                <div
                  title={`${WEEKDAYS[idx]} · ${count} ${playLabel(count)}`}
                  style={{ height: `${heightPct}%` }}
                  className={`w-full rounded-t-md transition-colors ${
                    count === 0
                      ? "bg-foreground/10"
                      : ratio > 0.7
                        ? "bg-accent"
                        : ratio > 0.35
                          ? "bg-accent/55"
                          : "bg-foreground/35"
                  }`}
                />
              </div>
            );
          })}
        </div>
        <div aria-hidden="true" className="mt-2 grid grid-cols-7 gap-2 text-center font-mono text-[10px] text-subtle">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function LinkedRanking({
  title,
  entries,
  hrefFor,
  roundCover = false,
}: {
  title: string;
  entries: StatEntry[];
  hrefFor: (entry: StatEntry) => string;
  roundCover?: boolean;
}) {
  const max = entries.length > 0 ? Math.max(...entries.map((entry) => entry.count)) : 0;
  return (
    <section className="min-w-0" aria-label={title}>
      <h3 className="label-mono border-b border-hairline pb-2.5">{title}</h3>
      {entries.length === 0 ? (
        <p className="py-4 text-sm leading-relaxed text-muted">In diesem Zeitraum sind noch keine Wiedergaben erfasst.</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <li key={`${entry.key}-${index}`} className="border-b border-hairline">
              <Link
                href={hrefFor(entry)}
                className="group flex min-h-14 min-w-0 items-center gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-foreground/[0.04]"
              >
                <span aria-hidden="true" className="w-6 shrink-0 font-mono text-xs tabular-nums text-subtle">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {entry.cover && (
                  <Cover
                    src={entry.cover}
                    className={`h-10 w-10 shrink-0 ${roundCover ? "rounded-full" : "rounded-art"}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-semibold group-hover:underline">{entry.label}</strong>
                  {entry.sublabel && <span className="mt-0.5 block truncate text-xs text-muted">{entry.sublabel}</span>}
                  <div aria-hidden="true" className="mt-2 h-0.5 overflow-hidden bg-foreground/[0.08]">
                    <span className="block h-full bg-foreground/55 transition-colors group-hover:bg-accent" style={{ width: `${(entry.count / max) * 100}%` }} />
                  </div>
                </div>
                <span className="min-w-10 shrink-0 text-right font-mono text-sm font-medium tabular-nums" aria-label={`${numberFormatter.format(entry.count)} ${playLabel(entry.count)}`}>
                  {numberFormatter.format(entry.count)}
                  <small aria-hidden="true" className="ml-0.5 text-[0.625rem] font-normal text-subtle">
                    ×
                  </small>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TrackRanking({
  title,
  entries,
  periodLabel,
  recentById,
}: {
  title: string;
  entries: StatEntry[];
  periodLabel: string;
  recentById: ReadonlyMap<string, TimestampedPlay>;
}) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const max = entries.length > 0 ? Math.max(...entries.map((entry) => entry.count)) : 0;

  async function resolveTracks(list: StatEntry[]): Promise<Track[]> {
    const results = await Promise.allSettled(
      list.map(async (entry) => {
        const cached = recentById.get(entry.key);
        if (cached) return recentToTrack(cached);
        if (!NUMERIC_ID_RE.test(entry.key)) {
          throw new Error(`keine gültige Titel-ID (${entry.key})`);
        }
        return await api.track(entry.key);
      }),
    );
    const resolved: Track[] = [];
    const failures: string[] = [];
    results.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        resolved.push(result.value);
      } else {
        const entry = list[idx];
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push(`„${entry.label}“ (${reason})`);
      }
    });
    if (failures.length > 0) {
      throw new Error(`${failures.length} Titel konnten nicht geladen werden: ${failures.join("; ")}`);
    }
    return resolved;
  }

  async function playFrom(startIndex: number, busyKey?: string) {
    if (loadingKey !== null || entries.length === 0) return;
    const key = busyKey ?? entries[startIndex].key;
    setLoadingKey(key);
    try {
      const tracks = await resolveTracks(entries);
      playQueue(tracks, Math.max(0, startIndex), `Top-Titel (${periodLabel})`);
    } catch (cause) {
      toast.error(`Top-Titel konnten nicht abgespielt werden: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setLoadingKey(null);
    }
  }

  async function saveTopTracks() {
    if (loadingKey !== null || entries.length === 0) return;
    setLoadingKey("save");
    try {
      const tracks = await resolveTracks(entries);
      openSaveAsPlaylist({
        defaultName: `Meine Top ${tracks.length} (${periodLabel})`,
        description: "Aus deinem LoggeRythm-Rückblick erstellt",
        tracks,
      });
    } catch (cause) {
      toast.error(`Top-Titel konnten nicht geladen werden: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setLoadingKey(null);
    }
  }

  return (
    <section className="min-w-0" aria-label={title}>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 border-b border-hairline pb-2">
        <h3 className="label-mono">{title}</h3>
        {entries.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={loadingKey !== null}
              onClick={() => void playFrom(0, "all")}
              className="action-secondary min-h-8 gap-1.5 px-2.5 text-xs"
            >
              {loadingKey === "all" ? <SpinnerIcon width={13} height={13} className="animate-spin" /> : <PlayIcon width={13} height={13} />}
              Top {entries.length} abspielen
            </button>
            <button
              type="button"
              disabled={loadingKey !== null}
              onClick={() => void saveTopTracks()}
              aria-label="Top-Titel als Playlist speichern"
              title="Als Playlist speichern"
              className="action-icon h-8 min-h-8 w-8 border border-border"
            >
              {loadingKey === "save" ? <SpinnerIcon width={14} height={14} className="animate-spin" /> : <SavePlaylistIcon width={14} height={14} />}
            </button>
          </div>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="py-4 text-sm leading-relaxed text-muted">In diesem Zeitraum sind noch keine Wiedergaben erfasst.</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((entry, index) => {
            const busy = loadingKey === entry.key;
            return (
              <li key={`${entry.key}-${index}`} className="border-b border-hairline">
                <button
                  type="button"
                  disabled={loadingKey !== null}
                  onClick={() => void playFrom(index)}
                  aria-label={`${entry.label} abspielen`}
                  className="group flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] disabled:opacity-60"
                >
                  <span aria-hidden="true" className="w-6 shrink-0 font-mono text-xs tabular-nums text-subtle">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="relative shrink-0">
                    <Cover src={entry.cover} className="h-10 w-10 rounded-art" />
                    <span className="absolute inset-0 grid place-items-center rounded-art bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      {busy ? <SpinnerIcon width={15} height={15} className="animate-spin text-white" /> : <PlayIcon width={15} height={15} className="text-white" />}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-semibold group-hover:underline">{entry.label}</strong>
                    {entry.sublabel && <span className="mt-0.5 block truncate text-xs text-muted">{entry.sublabel}</span>}
                    <div aria-hidden="true" className="mt-2 h-0.5 overflow-hidden bg-foreground/[0.08]">
                      <span className="block h-full bg-foreground/55 transition-colors group-hover:bg-accent" style={{ width: `${(entry.count / max) * 100}%` }} />
                    </div>
                  </div>
                  <span className="min-w-10 shrink-0 text-right font-mono text-sm font-medium tabular-nums" aria-label={`${numberFormatter.format(entry.count)} ${playLabel(entry.count)}`}>
                    {numberFormatter.format(entry.count)}
                    <small aria-hidden="true" className="ml-0.5 text-[0.625rem] font-normal text-subtle">
                      ×
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function RecentList({ tracks }: { tracks: TimestampedPlay[] }) {
  const playQueue = usePlayerStore((s) => s.playQueue);
  const [expanded, setExpanded] = useState(false);
  if (tracks.length === 0) return null;

  const shown = expanded ? tracks : tracks.slice(0, RECENT_PREVIEW);
  const hidden = tracks.length - shown.length;
  const playable = tracks.map(recentToTrack);

  return (
    <section aria-labelledby="recent-plays-heading" className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2.5">
        <h3 id="recent-plays-heading" className="label-mono">
          Zuletzt gehört
        </h3>
        <span className="label-mono tabular-nums">{tracks.length} Titel</span>
      </div>
      <ol className="flex flex-col">
        {shown.map((track, index) => (
          <li key={`${track.id}-${track.played_at}-${index}`} className="border-b border-hairline">
            <button
              type="button"
              onClick={() => playQueue(playable, index, "Zuletzt gehört")}
              aria-label={`${track.title} von ${trackArtistLabel(track)} abspielen`}
              className="group flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg px-1 py-2 text-left transition-colors hover:bg-foreground/[0.04]"
            >
              <span className="relative shrink-0">
                <Cover src={track.cover} className="h-10 w-10 rounded-art" />
                <span className="absolute inset-0 grid place-items-center rounded-art bg-black/55 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <PlayIcon width={15} height={15} className="text-white" />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium group-hover:underline">{track.title}</p>
                <p className="truncate text-xs text-muted">{trackArtistLabel(track)}</p>
              </div>
              {track.played_at && (
                <span className="hidden shrink-0 font-mono text-[11px] text-subtle sm:inline">
                  {formatPlayedAt(track.played_at)}
                </span>
              )}
              {track.duration_sec > 0 && (
                <span className="shrink-0 font-mono text-xs tabular-nums text-subtle">{formatTime(track.duration_sec)}</span>
              )}
            </button>
          </li>
        ))}
      </ol>
      {(hidden > 0 || expanded) && (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="action-secondary mt-3">
          {expanded ? "Weniger anzeigen" : `Alle ${tracks.length} anzeigen`}
        </button>
      )}
    </section>
  );
}

function StatsSkeleton() {
  return (
    <div role="status" aria-label="Hörprofil wird geladen" className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, idx) => (
          <div key={idx} className="skeleton h-24 rounded-[var(--radius-card)]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="skeleton h-36 rounded-[var(--radius-panel)]" />
        <div className="skeleton h-36 rounded-[var(--radius-panel)]" />
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, column) => (
          <div key={column} className="flex flex-col gap-3">
            <span className="skeleton block h-4 w-32 rounded" />
            {Array.from({ length: 5 }, (_, row) => (
              <span key={row} className="skeleton block h-14 rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Rich Listening Insights / Personal Wrapped view (`GET /api/me/stats/insights`).
 */
export default function ListeningStats() {
  const [range, setRange] = useState<StatsInsightsRange>("30d");
  const [storyOpen, setStoryOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [cardOptions, setCardOptions] = useState<WrappedCardOptions>(
    DEFAULT_WRAPPED_CARD_OPTIONS,
  );

  const { data, isLoading, isFetching, error, refetch } = useQuery<UserStatsInsights>({
    queryKey: ["stats-insights", range],
    queryFn: () => fetchStatsInsights(range),
    staleTime: 60_000,
  });

  const hasPlays = Boolean(data && data.play_count > 0);
  const wrappedQuery = useWrappedReport(range, hasPlays || storyOpen || studioOpen);

  const periodLabel = INSIGHTS_RANGES.find((r) => r.key === range)?.label ?? range;

  function openStudio(template: WrappedCardTemplateId = "summary") {
    setStoryOpen(false);
    setCardOptions((prev) => ({ ...prev, template }));
    setStudioOpen(true);
  }

  const heroCovers = (data?.top_tracks ?? [])
    .map((entry) => entry.cover)
    .filter((cover) => cover.length > 0)
    .slice(0, 3);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Zeitraum wählen" className="flex flex-wrap items-center gap-1.5">
          {INSIGHTS_RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={range === item.key}
              onClick={() => setRange(item.key)}
              className="filter-chip min-h-9 px-3.5 text-xs"
            >
              {item.label}
            </button>
          ))}
        </div>
        {hasPlays && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openStudio("summary")}
              className="action-secondary min-h-9 gap-2 px-3.5 text-xs"
            >
              <CardsStackIcon width={15} height={15} />
              Share-Cards
            </button>
            <Link
              href={`/wrapped?range=${encodeURIComponent(range)}`}
              className="action-secondary min-h-9 gap-1.5 px-3 text-xs"
            >
              <ExternalPageIcon width={14} height={14} />
              <span className="hidden sm:inline">/wrapped</span>
            </Link>
          </div>
        )}
      </div>

      {isLoading && !data ? (
        <StatsSkeleton />
      ) : error && !data ? (
        <div role="alert" className="error-panel flex flex-col items-start gap-3">
          <p className="font-semibold text-foreground">Dein Hörprofil konnte nicht geladen werden.</p>
          <p className="text-sm [overflow-wrap:anywhere]">{error instanceof Error ? error.message : String(error)}</p>
          <button type="button" onClick={() => void refetch()} disabled={isFetching} className="action-secondary min-h-9 px-4 text-xs">
            {isFetching ? "Wird geladen…" : "Erneut versuchen"}
          </button>
        </div>
      ) : !data || data.play_count === 0 ? (
        <EmptyState
          icon={<MusicNoteIcon />}
          title={`Noch keine Wiedergaben (${periodLabel})`}
          action={
            <Link href="/search" className="action-primary">
              Musik entdecken
            </Link>
          }
        >
          Spiel Musik ab, dann füllt sich dein Rückblick.
        </EmptyState>
      ) : (
        <>
          {error && (
            <div role="alert" className="error-panel flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 [overflow-wrap:anywhere]">Aktualisierung fehlgeschlagen: {error instanceof Error ? error.message : String(error)}</p>
              <button type="button" onClick={() => void refetch()} disabled={isFetching} className="action-secondary min-h-9 px-4 text-xs">
                Erneut versuchen
              </button>
            </div>
          )}

          <section
            aria-label="LoggeRythm Wrapped"
            className="relative overflow-hidden rounded-[var(--radius-panel)] border border-accent/30 bg-panel/90 p-5 shadow-[0_20px_60px_rgb(0_0_0/0.4)] sm:p-6"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "radial-gradient(36rem 18rem at 0% 0%, rgba(214, 255, 75, 0.2), transparent 70%), radial-gradient(28rem 18rem at 100% 100%, rgba(124, 92, 255, 0.16), transparent 70%)",
              }}
            />

            <div className="relative z-10 flex flex-col justify-between gap-6 md:flex-row md:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="page-eyebrow mb-0 text-accent">
                    LoggeRythm Wrapped · {periodLabel}
                  </span>
                  {wrappedQuery.data?.persona && (
                    <span className="rounded-full border border-accent/35 bg-accent/12 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-accent">
                      {wrappedQuery.data.persona.title}
                    </span>
                  )}
                </div>

                <h2 className="font-display mt-2.5 text-2xl font-extrabold leading-tight tracking-[-0.035em] sm:text-3xl">
                  Dein {periodLabel}-Rückblick als Story &amp; Share-Cards
                </h2>

                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                  {wrappedQuery.data?.persona?.tagline
                    ? `${wrappedQuery.data.persona.tagline} · `
                    : ""}
                  {formatListeningHours(data.listening_sec)} gehört in{" "}
                  {numberFormatter.format(data.play_count)} {playLabel(data.play_count)}
                  {data.top_artists[0] ? ` · #1 ${data.top_artists[0].label}` : ""}.
                </p>

                {wrappedQuery.isError && (
                  <div role="alert" className="error-panel mt-3 flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      Wrapped-Daten konnten nicht geladen werden: {wrappedQuery.error.message}
                    </span>
                    <button
                      type="button"
                      onClick={() => void wrappedQuery.refetch()}
                      disabled={wrappedQuery.isFetching}
                      className="action-secondary min-h-8 px-3 text-xs"
                    >
                      Erneut versuchen
                    </button>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setStoryOpen(true)}
                    className="action-primary min-h-10 gap-2 bg-accent px-4 text-sm text-on-accent hover:bg-accent-hover"
                  >
                    <SparklesIcon width={16} height={16} />
                    Wrapped Story starten
                  </button>
                  <button
                    type="button"
                    onClick={() => openStudio("summary")}
                    className="action-secondary min-h-10 gap-2 px-4 text-sm"
                  >
                    <CardsStackIcon width={16} height={16} />
                    Share-Cards gestalten
                  </button>
                  <Link
                    href={`/wrapped?range=${encodeURIComponent(range)}`}
                    className="section-link ml-1 py-2"
                  >
                    Studio öffnen
                  </Link>
                </div>
              </div>

              {heroCovers.length > 0 && (
                <div aria-hidden="true" className="hidden shrink-0 items-center pr-2 sm:flex">
                  {heroCovers.map((cover, idx) => (
                    <Cover
                      key={`${cover}-${idx}`}
                      src={cover}
                      className={`h-20 w-20 rounded-[var(--radius-card)] shadow-[0_14px_30px_rgb(0_0_0/0.6)] ring-1 ring-white/15 ${
                        idx === 0
                          ? "z-30 -rotate-6"
                          : idx === 1
                            ? "z-20 -ml-7 translate-y-1 rotate-3"
                            : "z-10 -ml-7 -translate-y-1 rotate-12 opacity-85"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <dl aria-label="Hörprofil-Kennzahlen" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Hörzeit" value={formatListeningHours(data.listening_sec)} hint={`${numberFormatter.format(data.play_count)} ${playLabel(data.play_count)}`} />
            <Kpi label="Verschiedene Titel" value={numberFormatter.format(data.unique_tracks)} />
            <Kpi
              label="Künstler"
              value={numberFormatter.format(data.unique_artists)}
              hint={data.new_artists_count > 0 ? `+${numberFormatter.format(data.new_artists_count)} neu entdeckt` : undefined}
            />
            <Kpi
              label="Aktuelle Serie"
              value={`${data.current_streak_days} ${data.current_streak_days === 1 ? "Tag" : "Tage"}`}
            />
            <Kpi
              label="Längste Serie"
              value={`${data.longest_streak_days} ${data.longest_streak_days === 1 ? "Tag" : "Tage"}`}
            />
          </dl>

          <ActivityHeatmaps hourly={data.hourly_distribution} weekday={data.weekday_distribution} />

          {(() => {
            const recentById = new Map<string, TimestampedPlay>();
            for (const item of data.recent_plays) {
              if (!recentById.has(item.id)) recentById.set(item.id, item);
            }
            return (
              <div className="grid gap-10 lg:grid-cols-2">
                <TrackRanking title="Meistgehörte Titel" entries={data.top_tracks} periodLabel={periodLabel} recentById={recentById} />
                <LinkedRanking
                  title="Meistgehörte Künstler"
                  entries={data.top_artists}
                  roundCover
                  hrefFor={(entry) =>
                    NUMERIC_ID_RE.test(entry.key)
                      ? `/artist/${encodeURIComponent(entry.key)}`
                      : `/search?q=${encodeURIComponent(entry.label)}`
                  }
                />
              </div>
            );
          })()}

          {data.top_albums.length > 0 && (
            <LinkedRanking
              title="Meistgehörte Alben"
              entries={data.top_albums}
              hrefFor={(entry) =>
                NUMERIC_ID_RE.test(entry.key)
                  ? `/album/${encodeURIComponent(entry.key)}`
                  : `/search?q=${encodeURIComponent(entry.label)}`
              }
            />
          )}

          <RecentList tracks={data.recent_plays} />
        </>
      )}

      <WrappedStoryModal
        open={storyOpen}
        onClose={() => setStoryOpen(false)}
        report={wrappedQuery.data}
        isLoading={wrappedQuery.isLoading}
        error={wrappedQuery.error}
        onRetry={() => void wrappedQuery.refetch()}
        onShareTemplate={(tpl) => openStudio(tpl)}
      />

      <WrappedStudioModal
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        report={wrappedQuery.data}
        isLoading={wrappedQuery.isLoading}
        isFetching={wrappedQuery.isFetching}
        error={wrappedQuery.error}
        onRetry={() => void wrappedQuery.refetch()}
        range={range}
        onRangeChange={setRange}
        options={cardOptions}
        onOptionsChange={setCardOptions}
        onOpenStory={() => {
          setStudioOpen(false);
          setStoryOpen(true);
        }}
      />
    </div>
  );
}
