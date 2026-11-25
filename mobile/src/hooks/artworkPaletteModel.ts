import type { ArtworkPaletteResult } from '../../modules/loggerythm-player/src';

const MAX_PALETTE_CACHE = 48;
const paletteCache = new Map<string, ArtworkPaletteResult>();

export interface ResolvedArtworkAmbience {
  readonly palette: ArtworkPaletteResult;
  readonly glowColor: string;
  readonly surfaceTint: string;
  readonly borderTint: string;
}

export function getCachedArtworkPalette(uri: string): ArtworkPaletteResult | undefined {
  return paletteCache.get(uri);
}

export function setCachedArtworkPalette(uri: string, palette: ArtworkPaletteResult): void {
  if (paletteCache.has(uri)) paletteCache.delete(uri);
  paletteCache.set(uri, palette);
  if (paletteCache.size > MAX_PALETTE_CACHE) {
    const oldest = paletteCache.keys().next().value;
    if (oldest !== undefined) paletteCache.delete(oldest);
  }
}

export function deriveArtworkAmbience(palette: ArtworkPaletteResult): ResolvedArtworkAmbience {
  const glowColor = palette.vibrant ?? palette.dominant;
  const surfaceTint = palette.darkMuted ?? palette.darkVibrant ?? palette.dominant;
  const borderTint = palette.muted ?? palette.vibrant ?? palette.dominant;
  return Object.freeze({
    palette,
    glowColor,
    surfaceTint,
    borderTint,
  });
}

/** Clear cached artwork palettes on account boundary transitions (logout / account switch). */
export function clearArtworkPaletteCache(): void {
  paletteCache.clear();
}
