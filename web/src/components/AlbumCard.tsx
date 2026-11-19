"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Cover from "@/components/ui/Cover";
import CardPlayButton from "@/components/CardPlayButton";
import { Morph, useMorphSource } from "@/components/motion/Morph";
import type { AlbumSummary } from "@/types";
import styles from "./cards.module.css";

const FIVE_MINUTES = 5 * 60_000;

/** Album tile: artwork, title, "year · artist"; the hover button plays it. */
export default function AlbumCard({ album, onPlayed }: { album: AlbumSummary; /** Playback was started from the card. */ onPlayed?: () => void }) {
  const queryClient = useQueryClient();
  const id = String(album.id);
  const year = album.release_date ? album.release_date.slice(0, 4) : "";
  const href = `/album/${id}`;
  const subtitle = [year, album.artist].filter(Boolean).join(" · ");
  const morph = useMorphSource(href, { title: album.title, cover: album.cover, subtitle });

  async function load() {
    const full = await queryClient.fetchQuery({ queryKey: ["album", id], queryFn: () => api.album(id), staleTime: FIVE_MINUTES });
    return { tracks: full.tracks, context: full.title };
  }

  return (
    <article className={`music-card group ${styles.tile}`}>
      <div className={styles.art}>
        <Morph name={morph.art} part="art">
          <Cover src={album.cover} className="transition-transform duration-300 group-hover:scale-[1.03]" />
        </Morph>
        <CardPlayButton label={`${album.title} abspielen`} load={load} onPlayed={onPlayed} />
      </div>
      <Morph name={morph.title} part="title">
        <Link href={href} onClick={morph.arm} transitionTypes={morph.types} className={`${styles.link} ${styles.title} block`}>
          {album.title}
        </Link>
      </Morph>
      <Morph name={morph.meta} part="meta">
        <p className={styles.subtitle}>{subtitle}</p>
      </Morph>
    </article>
  );
}
