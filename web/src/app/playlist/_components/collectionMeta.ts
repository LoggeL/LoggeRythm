import type { Track } from "@/types";

/** "1 Titel" / "12 Titel" — German has no plural form here, but keep one place. */
export function trackCountLabel(count: number): string {
  return `${count} Titel`;
}

/** Total playing time as "43 Min." or "1 Std. 12 Min."; "" when unknown. */
export function totalDurationLabel(tracks: readonly Track[]): string {
  const seconds = tracks.reduce((sum, track) => sum + (track.duration_sec || 0), 0);
  if (seconds <= 0) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} Min.`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} Std.` : `${Math.floor(minutes / 60)} Std. ${rest} Min.`;
}

/** "12 Titel · 43 Min." for a hero's metadata line. */
export function tracksSummary(tracks: readonly Track[]): string {
  return [trackCountLabel(tracks.length), totalDurationLabel(tracks)].filter(Boolean).join(" · ");
}
