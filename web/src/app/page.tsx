"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { useMe } from "@/hooks/useAuth";
import { useRecentTracks, RECENT_QUEUE_CONTEXT } from "@/hooks/useRecentTracks";
import { useReleaseRadar, useReleaseRadarSeen } from "@/hooks/useReleaseRadar";
import { trackArtistLabel } from "@/lib/trackArtists";
import { CompassIcon, RadioIcon } from "@/components/icons";
import FriendsListeningPanel from "@/components/social/FriendsListeningPanel";
import ShelfCard from "@/components/ShelfCard";
import Shelf, { ShelfSkeleton } from "@/components/browse/Shelf";
import QuickTile from "@/components/browse/QuickTile";
import BrowseTile from "@/components/browse/BrowseTile";
import QueryState from "@/components/browse/QueryState";
import QueryError from "@/components/ui/QueryError";
import EmptyState from "@/components/ui/EmptyState";
import SectionHeader from "@/components/ui/SectionHeader";
import type { HomeShelf, Track } from "@/types";

const EMPTY_TRACKS: Track[] = [];
const QUICK_TILE_COUNT = 6;

function greeting(hour: number): string {
  if (hour < 5) return "Gute Nacht";
  if (hour < 11) return "Guten Morgen";
  if (hour < 18) return "Guten Tag";
  return "Guten Abend";
}

const mixHref = (shelf: HomeShelf) => `/mix/${encodeURIComponent(shelf.key)}`;

