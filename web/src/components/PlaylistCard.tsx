import Link from "next/link";
import Cover from "@/components/ui/Cover";
import { playlistPath } from "@/lib/slugs";
import type { PlaylistSummary } from "@/types";
import styles from "./cards.module.css";

/** Playlist tile: cover, name and track count, linking to the playlist. */
export default function PlaylistCard({ playlist }: { playlist: PlaylistSummary }) {
  return (
    <article className={`music-card group ${styles.tile}`}>
      <div className={styles.art}>
        <Cover src={playlist.cover_url} className="transition-transform duration-300 group-hover:scale-[1.03]" />
      </div>
      <Link href={playlistPath(playlist)} className={`${styles.link} ${styles.title} block`}>
        {playlist.name}
      </Link>
      <p className={styles.subtitle}>{playlist.track_count} Titel</p>
    </article>
  );
}
