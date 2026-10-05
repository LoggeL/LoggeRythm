"use client";

import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { useTrackPlays } from "@/hooks/usePlays";
import TrackRow from "@/components/TrackRow";

export default function PopularTrackTable({
  tracks,
  context,
  showPlays = false,
}: {
  tracks: Track[];
  context: string;
  showPlays?: boolean;
}) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const plays = useTrackPlays(showPlays ? tracks : []);

  return (
    <div>
      <div className="hidden sm:grid grid-cols-[2rem_minmax(0,4fr)_minmax(0,3fr)_auto] gap-3 border-b border-border px-3 pb-3 text-xs text-muted">
        <span className="text-center">#</span>
        <span>Titel</span>
        <span>Album</span>
        <span className="w-36" />
      </div>
      {tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          onPlay={() => playQueue(tracks, index, context)}
          showPopularity={showPlays}
          plays={plays[String(track.id)]}
        />
      ))}
    </div>
  );
}
