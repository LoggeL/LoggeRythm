"use client";

import type { MouseEvent } from "react";
import AlbumCard from "@/components/AlbumCard";
import type { Track } from "@/types";
import ResultCards, { type ResultLayout } from "./ResultCards";

/** Album search answers with one representative track per album. */
export default function AlbumResults({
  albums,
  layout,
  onActivate,
  onPlayed,
}: {
  albums: Track[];
  layout: ResultLayout;
  onActivate: (event: MouseEvent<HTMLDivElement>) => void;
  /** The card's own play button started playback. */
  onPlayed: () => void;
}) {
  return (
    <ResultCards label="Alben" layout={layout}>
      {albums.map((album) => (
        <div key={String(album.album_id || album.id)} onClickCapture={onActivate} onAuxClickCapture={onActivate}>
          <AlbumCard album={{ id: album.album_id || album.id, title: album.album || album.title, artist: album.artist, cover: album.cover }} onPlayed={onPlayed} />
        </div>
      ))}
    </ResultCards>
  );
}