export default function HomePage() {
  const meQuery = useMe();
  const { data: me } = meQuery;
  const playQueue = usePlayerStore((state) => state.playQueue);
  const recent = useRecentTracks();
  const userId = me ? String(me.id) : null;
  const mixes = useQuery<HomeShelf[]>({
    queryKey: ["home-mixes", userId],
    queryFn: () => api.homeMixes(),
    enabled: userId !== null,
  });
  const personalMixes = useQuery<HomeShelf[]>({
    queryKey: ["home-personal-mixes", userId],
    queryFn: () => api.homePersonalMixes(),
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
  const mixShelves = mixes.data ?? [];
  const hasPersonal = mixShelves.length > 0 || radarTracks.length > 0;
  const personalLoading = (mixes.isLoading || radar.isLoading) && !hasPersonal;
  const personalEmpty = mixes.isSuccess && radar.isSuccess && !hasPersonal;

  return (
    <div className="flex flex-col gap-9 md:gap-11">
      <header>
        {/* The hour differs between the server render and the visitor's clock. */}
        <h1 className="page-title" suppressHydrationWarning>
          {greeting(new Date().getHours())}
          {me?.display_name ? `, ${me.display_name}` : ""}
        </h1>
        <QueryError label="Deine Kontodaten" query={meQuery} className="mt-5" />
      </header>

      {recent.length > 0 ? (
        <section aria-labelledby="resume-heading">
          <SectionHeader id="resume-heading" title="Weiterhören" description={`${RECENT_QUEUE_CONTEXT} auf diesem Gerät`} href="/library?tab=recent" linkLabel="Verlauf öffnen" />
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
            {recent.slice(0, QUICK_TILE_COUNT).map((track, index) => (
              <QuickTile
                key={`${track.id}-${index}`}
                title={track.title}
                subtitle={trackArtistLabel(track)}
                cover={track.cover}
                onPlay={() => playQueue(recent, index, RECENT_QUEUE_CONTEXT)}
              />
            ))}
          </div>
        </section>
      ) : (
        <section aria-labelledby="start-heading" className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 id="start-heading" className="text-xl font-bold tracking-tight">
              Was möchtest du heute hören?
            </h2>
            <p className="mt-1 text-sm text-muted">Sobald du Musik hörst, kannst du hier direkt weitermachen.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/search" className="action-primary">
              Musik suchen
            </Link>
            <Link href="/library" className="action-secondary">
              Meine Bibliothek
            </Link>
          </div>
        </section>
      )}

      {me && <FriendsListeningPanel />}

      {me && (personalMixes.isLoading || personalMixes.isError || (personalMixes.data?.length ?? 0) > 0) && (
        <section aria-labelledby="personal-mixes-heading" aria-busy={personalMixes.isLoading}>
          <SectionHeader
            id="personal-mixes-heading"
            title="Aus deinem Hörverlauf"
            description="On Repeat, vergessene Favoriten und ungehörte Schätze aus deiner Bibliothek."
            href="/account?tab=stats"
            linkLabel="Hörprofil"
          />
          <QueryState query={personalMixes} label="Deine persönlichen Mixe" skeleton={<ShelfSkeleton />} empty={null}>
            {(shelves) => (
              <Shelf label="Aus deinem Hörverlauf">
                {shelves.map((shelf, index) => (
                  <ShelfCard key={shelf.key} href={mixHref(shelf)} shelf={shelf} index={index} />
                ))}
              </Shelf>
            )}
          </QueryState>
        </section>
      )}

      {me && (
        <section aria-labelledby="personal-heading" aria-busy={personalLoading}>
          <SectionHeader
            id="personal-heading"
            title="Für dich zusammengestellt"
            description="Deine Mixe und neue Musik von Künstlern, denen du folgst."
            href="/radar"
            linkLabel="Release Radar"
          />
          <QueryError label="Deine Mixe" query={mixes} className="mb-4" />
          <QueryError label="Dein Release Radar" query={radar} className="mb-4" />
          {personalLoading ? (
            <div role="status" aria-label="Persönliche Musik wird geladen">
              <ShelfSkeleton />
            </div>
          ) : personalEmpty ? (
            <EmptyState
              icon={<CompassIcon width={24} height={24} />}
              title="Deine Mixe entstehen beim Hören"
              action={
                <Link href="/genre" className="action-secondary">
                  Neue Musik entdecken
                </Link>
              }
            >
              Höre Musik und folge Künstlern, dann stellen wir hier persönliche Mixe und dein Release Radar zusammen.
            </EmptyState>
          ) : (
            hasPersonal && (
              <Shelf label="Für dich zusammengestellt">
                {radarTracks.length > 0 && (
                  <ShelfCard
                    key="release-radar"
                    href="/radar"
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
                {mixShelves.map((shelf, index) => (
                  <ShelfCard key={shelf.key} href={mixHref(shelf)} shelf={shelf} index={index} />
                ))}
              </Shelf>
            )
          )}
        </section>
      )}

      {me && (becauseYouListened.isLoading || becauseYouListened.isError || (becauseYouListened.data?.length ?? 0) > 0) && (
        <section aria-labelledby="listened-heading" aria-busy={becauseYouListened.isLoading}>
          <SectionHeader id="listened-heading" title="Weil du es gern hörst" href="/radio" linkLabel="Deine Radios" />
          <QueryState query={becauseYouListened} label="Empfehlungen zu deiner Musik" skeleton={<ShelfSkeleton />} empty={null}>
            {(shelves) => (
              <Shelf label="Weil du es gern hörst">
                {shelves.map((shelf, index) => (
                  <ShelfCard key={shelf.key} href={mixHref(shelf)} shelf={shelf} index={index + 1} />
                ))}
              </Shelf>
            )}
          </QueryState>
        </section>
      )}

      <section aria-labelledby="more-heading">
        <SectionHeader id="more-heading" title="Lust auf etwas Neues?" />
        <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
          <BrowseTile
            href="/genre"
            title="Entdecken"
            hint="Charts, neue Veröffentlichungen, Genres und Playlists."
            icon={<CompassIcon width={88} height={88} />}
            tone={3}
          />
          <BrowseTile
            href="/radio"
            title="Radio"
            hint="Einfach laufen lassen: deine Radios oder Musik für Fokus, Chill, Workout und Party."
            icon={<RadioIcon width={88} height={88} />}
            tone={4}
          />
        </div>
      </section>
    </div>
  );
}
