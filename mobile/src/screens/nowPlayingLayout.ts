export const NOW_PLAYING_HORIZONTAL_PADDING = 56;
export const NOW_PLAYING_MAX_ARTWORK_SIZE = 440;
export const NOW_PLAYING_SHORT_SCREEN_ARTWORK_FLOOR = 144;
export const NOW_PLAYING_ARTWORK_HEIGHT_FRACTION = 0.42;
export const NOW_PLAYING_TV_MAX_ARTWORK_SIZE = 280;
export const NOW_PLAYING_TV_MIN_ARTWORK_SIZE = 112;
const NOW_PLAYING_TV_CHROME_RESERVE = 330;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Bound the square cover by both viewport axes.
 *
 * Width wins on portrait phones; short landscape windows use a smaller cover
 * and the Playing owner scrolls the remaining metadata/transport controls.
 */
export function nowPlayingArtworkSize(
  windowWidth: number,
  windowHeight: number,
): number {
  const widthBound = Math.max(
    0,
    finiteNonNegative(windowWidth) - NOW_PLAYING_HORIZONTAL_PADDING,
  );
  const heightPreference = Math.max(
    NOW_PLAYING_SHORT_SCREEN_ARTWORK_FLOOR,
    finiteNonNegative(windowHeight) * NOW_PLAYING_ARTWORK_HEIGHT_FRACTION,
  );
  return Math.min(NOW_PLAYING_MAX_ARTWORK_SIZE, widthBound, heightPreference);
}

/**
 * Bound the square cover inside the left column of the 16:9 Android TV split
 * player so artwork, metadata, and full transport controls fit comfortably
 * without scrolling inside the TV content area (already inset for overscan by
 * `TvShellLayout`).
 */
export function nowPlayingTvArtworkSize(
  contentWidth: number,
  contentHeight: number,
  splitPrimaryRatio = 0.43,
): number {
  const safeWidth = finiteNonNegative(contentWidth);
  const safeHeight = finiteNonNegative(contentHeight);
  if (safeWidth === 0 || safeHeight === 0) return 0;
  const columnWidthBound = Math.max(0, safeWidth * splitPrimaryRatio - 56);
  const heightBound = Math.max(
    0,
    Math.min(safeHeight * 0.32, safeHeight - NOW_PLAYING_TV_CHROME_RESERVE),
  );
  const bounded = Math.min(NOW_PLAYING_TV_MAX_ARTWORK_SIZE, columnWidthBound, heightBound);
  return Math.max(
    Math.min(NOW_PLAYING_TV_MIN_ARTWORK_SIZE, columnWidthBound, heightBound),
    Math.floor(bounded),
  );
}
