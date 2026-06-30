export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const _compact = new Intl.NumberFormat("de-DE", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Compact German number, e.g. 1839543 → "1,8 Mio.". */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  return _compact.format(n);
}
