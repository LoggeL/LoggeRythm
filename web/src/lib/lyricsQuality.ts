import type { LyricsLine } from "@/types";

// Heuristics for spotting broken provider (lrclib) lyrics — wrong track match,
// shifted or garbage timestamps. When one fires, the UI auto-prefers the
// Whisper transcription; the user can always toggle back.
const MAX_LINE_GAP_SECONDS = 45;
const END_OVERSHOOT_SECONDS = 3;
const CLUMP_MIN_LINES = 4;
const MIN_COVERAGE_LINES = 10;
const MIN_COVERAGE_RATIO = 0.25;

/**
 * Return a human-readable reason why these synced lyrics look wrong for a
 * track of `durationSec` seconds, or null when they look plausible.
 * Duration-based checks are skipped while the duration is unknown (0).
 */
export function findLyricsSuspicion(
  lines: LyricsLine[],
  durationSec: number,
): string | null {
  if (lines.length < 2) return null;

  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].t - lines[i - 1].t;
    if (gap > MAX_LINE_GAP_SECONDS) {
      return `${Math.round(gap)}s Sprung zwischen zwei Zeilen`;
    }
  }

  const first = lines[0].t;
  const last = lines[lines.length - 1].t;
  if (durationSec > 0 && last > durationSec + END_OVERSHOOT_SECONDS) {
    return "Zeitstempel hinter dem Songende";
  }

  let run = 1;
  for (let i = 1; i < lines.length; i++) {
    run = lines[i].t === lines[i - 1].t ? run + 1 : 1;
    if (run >= CLUMP_MIN_LINES) {
      return "mehrere Zeilen mit identischem Zeitstempel";
    }
  }

  if (
    durationSec > 0 &&
    lines.length >= MIN_COVERAGE_LINES &&
    last - first < durationSec * MIN_COVERAGE_RATIO
  ) {
    return "Songtext deckt nur einen kleinen Teil des Songs ab";
  }

  return null;
}
