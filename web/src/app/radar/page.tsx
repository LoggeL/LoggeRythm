"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useMe } from "@/hooks/useAuth";
import {
  RADAR_TITLE,
  useRefreshReleaseRadar,
  useReleaseRadar,
  useReleaseRadarSeen,
} from "@/hooks/useReleaseRadar";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import { RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon, RefreshIcon } from "@/components/icons";
import CoverPlaceholder from "@/components/CoverPlaceholder";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import CollectionTracks from "@/app/playlist/_components/CollectionTracks";

export default function RadarPage() {
  const account = useMe();
  const me = account.data;
  const playQueue = usePlayerStore((s) => s.playQueue);
  const radar = useReleaseRadar(me);
  const refreshRadar = useRefreshReleaseRadar(me);

  const tracks = radar.data ?? [];
  const cover = tracks.find((t) => t.cover)?.cover;
  const { markVisibleTracksSeen } = useReleaseRadarSeen(me?.id, tracks);
  const radarError = refreshRadar.error ?? radar.error;

  useEffect(() => {
    markVisibleTracksSeen();
  }, [markVisibleTracksSeen]);

  return (
    <div className="animate-in">
      <CollectionHero
        eyebrow="Playlist"
        title={RADAR_TITLE}
        description="Neues von Künstler:innen, die du hörst und folgst"
        metadata={
          account.isLoading || radar.isLoading
            ? "Wird geladen…"
            : `${tracks.length} Titel`
        }
        artwork={
          cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={RADAR_TITLE}
              className="h-full w-full rounded-2xl object-cover"
            />
          ) : (
            <CoverPlaceholder className="h-full w-full rounded-2xl" />
          )
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => playQueue(tracks, 0, RADAR_TITLE)}
              disabled={tracks.length === 0}
              className="action-primary"
            >
              <PlayIcon width={18} height={18} /> Alle abspielen
            </button>
            <button
              type="button"
              onClick={() => refreshRadar.mutate()}
              disabled={!me || refreshRadar.isPending}
              className="action-secondary"
            >
              <RefreshIcon
                aria-hidden="true"
                className={refreshRadar.isPending ? "animate-spin" : undefined}
              />
              {refreshRadar.isPending
                ? "Release Radar wird aktualisiert…"
                : "Release Radar aktualisieren"}
            </button>
          </>
        }
      />
      {refreshRadar.isSuccess && (
        <p role="status" className="mb-4 text-sm text-accent-soft">
          Release Radar wurde aktualisiert.
        </p>
      )}

      {radarError && (
        <div role="alert" className="error-panel mb-4">
          Release Radar konnte nicht aktualisiert werden.
          {tracks.length > 0 &&
            " Die zuletzt geladenen Songs bleiben sichtbar."}{" "}
          {radarError.message}
        </div>
      )}
      {account.isError && (
        <div role="alert" className="error-panel mb-4">
          Dein Konto konnte nicht geladen werden: {account.error.message}
          <button
            type="button"
            onClick={() => void account.refetch()}
            disabled={account.isFetching}
            className="ml-3 underline disabled:opacity-50"
          >
            Erneut versuchen
          </button>
        </div>
      )}

      <CollectionTracks count={tracks.length}>
        {account.isLoading || radar.isLoading ? (
          <RowListSkeleton />
        ) : account.isError && !me ? null : !me ? (
          <div className="empty-panel">
            <p className="mb-4">
              Melde dich an, um deinen Release Radar zu hören.
            </p>
            <Link href="/login" className="action-primary">
              Anmelden
            </Link>
          </div>
        ) : radar.isError && radar.data === undefined ? null : tracks.length ===
          0 ? (
          <p className="empty-panel">
            Noch keine frischen Releases von deinen Künstler:innen. Folge
            Artists oder höre mehr, dann füllt sich dein Radar.
          </p>
        ) : (
          <div className="flex flex-col">
            {tracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                onPlay={() => playQueue(tracks, i, RADAR_TITLE)}
              />
            ))}
          </div>
        )}
      </CollectionTracks>
    </div>
  );
}
