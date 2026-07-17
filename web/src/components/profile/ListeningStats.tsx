"use client";

import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import { api } from "@/lib/api";
import { decodeListeningStats } from "@/lib/listeningStats";
import type { RecentPlay, StatEntry, UserStats } from "@/types";
import styles from "./ListeningStats.module.css";

type ListeningStatsData = UserStats;

type VisualStyle = CSSProperties & {
  "--delay"?: string;
  "--strength"?: string;
};

const numberFormatter = new Intl.NumberFormat("de-DE");

function formatCount(value: number): string {
  return numberFormatter.format(value);
}

function playLabel(value: number): string {
  return value === 1 ? "Wiedergabe" : "Wiedergaben";
}

function revealStyle(index: number): VisualStyle {
  return { "--delay": `${index * 70}ms` };
}

function traceStyle(value: number, max: number, index: number): VisualStyle {
  return {
    "--delay": `${220 + index * 90}ms`,
    "--strength": `${(value / max) * 100}%`,
  };
}

async function fetchListeningStats(): Promise<ListeningStatsData> {
  return decodeListeningStats(await api.stats());
}

function Artwork({
  cover,
  className,
}: {
  cover?: string;
  className: string;
}) {
  if (!cover) return <CoverPlaceholder className={className} />;

  return (
    // Statistics artwork is decorative because the adjacent text names it.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cover}
      alt=""
      width={320}
      height={320}
      loading="lazy"
      decoding="async"
      className={className}
    />
  );
}

function SectionLabel({ index, children }: { index: string; children: ReactNode }) {
  return (
    <div className={styles.sectionLabel}>
      <span aria-hidden="true">{index}</span>
      <span>{children}</span>
    </div>
  );
}

