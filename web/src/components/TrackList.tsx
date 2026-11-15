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
}: {
  showAlbum?: boolean;
  showPopularity?: boolean;
  reorderable?: boolean;
}) {
  return (
    <div className={styles.header} data-album={showAlbum} data-popularity={showPopularity} data-handle={reorderable} aria-hidden="true">
      <span className={styles.headerIndex}>#</span>
      <span>Titel</span>
      {showAlbum && <span className={styles.headerAlbum}>Album</span>}
      <span className={styles.headerDuration} title="Dauer">
        <ClockIcon width={15} height={15} className="ml-auto" />
      </span>
    </div>
  );
}
