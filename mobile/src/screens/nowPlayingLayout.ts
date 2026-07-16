export const NOW_PLAYING_HORIZONTAL_PADDING = 56;
export const NOW_PLAYING_MAX_ARTWORK_SIZE = 440;
export const NOW_PLAYING_SHORT_SCREEN_ARTWORK_FLOOR = 144;
export const NOW_PLAYING_ARTWORK_HEIGHT_FRACTION = 0.42;

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
