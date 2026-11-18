import { ClockIcon } from "@/components/icons";
import styles from "./trackList.module.css";

/**
 * Sticky column header for a list of TrackRows (# · Titel · Album · Dauer).
 * Pass the same layout flags as the rows below it so the columns line up.
 * Hidden on phones, where rows collapse to cover, title and menu.
 */
export function TrackListHeader({
  showAlbum = true,
  showPopularity = false,
  reorderable = false,
  noteLabel,
}: {
  showAlbum?: boolean;
  showPopularity?: boolean;
  reorderable?: boolean;
  /** Heading of the note column, for lists whose rows carry a `note`. */
  noteLabel?: string;
}) {
  return (
    <div className={styles.header} data-album={showAlbum} data-popularity={showPopularity} data-handle={reorderable} data-note={noteLabel !== undefined} aria-hidden="true">
      <span className={styles.headerIndex}>#</span>
      <span>Titel</span>
      {showAlbum && <span className={styles.headerAlbum}>Album</span>}
      {noteLabel !== undefined && <span className={styles.headerNote}>{noteLabel}</span>}
      <span className={styles.headerDuration} title="Dauer">
        <ClockIcon width={15} height={15} className="ml-auto" />
      </span>
    </div>
  );
}
