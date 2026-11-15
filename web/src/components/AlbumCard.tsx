"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Cover from "@/components/ui/Cover";
import CardPlayButton from "@/components/CardPlayButton";
import type { AlbumSummary } from "@/types";
import styles from "./cards.module.css";

const FIVE_MINUTES = 5 * 60_000;

/** Album tile: artwork, title, "year · artist"; the hover button plays it. */
export default function AlbumCard({ album, onPlayed }: { album: AlbumSummary; /** Playback was started from the card. */ onPlayed?: () => void }) {
  const queryClient = useQueryClient();
  const id = String(album.id);
  const year = album.release_date ? album.release_date.slice(0, 4) : "";

  async function load() {
    const full = await queryClient.fetchQuery({ queryKey: ["album", id], queryFn: () => api.album(id), staleTime: FIVE_MINUTES });
    return { tracks: full.tracks, context: full.title };
  }

  return (
    <article className={`music-card group ${styles.tile}`}>
      <div className={styles.art}>
        <Cover src={album.cover} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        <CardPlayButton label={`${album.title} abspielen`} load={load} onPlayed={onPlayed} />
      </div>
      <Link href={`/album/${id}`} className={`${styles.link} ${styles.title} block`}>
        {album.title}
      </Link>
      <p className={styles.subtitle}>{[year, album.artist].filter(Boolean).join(" · ")}</p>
    </article>
  );
}
