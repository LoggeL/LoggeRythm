"use client";

import type { MouseEvent } from "react";
import TrackRow from "@/components/TrackRow";
import type { Track } from "@/types";

/**
 * Saved songs matching the typed text. They render on every keystroke, so
 * unlike TrackResults they request no play counts.
 */
export default function LibraryResults({
  tracks,
  onPlay,
  onActivate,
}: {
  tracks: Track[];
  onPlay: (index: number) => void;
  onActivate: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="flex flex-col">
      {tracks.map((track, index) => (
        <div key={track.id} onClickCapture={onActivate} onAuxClickCapture={onActivate}>
          <TrackRow track={track} index={index} onPlay={() => onPlay(index)} />
        </div>
      ))}
    </div>
  );
}
