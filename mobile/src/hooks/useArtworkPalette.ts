import { useEffect, useState } from 'react';
import {
  extractArtworkPalette,
  isNativeMethodAvailable,
} from '../player/nativeAudioCraft';
import {
  clearArtworkPaletteCache,
  deriveArtworkAmbience,
  getCachedArtworkPalette,
  setCachedArtworkPalette,
  type ResolvedArtworkAmbience,
} from './artworkPaletteModel';

export { clearArtworkPaletteCache, deriveArtworkAmbience, type ResolvedArtworkAmbience };

/**
 * Extract dynamic Material-style artwork colors via native AndroidX Palette
 * (`NativeModules.LoggeRythmPlayer.extractArtworkPalette`).
 * Never invents placeholder colors when unavailable or failing; returns null
 * so callers retain the canonical Ink/Paper/Signal theme surfaces.
 */
export function useArtworkPalette(uri: string | null | undefined): ResolvedArtworkAmbience | null {
  const normalized = typeof uri === 'string' && uri.trim().length > 0 ? uri.trim() : null;
  const [resolved, setResolved] = useState<{
    uri: string;
    ambience: ResolvedArtworkAmbience;
  } | null>(() => {
    if (normalized === null) return null;
    const cached = getCachedArtworkPalette(normalized);
    return cached !== undefined
      ? { uri: normalized, ambience: deriveArtworkAmbience(cached) }
      : null;
  });

  useEffect(() => {
    if (normalized === null || !isNativeMethodAvailable('extractArtworkPalette')) return;
    const cached = getCachedArtworkPalette(normalized);
    if (cached !== undefined) {
      const ambience = deriveArtworkAmbience(cached);
      const timer = setTimeout(() => {
        setResolved({ uri: normalized, ambience });
      }, 0);
      return () => clearTimeout(timer);
    }

    let cancelled = false;
    void extractArtworkPalette(normalized)
      .then((palette) => {
        setCachedArtworkPalette(normalized, palette);
        if (!cancelled) {
          setResolved({ uri: normalized, ambience: deriveArtworkAmbience(palette) });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          console.error('[LoggeRythm] Failed to extract artwork palette:', cause);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [normalized]);

  if (normalized === null) return null;
  const cachedNow = getCachedArtworkPalette(normalized);
  if (cachedNow !== undefined) return deriveArtworkAmbience(cachedNow);
  if (resolved !== null && resolved.uri === normalized) return resolved.ambience;
  return null;
}
