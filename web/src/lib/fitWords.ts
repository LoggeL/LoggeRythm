/**
 * Display headings are set large and wrap between words. A single word wider
 * than the heading (a long artist name like "Mehnersmoos" in a narrow column)
 * would otherwise be broken mid-word by `overflow-wrap: anywhere`. These
 * helpers find the font size at which every word fits on its own line.
 */

/** The words a heading wraps between (whitespace-separated, empty parts dropped). */
export function headingWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== "");
}

/**
 * Font size (px) at which the widest word fits `availableWidth`.
 * Keeps `naturalSize` when it already fits; never grows the text.
 * `widestWord` is that word's width measured at `naturalSize`.
 */
export function fittedFontSize(naturalSize: number, availableWidth: number, widestWord: number): number {
  for (const [label, value] of [["natural size", naturalSize], ["available width", availableWidth], ["widest word", widestWord]] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`fittedFontSize: ${label} must be a finite, non-negative number, got ${value}`);
    }
  }
  if (naturalSize === 0) throw new RangeError("fittedFontSize: natural size is 0px, the heading has no font size");
  if (widestWord <= availableWidth || widestWord === 0) return naturalSize;
  // Sub-pixel rounding in the browser's line breaking: stay just under the edge.
  return Math.floor(naturalSize * (availableWidth / widestWord) * 0.99 * 100) / 100;
}