function PulseCard({ data }: { data: ListeningStatsData }) {
  const monthlyPlays = data.total_plays_month;
  const monthlyShare =
    data.total_plays > 0
      ? Math.round((monthlyPlays / data.total_plays) * 100)
      : 0;
  const topArtist = data.top_artists[0];

  return (
    <article
      className={`${styles.card} ${styles.pulseCard} ${styles.reveal}`}
      style={revealStyle(0)}
    >
      <div className={styles.pulseGlow} aria-hidden="true" />
      <div className={styles.orbit} aria-hidden="true">
        <span className={styles.orbitHalo} />
        <span className={styles.orbitRing} />
        <span className={styles.orbitRingInner} />
        <span className={styles.orbitDot} />
        <span className={styles.orbitCore}>
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className={styles.pulseContent}>
        <SectionLabel index="01">Gesamtfrequenz</SectionLabel>

        <div className={styles.totalMetric}>
          <strong>{formatCount(data.total_plays)}</strong>
          <span>aufgezeichnete {playLabel(data.total_plays)}</span>
        </div>

        <div className={styles.pulseFooter}>
          <div className={styles.monthMetric}>
            <span>Letzte 30 Tage</span>
            <strong>{formatCount(monthlyPlays)}</strong>
          </div>

          {monthlyPlays > 0 && data.total_plays > 0 && (
            <div className={styles.shareMetric}>
              <span>{monthlyShare}%</span>
              <p>deines gesamten Archivs liegen in dieser Phase.</p>
            </div>
          )}

          {topArtist && (
            <div className={styles.favoriteMetric}>
              <span>Stärkstes Signal</span>
              <strong>{topArtist.label}</strong>
              <small>
                {formatCount(topArtist.count)} {playLabel(topArtist.count)}
              </small>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function RecentCard({ tracks }: { tracks: RecentPlay[] }) {
  const visibleTracks = tracks.slice(0, 5);
  const visibleCovers = tracks.slice(0, 4);

  return (
    <article
      className={`${styles.card} ${styles.recentCard} ${styles.reveal}`}
      style={revealStyle(1)}
    >
      <div className={styles.recentHeader}>
        <SectionLabel index="02">Letzte Signale</SectionLabel>
        {tracks.length > 0 && (
          <span className={styles.entryCount}>{tracks.length} Einträge</span>
        )}
      </div>

      {visibleTracks.length > 0 ? (
        <>
          <div className={styles.coverStack} aria-hidden="true">
            {visibleCovers.map((track, index) => (
              <Artwork
                key={`${track.id}-${index}`}
                cover={track.cover}
                className={styles.stackCover}
              />
            ))}
          </div>

          <ol className={styles.recentList} aria-label="Zuletzt gehörte Titel">
            {visibleTracks.map((track, index) => (
              <li key={`${track.id}-${index}`}>
                <span className={styles.recentIndex} aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{track.title}</strong>
                  <span>{track.artist}</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className={styles.miniEmpty}>
          <span aria-hidden="true" />
          <p>Keine jüngsten Titel im Archiv.</p>
        </div>
      )}
    </article>
  );
}

function ArtistSignature({ artists }: { artists: StatEntry[] }) {
  const max = Math.max(...artists.map((artist) => artist.count));

  return (
    <article
      className={`${styles.card} ${styles.signatureCard} ${styles.reveal}`}
      style={revealStyle(2)}
    >
      <header className={styles.cardHeader}>
        <div>
          <SectionLabel index="03">Klangsignatur</SectionLabel>
          <h3>Die Stimmen in deinem Spektrum.</h3>
        </div>
        <p>Relative Intensität nach tatsächlichen Wiedergaben.</p>
      </header>

      <ol className={styles.artistSpectrum}>
        {artists.map((artist, index) => (
          <li
            key={`${artist.key}-${index}`}
            className={styles.artistSignal}
            style={traceStyle(artist.count, max, index)}
          >
            <span className={styles.artistRank} aria-hidden="true">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className={styles.artistIdentity}>
              <strong>{artist.label}</strong>
              <span>
                {formatCount(artist.count)} {playLabel(artist.count)}
              </span>
            </div>
            <div className={styles.signalRail} aria-hidden="true">
              <span className={styles.signalFill} />
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

function TrackChart({ tracks }: { tracks: StatEntry[] }) {
  const max = Math.max(...tracks.map((track) => track.count));

  return (
    <article
      className={`${styles.card} ${styles.tracksCard} ${styles.reveal}`}
      style={revealStyle(3)}
    >
      <header className={styles.cardHeader}>
        <div>
          <SectionLabel index="04">Heavy Rotation</SectionLabel>
          <h3>Die Titel, die geblieben sind.</h3>
        </div>
      </header>

      <ol className={styles.trackChart}>
        {tracks.map((track, index) => (
          <li
            key={`${track.key}-${index}`}
            className={styles.trackItem}
            style={traceStyle(track.count, max, index)}
          >
            <span className={styles.trackRank}>{index + 1}</span>
            <Artwork cover={track.cover} className={styles.trackCover} />
            <div className={styles.trackCopy}>
              <strong>{track.label}</strong>
              {track.sublabel && <span>{track.sublabel}</span>}
              <div className={styles.trackRail} aria-hidden="true">
                <span />
              </div>
            </div>
            <span className={styles.trackCount}>
              <strong>{formatCount(track.count)}</strong>
              <span>{playLabel(track.count)}</span>
            </span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function MonthlyArtists({ artists }: { artists: StatEntry[] }) {
  const artistMax = Math.max(...artists.map((artist) => artist.count));

  return (
    <section
      className={styles.monthArtists}
      aria-labelledby="month-artists-title"
    >
      <h4 id="month-artists-title">Künstler dieser Phase</h4>
      <ol>
        {artists.map((artist, index) => (
          <li
            key={`${artist.key}-${index}`}
            style={traceStyle(artist.count, artistMax, index)}
          >
            <div>
              <span>{artist.label}</span>
              <strong>{formatCount(artist.count)}</strong>
            </div>
            <span className={styles.monthRail} aria-hidden="true">
              <i />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MonthlyFocus({
  total,
  artists,
  tracks,
}: {
  total: number;
  artists: StatEntry[];
  tracks: StatEntry[];
}) {
  return (
    <article
      className={`${styles.card} ${styles.monthCard} ${styles.reveal}`}
      style={revealStyle(4)}
    >
      <div className={styles.monthLead}>
        <SectionLabel index="05">Aktuelle Phase</SectionLabel>
        <div className={styles.periodStamp} aria-hidden="true">
          <strong>30</strong>
          <span>Tage</span>
        </div>
        <div className={styles.periodTotal}>
          <strong>{formatCount(total)}</strong>
          <span>{playLabel(total)} in diesem Zeitfenster</span>
        </div>
      </div>

      <div className={styles.monthDetails}>
        {artists.length > 0 && <MonthlyArtists artists={artists} />}

        {tracks.length > 0 && (
          <section
            className={styles.monthTracks}
            aria-labelledby="month-tracks-title"
          >
            <h4 id="month-tracks-title">Titel dieser Phase</h4>
            <ol>
              {tracks.map((track, index) => (
                <li key={`${track.key}-${index}`}>
                  <span aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{track.label}</strong>
                    {track.sublabel && <span>{track.sublabel}</span>}
                  </div>
                  <b>{formatCount(track.count)}×</b>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <div className={styles.loadingState} role="status" aria-live="polite">
      <span className={styles.visuallyHidden}>Hörprofil wird geladen…</span>
      <div className={styles.skeletonWide} aria-hidden="true" />
      <div className={styles.skeletonSmall} aria-hidden="true" />
      <div className={styles.skeletonWide} aria-hidden="true" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className={`${styles.card} ${styles.emptyState}`} role="status">
      <div className={styles.emptyGlyph} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <SectionLabel index="00">Noch unbeschrieben</SectionLabel>
      <h3>Noch keine Hörspuren.</h3>
      <p>
        Sobald du einen Titel startest, beginnt dein persönliches Klangarchiv hier
        sichtbar zu werden.
      </p>
    </div>
  );
}

export default function ListeningStats() {
  const { data, isLoading, error } = useQuery<ListeningStatsData>({
    queryKey: ["stats"],
    queryFn: fetchListeningStats,
    // This query key is shared with the account hero. Validate selected cache
    // data as well, so a response fetched by that observer cannot bypass the
    // strict contract above.
    select: decodeListeningStats,
  });

  const hasHistory =
    !!data &&
    (data.total_plays > 0 ||
      data.recent.length > 0 ||
      data.top_artists.length > 0 ||
      data.top_tracks.length > 0);

  return (
    <section
      className={styles.root}
      aria-labelledby="listening-dna-title"
      aria-busy={isLoading}
    >
      <header className={styles.editorialHeader}>
        <div>
          <p className={styles.eyebrow}>
            <span aria-hidden="true" />
            Listening DNA · Dein Archiv
          </p>
          <h2 id="listening-dna-title">Dein Klang, sichtbar gemacht.</h2>
        </div>
        <p className={styles.headerIntro}>
          Jeder Play hinterlässt eine Spur. Hier verdichten sich deine Sessions zu
          einem persönlichen Hörprofil.
        </p>
        <div className={styles.headerSignal} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </header>

      {isLoading && <LoadingState />}

      {error && (
        <div className={styles.errorCard} role="alert">
          <span>Signal unterbrochen</span>
          <p>Deine Hörstatistik konnte nicht geladen werden. Bitte versuche es erneut.</p>
        </div>
      )}

      {data && !hasHistory && <EmptyState />}

      {data && hasHistory && (
        <div className={styles.dashboard}>
          <div className={styles.heroGrid}>
            <PulseCard data={data} />
            <RecentCard tracks={data.recent} />
          </div>

          <div className={styles.analysisGrid}>
            {data.top_artists.length > 0 && (
              <ArtistSignature artists={data.top_artists} />
            )}
            {data.top_tracks.length > 0 && <TrackChart tracks={data.top_tracks} />}
          </div>

          {data.total_plays_month > 0 && (
            <MonthlyFocus
              total={data.total_plays_month}
              artists={data.top_artists_month}
              tracks={data.top_tracks_month}
            />
          )}
        </div>
      )}
    </section>
  );
}
