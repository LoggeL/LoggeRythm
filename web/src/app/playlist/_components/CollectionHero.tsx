import type { ReactNode } from "react";
import styles from "./collection.module.css";

/** A consistent, responsive header for music collections and artist pages. */
export default function CollectionHero({
  artwork,
  eyebrow,
  title,
  description,
  metadata,
  actions,
  roundArtwork = false,
}: {
  artwork: ReactNode;
  eyebrow: ReactNode;
  title: string;
  description?: ReactNode;
  metadata?: ReactNode;
  actions?: ReactNode;
  roundArtwork?: boolean;
}) {
  return (
    <header className={styles.hero}>
      <div
        className={`${styles.artwork} group ${roundArtwork ? styles.roundArtwork : ""}`}
      >
        {artwork}
      </div>
      <div className={styles.info}>
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className={`${styles.title} page-title`}>{title}</h1>
        {description && <div className={styles.description}>{description}</div>}
        {metadata && <p className={styles.metadata}>{metadata}</p>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}
