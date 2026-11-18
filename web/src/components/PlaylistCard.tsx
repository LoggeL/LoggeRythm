"use client";

import Link from "next/link";
import Cover from "@/components/ui/Cover";
import { Morph, useMorphSource } from "@/components/motion/Morph";
import { playlistPath } from "@/lib/slugs";
import type { PlaylistSummary } from "@/types";
import styles from "./cards.module.css";

/** Playlist tile: cover, name and track count, linking to the playlist. */
export default function PlaylistCard({ playlist }: { playlist: PlaylistSummary }) {
  const href = playlistPath(playlist);
  const morph = useMorphSource(href, { title: playlist.name, cover: playlist.cover_url });

  return (
    <article className={`music-card group ${styles.tile}`}>
      <div className={styles.art}>
        <Morph name={morph.art} part="art">
          <Cover src={playlist.cover_url} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        </Morph>
      </div>
      <Morph name={morph.title} part="title">
        <Link href={href} onClick={morph.arm} className={`${styles.link} ${styles.title} block`}>
          {playlist.name}
        </Link>
      </Morph>
      <p className={styles.subtitle}>{playlist.track_count} Titel</p>
    </article>
  );
}
