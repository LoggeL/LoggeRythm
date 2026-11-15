"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Cover from "@/components/ui/Cover";
import CardPlayButton from "@/components/CardPlayButton";
import type { ArtistSummary } from "@/types";
import styles from "./cards.module.css";

const FIVE_MINUTES = 5 * 60_000;

/** Artist tile: round portrait and name; the hover button plays the top tracks. */
export default function ArtistCard({ artist, onPlayed }: { artist: ArtistSummary; /** Playback was started from the card. */ onPlayed?: () => void }) {
  const queryClient = useQueryClient();
  const id = String(artist.id);

  async function load() {
    const full = await queryClient.fetchQuery({ queryKey: ["artist", id], queryFn: () => api.artist(id), staleTime: FIVE_MINUTES });
    return { tracks: full.top, context: full.name };
  }

  return (
    <article className={`music-card group ${styles.tile}`}>
      <div className="relative">
        <div className={`${styles.art} ${styles.roundArt}`}>
          <Cover src={artist.picture} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        </div>
        <CardPlayButton label={`${artist.name} abspielen`} load={load} onPlayed={onPlayed} />
      </div>
      <Link href={`/artist/${id}`} className={`${styles.link} ${styles.title} block`}>
        {artist.name}
      </Link>
      <p className={styles.subtitle}>Künstler</p>
    </article>
  );
}
