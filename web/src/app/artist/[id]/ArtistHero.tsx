"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCoverColors } from "@/hooks/useCoverColors";
import Cover from "@/components/ui/Cover";
import collection from "@/app/playlist/_components/collection.module.css";
import styles from "./artist.module.css";

/** Steps the display name down as it gets longer. */
function nameSize(name: string): "lg" | "md" | "sm" {
  const length = name.trim().length;
  if (length <= 12) return "lg";
  if (length <= 24) return "md";
  return "sm";
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
        <div className={styles.portrait}>
          <Cover src={picture} alt={`Porträt von ${name}`} eager />
        </div>
        <div className={styles.info}>
          <p className="page-eyebrow">Künstler</p>
          <h1 className={styles.name} data-size={nameSize(name)} title={name}>
            {name}
          </h1>
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
