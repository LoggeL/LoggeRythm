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

/**
 * Relative German release date, e.g. "heute", "gestern", "vor 5 Tagen",
 * "vor 3 Wochen". Expects an ISO date (YYYY-MM-DD); returns "" if unparseable.
 */
export function formatRelativeDate(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  if (days < 14) return "vor 1 Woche";
  if (days < 31) return `vor ${Math.floor(days / 7)} Wochen`;
  if (days < 61) return "vor 1 Monat";
  return `vor ${Math.floor(days / 30)} Monaten`;
}
