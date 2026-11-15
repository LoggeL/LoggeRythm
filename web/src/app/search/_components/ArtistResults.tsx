"use client";

import type { MouseEvent } from "react";
import ArtistCard from "@/components/ArtistCard";
import type { ArtistSummary } from "@/types";
import ResultCards, { type ResultLayout } from "./ResultCards";

export default function ArtistResults({
  artists,
  layout,
  onActivate,
  onPlayed,
}: {
  artists: ArtistSummary[];
  layout: ResultLayout;
  onActivate: (event: MouseEvent<HTMLDivElement>) => void;
  /** The card's own play button started playback. */
  onPlayed: () => void;
}) {
  return (
    <ResultCards label="Künstler" layout={layout}>
      {artists.map((artist) => (
        <div key={String(artist.id)} onClickCapture={onActivate} onAuxClickCapture={onActivate}>
          <ArtistCard artist={artist} onPlayed={onPlayed} />
        </div>
      ))}
    </ResultCards>
  );
}
