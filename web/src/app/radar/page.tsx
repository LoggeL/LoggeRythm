"use client";

import { useEffect } from "react";
import { useMe } from "@/hooks/useAuth";
import {
  RADAR_TITLE,
  useReleaseRadar,
  useReleaseRadarSeen,
} from "@/hooks/useReleaseRadar";
import { usePlayerStore } from "@/store/player";
import TrackRow from "@/components/TrackRow";
import { RowListSkeleton } from "@/components/Skeleton";
import { PlayIcon } from "@/components/icons";
import CoverPlaceholder from "@/components/CoverPlaceholder";

export default function RadarPage() {
  const { data: me } = useMe();
  const playQueue = usePlayerStore((s) => s.playQueue);
  const radar = useReleaseRadar(me);

  const tracks = radar.data ?? [];
  const cover = tracks.find((t) => t.cover)?.cover;
  const { markVisibleTracksSeen } = useReleaseRadarSeen(me?.id, tracks);

  useEffect(() => {
    markVisibleTracksSeen();
  }, [markVisibleTracksSeen]);

  return (
    <div className="animate-in">
      <header className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6 mb-6">
        <div className="relative w-40 h-40 flex-shrink-0">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cover}
              alt={RADAR_TITLE}
              className="w-40 h-40 rounded-md object-cover shadow-xl"
            />
          ) : (
            <CoverPlaceholder className="w-40 h-40 rounded-md shadow-xl" />
          )}
          {tracks.length > 0 && (
            <button
              type="button"
              onClick={() => playQueue(tracks, 0, RADAR_TITLE)}
              aria-label="Alle abspielen"
              title="Alle abspielen"
              className="absolute -bottom-3 -right-3 z-10 grid h-12 w-12 place-items-center rounded-full bg-accent text-white shadow-xl shadow-accent/30 transition hover:bg-accent-hover hover:scale-105 press"
            >
              <PlayIcon width={22} height={22} />
            </button>
          )}
        </div>
        <div className="min-w-0 max-w-full">
          <p className="text-xs uppercase tracking-wide text-muted">Playlist</p>
          <h1 className="text-4xl font-extrabold mb-2 truncate">{RADAR_TITLE}</h1>
          <p className="text-muted">
            Neues von Künstler:innen, die du hörst und folgst
          </p>
          <p className="text-sm text-muted mt-1">{tracks.length} Titel</p>
        </div>
      </header>

      {radar.isError && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200"
        >
          Release Radar konnte nicht aktualisiert werden.
          {tracks.length > 0 &&
            " Die zuletzt geladenen Songs bleiben sichtbar."}{" "}
          {radar.error.message}
        </div>
      )}

      {radar.isLoading ? (
        <RowListSkeleton />
      ) : radar.isError && radar.data === undefined ? (
        null
      ) : tracks.length === 0 ? (
        <p className="text-muted">
          Noch keine frischen Releases von deinen Künstler:innen. Folge Artists
          oder höre mehr, dann füllt sich dein Radar.
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
    </div>
  );
}
