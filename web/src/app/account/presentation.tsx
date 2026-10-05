import styles from "./account.module.css";

export function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("Ungültiger Speicherwert: eine nicht-negative ganze Zahl wird erwartet.");
  }
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.floor(Math.log(bytes) / Math.log(1024));
  if (index >= units.length) throw new Error("Ungültiger Speicherwert: der Wert muss kleiner als 1 PB sein.");
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

export function StatusBadge({ approved }: { approved: boolean }) {
  return (
    <span className={`${styles.statusBadge} ${approved ? styles.statusApproved : styles.statusPending}`}>
      <span className={styles.statusDot} aria-hidden="true" />
      {approved ? "Freigegeben" : "Wartet auf Freigabe"}
    </span>
  );
}
