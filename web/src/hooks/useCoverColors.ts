"use client";

import { useEffect, useState } from "react";

/** A cover-derived colour palette used to theme the fullscreen player. */
export interface CoverPalette {
  /** Primary vibrant colour as an [r,g,b] triple (for the bass glow). */
  rgb: [number, number, number];
  /** Primary vibrant colour as a CSS ``rgb()`` string. */
  primary: string;
  /** A lighter companion (secondary hue or a tint of the primary). */
  secondary: string;
  /** Three gradient stops (dark → primary → light) for the visualizer. */
  gradient: [string, string, string];
}

// Extracting from an image is mildly expensive; cache per URL so switching tabs
// (or re-opening fullscreen) is instant and stable.
const cache = new Map<string, CoverPalette | null>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

const css = (rgb: [number, number, number]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

/** Quantize the cover into the dominant *vibrant* colour + a companion stop. */
function extractPalette(data: Uint8ClampedArray): CoverPalette | null {
  // 12 hue buckets; accumulate a vibrancy-weighted average colour per bucket.
  const buckets = Array.from({ length: 12 }, () => ({
    weight: 0,
    r: 0,
    g: 0,
    b: 0,
  }));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 200) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < 0.18 || l < 0.12 || l > 0.92) continue; // skip grey / near-black/white
    // Favour saturated mid-tones (the colour a human would name).
    const weight = s * (1 - Math.abs(l - 0.5) * 1.1);
    if (weight <= 0) continue;
    const idx = Math.min(11, Math.floor(h / 30));
    buckets[idx].weight += weight;
    buckets[idx].r += r * weight;
    buckets[idx].g += g * weight;
    buckets[idx].b += b * weight;
  }
  const ranked = buckets
    .map((bk, idx) => ({ idx, ...bk }))
    .filter((bk) => bk.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  if (ranked.length === 0) return null;

  const avg = (bk: (typeof ranked)[number]): [number, number, number] => [
    Math.round(bk.r / bk.weight),
    Math.round(bk.g / bk.weight),
    Math.round(bk.b / bk.weight),
  ];

  // Primary = dominant vibrant bucket, normalized to a punchy saturation.
  const primaryRgb = avg(ranked[0]);
  const [h1, s1Raw, l1Raw] = rgbToHsl(...primaryRgb);
  const s1 = Math.min(1, Math.max(0.55, s1Raw));
  const l1 = Math.min(0.62, Math.max(0.45, l1Raw));
  const primary = hslToRgb(h1, s1, l1);

  // Secondary = next distinct hue if there is one, else a hue-shifted tint.
  const second = ranked.find((bk) => Math.abs(bk.idx - ranked[0].idx) > 1);
  let secondary: [number, number, number];
  if (second) {
    const [h2, s2, l2] = rgbToHsl(...avg(second));
    secondary = hslToRgb(h2, Math.min(1, Math.max(0.55, s2)), Math.min(0.7, Math.max(0.5, l2)));
  } else {
    secondary = hslToRgb((h1 + 40) % 360, s1, Math.min(0.72, l1 + 0.14));
  }

  const dark = hslToRgb(h1, s1, Math.max(0.28, l1 - 0.2));
  const light = hslToRgb(
    rgbToHsl(...secondary)[0],
    Math.min(1, s1),
    Math.min(0.78, l1 + 0.2),
  );

  return {
    rgb: primary,
    primary: css(primary),
    secondary: css(secondary),
    gradient: [css(dark), css(primary), css(light)],
  };
}

/**
 * Derive a colour palette from a cover image (cross-origin canvas sampling).
 * Returns ``null`` until ready, or if the image can't be sampled — callers then
 * fall back to the app's default violet theme.
 */
const cachedFor = (coverUrl: string | undefined | null): CoverPalette | null =>
  coverUrl && cache.has(coverUrl) ? cache.get(coverUrl) ?? null : null;

export function useCoverColors(coverUrl: string | undefined | null): CoverPalette | null {
  const [palette, setPalette] = useState<CoverPalette | null>(() =>
    cachedFor(coverUrl),
  );

  // Reset synchronously during render when the cover changes (React's
  // "storing information from previous renders" pattern — no effect setState).
  const [prevUrl, setPrevUrl] = useState(coverUrl);
  if (prevUrl !== coverUrl) {
    setPrevUrl(coverUrl);
    setPalette(cachedFor(coverUrl));
  }

  useEffect(() => {
    // Synchronous cases (no cover, or already cached) are handled at render.
    if (!coverUrl || cache.has(coverUrl)) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let result: CoverPalette | null = null;
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, size, size);
          result = extractPalette(ctx.getImageData(0, 0, size, size).data);
        }
      } catch {
        result = null; // tainted canvas / CORS — fall back to default theme
      }
      cache.set(coverUrl, result);
      if (!cancelled) setPalette(result);
    };
    img.onerror = () => {
      cache.set(coverUrl, null);
      if (!cancelled) setPalette(null);
    };
    img.src = coverUrl;
    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return palette;
}
