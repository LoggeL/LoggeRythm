"use client";

import type { MouseEvent } from "react";
import DeezerPlaylistCard from "@/components/DeezerPlaylistCard";
import type { PlaylistSearchResult } from "@/types";
import ResultCards, { type ResultLayout } from "./ResultCards";

/** Playlist search results: a card opens the playlist, its play button starts it. */
export default function PlaylistResults({
  playlists,
  layout,
  onActivate,
  onPlayed,
}: {
  playlists: PlaylistSearchResult[];
  layout: ResultLayout;
  onActivate: (event: MouseEvent<HTMLDivElement>) => void;
  /** The card's own play button started playback. */
  onPlayed: () => void;
}) {
  return (
    <ResultCards label="Playlists" layout={layout}>
      {playlists.map((playlist) => (
        <div key={String(playlist.id)} onClickCapture={onActivate} onAuxClickCapture={onActivate}>
          <DeezerPlaylistCard playlist={playlist} onPlayed={onPlayed} />
        </div>
      ))}
    </ResultCards>
  );
}
