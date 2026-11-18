"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCoverColors } from "@/hooks/useCoverColors";
import { HeroMorph } from "@/components/motion/Morph";
import styles from "./collection.module.css";

/** Steps the display title down as it gets longer, so it never dominates. */
function titleSize(title: string): "lg" | "md" | "sm" | "xs" {
  const length = title.trim().length;
  if (length <= 16) return "lg";
  if (length <= 30) return "md";
  if (length <= 56) return "sm";
  return "xs";
}

/**
 * Header shared by every collection page (playlist, album, artist, mix, radar,
 * profile): artwork, eyebrow, display title, one quiet metadata line and a
 * single action row. `coverUrl` tints the wash behind it with the artwork's
 * colour; without one it follows the ambient colour of the playing track.
 */
export default function CollectionHero({
  artwork,
  coverUrl,
  eyebrow,
  title,
  description,
  metadata,
  actions,
  roundArtwork = false,
  clampDescription = true,
}: {
  artwork: ReactNode;
  /** Image the colour wash is derived from (usually the artwork's source). */
  coverUrl?: string | null;
  eyebrow: ReactNode;
  title: string;
  description?: ReactNode;
  metadata?: ReactNode;
  /** Play button first, then icon actions, overflow menu last. */
  actions?: ReactNode;
  roundArtwork?: boolean;
  /** Cut the description after two lines. Off for text that must be read in full. */
  clampDescription?: boolean;
}) {
  const palette = useCoverColors(coverUrl);
  const tint = palette ? ({ "--hero-tint": palette.rgb.join(" ") } as CSSProperties) : undefined;

  return (
    <header className={styles.hero} style={tint}>
      <div className={styles.wash} data-tinted={palette !== null} aria-hidden="true" />
      {/* Artwork and title continue from the card this page was opened from. */}
      <HeroMorph part="art">
        <div className={`${styles.artwork} group ${roundArtwork ? styles.roundArtwork : ""}`}>{artwork}</div>
      </HeroMorph>
      <div className={styles.info}>
        <p className="page-eyebrow">{eyebrow}</p>
        <HeroMorph part="title">
          <h1 className={styles.title} data-size={titleSize(title)} title={title}>
            {title}
          </h1>
        </HeroMorph>
        {description && <div className={styles.description} data-clamp={clampDescription}>{description}</div>}
        {metadata && <p className={styles.metadata}>{metadata}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
