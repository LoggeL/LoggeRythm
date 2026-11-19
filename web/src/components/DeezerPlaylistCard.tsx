"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { deezerPlaylistPath } from "@/lib/slugs";
import Cover from "@/components/ui/Cover";
import CardPlayButton from "@/components/CardPlayButton";
import { Morph, useMorphSource } from "@/components/motion/Morph";
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
  const href = deezerPlaylistPath(id);
  const subtitle = `Playlist · ${playlist.track_count} Titel`;
  const morph = useMorphSource(href, { title: playlist.title, cover: playlist.cover, subtitle });

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
        <Morph name={morph.art} part="art">
          <Cover src={playlist.cover} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        </Morph>
        <CardPlayButton label={`${playlist.title} abspielen`} load={load} onPlayed={onPlayed} />
      </div>
      <Morph name={morph.title} part="title">
        <Link href={href} onClick={morph.arm} transitionTypes={morph.types} className={`${styles.link} ${styles.title} block`}>
          {playlist.title}
        </Link>
      </Morph>
      <Morph name={morph.meta} part="meta">
        <p className={styles.subtitle}>{subtitle}</p>
      </Morph>
    </article>
  );
}
