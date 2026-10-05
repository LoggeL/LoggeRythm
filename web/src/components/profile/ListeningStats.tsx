"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { api } from "@/lib/api";
import { decodeListeningStats } from "@/lib/listeningStats";
import { trackArtistLabel } from "@/lib/trackArtists";
import type { RecentPlay, StatEntry, UserStats } from "@/types";
import styles from "./ListeningStats.module.css";

const numberFormatter = new Intl.NumberFormat("de-DE");
const playLabel = (value: number) => value === 1 ? "Wiedergabe" : "Wiedergaben";

async function fetchListeningStats(): Promise<UserStats> {
  return decodeListeningStats(await api.stats());
}

function Artwork({ cover }: { cover?: string }) {
  if (!cover) return <CoverPlaceholder className={styles.artwork} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cover} alt="" width={40} height={40} loading="lazy" decoding="async" className={styles.artwork} />
  );
}

function Ranking({ title, entries, artwork }: { title: string; entries: StatEntry[]; artwork?: boolean }) {
  const max = entries.length > 0 ? Math.max(...entries.map((entry) => entry.count)) : 0;
  return (
    <section className={styles.card} aria-label={title}>
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className={styles.empty}>In diesem Zeitraum sind noch keine Wiedergaben erfasst.</p>
      ) : (
        <ol className={styles.ranking}>
          {entries.map((entry, index) => (
            <li key={`${entry.key}-${index}`}>
              <span className={styles.rank} aria-hidden="true">{index + 1}</span>
              {artwork && <Artwork cover={entry.cover} />}
              <div className={styles.entryCopy}>
                <strong>{entry.label}</strong>
                {entry.sublabel && <span>{entry.sublabel}</span>}
                <div className={styles.rail} aria-hidden="true" style={{ "--strength": `${(entry.count / max) * 100}%` } as CSSProperties}><span /></div>
              </div>
              <span className={styles.count} aria-label={`${numberFormatter.format(entry.count)} ${playLabel(entry.count)}`}>
                {numberFormatter.format(entry.count)}<small>mal</small>
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
  const visible = expanded ? tracks : tracks.slice(0, 5);
  return (
    <section className={styles.card} aria-labelledby="recent-listening-title">
      <div className={styles.cardHeader}>
        <h3 id="recent-listening-title">Zuletzt gehört</h3>
        {tracks.length > 5 && (
          <button type="button" aria-expanded={expanded} aria-controls="recent-listening-list" onClick={() => setExpanded((value) => !value)} className="action-secondary">
            {expanded ? "Weniger anzeigen" : `Alle ${tracks.length} anzeigen`}
          </button>
        )}
      </div>
      <ol id="recent-listening-list" className={styles.recentList}>
        {visible.map((track, index) => (
          <li key={`${track.id}-${index}`}>
            <Artwork cover={track.cover} />
            <div className={styles.entryCopy}><strong>{track.title}</strong><span>{trackArtistLabel(track)}</span></div>
          </li>
        ))}
      </ol>
    </section>
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
  const total = data && (period === "month" ? data.total_plays_month : data.total_plays);

  return (
    <section className={styles.root} aria-labelledby="listening-stats-title" aria-busy={isFetching}>
      <header className={styles.header}>
        <div><h2 id="listening-stats-title">Dein Hörprofil</h2><p>Deine meistgehörten Künstler und Titel.</p></div>
        <div className={styles.filters} role="group" aria-label="Zeitraum der Hörstatistik">
          <button type="button" aria-pressed={period === "all"} data-active={period === "all"} onClick={() => setPeriod("all")} className="filter-chip">Gesamter Zeitraum</button>
          <button type="button" aria-pressed={period === "month"} data-active={period === "month"} onClick={() => setPeriod("month")} className="filter-chip">Letzte 30 Tage</button>
        </div>
      </header>

      {isLoading && <div className="empty-panel" role="status">Hörprofil wird geladen…</div>}
      {error && (
        <div className="error-panel" role="alert">
          <p>Hörstatistik konnte nicht geladen werden: {error.message}</p>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className="action-secondary">Erneut versuchen</button>
        </div>
      )}
      {data && data.total_plays === 0 && (
        <div className="empty-panel"><h3>Noch keine Wiedergaben</h3><p>Wenn du Musik hörst, erscheinen hier dein Verlauf und deine Favoriten.</p></div>
      )}
      {data && data.total_plays > 0 && (
        <>
          <div className={styles.periodSummary} aria-live="polite">
            <strong>{numberFormatter.format(total!)}</strong><span>{playLabel(total!)} {period === "month" ? "in den letzten 30 Tagen" : "insgesamt"}</span>
            {period === "month" && <small>{Math.round((data.total_plays_month / data.total_plays) * 100)} % aller Wiedergaben</small>}
          </div>
          <div className={styles.rankings}>
            <Ranking title="Top-Künstler" entries={period === "month" ? data.top_artists_month : data.top_artists} />
            <Ranking title="Top-Titel" entries={period === "month" ? data.top_tracks_month : data.top_tracks} artwork />
          </div>
          <RecentList tracks={data.recent} />
        </>
      )}
    </section>
  );
}
