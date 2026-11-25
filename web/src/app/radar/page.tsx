"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useMe } from "@/hooks/useAuth";
import { RADAR_TITLE, useRefreshReleaseRadar, useReleaseRadar, useReleaseRadarSeen } from "@/hooks/useReleaseRadar";
import { usePlayerStore } from "@/store/player";
import { RADAR_RULE, radarReasonLabel } from "@/lib/radarReason";
import type { RadarReason } from "@/types";
import TrackRow from "@/components/TrackRow";
import { RowListSkeleton } from "@/components/Skeleton";
import { RefreshIcon } from "@/components/icons";
import Cover from "@/components/ui/Cover";
import EmptyState from "@/components/ui/EmptyState";
import QueryError from "@/components/ui/QueryError";
import CollectionHero from "@/app/playlist/_components/CollectionHero";
import CollectionTracks from "@/app/playlist/_components/CollectionTracks";
import { useLoadingPlaceholder } from "@/app/playlist/_components/CollectionPageState";
import { CollectionMenu, PlayCollectionButton, ShuffleCollectionButton, useQueueAllItem, useSaveAsPlaylistItem } from "@/app/playlist/_components/CollectionActions";
import { tracksSummary } from "@/app/playlist/_components/collectionMeta";

/**
 * Why a track is in the radar, with the watched artist linked. That artist is
 * the source of the release and may differ from the track's own artists.
 */
function RadarReasonNote({ reason }: { reason: RadarReason }) {
  const label = radarReasonLabel(reason);
  return (
    <span title={label.text}>
      {label.lead}
      {label.artistName !== null && (
        <Link href={`/artist/${reason.artist_id}`} className="hover:text-foreground hover:underline">
          {label.artistName}
        </Link>
      )}
    </span>
  );
}

export default function RadarPage() {
  const account = useMe();
  const me = account.data;
  const playQueue = usePlayerStore((s) => s.playQueue);
  const radar = useReleaseRadar(me);
  const refreshRadar = useRefreshReleaseRadar(me);

  const tracks = radar.data ?? [];
  const cover = tracks.find((t) => t.cover)?.cover;
  const queueAll = useQueueAllItem(tracks);
  const savePlaylist = useSaveAsPlaylistItem(RADAR_TITLE, tracks, RADAR_RULE);
  // Deferred, so the loaded titles cross-fade in instead of replacing the placeholder rows at once.
  const loading = useLoadingPlaceholder(account.isLoading || radar.isLoading);
  const { markVisibleTracksSeen } = useReleaseRadarSeen(me?.id, tracks);

  useEffect(() => {
    markVisibleTracksSeen();
  }, [markVisibleTracksSeen]);

  return (
    <div>
      <CollectionHero
        eyebrow="Für dich"
        title={RADAR_TITLE}
        description={RADAR_RULE}
        clampDescription={false}
        metadata={loading ? "Wird geladen…" : tracksSummary(tracks)}
        coverUrl={cover}
        artwork={<Cover src={cover} eager />}
        actions={
          <>
            <PlayCollectionButton tracks={tracks} context={RADAR_TITLE} />
            <ShuffleCollectionButton tracks={tracks} context={RADAR_TITLE} />
            {tracks.length > 0 && (
              <CollectionMenu label="Weitere Optionen für den Release Radar" items={[queueAll, savePlaylist]} />
            )}
            <button
              type="button"
              onClick={() => refreshRadar.mutate()}
              disabled={!me || refreshRadar.isPending}
              aria-busy={refreshRadar.isPending}
              aria-label="Release Radar aktualisieren"
              title="Release Radar aktualisieren"
              className="action-icon h-11 w-11"
            >
              <RefreshIcon aria-hidden="true" width={22} height={22} className={refreshRadar.isPending ? "animate-spin" : undefined} />
            </button>
            {(refreshRadar.isPending || refreshRadar.isSuccess) && (
              <span role="status" className={`label-mono normal-case tracking-[0.04em] ${refreshRadar.isPending ? "" : "text-success"}`}>
                {refreshRadar.isPending ? "Release Radar wird aktualisiert…" : "Release Radar wurde aktualisiert."}
              </span>
            )}
          </>
        }
      />

      {refreshRadar.error && (
        <p role="alert" className="error-panel mb-4">
          Release Radar konnte nicht aktualisiert werden.{tracks.length > 0 && " Die zuletzt geladenen Songs bleiben sichtbar."} {refreshRadar.error.message}
        </p>
      )}
      <QueryError label="Die Titel im Release Radar" query={radar} className="mb-4" />
      <QueryError label="Deine Kontodaten" query={account} className="mb-4" />

      <CollectionTracks count={loading ? 0 : tracks.length} noteLabel="Warum im Radar">
        {loading ? (
          <RowListSkeleton />
        ) : !me ? (
          // A failed account lookup is reported above; only a signed-out
          // session is asked to sign in.
          account.isError ? null : (
            <EmptyState
              title="Melde dich an, um deinen Release Radar zu hören"
              action={
                <Link href="/login" className="action-primary">
                  Anmelden
                </Link>
              }
            />
          )
        ) : radar.isError && radar.data === undefined ? null : tracks.length === 0 ? (
          <EmptyState
            title="Noch keine frischen Releases"
            action={
              <Link href="/search" className="action-secondary">
                Künstler finden
              </Link>
            }
          >
            Folge Künstler:innen oder höre mehr Musik, dann füllt sich dein Radar.
          </EmptyState>
        ) : (
          tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} onPlay={() => playQueue(tracks, i, RADAR_TITLE)} note={<RadarReasonNote reason={track.radar_reason} />} />
          ))
        )}
      </CollectionTracks>
    </div>
  );
}
