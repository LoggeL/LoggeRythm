"use client";

import Link from "next/link";
import type { HomeShelf } from "@/types";
import { usePlayerStore } from "@/store/player";
import { PlayIcon, ChevronRightIcon, MusicNoteIcon } from "@/components/icons";
import CardPlayButton from "@/components/CardPlayButton";
import styles from "./cards.module.css";

const THEMES = ["gradient-violet", "gradient-blue", "gradient-teal", "gradient-orange"];
const TAGS: Record<string, string> = { weekly: "Dein Mix", chill: "Entspannt", discover: "Neue Entdeckungen", "release-radar": "Release Radar" };

/**
 * A generated collection (mix, radar, genre shelf). With `href` the tile opens
 * the collection and its play button starts it; without, the tile itself plays.
 * `variant="hero"` is the wide text-led banner, `"collection"` the cover tile.
 */
export default function ShelfCard({ shelf, index = 0, variant = "collection", href, highlighted = false, statusBadge }: {
  shelf: HomeShelf;
  index?: number;
  variant?: "hero" | "collection";
  href?: string;
  highlighted?: boolean;
  statusBadge?: string;
}) {
  const playQueue = usePlayerStore((state) => state.playQueue);
  const cover = shelf.cover || shelf.tracks.find((track) => track.cover)?.cover;
  const empty = shelf.tracks.length === 0;
  const play = () => playQueue(shelf.tracks, 0, shelf.title);
  const art = cover ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
  ) : (
    <div className={`grid h-full w-full place-items-center ${THEMES[index % THEMES.length]}`}><MusicNoteIcon width={44} height={44} className="text-foreground/50" aria-hidden="true" /></div>
  );
  const badge = statusBadge && <span className="absolute left-2 top-2 z-[1] rounded-[3px] bg-accent px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-on-accent">{statusBadge}</span>;
  const linkLabel = statusBadge ? `${shelf.title}, ${statusBadge}` : shelf.title;
  const subtitle = shelf.subtitle || `${shelf.tracks.length} Titel`;

  if (variant === "hero") {
    const className = `group surface-card relative flex min-h-40 w-full items-center gap-4 overflow-hidden p-5 text-left transition-colors hover:bg-panel-hover ${highlighted ? "new-content-highlight" : ""}`;
    const contents = (
      <>
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow mb-2">{TAGS[shelf.key] || "Für dich"}</p>
          <h3 className="text-lg font-semibold leading-tight tracking-tight">{shelf.title}</h3>
          {shelf.subtitle && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{shelf.subtitle}</p>}
          <span className="mt-3 inline-flex items-center gap-2 text-xs text-muted">{shelf.tracks.length} Titel {href ? <ChevronRightIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}</span>
        </div>
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg shadow-lg sm:h-28 sm:w-28">{art}</div>
        {statusBadge && <span className="absolute right-3 top-3 z-[1] rounded-[3px] bg-accent px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-on-accent">{statusBadge}</span>}
      </>
    );
    return href ? (
      <Link href={href} className={className} aria-label={linkLabel}>{contents}</Link>
    ) : (
      <button type="button" onClick={play} disabled={empty} className={`${className} disabled:opacity-50`} aria-label={`${shelf.title} abspielen`}>{contents}</button>
    );
  }

  return (
    <article className={`music-card group w-full ${styles.tile} ${highlighted ? "new-content-highlight" : ""} ${!href && empty ? "opacity-50" : ""}`}>
      <div className={styles.art}>
        {art}
        {badge}
        {href ? (
          !empty && <CardPlayButton label={`${shelf.title} abspielen`} load={() => ({ tracks: shelf.tracks, context: shelf.title })} />
        ) : (
          <span aria-hidden="true" className={`${styles.fab} pointer-events-none`}>
            <span className="play-fab h-11 w-11"><PlayIcon width={22} height={22} /></span>
          </span>
        )}
      </div>
      {href ? (
        <Link href={href} aria-label={linkLabel} className={`${styles.link} ${styles.title} block`}>{shelf.title}</Link>
      ) : (
        <button type="button" onClick={play} disabled={empty} aria-label={`${shelf.title} abspielen`} className={`${styles.link} ${styles.title} block w-full text-left`}>{shelf.title}</button>
      )}
      <p className={styles.subtitle}>{subtitle}</p>
    </article>
  );
}
