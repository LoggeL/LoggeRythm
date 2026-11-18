import type { ReactNode } from "react";
import { TrackListHeader } from "@/components/TrackList";
import styles from "./collection.module.css";

/**
 * The track list of a collection page: an optional heading with the count and
 * a sticky column header above the rows. The column header only appears when
 * there are rows, so loading, empty and error states stand on their own.
 */
export default function CollectionTracks({
  count,
  title,
  showAlbum = true,
  reorderable = false,
  noteLabel,
  children,
}: {
  count: number;
  /** Visible heading, for pages where the list is one section among several. */
  title?: string;
  showAlbum?: boolean;
  /** The rows carry a drag handle (see SortableTracks). */
  reorderable?: boolean;
  /** Heading of the note column, when the rows carry a `note` (see TrackRow). */
  noteLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.tracks} data-notes={noteLabel !== undefined} aria-label={title ?? "Titel"}>
      {title && (
        <div className={styles.trackHeading}>
          <h2>{title}</h2>
          <span className={styles.trackCount}>{count}</span>
        </div>
      )}
      {count > 0 && <TrackListHeader showAlbum={showAlbum} reorderable={reorderable} noteLabel={noteLabel} />}
      {children}
    </section>
  );
}
