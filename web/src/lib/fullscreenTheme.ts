import type { CSSProperties } from "react";
import type { CoverPalette } from "../hooks/useCoverColors";

type Rgb = readonly [number, number, number];
export type FullscreenTheme = CSSProperties & Record<`--${string}`, string>;

const DARK_FOREGROUND: Rgb = [11, 12, 16];
const LIGHT_FOREGROUND: Rgb = [245, 245, 247];
const PANEL: Rgb = [21, 23, 30];
const MIN_CONTRAST = 4.5;
const SOFT_CONTRAST = 7;

function validateRgb(rgb: Rgb): void {
  if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
    throw new RangeError("Fullscreen colour requires three integer RGB channels between 0 and 255.");
  }
}

/** WCAG relative luminance, calculated in linear sRGB rather than byte space. */
export function relativeLuminance(rgb: Rgb): number {
  validateRgb(rgb);
  const linear = rgb.map((channel) => {
    const component = channel / 255;
    return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function rgbToHsl(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness];
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return [hue, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  const values = hue < 60 ? [chroma, secondary, 0]
    : hue < 120 ? [secondary, chroma, 0]
      : hue < 180 ? [0, chroma, secondary]
        : hue < 240 ? [0, secondary, chroma]
          : hue < 300 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  return values.map((channel) => Math.round((channel + offset) * 255)) as unknown as Rgb;
}

const cssRgb = (rgb: Rgb): string => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

function foregroundFor(background: Rgb): { rgb: Rgb; dark: boolean } {
  const dark = contrastRatio(background, DARK_FOREGROUND) >= contrastRatio(background, LIGHT_FOREGROUND);
  const initial = dark ? DARK_FOREGROUND : LIGHT_FOREGROUND;
  if (contrastRatio(background, initial) >= MIN_CONTRAST) return { rgb: initial, dark };

  // Some mid-tone colours cannot reach 4.5 with either off-white or charcoal.
  // Move only the foreground toward black/white, preserving the exact cover.
  const extreme = dark ? 0 : 255;
  for (let step = 1; step <= 255; step += 1) {
    const rgb = initial.map((channel) => Math.round(channel + (extreme - channel) * step / 255)) as unknown as Rgb;
    if (contrastRatio(background, rgb) >= MIN_CONTRAST) return { rgb, dark };
  }
  throw new Error("Fullscreen cover colour could not produce a readable foreground.");
}

function readableTint(rgb: Rgb, hue: number, saturation: number, lightness: number): Rgb {
  if (contrastRatio(rgb, PANEL) >= SOFT_CONTRAST) return rgb;
  let low = lightness;
  let high = 1;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const middle = (low + high) / 2;
    if (contrastRatio(hslToRgb(hue, saturation, middle), PANEL) >= SOFT_CONTRAST) high = middle;
    else low = middle;
  }
  return hslToRgb(hue, saturation, high);
}

/** Cover-scoped accents; an unresolved palette inherits the existing theme. */
export function fullscreenTheme(palette: Pick<CoverPalette, "rgb"> | Rgb | null): FullscreenTheme {
  if (palette === null) return {};
  if (typeof palette !== "object") {
    throw new TypeError("Fullscreen theme requires an RGB palette, an RGB tuple, or null.");
  }
  const rgb = "rgb" in palette ? palette.rgb : palette;
  validateRgb(rgb);
  const [hue, saturation, lightness] = rgbToHsl(rgb);
  const foreground = foregroundFor(rgb);
  const hoverLightness = foreground.dark ? lightness + (1 - lightness) * 0.12 : lightness * 0.88;
  const hover = hslToRgb(hue, saturation, hoverLightness);
  const soft = readableTint(rgb, hue, saturation, lightness);
  return {
    "--accent": cssRgb(rgb),
    "--accent-solid": cssRgb(rgb),
    "--accent-hover": cssRgb(hover),
    "--accent-soft": cssRgb(soft),
    "--on-accent": cssRgb(foreground.rgb),
    "--cover-primary-rgb": rgb.join(" "),
  };
}
