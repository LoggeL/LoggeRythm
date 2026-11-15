"use client";

import type { MouseEvent } from "react";
import TrackRow from "@/components/TrackRow";
import { useTrackPlays } from "@/hooks/usePlays";
import type { Track } from "@/types";

/** Track rows; playing one queues the whole result list from that position. */
export default function TrackResults({
  tracks,
  limit,
  onPlay,
  onActivate,
}: {
  tracks: Track[];
  limit?: number;
  onPlay: (index: number) => void;
  onActivate: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const shown = limit === undefined ? tracks : tracks.slice(0, limit);
  const plays = useTrackPlays(shown);
  return (
    <div className="flex flex-col">
      {shown.map((track, index) => (
        <div key={track.id} onClickCapture={onActivate} onAuxClickCapture={onActivate}>
          <TrackRow track={track} index={index} showPopularity plays={plays[String(track.id)]} onPlay={() => onPlay(index)} />
        </div>
      ))}
    </div>
  );
}
