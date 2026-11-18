"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Cover from "@/components/ui/Cover";
import CardPlayButton from "@/components/CardPlayButton";
import { Morph, useMorphSource } from "@/components/motion/Morph";
import type { ArtistSummary } from "@/types";
import styles from "./cards.module.css";

const FIVE_MINUTES = 5 * 60_000;

/** Artist tile: round portrait and name; the hover button plays the top tracks. */
export default function ArtistCard({ artist, onPlayed }: { artist: ArtistSummary; /** Playback was started from the card. */ onPlayed?: () => void }) {
  const queryClient = useQueryClient();
  const id = String(artist.id);
  const href = `/artist/${id}`;
  const morph = useMorphSource(href, { title: artist.name, cover: artist.picture });

  async function load() {
    const full = await queryClient.fetchQuery({ queryKey: ["artist", id], queryFn: () => api.artist(id), staleTime: FIVE_MINUTES });
    return { tracks: full.top, context: full.name };
  }

  return (
    <article className={`music-card group ${styles.tile}`}>
      <div className="relative">
        <div className={`${styles.art} ${styles.roundArt}`}>
          <Morph name={morph.art} part="art">
            {/* Round on its own: in flight the portrait is no longer clipped by its frame. */}
            <Cover src={artist.picture} className="rounded-full transition-transform duration-300 group-hover:scale-[1.03]" />
          </Morph>
        </div>
        <CardPlayButton label={`${artist.name} abspielen`} load={load} onPlayed={onPlayed} />
      </div>
      <Morph name={morph.title} part="title">
        <Link href={href} onClick={morph.arm} className={`${styles.link} ${styles.title} block`}>
          {artist.name}
        </Link>
      </Morph>
      <p className={styles.subtitle}>Künstler</p>
    </article>
  );
}
