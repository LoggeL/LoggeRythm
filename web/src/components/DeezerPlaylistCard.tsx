"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { deezerPlaylistPath } from "@/lib/slugs";
import Cover from "@/components/ui/Cover";
import CardPlayButton from "@/components/CardPlayButton";
import type { PlaylistSearchResult } from "@/types";
import styles from "./cards.module.css";

const FIVE_MINUTES = 5 * 60_000;

/** Deezer playlist tile: the title opens the playlist, the hover button plays it. */
export default function DeezerPlaylistCard({
  playlist,
  onPlayed,
}: {
  playlist: PlaylistSearchResult;
  /** Playback was started from the card. */
  onPlayed?: () => void;
}) {
  const queryClient = useQueryClient();
  const id = String(playlist.id);

  async function load() {
    const full = await queryClient.fetchQuery({
      queryKey: ["deezer-playlist", id],
      queryFn: () => api.deezerPlaylist(id),
      staleTime: FIVE_MINUTES,
    });
    return { tracks: full.tracks, context: full.name };
  }

  return (
    <article className={`music-card group ${styles.tile}`}>
      <div className={styles.art}>
        <Cover src={playlist.cover} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        <CardPlayButton label={`${playlist.title} abspielen`} load={load} onPlayed={onPlayed} />
      </div>
      <Link href={deezerPlaylistPath(id)} className={`${styles.link} ${styles.title} block`}>
        {playlist.title}
      </Link>
      <p className={styles.subtitle}>Playlist · {playlist.track_count} Titel</p>
    </article>
  );
}
