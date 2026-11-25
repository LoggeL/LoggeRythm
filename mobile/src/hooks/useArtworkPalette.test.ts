import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearArtworkPaletteCache,
  deriveArtworkAmbience,
} from './artworkPaletteModel';

describe('useArtworkPalette helpers', () => {
  beforeEach(() => {
    clearArtworkPaletteCache();
  });

  it('derives contrast-safe ambience colors preferring vibrant/darkMuted with dominant fallback', () => {
    const full = deriveArtworkAmbience({
      vibrant: '#ff4488',
      darkVibrant: '#661133',
      muted: '#998877',
      darkMuted: '#221c24',
      dominant: '#332244',
    });
    expect(full.glowColor).toBe('#ff4488');
    expect(full.surfaceTint).toBe('#221c24');
    expect(full.borderTint).toBe('#998877');

    const fallback = deriveArtworkAmbience({
      vibrant: null,
      darkVibrant: null,
      muted: null,
      darkMuted: null,
      dominant: '#1f2a3c',
    });
    expect(fallback.glowColor).toBe('#1f2a3c');
    expect(fallback.surfaceTint).toBe('#1f2a3c');
    expect(fallback.borderTint).toBe('#1f2a3c');
  });
});
