"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCoverColors } from "@/hooks/useCoverColors";
import Cover from "@/components/ui/Cover";
import { HeroMorph, useMorphSeed } from "@/components/motion/Morph";
import collection from "@/app/playlist/_components/collection.module.css";
import styles from "./artist.module.css";

/** Steps the display name down as it gets longer. */
function nameSize(name: string): "lg" | "md" | "sm" {
  const length = name.trim().length;
  if (length <= 12) return "lg";
  if (length <= 24) return "md";
  return "sm";
}

/**
 * Portrait slot of the loading header. Opened from an artist card, it already
 * shows that card's picture, which travels over from the card and stays in
 * place when the artist has loaded.
 */
export function ArtistPortraitPlaceholder() {
  const seed = useMorphSeed();
  return (
    <HeroMorph part="art">
      <div className={styles.portrait}>{seed ? <Cover src={seed.cover} eager /> : <div className="skeleton" />}</div>
    </HeroMorph>
  );
}

/** Name slot of the loading header: the name from the card, or a placeholder bar. */
export function ArtistNamePlaceholder() {
  const seed = useMorphSeed();
  return (
    <HeroMorph part="title">
      {seed ? (
        <h1 className={styles.name} data-size={nameSize(seed.title)} title={seed.title}>
          {seed.title}
        </h1>
      ) : (
        <div className={`${styles.name} skeleton w-3/5 rounded-[var(--radius-card)]`} data-size="md" aria-hidden="true">
          &nbsp;
        </div>
      )}
    </HeroMorph>
  );
}

export interface ArtistFigure {
  value: string;
  label: string;
}

/**
 * Header of the artist page: large portrait, the name in display type, one
 * mono line of figures and the action row (play first, follow last). The
 * portrait tints the wash behind it, like the collection pages.
 */
export default function ArtistHero({ name, picture, figures, actions }: { name: string; picture: string; figures: ArtistFigure[]; actions: ReactNode }) {
  const palette = useCoverColors(picture);
  const tint = palette ? ({ "--hero-tint": palette.rgb.join(" ") } as CSSProperties) : undefined;

  return (
    <header className={styles.hero} style={tint}>
      <div className={collection.wash} data-tinted={palette !== null} aria-hidden="true" />
      <div className={styles.layout}>
        {/* Portrait and name continue from the card this page was opened from. */}
        <HeroMorph part="art">
          <div className={styles.portrait}>
            <Cover src={picture} alt={`Porträt von ${name}`} eager />
          </div>
        </HeroMorph>
        <div className={styles.info}>
          <p className="page-eyebrow">Künstler</p>
          <HeroMorph part="title">
            <h1 className={styles.name} data-size={nameSize(name)} title={name}>
              {name}
            </h1>
          </HeroMorph>
          {figures.length > 0 && (
            <ul className={styles.meta}>
              {figures.map((figure) => (
                <li key={figure.label}>
                  <strong>{figure.value}</strong> {figure.label}
                </li>
              ))}
            </ul>
          )}
          <div className={styles.actions}>{actions}</div>
        </div>
      </div>
    </header>
  );
}
