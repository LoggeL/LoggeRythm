import { layout, spacing } from '../../theme';

/** Edge of the square station tile (personal and genre stations). */
export const RADIO_TILE_WIDTH = layout.artwork.card;
/** Width of the horizontal mood station card; fits a 360dp screen with the next card peeking in. */
export const RADIO_WIDE_WIDTH = layout.artwork.lg * 3 - spacing.md;
/** Height every mood slot reserves so loading, error and content never jump. */
export const RADIO_WIDE_HEIGHT = layout.artwork.lg + spacing.sm * 2;
/** Diameter of the decorative play disc on a station card. */
export const RADIO_PLAY_DISC = layout.artwork.xs;
