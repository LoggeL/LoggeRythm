"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useLocalJson } from "@/hooks/useLocalJson";
import { useMe } from "@/hooks/useAuth";
import { useReleaseRadar, useReleaseRadarSeen } from "@/hooks/useReleaseRadar";
import { trackArtistLabel } from "@/lib/trackArtists";
import { PlayIcon, RadioIcon, CompassIcon } from "@/components/icons";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import ShelfCard from "@/components/ShelfCard";
import type { HomeShelf, Track } from "@/types";

const EMPTY_TRACKS: Track[] = [];

function greeting(hour: number): string {
  if (hour < 5) return "Gute Nacht";
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}

type HomeQuery = {
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
};

function HomeError({ label, query }: { label: string; query: HomeQuery }) {
  if (!query.isError) return null;
  return (
    <div role="alert" className="error-panel">
      <p>
        {label} konnten nicht geladen werden: {query.error?.message}
      </p>
      <button
        type="button"
        className="action-secondary mt-3"
        onClick={() => void query.refetch()}
        disabled={query.isFetching}
      >
        {query.isFetching ? "Wird geladen…" : "Erneut versuchen"}
      </button>
    </div>
  );
}

export default function HomePage() {
  const meQuery = useMe();
  const { data: me } = meQuery;
  const playQueue = usePlayerStore((state) => state.playQueue);
  const [recent] = useLocalJson<Track[]>("sf_recent_tracks", EMPTY_TRACKS);
  if (!Array.isArray(recent)) {
    throw new Error(
      'Ungültiger Hörverlauf in localStorage["sf_recent_tracks"]: erwartet wurde eine Titelliste.',
    );
  }
  const userId = me ? String(me.id) : null;
  const mixes = useQuery<HomeShelf[]>({
    queryKey: ["home-mixes", userId],
    queryFn: () => api.homeMixes(),
    enabled: userId !== null,
  });
  const becauseYouListened = useQuery<HomeShelf[]>({
    queryKey: ["because-you-listened", userId],
    queryFn: () => api.becauseYouListened(),
    enabled: userId !== null,
  });
  const radar = useReleaseRadar(me);
  const radarTracks = radar.data ?? EMPTY_TRACKS;
  const { unseenCount } = useReleaseRadarSeen(me?.id, radarTracks);
  const latest = recent[0];
  const [showAllMixes, setShowAllMixes] = useState(false);
  const covers = recent.filter((track) => track.cover).slice(0, 3);
  const featuredMixCount = radarTracks.length > 0 ? 2 : 3;

  return (
    <div className="flex flex-col gap-8 md:gap-10 animate-in">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">Dein Musikraum</p>
          <h1 className="page-title">
            {greeting(new Date().getHours())}
            {me?.display_name ? `, ${me.display_name}` : ""}
          </h1>
          <p className="page-description">
            Deine Mixe und zuletzt gehörten Titel.
          </p>
        </div>
        <Link href="/genre" className="action-secondary">
          <CompassIcon width={18} height={18} />
          Entdecken
        </Link>
      </header>

      <HomeError label="Deine Kontodaten" query={meQuery} />

      <section
        className="surface-card relative overflow-hidden p-6 sm:p-8"
        aria-label="Musik starten"
      >
        <div className="relative z-10 max-w-xl lg:max-w-[52%]">
          <p className="page-eyebrow">
            {latest ? "Gleich weiterhören" : "Zeit für Musik"}
          </p>
          <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight leading-tight">
            {latest ? latest.title : "Was möchtest du heute hören?"}
          </h2>
          <p className="mt-3 text-muted text-sm sm:text-base">
            {latest
              ? trackArtistLabel(latest)
              : "Deine Sammlung und neue Entdeckungen sind nur einen Klick entfernt."}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {latest ? (
              <button
                type="button"
                className="action-primary"
                onClick={() => playQueue(recent, 0, "Zuletzt gehört")}
              >
                <PlayIcon width={18} height={18} />
                Weiterhören
              </button>
            ) : (
              <Link href="/search" className="action-primary">
                Musik suchen
              </Link>
            )}
            <Link href="/library" className="action-secondary">
              Meine Bibliothek
            </Link>
          </div>
        </div>
        {covers.length > 0 && (
          <div
            aria-hidden="true"
            className="hidden lg:flex absolute right-8 top-1/2 -translate-y-1/2 items-center -space-x-5 pointer-events-none"
          >
            {covers.map((track, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${track.id}-${index}`}
                src={track.cover}
                alt=""
                className={`h-36 w-36 xl:h-44 xl:w-44 rounded-xl object-cover border-4 border-panel ${index === 1 ? "relative z-10" : "opacity-55"}`}
              />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading">
          <div className="section-heading">
            <h2 id="recent-heading">Zuletzt gehört</h2>
            <Link
              href="/library?tab=recent"
              className="text-sm text-muted hover:text-foreground"
            >
              Verlauf öffnen
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
            {recent.slice(0, 6).map((track, index) => (
              <button
                key={`${track.id}-${index}`}
                type="button"
                onClick={() => playQueue(recent, index, "Zuletzt gehört")}
                className="group flex min-w-0 items-center gap-3 rounded-xl border border-white/5 bg-panel px-3 py-3 text-left hover:bg-panel-hover transition"
              >
                {track.cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={track.cover}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 flex-shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                ) : (
                  <CoverPlaceholder className="h-12 w-12 flex-shrink-0 rounded-md" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {track.title}
                  </span>
                  <span className="block truncate text-xs text-muted mt-1">
                    {trackArtistLabel(track)}
                  </span>
                </span>
                <span className="action-icon flex-shrink-0" aria-hidden="true">
                  <PlayIcon width={17} height={17} />
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {me && (
        <section aria-labelledby="personal-heading">
          <div className="section-heading">
            <div>
              <h2 id="personal-heading">Für dich zusammengestellt</h2>
              <p className="text-sm text-muted mt-1">
                Deine Mixe und neue Musik von Künstlern, denen du folgst.
              </p>
            </div>
            <Link
              href="/radar"
              className="text-sm text-muted hover:text-foreground"
            >
              Release Radar
            </Link>
          </div>
          <div className="space-y-3">
            <HomeError label="Deine Mixe" query={mixes} />
            <HomeError label="Dein Release Radar" query={radar} />
          </div>
          {(mixes.isLoading || radar.isLoading) &&
            !mixes.data &&
            !radar.data && (
              <div
                role="status"
                aria-label="Persönliche Musik wird geladen"
                className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4"
              >
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="skeleton h-44 rounded-xl" />
                ))}
              </div>
            )}
          <div
            id="personal-mixes"
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
          >
            {radarTracks.length > 0 && (
              <ShelfCard
                href="/radar"
                variant="hero"
                highlighted={unseenCount > 0}
                statusBadge={unseenCount > 0 ? `${unseenCount} neu` : undefined}
                shelf={{
                  key: "release-radar",
                  title: "Dein Release Radar",
                  subtitle: "Neue Titel von deinen Künstlern",
                  cover: radarTracks.find((track) => track.cover)?.cover,
                  tracks: radarTracks,
                }}
              />
            )}
            {(mixes.data ?? [])
              .slice(0, showAllMixes ? undefined : featuredMixCount)
              .map((shelf, index) => (
                <ShelfCard
                  key={shelf.key}
                  href={`/mix/${encodeURIComponent(shelf.key)}`}
                  shelf={shelf}
                  index={index}
                  variant="hero"
                />
              ))}
          </div>
          {(mixes.data?.length ?? 0) > featuredMixCount && (
            <button
              type="button"
              className="mt-4 text-sm text-muted hover:text-foreground"
              aria-expanded={showAllMixes}
              aria-controls="personal-mixes"
              onClick={() => setShowAllMixes((current) => !current)}
            >
              {showAllMixes ? "Weniger anzeigen" : "Alle Mixe anzeigen"}
            </button>
          )}
          {mixes.isSuccess &&
            radar.isSuccess &&
            mixes.data.length === 0 &&
            radarTracks.length === 0 && (
              <div className="empty-panel">
                <p>
                  Deine persönlichen Mixe entstehen, wenn du Musik hörst und
                  Künstlern folgst.
                </p>
                <Link href="/genre" className="action-secondary mt-4">
                  Neue Musik entdecken
                </Link>
              </div>
            )}
        </section>
      )}

      {me &&
        (becauseYouListened.isLoading ||
          becauseYouListened.isError ||
          (becauseYouListened.data?.length ?? 0) > 0) && (
          <section aria-labelledby="listened-heading">
            <div className="section-heading">
              <h2 id="listened-heading">Weil du es gern hörst</h2>
              <Link
                href="/radio"
                className="text-sm text-muted hover:text-foreground"
              >
                Deine Radios
              </Link>
            </div>
            <HomeError
              label="Empfehlungen zu deiner Musik"
              query={becauseYouListened}
            />
            {becauseYouListened.isLoading && (
              <div
                role="status"
                aria-label="Empfehlungen werden geladen"
                className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4"
              >
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="skeleton h-36 rounded-xl" />
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {(becauseYouListened.data ?? [])
                .slice(0, 3)
                .map((shelf, index) => (
                  <ShelfCard
                    key={shelf.key}
                    href={`/mix/${encodeURIComponent(shelf.key)}`}
                    shelf={shelf}
                    index={index}
                    variant="hero"
                  />
                ))}
            </div>
          </section>
        )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Link
          href="/genre"
          className="surface-card flex items-start gap-4 p-5 hover:bg-panel-hover transition"
        >
          <CompassIcon
            className="mt-1 text-muted flex-shrink-0"
            width={22}
            height={22}
          />
          <div>
            <h2 className="font-medium">Lust auf etwas Neues?</h2>
            <p className="text-sm text-muted mt-1">
              Charts, neue Veröffentlichungen, Genres und Community-Playlists.
            </p>
            <span className="inline-block text-sm text-accent-soft mt-3">
              Musik entdecken →
            </span>
          </div>
        </Link>
        <Link
          href="/radio"
          className="surface-card flex items-start gap-4 p-5 hover:bg-panel-hover transition"
        >
          <RadioIcon
            className="mt-1 text-muted flex-shrink-0"
            width={22}
            height={22}
          />
          <div>
            <h2 className="font-medium">Einfach laufen lassen</h2>
            <p className="text-sm text-muted mt-1">
              Deine Radios oder Musik für Fokus, Chill, Workout und Party.
            </p>
            <span className="inline-block text-sm text-accent-soft mt-3">
              Radio auswählen →
            </span>
          </div>
        </Link>
      </div>
    </div>
  );
}
