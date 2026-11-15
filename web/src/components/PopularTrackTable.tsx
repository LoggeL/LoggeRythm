"use client";

import type { Track } from "@/types";
import { usePlayerStore } from "@/store/player";
import { useTrackPlays } from "@/hooks/usePlays";
import TrackRow from "@/components/TrackRow";
import { TrackListHeader } from "@/components/TrackList";

/** Ranked track table with an optional Last.fm play-count column. */
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
      <TrackListHeader showPopularity={showPlays} />
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
