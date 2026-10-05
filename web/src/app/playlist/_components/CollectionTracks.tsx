import type { ReactNode } from "react";
import styles from "./collection.module.css";

export default function CollectionTracks({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return (
    <section className={styles.tracks} aria-label="Titel">
      <div className={styles.trackHeading}>
        <h2 className="section-heading">Titel</h2>
        <span className={styles.trackCount}>{count}</span>
      </div>
      {children}
    </section>
  );
}
