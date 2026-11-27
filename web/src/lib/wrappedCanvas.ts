/**
 * High-resolution Canvas 2D share-card rendering engine for LoggeRythm Wrapped.
 *
 * Supports 2 crisp formats (`story` 1080x1920, `square` 1080x1080), 5 themes,
 * and 7 bespoke editorial templates aligned with LoggeRythm's "Ink, Paper, Signal"
 * design language and 4x4 step-sequencer emblem.
 */

import {
  WRAPPED_RANGES,
  buildCoverThemePalette,
  getWrappedThemeById,
  parseHexRgb,
  pickReadableInk,
  wrappedArtworkProxyUrl,
  type WrappedAura,
  type WrappedCardOptions,
  type WrappedEmblemId,
  type WrappedFormat,
  type WrappedRankedItem,
  type WrappedReport,
  type WrappedThemeId,
  type WrappedThemePalette,
} from "@/lib/wrapped";

export interface WrappedAssets {
  images: Map<string, HTMLImageElement>;
  failedUrls: string[];
  coverPalette: WrappedThemePalette | null;
}

export interface SafeCardMetrics {
  width: 1080;
  height: 1920 | 1080;
  padX: number;
  headerTop: number;
  headerHeight: number;
  bodyTop: number;
  bodyBottom: number;
  bodyHeight: number;
  footerTop: number;
  innerWidth: number;
}

interface CanvasFontStack {
  display: string;
  sans: string;
  mono: string;
}

const WEEKDAYS_SHORT = ["MO", "DI", "MI", "DO", "FR", "SA", "SO"] as const;
const WEEKDAYS_LONG = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
] as const;

const MONOGRAM_GRADIENTS: readonly [string, string][] = [
  ["#4a5a16", "#1b200c"],
  ["#5945a0", "#2c2648"],
  ["#874d72", "#35263c"],
  ["#415c65", "#202c3b"],
  ["#36665d", "#1b2f37"],
  ["#986341", "#402c2d"],
  ["#3c5684", "#212b40"],
  ["#864653", "#3a2634"],
  ["#407353", "#1e332a"],
];

// Matching web/public/Logo.svg (256x256 coordinate system)
const LOGO_SQUARES: readonly [number, number][] = [
  [38, 38],
  [38, 86],
  [38, 134],
  [38, 182],
  [86, 182],
  [134, 182],
  [182, 182],
  [134, 86],
];

const LOGO_DOTS: readonly [number, number][] = [
  [104, 56],
  [152, 56],
  [200, 56],
  [104, 104],
  [200, 104],
  [104, 152],
  [152, 152],
  [200, 152],
];

let cachedGrainCanvas: HTMLCanvasElement | null = null;

export function getWrappedCanvasDimensions(format: WrappedFormat): {
  width: 1080;
  height: 1920 | 1080;
} {
  if (format === "story") return { width: 1080, height: 1920 };
  if (format === "square") return { width: 1080, height: 1080 };
  throw new Error(`Unbekanntes Kartenformat: ${JSON.stringify(format)}.`);
}

export function computeSafeCardMetrics(format: WrappedFormat): SafeCardMetrics {
  const { width, height } = getWrappedCanvasDimensions(format);
  if (format === "story") {
    const padX = 72;
    const headerTop = 58;
    const headerHeight = 84;
    const bodyTop = 176;
    const bodyBottom = 1776;
    const footerTop = 1806;
    return {
      width,
      height,
      padX,
      headerTop,
      headerHeight,
      bodyTop,
      bodyBottom,
      bodyHeight: bodyBottom - bodyTop,
      footerTop,
      innerWidth: width - padX * 2,
    };
  }
  const padX = 64;
  const headerTop = 44;
  const headerHeight = 72;
  const bodyTop = 140;
  const bodyBottom = 972;
  const footerTop = 994;
  return {
    width,
    height,
    padX,
    headerTop,
    headerHeight,
    bodyTop,
    bodyBottom,
    bodyHeight: bodyBottom - bodyTop,
    footerTop,
    innerWidth: width - padX * 2,
  };
}

export function truncateTextWithEllipsis(
  text: string,
  maxWidth: number,
  measureWidth: (candidate: string) => number,
): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (maxWidth <= 0 || normalized.length === 0) return "";
  if (measureWidth(normalized) <= maxWidth) return normalized;
  const ellipsis = "…";
  if (measureWidth(ellipsis) > maxWidth) return "";
  let low = 0;
  let high = normalized.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${normalized.slice(0, mid).trimEnd()}${ellipsis}`;
    if (measureWidth(candidate) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low === 0 ? ellipsis : `${normalized.slice(0, low).trimEnd()}${ellipsis}`;
}

export function wrapTextLines(
  text: string,
  maxWidth: number,
  maxLines: number,
  measureWidth: (candidate: string) => number,
): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (maxWidth <= 0 || maxLines <= 0 || normalized.length === 0) return [];
  if (measureWidth(normalized) <= maxWidth) return [normalized];

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  let index = 0;

  while (index < words.length) {
    const word = words[index];
    const isLastAllowed = lines.length === maxLines - 1;

    if (!current) {
      if (measureWidth(word) <= maxWidth) {
        current = word;
        index += 1;
      } else if (isLastAllowed) {
        const rest = words.slice(index).join(" ");
        lines.push(truncateTextWithEllipsis(rest, maxWidth, measureWidth));
        return lines;
      } else {
        // Hard-break single long token cleanly across lines.
        let cut = 1;
        while (cut < word.length && measureWidth(word.slice(0, cut + 1)) <= maxWidth) {
          cut += 1;
        }
        lines.push(word.slice(0, cut));
        words[index] = word.slice(cut);
      }
      continue;
    }

    const candidate = `${current} ${word}`;
    if (measureWidth(candidate) <= maxWidth) {
      current = candidate;
      index += 1;
    } else if (isLastAllowed) {
      const remaining = `${current} ${words.slice(index).join(" ")}`;
      lines.push(truncateTextWithEllipsis(remaining, maxWidth, measureWidth));
      return lines;
    } else {
      lines.push(current);
      current = "";
    }
  }

  if (current) {
    lines.push(truncateTextWithEllipsis(current, maxWidth, measureWidth));
  }
  return lines.slice(0, maxLines);
}

export function getInitials(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return "LR";
  const parts = clean.split(" ").filter((p) => p.length > 0);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, Math.min(2, clean.length)).toUpperCase();
}

export function formatWrappedDurationHours(seconds: number): { value: string; unit: string } {
  if (!Number.isFinite(seconds) || seconds < 0) return { value: "0", unit: "Std." };
  if (seconds < 60) return { value: String(Math.round(seconds)), unit: "Sek." };
  if (seconds < 3600) return { value: String(Math.round(seconds / 60)), unit: "Min." };
  const hours = seconds / 3600;
  return {
    value: hours.toLocaleString("de-DE", { maximumFractionDigits: hours >= 100 ? 0 : 1 }),
    unit: "Std.",
  };
}

export function formatMmSs(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function resolveCardPalette(
  themeId: WrappedThemeId,
  coverPalette: WrappedThemePalette | null,
  reportAura?: WrappedAura | null,
): WrappedThemePalette {
  const theme = getWrappedThemeById(themeId);
  if (themeId !== "cover") {
    return theme.palette;
  }
  if (coverPalette) {
    return coverPalette;
  }
  if (reportAura && reportAura.colors.length === 3) {
    return buildCoverThemePalette(parseHexRgb(reportAura.colors[0]), theme.palette);
  }
  return theme.palette;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rgbToHslQuick(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function extractDominantRgbFromImage(img: HTMLImageElement): [number, number, number] {
  const size = 32;
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = size;
  sampleCanvas.height = size;
  const ctx = sampleCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D-Kontext für Cover-Farbanalyse nicht verfügbar.");
  }
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  const buckets = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 180) continue;
    totalR += r;
    totalG += g;
    totalB += b;
    totalCount += 1;

    const [h, s, l] = rgbToHslQuick(r, g, b);
    if (s < 0.16 || l < 0.1 || l > 0.92) continue;
    const weight = s * (1 - Math.abs(l - 0.5) * 1.1);
    if (weight <= 0) continue;
    const bucketIdx = Math.min(11, Math.floor(h / 30));
    buckets[bucketIdx].weight += weight;
    buckets[bucketIdx].r += r * weight;
    buckets[bucketIdx].g += g * weight;
    buckets[bucketIdx].b += b * weight;
  }

  const ranked = buckets.filter((bk) => bk.weight > 0).sort((a, b) => b.weight - a.weight);
  if (ranked.length > 0) {
    const top = ranked[0];
    return [
      Math.round(top.r / top.weight),
      Math.round(top.g / top.weight),
      Math.round(top.b / top.weight),
    ];
  }
  if (totalCount > 0) {
    return [
      Math.round(totalR / totalCount),
      Math.round(totalG / totalCount),
      Math.round(totalB / totalCount),
    ];
  }
  return [214, 255, 75];
}

function loadProxiedImage(rawUrl: string): Promise<HTMLImageElement> {
  const proxyUrl = wrappedArtworkProxyUrl(rawUrl);
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        reject(new Error(`Leeres Cover-Bild für ${rawUrl}`));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error(`Cover konnte nicht geladen werden: ${rawUrl}`));
    };
    img.src = proxyUrl;
  });
}

export async function loadWrappedAssets(report: WrappedReport): Promise<WrappedAssets> {
  if (!report || typeof report !== "object" || !report.totals) {
    throw new Error("Wrapped-Bericht für Asset-Laden ist ungültig.");
  }
  if (typeof Image === "undefined" || typeof document === "undefined") {
    throw new Error("Asset-Laden erfordert eine Browser-Umgebung.");
  }

  const uniqueUrls = new Set<string>();
  const addUrl = (candidate: string | null | undefined) => {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      uniqueUrls.add(candidate.trim());
    }
  };

  addUrl(report.user.avatar_url);
  addUrl(report.obsession?.cover);
  addUrl(report.peak_day?.top_track_cover);
  for (const item of report.top_tracks.slice(0, 5)) addUrl(item.cover);
  for (const item of report.top_artists.slice(0, 5)) addUrl(item.cover);
  for (const item of report.top_albums.slice(0, 3)) addUrl(item.cover);

  const images = new Map<string, HTMLImageElement>();
  const failedUrls: string[] = [];

  const urls = Array.from(uniqueUrls);
  const results = await Promise.allSettled(urls.map((url) => loadProxiedImage(url)));
  results.forEach((outcome, idx) => {
    const url = urls[idx];
    if (outcome.status === "fulfilled") {
      images.set(url, outcome.value);
    } else {
      failedUrls.push(url);
    }
  });

  const paletteCandidates = [
    report.top_tracks[0]?.cover,
    report.obsession?.cover,
    report.top_artists[0]?.cover,
    report.top_albums[0]?.cover,
    report.peak_day?.top_track_cover,
  ].filter((c): c is string => typeof c === "string" && c.trim().length > 0);

  let coverPalette: WrappedThemePalette | null = null;
  for (const candidate of paletteCandidates) {
    const loaded = images.get(candidate.trim());
    if (!loaded) continue;
    try {
      const dominantRgb = extractDominantRgbFromImage(loaded);
      coverPalette = buildCoverThemePalette(dominantRgb);
      break;
    } catch {
      // Remove tainted/unreadable image so PNG canvas export cannot fail silently later.
      images.delete(candidate.trim());
      if (!failedUrls.includes(candidate.trim())) {
        failedUrls.push(candidate.trim());
      }
    }
  }

  return { images, failedUrls, coverPalette };
}

function resolveCanvasFonts(): CanvasFontStack {
  if (typeof window !== "undefined" && typeof document !== "undefined" && document.body) {
    const style = window.getComputedStyle(document.body);
    const display = style.getPropertyValue("--font-display-face").trim();
    const sans = style.getPropertyValue("--font-geist-sans").trim();
    const mono = style.getPropertyValue("--font-geist-mono").trim();
    return {
      display: display
        ? `${display}, "Bricolage Grotesque", system-ui, sans-serif`
        : `"Bricolage Grotesque", system-ui, sans-serif`,
      sans: sans ? `${sans}, "Geist", system-ui, sans-serif` : `"Geist", system-ui, sans-serif`,
      mono: mono ? `${mono}, "Geist Mono", ui-monospace, monospace` : `"Geist Mono", ui-monospace, monospace`,
    };
  }
  return {
    display: `"Bricolage Grotesque", system-ui, sans-serif`,
    sans: `"Geist", system-ui, sans-serif`,
    mono: `"Geist Mono", ui-monospace, monospace`,
  };
}

function hexAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
  stroke?: string,
  lineWidth = 1.5,
): void {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawStepSequencerMark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  dimDotAlpha = 0.52,
): void {
  const scale = size / 256;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = color;
  for (const [sx, sy] of LOGO_SQUARES) {
    roundRectPath(ctx, sx, sy, 36, 36, 10);
    ctx.fill();
  }
  ctx.fillStyle = hexAlpha(color, dimDotAlpha);
  for (const [cx, cy] of LOGO_DOTS) {
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function getGrainTile(): HTMLCanvasElement | null {
  if (cachedGrainCanvas) return cachedGrainCanvas;
  if (typeof document === "undefined") return null;
  const tile = document.createElement("canvas");
  tile.width = 160;
  tile.height = 160;
  const gctx = tile.getContext("2d");
  if (!gctx) return null;
  const imgData = gctx.createImageData(160, 160);
  let seed = 0x9e3779b9;
  for (let i = 0; i < imgData.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = seed & 0xff;
    imgData.data[i] = v;
    imgData.data[i + 1] = v;
    imgData.data[i + 2] = v;
    imgData.data[i + 3] = 10;
  }
  gctx.putImageData(imgData, 0, 0);
  cachedGrainCanvas = tile;
  return tile;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  palette: WrappedThemePalette,
): void {
  const { width, height } = metrics;
  const baseGrad = ctx.createLinearGradient(0, 0, width * 0.45, height);
  baseGrad.addColorStop(0, palette.bg);
  baseGrad.addColorStop(0.55, palette.bgSecondary);
  baseGrad.addColorStop(1, palette.bg);
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, 0, width, height);

  // Top-left & bottom-right atmospheric accent halos
  const haloA = ctx.createRadialGradient(width * 0.16, height * 0.12, 20, width * 0.16, height * 0.12, width * 0.72);
  haloA.addColorStop(0, hexAlpha(palette.accent, palette.isLight ? 0.11 : 0.16));
  haloA.addColorStop(1, hexAlpha(palette.accent, 0));
  ctx.fillStyle = haloA;
  ctx.fillRect(0, 0, width, height);

  const haloB = ctx.createRadialGradient(width * 0.86, height * 0.84, 20, width * 0.86, height * 0.84, width * 0.65);
  haloB.addColorStop(0, hexAlpha(palette.accentAlt, palette.isLight ? 0.09 : 0.14));
  haloB.addColorStop(1, hexAlpha(palette.accentAlt, 0));
  ctx.fillStyle = haloB;
  ctx.fillRect(0, 0, width, height);

  // Subtle halftone studio grid
  ctx.save();
  ctx.fillStyle = hexAlpha(palette.text, palette.isLight ? 0.035 : 0.03);
  const step = 36;
  for (let gx = 36; gx < width; gx += step) {
    for (let gy = 36; gy < height; gy += step) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Procedural analog film grain
  const grain = getGrainTile();
  if (grain) {
    const pattern = ctx.createPattern(grain, "repeat");
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = palette.isLight ? 0.55 : 0.85;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  // Crisp editorial inner frame
  ctx.save();
  roundRectPath(ctx, 22, 22, width - 44, height - 44, 28);
  ctx.strokeStyle = hexAlpha(palette.border, 0.85);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw <= 0 || ih <= 0) return;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function drawCoverOrMonogram(
  ctx: CanvasRenderingContext2D,
  coverUrl: string,
  label: string,
  x: number,
  y: number,
  size: number,
  radius: number,
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
  circular = false,
): void {
  ctx.save();
  if (circular) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
  } else {
    roundRectPath(ctx, x, y, size, size, radius);
  }
  ctx.clip();

  const loaded = coverUrl.trim() ? assets.images.get(coverUrl.trim()) : undefined;
  if (loaded) {
    drawImageCover(ctx, loaded, x, y, size, size);
  } else {
    const pair = MONOGRAM_GRADIENTS[hashSeed(label || "LoggeRythm") % MONOGRAM_GRADIENTS.length];
    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, pair[0]);
    grad.addColorStop(1, pair[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, size, size);

    // Subtle step-sequencer corner watermark
    drawStepSequencerMark(
      ctx,
      x + size * 0.62,
      y + size * 0.62,
      size * 0.34,
      palette.isLight ? "#f4f0e6" : palette.accent,
      0.24,
    );

    // Centered monogram initials
    const initials = getInitials(label);
    ctx.fillStyle = "#f4f0e6";
    ctx.font = `800 ${Math.round(size * 0.36)}px ${fonts.display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, x + size / 2, y + size / 2 + size * 0.02);
  }
  ctx.restore();

  // Crisp sleeve border
  ctx.save();
  if (circular) {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, x, y, size, size, radius);
  }
  ctx.strokeStyle = hexAlpha(palette.text, 0.16);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontWeight: number,
  fontFamily: string,
  startSize: number,
  minSize: number,
  maxWidth: number,
): number {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minSize;
}

function formatRangeBadge(range: WrappedReport["range"]): string {
  const entry = WRAPPED_RANGES.find((r) => r.key === range);
  return (entry?.label ?? range).toUpperCase();
}

function formatGermanDateShort(iso: string | null): string {
  if (!iso) return "GESAMTZEIT";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  fill: string,
  textColor: string,
  borderColor: string | null,
  font: string,
  padX = 18,
  height = 38,
): number {
  ctx.save();
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  const pillW = Math.ceil(textWidth + padX * 2);
  fillRoundRect(ctx, x, y, pillW, height, height / 2, fill, borderColor ?? undefined, 1.25);
  ctx.fillStyle = textColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + height / 2 + 0.5);
  ctx.restore();
  return pillW;
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const { padX, headerTop, width } = metrics;
  const markSize = options.format === "story" ? 44 : 38;
  drawStepSequencerMark(ctx, padX, headerTop + 6, markSize, palette.accent);

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.text;
  ctx.font = `800 ${options.format === "story" ? 26 : 23}px ${fonts.display}`;
  const wordmarkX = padX + markSize + 14;
  ctx.fillText("LoggeRythm", wordmarkX, headerTop + 4);

  ctx.fillStyle = palette.muted;
  ctx.font = `600 14px ${fonts.mono}`;
  ctx.fillText(`WRAPPED · ${formatRangeBadge(report.range)}`, wordmarkX, headerTop + 34);
  ctx.restore();

  if (options.showUser) {
    const pillH = 44;
    const avatarSize = 32;
    const nameRaw = report.user.display_name.trim() || "LoggeRythm Listener";
    ctx.save();
    ctx.font = `600 17px ${fonts.sans}`;
    const maxNameW = 240;
    const displayName = truncateTextWithEllipsis(nameRaw, maxNameW, (c) => ctx.measureText(c).width);
    const pillW = Math.ceil(avatarSize + 10 + ctx.measureText(displayName).width + 24);
    const pillX = width - padX - pillW;
    const pillY = headerTop + 6;
    fillRoundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2, hexAlpha(palette.surface, 0.92), palette.border, 1.25);
    drawCoverOrMonogram(
      ctx,
      report.user.avatar_url,
      nameRaw,
      pillX + 6,
      pillY + (pillH - avatarSize) / 2,
      avatarSize,
      avatarSize / 2,
      assets,
      palette,
      fonts,
      true,
    );
    ctx.fillStyle = palette.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(displayName, pillX + 6 + avatarSize + 10, pillY + pillH / 2 + 0.5);
    ctx.restore();
  } else {
    const rangeTag = formatRangeBadge(report.range);
    ctx.save();
    const font = `700 14px ${fonts.mono}`;
    ctx.font = font;
    const estW = ctx.measureText(rangeTag).width + 32;
    drawPill(
      ctx,
      width - padX - estW,
      headerTop + 10,
      rangeTag,
      hexAlpha(palette.accent, 0.14),
      palette.accent,
      hexAlpha(palette.accent, 0.45),
      font,
      16,
      34,
    );
    ctx.restore();
  }

  // Subtle divider line below header
  ctx.save();
  ctx.strokeStyle = hexAlpha(palette.border, 0.75);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, headerTop + metrics.headerHeight - 8);
  ctx.lineTo(width - padX, headerTop + metrics.headerHeight - 8);
  ctx.stroke();
  ctx.restore();
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const { padX, footerTop, width } = metrics;
  ctx.save();
  ctx.strokeStyle = hexAlpha(palette.border, 0.75);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, footerTop);
  ctx.lineTo(width - padX, footerTop);
  ctx.stroke();

  const periodStr = report.period_start
    ? `${formatGermanDateShort(report.period_start)} – ${formatGermanDateShort(report.period_end)}`
    : `BIS ${formatGermanDateShort(report.period_end)}`;

  ctx.textBaseline = "top";
  ctx.font = `600 15px ${fonts.mono}`;
  ctx.fillStyle = palette.muted;
  ctx.textAlign = "left";
  ctx.fillText(periodStr, padX, footerTop + 18);

  const rightText =
    options.showCounts && report.totals.play_count > 0
      ? `${report.totals.play_count.toLocaleString("de-DE")} PLAYS · ${report.totals.unique_tracks.toLocaleString("de-DE")} TITEL`
      : "LOGGERYTHM · INK, PAPER, SIGNAL";
  ctx.textAlign = "right";
  ctx.fillStyle = palette.accent;
  ctx.fillText(rightText, width - padX, footerTop + 18);
  ctx.restore();
}

function drawEmptyStateCard(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const { width, bodyTop, bodyHeight, innerWidth } = metrics;
  const centerX = width / 2;
  const centerY = bodyTop + bodyHeight * 0.45;

  drawStepSequencerMark(ctx, centerX - 64, centerY - 190, 128, palette.accent, 0.4);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.accent;
  ctx.font = `700 18px ${fonts.mono}`;
  ctx.fillText(`ZEITRAUM · ${formatRangeBadge(report.range)}`, centerX, centerY - 22);

  ctx.fillStyle = palette.text;
  ctx.font = `800 56px ${fonts.display}`;
  ctx.fillText("Noch keine Wiedergaben", centerX, centerY + 18);

  ctx.fillStyle = palette.muted;
  ctx.font = `500 24px ${fonts.sans}`;
  const lines = wrapTextLines(
    "Sobald du in diesem Zeitraum Songs abspielst, entsteht hier deine persönliche Wrapped Share-Card.",
    Math.min(700, innerWidth - 80),
    3,
    (c) => ctx.measureText(c).width,
  );
  lines.forEach((line, idx) => {
    ctx.fillText(line, centerX, centerY + 104 + idx * 36);
  });
  ctx.restore();
}

function drawRankedPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  items: WrappedRankedItem[],
  showCounts: boolean,
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
  compact: boolean,
): void {
  fillRoundRect(ctx, x, y, w, h, 22, hexAlpha(palette.surface, 0.88), palette.border, 1.5);

  const pad = compact ? 22 : 26;
  ctx.save();
  ctx.fillStyle = palette.accent;
  ctx.font = `700 ${compact ? 14 : 15}px ${fonts.mono}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(title, x + pad, y + pad);
  ctx.restore();

  const list = items.slice(0, 5);
  if (list.length === 0) {
    ctx.save();
    ctx.fillStyle = palette.muted;
    ctx.font = `500 18px ${fonts.sans}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Keine Einträge", x + pad, y + pad + 42);
    ctx.restore();
    return;
  }

  const startY = y + pad + (compact ? 34 : 42);
  const availH = h - pad * 2 - (compact ? 34 : 42);
  const rowH = Math.floor(availH / 5);
  const coverSize = compact ? 46 : 56;
  const maxCount = Math.max(1, list[0].count);

  list.forEach((item, idx) => {
    const rowY = startY + idx * rowH;
    const rankStr = String(item.rank).padStart(2, "0");

    ctx.save();
    ctx.font = `700 ${compact ? 16 : 18}px ${fonts.mono}`;
    ctx.fillStyle = idx === 0 ? palette.accent : palette.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(rankStr, x + pad, rowY + coverSize / 2);

    const artX = x + pad + (compact ? 32 : 38);
    drawCoverOrMonogram(
      ctx,
      item.cover,
      item.label,
      artX,
      rowY,
      coverSize,
      10,
      assets,
      palette,
      fonts,
    );

    const textX = artX + coverSize + 14;
    const countLabel = showCounts ? `${item.count}×` : "";
    ctx.font = `700 ${compact ? 15 : 16}px ${fonts.mono}`;
    const countW = countLabel ? ctx.measureText(countLabel).width + 12 : 0;
    const textMaxW = Math.max(60, x + w - pad - textX - countW);

    ctx.font = `700 ${compact ? 19 : 22}px ${fonts.sans}`;
    ctx.fillStyle = palette.text;
    ctx.textBaseline = "top";
    const mainText = truncateTextWithEllipsis(item.label, textMaxW, (c) => ctx.measureText(c).width);
    ctx.fillText(mainText, textX, rowY + (item.sublabel ? 2 : coverSize * 0.25));

    if (item.sublabel) {
      ctx.font = `500 ${compact ? 14 : 16}px ${fonts.sans}`;
      ctx.fillStyle = palette.muted;
      const subText = truncateTextWithEllipsis(item.sublabel, textMaxW, (c) => ctx.measureText(c).width);
      ctx.fillText(subText, textX, rowY + (compact ? 25 : 30));
    }

    if (countLabel) {
      ctx.font = `700 ${compact ? 15 : 16}px ${fonts.mono}`;
      ctx.fillStyle = idx === 0 ? palette.accent : palette.muted;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(countLabel, x + w - pad, rowY + 4);
    }

    // Progress bar at bottom of row
    const barY = rowY + coverSize + (compact ? 7 : 10);
    const barW = Math.max(40, x + w - pad - textX);
    const ratio = Math.max(0.08, item.count / maxCount);
    fillRoundRect(ctx, textX, barY, barW, 4, 2, hexAlpha(palette.border, 0.75));
    fillRoundRect(
      ctx,
      textX,
      barY,
      barW * ratio,
      4,
      2,
      idx === 0 ? palette.accent : hexAlpha(palette.accentAlt, 0.85),
    );
    ctx.restore();
  });
}

function drawFannedSleeves(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  sleeveSize: number,
  items: WrappedRankedItem[],
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const stack = items.slice(0, 3);
  if (stack.length === 0) return;

  const configs =
    stack.length === 1
      ? [{ dx: 0, dy: 0, angle: 0, scale: 1 }]
      : stack.length === 2
        ? [
            { dx: -sleeveSize * 0.28, dy: 14, angle: -0.13, scale: 0.9 },
            { dx: sleeveSize * 0.16, dy: -6, angle: 0.08, scale: 1 },
          ]
        : [
            { dx: -sleeveSize * 0.42, dy: 24, angle: -0.16, scale: 0.86 },
            { dx: sleeveSize * 0.42, dy: 22, angle: 0.16, scale: 0.86 },
            { dx: 0, dy: -8, angle: -0.02, scale: 1 },
          ];

  const order = stack.length === 3 ? [2, 1, 0] : stack.length === 2 ? [1, 0] : [0];
  order.forEach((itemIdx, drawIdx) => {
    const item = stack[itemIdx];
    const cfg = configs[drawIdx];
    const size = sleeveSize * cfg.scale;
    ctx.save();
    ctx.translate(centerX + cfg.dx, centerY + cfg.dy);
    ctx.rotate(cfg.angle);
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 14;
    drawCoverOrMonogram(
      ctx,
      item.cover,
      item.label,
      -size / 2,
      -size / 2,
      size,
      18,
      assets,
      palette,
      fonts,
    );
    ctx.restore();
  });
}

function renderSummaryTemplate(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const { padX, bodyTop, innerWidth } = metrics;
  const isStory = options.format === "story";
  const heroDur = formatWrappedDurationHours(report.totals.listening_sec);
  const sleeveItems = report.top_albums.length > 0 ? report.top_albums : report.top_tracks;

  if (isStory) {
    // Top editorial hero
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = palette.accent;
    ctx.font = `700 17px ${fonts.mono}`;
    ctx.fillText("DEINE HÖRZEIT IM RÜCKBLICK", padX, bodyTop + 14);

    if (options.showCounts) {
      const bigSize = fitFontSize(ctx, heroDur.value, 800, fonts.display, 148, 88, 460);
      ctx.font = `800 ${bigSize}px ${fonts.display}`;
      ctx.fillStyle = palette.text;
      ctx.fillText(heroDur.value, padX, bodyTop + 44);
      const valW = ctx.measureText(heroDur.value).width;
      ctx.font = `700 42px ${fonts.display}`;
      ctx.fillStyle = palette.accent;
      ctx.fillText(heroDur.unit.toUpperCase(), padX + valW + 18, bodyTop + 44 + bigSize * 0.48);

      ctx.font = `500 22px ${fonts.sans}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(
        `${report.totals.play_count.toLocaleString("de-DE")} Wiedergaben · ${report.totals.unique_tracks} Titel · ${report.totals.unique_artists} Künstler`,
        padX,
        bodyTop + 216,
      );
    } else {
      const titleText = report.persona ? report.persona.title : report.rhythm.chronotype_label;
      const bigSize = fitFontSize(ctx, titleText, 800, fonts.display, 84, 48, innerWidth);
      ctx.font = `800 ${bigSize}px ${fonts.display}`;
      ctx.fillStyle = palette.text;
      ctx.fillText(titleText, padX, bodyTop + 56);
      ctx.font = `500 22px ${fonts.sans}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(
        report.persona?.subtitle ?? "Persönliche Klang-Chronik · Private Edition",
        padX,
        bodyTop + 168,
      );
    }

    // Equivalent + Persona pills row
    let pillX = padX;
    const pillY = bodyTop + 266;
    if (options.showCounts && report.equivalents.length > 0) {
      const eq = report.equivalents[0];
      const eqText = `≈ ${eq.value} ${eq.label}`;
      pillX +=
        drawPill(
          ctx,
          pillX,
          pillY,
          truncateTextWithEllipsis(eqText, 440, (c) => {
            ctx.font = `600 17px ${fonts.sans}`;
            return ctx.measureText(c).width;
          }),
          hexAlpha(palette.accent, 0.16),
          palette.accent,
          hexAlpha(palette.accent, 0.45),
          `600 17px ${fonts.sans}`,
          18,
          40,
        ) + 12;
    }
    if (report.persona && pillX < padX + innerWidth - 220) {
      const personaPillText = `ARCHETYP: ${report.persona.title.toUpperCase()}`;
      drawPill(
        ctx,
        pillX,
        pillY,
        truncateTextWithEllipsis(personaPillText, padX + innerWidth - pillX - 32, (c) => {
          ctx.font = `600 15px ${fonts.mono}`;
          return ctx.measureText(c).width;
        }),
        hexAlpha(palette.surface, 0.95),
        palette.text,
        palette.border,
        `600 15px ${fonts.mono}`,
        18,
        40,
      );
    }
    ctx.restore();

    // Fanned 3-cover record sleeve stack centerpiece
    drawFannedSleeves(ctx, metrics.width / 2, bodyTop + 525, 290, sleeveItems, assets, palette, fonts);

    // Side-by-side Top 5 Artists & Top 5 Tracks
    const gap = 24;
    const colW = (innerWidth - gap) / 2;
    const listsY = bodyTop + 740;
    const listsH = 685;
    drawRankedPanel(
      ctx,
      padX,
      listsY,
      colW,
      listsH,
      "TOP KÜNSTLER",
      report.top_artists,
      options.showCounts,
      assets,
      palette,
      fonts,
      false,
    );
    drawRankedPanel(
      ctx,
      padX + colW + gap,
      listsY,
      colW,
      listsH,
      "TOP TITEL",
      report.top_tracks,
      options.showCounts,
      assets,
      palette,
      fonts,
      false,
    );

    // Bottom KPI Telemetry strip
    const kpiY = bodyTop + 1455;
    const kpiH = 112;
    const kpiW = (innerWidth - gap * 2) / 3;
    const kpis = options.showCounts
      ? [
          {
            label: "ENTDECKER-SCORE",
            val: `${report.rhythm.discovery_score_pct}%`,
            sub: `${report.totals.new_artists_count} neue Künstler`,
          },
          {
            label: "AKTIVE TAGE",
            val: `${report.totals.active_days}/${Math.max(report.totals.active_days, report.totals.total_days)}`,
            sub: `Rekord: ${report.totals.longest_streak_days} Tage Serie`,
          },
          {
            label: report.tempo ? "Ø TEMPO" : "PEAK-STUNDE",
            val: report.tempo ? `${report.tempo.avg_bpm} BPM` : `${String(report.rhythm.peak_hour).padStart(2, "0")}:00`,
            sub: report.tempo ? report.tempo.vibe_label : report.rhythm.chronotype_label,
          },
        ]
      : [
          {
            label: "CHRONOTYP",
            val: report.rhythm.chronotype_label,
            sub: `Peak ${WEEKDAYS_SHORT[report.rhythm.peak_weekday]}`,
          },
          {
            label: "AURA",
            val: report.aura ? report.aura.title : "Klang-Signatur",
            sub: report.aura?.mood_tags[0] ?? "Fokussiert",
          },
          {
            label: "TEMPO-VIBE",
            val: report.tempo ? report.tempo.vibe_label : "Dynamisch",
            sub: report.persona ? report.persona.subtitle : "LoggeRythm",
          },
        ];

    kpis.forEach((kpi, idx) => {
      const kx = padX + idx * (kpiW + gap);
      fillRoundRect(ctx, kx, kpiY, kpiW, kpiH, 18, hexAlpha(palette.surface, 0.88), palette.border, 1.25);
      ctx.save();
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = palette.muted;
      ctx.font = `700 13px ${fonts.mono}`;
      ctx.fillText(kpi.label, kx + 20, kpiY + 18);

      ctx.fillStyle = idx === 0 ? palette.accent : palette.text;
      const valSize = fitFontSize(ctx, kpi.val, 800, fonts.display, 32, 20, kpiW - 40);
      ctx.font = `800 ${valSize}px ${fonts.display}`;
      ctx.fillText(truncateTextWithEllipsis(kpi.val, kpiW - 40, (c) => ctx.measureText(c).width), kx + 20, kpiY + 42);

      ctx.fillStyle = palette.muted;
      ctx.font = `500 15px ${fonts.sans}`;
      ctx.fillText(truncateTextWithEllipsis(kpi.sub, kpiW - 40, (c) => ctx.measureText(c).width), kx + 20, kpiY + 80);
      ctx.restore();
    });
    return;
  }

  // SQUARE (1080x1080)
  const leftW = 550;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.accent;
  ctx.font = `700 15px ${fonts.mono}`;
  ctx.fillText("DEIN RÜCKBLICK", padX, bodyTop + 10);

  if (options.showCounts) {
    const bigSize = fitFontSize(ctx, heroDur.value, 800, fonts.display, 108, 70, 340);
    ctx.font = `800 ${bigSize}px ${fonts.display}`;
    ctx.fillStyle = palette.text;
    ctx.fillText(heroDur.value, padX, bodyTop + 34);
    const valW = ctx.measureText(heroDur.value).width;
    ctx.font = `700 30px ${fonts.display}`;
    ctx.fillStyle = palette.accent;
    ctx.fillText(heroDur.unit.toUpperCase(), padX + valW + 14, bodyTop + 34 + bigSize * 0.48);

    ctx.font = `500 19px ${fonts.sans}`;
    ctx.fillStyle = palette.muted;
    ctx.fillText(
      `${report.totals.play_count.toLocaleString("de-DE")} Wiedergaben · ${report.totals.unique_artists} Künstler`,
      padX,
      bodyTop + 158,
    );
  } else {
    const titleText = report.persona ? report.persona.title : report.rhythm.chronotype_label;
    const bigSize = fitFontSize(ctx, titleText, 800, fonts.display, 64, 40, leftW);
    ctx.font = `800 ${bigSize}px ${fonts.display}`;
    ctx.fillStyle = palette.text;
    ctx.fillText(titleText, padX, bodyTop + 42);
    ctx.font = `500 19px ${fonts.sans}`;
    ctx.fillStyle = palette.muted;
    ctx.fillText(report.persona?.subtitle ?? "Persönliche Klang-Chronik", padX, bodyTop + 126);
  }

  const pillY = bodyTop + 206;
  if (report.persona) {
    drawPill(
      ctx,
      padX,
      pillY,
      truncateTextWithEllipsis(report.persona.title.toUpperCase(), leftW - 40, (c) => {
        ctx.font = `700 14px ${fonts.mono}`;
        return ctx.measureText(c).width;
      }),
      hexAlpha(palette.accent, 0.16),
      palette.accent,
      hexAlpha(palette.accent, 0.45),
      `700 14px ${fonts.mono}`,
      16,
      36,
    );
  }
  ctx.restore();

  drawFannedSleeves(ctx, padX + innerWidth - 175, bodyTop + 145, 190, sleeveItems, assets, palette, fonts);

  const gap = 22;
  const colW = (innerWidth - gap) / 2;
  const listsY = bodyTop + 292;
  const listsH = metrics.bodyBottom - listsY - 8;
  drawRankedPanel(
    ctx,
    padX,
    listsY,
    colW,
    listsH,
    "TOP KÜNSTLER",
    report.top_artists,
    options.showCounts,
    assets,
    palette,
    fonts,
    true,
  );
  drawRankedPanel(
    ctx,
    padX + colW + gap,
    listsY,
    colW,
    listsH,
    "TOP TITEL",
    report.top_tracks,
    options.showCounts,
    assets,
    palette,
    fonts,
    true,
  );
}

function drawPersonaEmblem(
  ctx: CanvasRenderingContext2D,
  emblem: WrappedEmblemId,
  cx: number,
  cy: number,
  radius: number,
  palette: WrappedThemePalette,
): void {
  ctx.save();

  // Outer halo & concentric reticle
  const glow = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius * 1.15);
  glow.addColorStop(0, hexAlpha(palette.accent, palette.isLight ? 0.18 : 0.24));
  glow.addColorStop(0.6, hexAlpha(palette.accentAlt, 0.08));
  glow.addColorStop(1, hexAlpha(palette.accent, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hexAlpha(palette.border, 0.9);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.94, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = hexAlpha(palette.accent, 0.45);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  switch (emblem) {
    case "moon_wave": {
      // Crescent moon + acoustic wave arcs
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(cx - radius * 0.06, cy, radius * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.bgSecondary;
      ctx.beginPath();
      ctx.arc(cx + radius * 0.12, cy - radius * 0.09, radius * 0.36, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = palette.accentAlt;
      ctx.lineWidth = 5;
      for (let i = 1; i <= 3; i += 1) {
        ctx.beginPath();
        ctx.arc(cx + radius * 0.05, cy, radius * (0.36 + i * 0.12), -0.55, 0.55);
        ctx.stroke();
      }
      ctx.fillStyle = palette.text;
      [
        [-0.45, -0.38, 4],
        [0.42, -0.44, 5],
        [-0.5, 0.34, 3.5],
      ].forEach(([dx, dy, r]) => {
        ctx.beginPath();
        ctx.arc(cx + radius * dx, cy + radius * dy, r, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case "infinite_vinyl": {
      // Dual overlapping vinyl discs + figure-8 ribbon
      const offset = radius * 0.25;
      [-offset, offset].forEach((dx, idx) => {
        ctx.fillStyle = idx === 0 ? "#111015" : "#1b1a22";
        ctx.beginPath();
        ctx.arc(cx + dx, cy, radius * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = idx === 0 ? palette.accent : palette.accentAlt;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.strokeStyle = hexAlpha(palette.text, 0.2);
        ctx.lineWidth = 1.2;
        for (let r = 0.18; r <= 0.28; r += 0.05) {
          ctx.beginPath();
          ctx.arc(cx + dx, cy, radius * r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = idx === 0 ? palette.accent : palette.accentAlt;
        ctx.beginPath();
        ctx.arc(cx + dx, cy, radius * 0.08, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - offset, cy - radius * 0.18);
      ctx.bezierCurveTo(cx, cy - radius * 0.3, cx, cy + radius * 0.3, cx + offset, cy + radius * 0.18);
      ctx.stroke();
      break;
    }
    case "compass_radar": {
      // Compass rose + sweeping radar sector
      ctx.fillStyle = hexAlpha(palette.accent, 0.2);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius * 0.65, -Math.PI * 0.42, Math.PI * 0.08);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = palette.accentAlt;
      ctx.lineWidth = 2.5;
      for (const r of [0.24, 0.44, 0.64]) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // 4-point star needle
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius * 0.62);
      ctx.lineTo(cx + radius * 0.12, cy);
      ctx.lineTo(cx, cy + radius * 0.62);
      ctx.lineTo(cx - radius * 0.12, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = palette.text;
      ctx.beginPath();
      ctx.arc(cx + radius * 0.28, cy - radius * 0.22, 7, 0, Math.PI * 2);
      ctx.arc(cx - radius * 0.35, cy + radius * 0.18, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "tonearm_disc": {
      // Turntable platter + articulated tonearm
      const discX = cx - radius * 0.08;
      ctx.fillStyle = "#101014";
      ctx.beginPath();
      ctx.arc(discX, cy, radius * 0.56, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let r = 0.25; r <= 0.5; r += 0.06) {
        ctx.strokeStyle = hexAlpha("#ffffff", 0.14);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(discX, cy, radius * r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(discX, cy, radius * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = palette.bg;
      ctx.beginPath();
      ctx.arc(discX, cy, radius * 0.04, 0, Math.PI * 2);
      ctx.fill();

      // Tonearm from top-right pivot
      const pivX = cx + radius * 0.52;
      const pivY = cy - radius * 0.48;
      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pivX, pivY);
      ctx.lineTo(pivX - radius * 0.08, cy + radius * 0.1);
      ctx.lineTo(discX + radius * 0.34, cy + radius * 0.3);
      ctx.stroke();
      ctx.fillStyle = palette.accentAlt;
      ctx.beginPath();
      ctx.arc(pivX, pivY, radius * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "strobe_bars": {
      // Kinetic club equalizer monoliths
      const heights = [0.42, 0.78, 0.96, 0.64, 0.88, 0.52, 0.7];
      const barW = radius * 0.12;
      const gap = radius * 0.06;
      const totalW = heights.length * barW + (heights.length - 1) * gap;
      const startX = cx - totalW / 2;
      const baseY = cy + radius * 0.42;
      heights.forEach((hRatio, i) => {
        const bx = startX + i * (barW + gap);
        const bh = radius * 0.88 * hRatio;
        fillRoundRect(
          ctx,
          bx,
          baseY - bh,
          barW,
          bh,
          barW / 2,
          i % 2 === 0 ? palette.accent : palette.accentAlt,
        );
        fillRoundRect(ctx, bx, baseY - bh - 14, barW, 7, 3, palette.text);
      });
      break;
    }
    case "sunrise_pulse": {
      // Rising horizon sun + pulse waveform
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 4;
      for (let a = -Math.PI; a <= 0; a += Math.PI / 8) {
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * radius * 0.42, cy + radius * 0.12 + Math.sin(a) * radius * 0.42);
        ctx.lineTo(cx + Math.cos(a) * radius * 0.6, cy + radius * 0.12 + Math.sin(a) * radius * 0.6);
        ctx.stroke();
      }
      ctx.fillStyle = palette.accentAlt;
      ctx.beginPath();
      ctx.arc(cx, cy + radius * 0.12, radius * 0.34, Math.PI, 0);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.62, cy + radius * 0.26);
      ctx.lineTo(cx - radius * 0.28, cy + radius * 0.26);
      ctx.lineTo(cx - radius * 0.12, cy - radius * 0.02);
      ctx.lineTo(cx + radius * 0.06, cy + radius * 0.44);
      ctx.lineTo(cx + radius * 0.22, cy + radius * 0.14);
      ctx.lineTo(cx + radius * 0.34, cy + radius * 0.26);
      ctx.lineTo(cx + radius * 0.62, cy + radius * 0.26);
      ctx.stroke();
      break;
    }
    case "flame_metro": {
      // Geometric streak flame + metronome needle
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius * 0.6);
      ctx.bezierCurveTo(cx + radius * 0.48, cy - radius * 0.18, cx + radius * 0.45, cy + radius * 0.55, cx, cy + radius * 0.56);
      ctx.bezierCurveTo(cx - radius * 0.45, cy + radius * 0.55, cx - radius * 0.48, cy - radius * 0.18, cx, cy - radius * 0.6);
      ctx.fill();

      ctx.fillStyle = palette.accentAlt;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius * 0.22);
      ctx.bezierCurveTo(cx + radius * 0.25, cy + radius * 0.05, cx + radius * 0.22, cy + radius * 0.44, cx, cy + radius * 0.46);
      ctx.bezierCurveTo(cx - radius * 0.22, cy + radius * 0.44, cx - radius * 0.25, cy + radius * 0.05, cx, cy - radius * 0.22);
      ctx.fill();

      ctx.strokeStyle = palette.bg;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy + radius * 0.42);
      ctx.lineTo(cx + radius * 0.18, cy - radius * 0.15);
      ctx.stroke();
      break;
    }
    case "prism_beat": {
      // Optical prism splitting an incoming beam into spectrum rays
      ctx.strokeStyle = palette.text;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - radius * 0.68, cy + radius * 0.08);
      ctx.lineTo(cx - radius * 0.12, cy - radius * 0.04);
      ctx.stroke();

      const rayColors = [palette.accent, palette.accentAlt, palette.text];
      rayColors.forEach((col, i) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(cx + radius * 0.14, cy - radius * 0.04 + (i - 1) * 14);
        ctx.lineTo(cx + radius * 0.68, cy + (i - 1) * radius * 0.26);
        ctx.stroke();
      });

      ctx.fillStyle = hexAlpha(palette.surface, 0.92);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - radius * 0.52);
      ctx.lineTo(cx + radius * 0.46, cy + radius * 0.38);
      ctx.lineTo(cx - radius * 0.46, cy + radius * 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function renderPersonaTemplate(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const persona = report.persona;
  if (!persona) {
    drawEmptyStateCard(ctx, metrics, report, palette, fonts);
    return;
  }

  const { padX, bodyTop, width, innerWidth } = metrics;
  const isStory = options.format === "story";
  const cx = width / 2;

  const emblemRadius = isStory ? 215 : 124;
  const emblemCy = isStory ? bodyTop + 265 : bodyTop + 148;
  drawPersonaEmblem(ctx, persona.emblem, cx, emblemCy, emblemRadius, palette);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const eyebrowY = isStory ? bodyTop + 530 : bodyTop + 296;
  ctx.fillStyle = palette.accent;
  ctx.font = `700 ${isStory ? 17 : 15}px ${fonts.mono}`;
  ctx.fillText(`DEINE KLANG-PERSÖNLICHKEIT · ${persona.subtitle.toUpperCase()}`, cx, eyebrowY);

  const titleY = eyebrowY + (isStory ? 38 : 30);
  const titleSize = fitFontSize(ctx, persona.title, 800, fonts.display, isStory ? 88 : 66, 40, innerWidth - 20);
  ctx.font = `800 ${titleSize}px ${fonts.display}`;
  ctx.fillStyle = palette.text;
  ctx.fillText(truncateTextWithEllipsis(persona.title, innerWidth - 20, (c) => ctx.measureText(c).width), cx, titleY);

  const tagY = titleY + titleSize + (isStory ? 24 : 14);
  ctx.font = `500 ${isStory ? 26 : 21}px ${fonts.sans}`;
  ctx.fillStyle = palette.muted;
  const taglineLines = wrapTextLines(
    persona.tagline,
    Math.min(820, innerWidth - 40),
    isStory ? 3 : 2,
    (c) => ctx.measureText(c).width,
  );
  taglineLines.forEach((line, idx) => {
    ctx.fillText(line, cx, tagY + idx * (isStory ? 38 : 30));
  });

  // 3 Trait pills centered nicely
  const traits = persona.traits.slice(0, 3);
  const pillsY = tagY + taglineLines.length * (isStory ? 38 : 30) + (isStory ? 44 : 24);
  const pillFont = `600 ${isStory ? 18 : 15}px ${fonts.sans}`;
  ctx.font = pillFont;
  const pillWidths = traits.map((t) => Math.ceil(ctx.measureText(t).width + (isStory ? 40 : 32)));
  const pillGap = 14;
  const totalPillsW = pillWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, traits.length - 1) * pillGap;
  let pillsEndY = pillsY;

  if (traits.length > 0 && totalPillsW <= innerWidth) {
    let px = cx - totalPillsW / 2;
    const pillH = isStory ? 46 : 38;
    traits.forEach((trait, idx) => {
      px +=
        drawPill(
          ctx,
          px,
          pillsY,
          trait,
          idx === 0 ? hexAlpha(palette.accent, 0.16) : hexAlpha(palette.surface, 0.94),
          idx === 0 ? palette.accent : palette.text,
          idx === 0 ? hexAlpha(palette.accent, 0.45) : palette.border,
          pillFont,
          isStory ? 20 : 16,
          pillH,
        ) + pillGap;
    });
    pillsEndY = pillsY + pillH;
  } else if (traits.length > 0) {
    // Stack pills cleanly if super long trait strings
    let py = pillsY;
    traits.forEach((trait, idx) => {
      const clamped = truncateTextWithEllipsis(trait, innerWidth - 40, (c) => ctx.measureText(c).width);
      const pw = Math.ceil(ctx.measureText(clamped).width + 32);
      drawPill(
        ctx,
        cx - pw / 2,
        py,
        clamped,
        idx === 0 ? hexAlpha(palette.accent, 0.16) : hexAlpha(palette.surface, 0.94),
        idx === 0 ? palette.accent : palette.text,
        palette.border,
        pillFont,
        16,
        36,
      );
      py += 44;
    });
    pillsEndY = py - 8;
  }
  ctx.restore();

  // Generative Sound-DNA waveform box at bottom
  const dnaY = Math.max(isStory ? bodyTop + 1125 : bodyTop + 592, pillsEndY + 24);
  const dnaH = Math.max(150, metrics.bodyBottom - dnaY - (isStory ? 28 : 12));
  fillRoundRect(ctx, padX, dnaY, innerWidth, dnaH, 24, hexAlpha(palette.surface, 0.9), palette.border, 1.5);

  ctx.save();
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = palette.muted;
  ctx.font = `700 14px ${fonts.mono}`;
  ctx.fillText("SOUND-DNA · KLANGSIGNATUR", padX + 28, dnaY + 22);

  ctx.textAlign = "right";
  ctx.fillStyle = palette.accent;
  const dnaMeta = options.showCounts
    ? `${report.rhythm.discovery_score_pct}% ENTDECKUNG · ${report.rhythm.repeat_score_pct}% TREUE`
    : `${report.rhythm.chronotype_label.toUpperCase()}`;
  ctx.fillText(dnaMeta, padX + innerWidth - 28, dnaY + 22);

  const barsCount = 36;
  const waveX = padX + 28;
  const waveW = innerWidth - 56;
  const waveMidY = dnaY + dnaH * 0.56;
  const maxAmp = dnaH * 0.28;
  const barStep = waveW / barsCount;
  const barW = Math.max(8, barStep * 0.58);
  const hourly = report.rhythm.hourly_distribution;
  const maxHour = Math.max(1, ...hourly);

  for (let i = 0; i < barsCount; i += 1) {
    // Center peak around middle of waveform and smooth neighbors for organic studio audio contour
    const centeredIdx = (Math.floor((i / barsCount) * 24) + report.rhythm.peak_hour + 12) % 24;
    const prevIdx = (centeredIdx + 23) % 24;
    const nextIdx = (centeredIdx + 1) % 24;
    const smoothedHour =
      (hourly[prevIdx] * 0.25 + hourly[centeredIdx] * 0.5 + hourly[nextIdx] * 0.25) / maxHour;
    const envelope = Math.sin(((i + 0.5) / barsCount) * Math.PI);
    const harmonic = 0.5 + 0.5 * Math.sin(i * 0.65 + report.rhythm.peak_hour * 0.35);
    const ratio = Math.max(0.14, Math.min(1, (smoothedHour * 0.6 + harmonic * 0.4) * (0.45 + 0.55 * envelope)));
    const h = Math.max(12, ratio * maxAmp * 2);
    const bx = waveX + i * barStep + (barStep - barW) / 2;
    const color =
      i % 6 === 0 ? palette.accent : i % 3 === 0 ? palette.accentAlt : hexAlpha(palette.text, 0.45);
    fillRoundRect(ctx, bx, waveMidY - h / 2, barW, h, barW / 2, color);
  }
  ctx.restore();
}

function drawReceiptPaper(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  paperColor: string,
): void {
  const teeth = 36;
  const toothW = w / teeth;
  const toothH = 12;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 16;

  ctx.beginPath();
  ctx.moveTo(x, y + toothH);
  for (let i = 0; i < teeth; i += 1) {
    const tx = x + i * toothW;
    ctx.lineTo(tx + toothW * 0.5, y);
    ctx.lineTo(tx + toothW, y + toothH);
  }
  ctx.lineTo(x + w, y + h - toothH);
  for (let i = teeth; i > 0; i -= 1) {
    const tx = x + i * toothW;
    ctx.lineTo(tx - toothW * 0.5, y + h);
    ctx.lineTo(tx - toothW, y + h - toothH);
  }
  ctx.closePath();
  ctx.fillStyle = paperColor;
  ctx.fill();
  ctx.restore();
}

function renderReceiptTemplate(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const isStory = options.format === "story";
  const slipW = 876;
  const slipX = (metrics.width - slipW) / 2;
  const slipY = metrics.bodyTop + (isStory ? 20 : 8);
  const slipH = metrics.bodyBottom - slipY - (isStory ? 20 : 8);

  const paperBg = "#f6f1e4";
  const ink = "#141316";
  const inkMuted = "#5d584e";
  const stampAccent = palette.isLight ? palette.accent : "#26232b";

  drawReceiptPaper(ctx, slipX, slipY, slipW, slipH, paperBg);

  const innerPad = 52;
  const left = slipX + innerPad;
  const right = slipX + slipW - innerPad;
  const contentW = slipW - innerPad * 2;
  let cursorY = slipY + (isStory ? 44 : 32);

  ctx.save();
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.fillStyle = ink;
  ctx.font = `800 ${isStory ? 40 : 32}px ${fonts.display}`;
  ctx.fillText("LOGGERYTHM STUDIO-BELEG", metrics.width / 2, cursorY);
  cursorY += isStory ? 48 : 38;

  ctx.fillStyle = inkMuted;
  ctx.font = `600 16px ${fonts.mono}`;
  const orderSub = options.showUser
    ? `ORDER #LR-${report.range.toUpperCase()} · ${(report.user.display_name.trim() || "GAST").toUpperCase()}`
    : `ORDER #LR-${report.range.toUpperCase()} · ${formatRangeBadge(report.range)}`;
  ctx.fillText(truncateTextWithEllipsis(orderSub, contentW, (c) => ctx.measureText(c).width), metrics.width / 2, cursorY);
  cursorY += isStory ? 34 : 26;

  // Dashed divider
  const drawDashed = (dy: number) => {
    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = "rgba(20, 19, 22, 0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left, dy);
    ctx.lineTo(right, dy);
    ctx.stroke();
    ctx.restore();
  };

  drawDashed(cursorY);
  cursorY += isStory ? 18 : 14;

  // Column header
  ctx.textAlign = "left";
  ctx.fillStyle = inkMuted;
  ctx.font = `700 14px ${fonts.mono}`;
  ctx.fillText("NR", left, cursorY);
  ctx.fillText("TITEL / KÜNSTLER", left + 54, cursorY);
  ctx.textAlign = "right";
  ctx.fillText(options.showCounts ? "QTY    ZEIT" : "KATEGORIE", right, cursorY);
  cursorY += isStory ? 30 : 24;

  drawDashed(cursorY);
  cursorY += isStory ? 18 : 12;

  const maxTracks = isStory ? 10 : 5;
  const tracks = report.top_tracks.slice(0, maxTracks);
  const totalsBlockH = isStory ? 280 : 210;
  const listAvailH = slipY + slipH - totalsBlockH - cursorY;
  const rowH = Math.max(54, Math.floor(listAvailH / Math.max(1, tracks.length)));

  tracks.forEach((track, idx) => {
    const ry = cursorY + idx * rowH;
    ctx.textAlign = "left";
    ctx.fillStyle = inkMuted;
    ctx.font = `700 16px ${fonts.mono}`;
    ctx.fillText(String(track.rank).padStart(2, "0"), left, ry + 4);

    const rightColStr = options.showCounts
      ? `${String(track.count).padStart(3, " ")}×  ${formatMmSs(track.listening_sec).padStart(6, " ")}`
      : `TOP-${String(track.rank).padStart(2, "0")}`;
    ctx.font = `600 16px ${fonts.mono}`;
    const rightW = ctx.measureText(rightColStr).width + 20;
    const textW = contentW - 54 - rightW;

    ctx.fillStyle = ink;
    ctx.font = `700 ${isStory ? 21 : 19}px ${fonts.sans}`;
    ctx.fillText(truncateTextWithEllipsis(track.label, textW, (c) => ctx.measureText(c).width), left + 54, ry);

    ctx.fillStyle = inkMuted;
    ctx.font = `500 ${isStory ? 16 : 15}px ${fonts.sans}`;
    ctx.fillText(
      truncateTextWithEllipsis(track.sublabel || "Unbekannter Künstler", textW, (c) => ctx.measureText(c).width),
      left + 54,
      ry + (isStory ? 26 : 23),
    );

    ctx.textAlign = "right";
    ctx.fillStyle = ink;
    ctx.font = `700 16px ${fonts.mono}`;
    ctx.fillText(rightColStr, right, ry + 8);
  });

  // Totals & Barcode footer inside receipt
  const summaryTop = slipY + slipH - totalsBlockH;
  drawDashed(summaryTop);

  let sy = summaryTop + (isStory ? 18 : 14);
  const drawSummaryRow = (label: string, val: string, bold = false) => {
    ctx.textAlign = "left";
    ctx.fillStyle = bold ? ink : inkMuted;
    ctx.font = `${bold ? 800 : 600} ${bold ? 22 : 16}px ${bold ? fonts.display : fonts.mono}`;
    ctx.fillText(label, left, sy);
    ctx.textAlign = "right";
    ctx.fillStyle = ink;
    ctx.fillText(val, right, sy);
    sy += bold ? 34 : 24;
  };

  if (options.showCounts) {
    const dur = formatWrappedDurationHours(report.totals.listening_sec);
    drawSummaryRow("WIEDERGABEN", String(report.totals.play_count));
    drawSummaryRow("ENTDECKER-QUOTE", `${report.rhythm.discovery_score_pct}%`);
    drawSummaryRow("GESAMTHÖRZEIT", `${dur.value} ${dur.unit.toUpperCase()}`, true);
  } else {
    drawSummaryRow("CHRONOTYP", report.rhythm.chronotype_label.toUpperCase());
    drawSummaryRow("ARCHETYP", (report.persona?.title ?? "KLANG-PROFIL").toUpperCase(), true);
  }

  sy += 6;
  drawDashed(sy);
  sy += isStory ? 20 : 14;

  // Deterministic procedural barcode
  const barcodeSeed = hashSeed(`${report.user.display_name}|${report.range}|${report.totals.play_count}`);
  const barcodeW = Math.min(540, contentW);
  const barcodeX = metrics.width / 2 - barcodeW / 2;
  const barcodeH = isStory ? 66 : 46;
  let bx = barcodeX;
  let s = barcodeSeed || 1234567;
  ctx.fillStyle = stampAccent;
  while (bx < barcodeX + barcodeW - 6) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const barW = ((s % 3) + 1) * 3;
    const gapW = (((s >>> 4) % 3) + 1) * 2.5;
    ctx.fillRect(bx, sy, Math.min(barW, barcodeX + barcodeW - bx), barcodeH);
    bx += barW + gapW;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = inkMuted;
  ctx.font = `600 14px ${fonts.mono}`;
  ctx.fillText("DANKE FÜRS ZUHÖREN · LOGGERYTHM STUDIO", metrics.width / 2, sy + barcodeH + 10);
  ctx.restore();
}

function renderFestivalTemplate(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const artists = report.top_artists;
  if (artists.length === 0) {
    drawEmptyStateCard(ctx, metrics, report, palette, fonts);
    return;
  }

  const { padX, bodyTop, bodyBottom, width, innerWidth } = metrics;
  const isStory = options.format === "story";
  const cx = width / 2;

  // Stage spotlight beams from top corners
  ctx.save();
  const beamLeft = ctx.createLinearGradient(0, bodyTop, cx + 120, bodyBottom);
  beamLeft.addColorStop(0, hexAlpha(palette.accent, palette.isLight ? 0.14 : 0.2));
  beamLeft.addColorStop(1, hexAlpha(palette.accent, 0));
  ctx.fillStyle = beamLeft;
  ctx.beginPath();
  ctx.moveTo(padX, bodyTop);
  ctx.lineTo(padX + 260, bodyTop);
  ctx.lineTo(width - padX, bodyBottom);
  ctx.lineTo(padX + 120, bodyBottom);
  ctx.closePath();
  ctx.fill();

  const beamRight = ctx.createLinearGradient(width, bodyTop, cx - 120, bodyBottom);
  beamRight.addColorStop(0, hexAlpha(palette.accentAlt, palette.isLight ? 0.12 : 0.18));
  beamRight.addColorStop(1, hexAlpha(palette.accentAlt, 0));
  ctx.fillStyle = beamRight;
  ctx.beginPath();
  ctx.moveTo(width - padX, bodyTop);
  ctx.lineTo(width - padX - 260, bodyTop);
  ctx.lineTo(padX, bodyBottom);
  ctx.lineTo(width - padX - 120, bodyBottom);
  ctx.closePath();
  ctx.fill();

  // Double poster border inside body
  roundRectPath(ctx, padX, bodyTop + 12, innerWidth, bodyBottom - bodyTop - 24, 24);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  roundRectPath(ctx, padX + 12, bodyTop + 24, innerWidth - 24, bodyBottom - bodyTop - 48, 18);
  ctx.strokeStyle = hexAlpha(palette.border, 0.9);
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.restore();

  let y = bodyTop + (isStory ? 62 : 44);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.accent;
  ctx.font = `700 ${isStory ? 16 : 14}px ${fonts.mono}`;
  ctx.fillText("PRÄSENTIERT DEIN PERSÖNLICHES LINEUP", cx, y);
  y += isStory ? 30 : 24;

  ctx.fillStyle = palette.text;
  ctx.font = `800 ${isStory ? 72 : 52}px ${fonts.display}`;
  ctx.fillText("LOGGERYTHM FEST", cx, y);
  y += isStory ? 96 : 68;

  // Headliner medallion
  const headliner = artists[0];
  const medalSize = isStory ? 310 : 168;
  ctx.beginPath();
  ctx.arc(cx, y + medalSize / 2, medalSize / 2 + 12, 0, Math.PI * 2);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  drawCoverOrMonogram(
    ctx,
    headliner.cover,
    headliner.label,
    cx - medalSize / 2,
    y,
    medalSize,
    medalSize / 2,
    assets,
    palette,
    fonts,
    true,
  );
  y += medalSize + (isStory ? 42 : 20);

  ctx.fillStyle = palette.accent;
  ctx.font = `700 15px ${fonts.mono}`;
  ctx.fillText(
    options.showCounts ? `HEADLINER · ${headliner.count} WIEDERGABEN` : "MAIN STAGE HEADLINER",
    cx,
    y,
  );
  y += isStory ? 32 : 22;

  const headName = headliner.label.toUpperCase();
  const posterW = innerWidth - 96;
  const headSize = fitFontSize(ctx, headName, 800, fonts.display, isStory ? 92 : 62, 38, posterW);
  ctx.font = `800 ${headSize}px ${fonts.display}`;
  ctx.fillStyle = palette.text;
  ctx.fillText(truncateTextWithEllipsis(headName, posterW, (c) => ctx.measureText(c).width), cx, y);
  y += headSize + (isStory ? 54 : 22);

  // Co-Headliners (#2 - #4)
  const coHeadliners = artists.slice(1, 4);
  if (coHeadliners.length > 0) {
    ctx.fillStyle = palette.accentAlt;
    ctx.font = `700 14px ${fonts.mono}`;
    ctx.fillText("CO-HEADLINER", cx, y);
    y += isStory ? 32 : 22;

    const coStr = coHeadliners.map((a) => a.label.toUpperCase()).join("  ★  ");
    ctx.font = `800 ${isStory ? 44 : 28}px ${fonts.display}`;
    ctx.fillStyle = palette.text;
    const coLines = wrapTextLines(coStr, posterW, 2, (c) => ctx.measureText(c).width);
    coLines.forEach((line, idx) => {
      ctx.fillText(line, cx, y + idx * (isStory ? 54 : 35));
    });
    y += coLines.length * (isStory ? 54 : 35) + (isStory ? 46 : 18);
  }

  // Undercard (#5 - #10)
  const barH = 54;
  const barY = bodyBottom - barH - (isStory ? 36 : 28);
  const undercard = artists.slice(4, 10);
  if (undercard.length > 0 && y < barY - 64) {
    ctx.fillStyle = palette.muted;
    ctx.font = `700 14px ${fonts.mono}`;
    ctx.fillText("UNDERCARD & SPECIAL GUESTS", cx, y);
    y += isStory ? 28 : 20;

    const underStr = undercard.map((a) => a.label.toUpperCase()).join("  •  ");
    ctx.font = `700 ${isStory ? 27 : 20}px ${fonts.sans}`;
    ctx.fillStyle = hexAlpha(palette.text, 0.88);
    const underLines = wrapTextLines(underStr, posterW, isStory ? 4 : 2, (c) => ctx.measureText(c).width);
    underLines.forEach((line, idx) => {
      if (y + idx * (isStory ? 38 : 28) < barY - 36) {
        ctx.fillText(line, cx, y + idx * (isStory ? 38 : 28));
      }
    });
    y += underLines.length * (isStory ? 38 : 28) + (isStory ? 36 : 14);
  }

  // Top Albums stage billing in Story format if room remains
  if (isStory && report.top_albums.length > 0 && y < barY - 120) {
    const stageCardY = Math.max(y + 8, barY - 134);
    fillRoundRect(
      ctx,
      padX + 36,
      stageCardY,
      innerWidth - 72,
      96,
      16,
      hexAlpha(palette.surface, 0.78),
      palette.border,
      1.25,
    );
    ctx.fillStyle = palette.muted;
    ctx.font = `700 14px ${fonts.mono}`;
    ctx.fillText("SPECIAL ALBUM STAGES", cx, stageCardY + 20);
    ctx.font = `600 22px ${fonts.sans}`;
    ctx.fillStyle = palette.accentAlt;
    const albumBilling = report.top_albums.slice(0, 3).map((a) => a.label).join("  ·  ");
    ctx.fillText(
      truncateTextWithEllipsis(albumBilling, innerWidth - 130, (c) => ctx.measureText(c).width),
      cx,
      stageCardY + 50,
    );
  }

  // Bottom festival pass bar
  fillRoundRect(
    ctx,
    padX + 36,
    barY,
    innerWidth - 72,
    barH,
    14,
    palette.accent,
  );
  ctx.fillStyle = pickReadableInk(palette.accent);
  ctx.font = `800 17px ${fonts.mono}`;
  ctx.textBaseline = "middle";
  const dur = formatWrappedDurationHours(report.totals.listening_sec);
  const stamp = options.showCounts
    ? `STAGE: ${report.rhythm.chronotype_label.toUpperCase()}  ·  ${report.totals.unique_artists} ARTISTS  ·  ${dur.value} ${dur.unit.toUpperCase()} LIVE`
    : `STAGE: ${report.rhythm.chronotype_label.toUpperCase()}  ·  ALL ACCESS PASS`;
  ctx.fillText(truncateTextWithEllipsis(stamp, innerWidth - 110, (c) => ctx.measureText(c).width), cx, barY + barH / 2);
  ctx.restore();
}

function drawVinylSleeveCombo(
  ctx: CanvasRenderingContext2D,
  sleeveX: number,
  sleeveY: number,
  sleeveSize: number,
  coverUrl: string,
  title: string,
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const discR = sleeveSize * 0.46;
  const discCx = sleeveX + sleeveSize + discR * 0.42;
  const discCy = sleeveY + sleeveSize * 0.5;

  // Vinyl disc behind right side of sleeve
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#0e0e11";
  ctx.beginPath();
  ctx.arc(discCx, discCy, discR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Concentric grooves
  ctx.save();
  ctx.beginPath();
  ctx.arc(discCx, discCy, discR, 0, Math.PI * 2);
  ctx.clip();

  for (let r = discR * 0.4; r < discR * 0.96; r += 5) {
    ctx.strokeStyle = r % 15 === 0 ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(discCx, discCy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Specular light sheen wedges
  const sheen = ctx.createLinearGradient(discCx - discR, discCy - discR, discCx + discR, discCy + discR);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0.14)");
  sheen.addColorStop(0.55, "rgba(255,255,255,0.04)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(discCx - discR, discCy - discR, discR * 2, discR * 2);

  // Center paper label
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(discCx, discCy, discR * 0.34, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = pickReadableInk(palette.accent);
  ctx.font = `800 ${Math.max(10, Math.round(discR * 0.085))}px ${fonts.mono}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("45 RPM", discCx, discCy - discR * 0.17);

  // Spindle hole
  ctx.fillStyle = palette.bg;
  ctx.beginPath();
  ctx.arc(discCx, discCy, discR * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Sharp record sleeve in foreground
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetX = 12;
  ctx.shadowOffsetY = 16;
  drawCoverOrMonogram(ctx, coverUrl, title, sleeveX, sleeveY, sleeveSize, 14, assets, palette, fonts);
  ctx.restore();
}

function renderObsessionTemplate(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const obsession = report.obsession;
  if (!obsession) {
    drawEmptyStateCard(ctx, metrics, report, palette, fonts);
    return;
  }

  const { padX, bodyTop, bodyBottom, innerWidth } = metrics;
  const isStory = options.format === "story";

  if (isStory) {
    // Center the 480px sleeve + right-peeking vinyl disc (~794px total width)
    drawVinylSleeveCombo(
      ctx,
      Math.round((metrics.width - 794) / 2),
      bodyTop + 48,
      480,
      obsession.cover,
      obsession.title,
      assets,
      palette,
      fonts,
    );

    let y = bodyTop + 604;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = palette.accent;
    ctx.font = `700 17px ${fonts.mono}`;
    ctx.fillText("DEIN #1 OHRWURM · HEAVY ROTATION", padX, y);
    y += 40;

    ctx.font = `800 66px ${fonts.display}`;
    ctx.fillStyle = palette.text;
    const titleLines = wrapTextLines(obsession.title, innerWidth, 2, (c) => ctx.measureText(c).width);
    titleLines.forEach((line, idx) => {
      ctx.fillText(line, padX, y + idx * 74);
    });
    y += titleLines.length * 74 + 14;

    ctx.font = `600 28px ${fonts.sans}`;
    ctx.fillStyle = palette.muted;
    const artistAlbum = obsession.album ? `${obsession.artist} — ${obsession.album}` : obsession.artist;
    ctx.fillText(truncateTextWithEllipsis(artistAlbum, innerWidth, (c) => ctx.measureText(c).width), padX, y);
    y += 72;

    // Giant repeat hero card
    const cardH = 276;
    fillRoundRect(ctx, padX, y, innerWidth, cardH, 24, hexAlpha(palette.surface, 0.92), palette.border, 1.5);
    if (options.showCounts) {
      const numText = `${obsession.play_count}×`;
      ctx.font = `800 112px ${fonts.display}`;
      ctx.fillStyle = palette.accent;
      ctx.fillText(numText, padX + 34, y + 32);
      const nw = ctx.measureText(numText).width;
      ctx.font = `800 32px ${fonts.display}`;
      ctx.fillStyle = palette.text;
      ctx.fillText("AUF DAUERSCHLEIFE", padX + 34 + nw + 22, y + 82);

      const dur = formatWrappedDurationHours(obsession.listening_sec);
      ctx.font = `600 21px ${fonts.sans}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(
        `${obsession.share_pct}% deiner gesamten Hörzeit · ${dur.value} ${dur.unit}`,
        padX + 34,
        y + 168,
      );

      if (obsession.peak_day_date) {
        drawPill(
          ctx,
          padX + 34,
          y + 210,
          `HEISSESTER TAG: ${formatGermanDateShort(obsession.peak_day_date)} · ${obsession.peak_day_plays}×`,
          hexAlpha(palette.accentAlt, 0.16),
          palette.accentAlt,
          hexAlpha(palette.accentAlt, 0.45),
          `700 15px ${fonts.mono}`,
          16,
          36,
        );
      }
    } else {
      ctx.font = `800 54px ${fonts.display}`;
      ctx.fillStyle = palette.accent;
      ctx.fillText("AUF DAUERSCHLEIFE", padX + 34, y + 52);
      ctx.font = `500 24px ${fonts.sans}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText("Meistgespielter Track in diesem Zeitraum", padX + 34, y + 128);
      if (obsession.peak_day_date) {
        drawPill(
          ctx,
          padX + 34,
          y + 194,
          `REKORD-TAG: ${formatGermanDateShort(obsession.peak_day_date)}`,
          hexAlpha(palette.accentAlt, 0.16),
          palette.accentAlt,
          hexAlpha(palette.accentAlt, 0.45),
          `700 15px ${fonts.mono}`,
          16,
          36,
        );
      }
    }

    // Runner-ups #2 and #3 anchored cleanly near bottom
    const runners = report.top_tracks.slice(1, 3);
    if (runners.length > 0) {
      const runH = 220;
      const runY = Math.max(y + cardH + 34, bodyBottom - runH - 16);
      const colW = (innerWidth - 24) / 2;
      runners.forEach((item, idx) => {
        const rx = padX + idx * (colW + 24);
        fillRoundRect(ctx, rx, runY, colW, runH, 20, hexAlpha(palette.surface, 0.85), palette.border, 1.25);
        ctx.font = `700 14px ${fonts.mono}`;
        ctx.fillStyle = palette.accentAlt;
        ctx.fillText(`PLATZ 0${item.rank}`, rx + 24, runY + 24);

        const cSize = 108;
        drawCoverOrMonogram(ctx, item.cover, item.label, rx + 24, runY + 68, cSize, 14, assets, palette, fonts);

        const tx = rx + 24 + cSize + 18;
        const tw = colW - 48 - cSize - 18;
        ctx.font = `700 23px ${fonts.sans}`;
        ctx.fillStyle = palette.text;
        ctx.fillText(truncateTextWithEllipsis(item.label, tw, (c) => ctx.measureText(c).width), tx, runY + 72);

        ctx.font = `500 18px ${fonts.sans}`;
        ctx.fillStyle = palette.muted;
        ctx.fillText(truncateTextWithEllipsis(item.sublabel, tw, (c) => ctx.measureText(c).width), tx, runY + 108);

        if (options.showCounts) {
          ctx.font = `700 16px ${fonts.mono}`;
          ctx.fillStyle = palette.accent;
          ctx.fillText(`${item.count}× gespielt`, tx, runY + 144);
        }
      });
    }
    ctx.restore();
    return;
  }

  // SQUARE (1080x1080): 288px sleeve + peeking vinyl fits cleanly left of x=540
  drawVinylSleeveCombo(
    ctx,
    padX + 8,
    bodyTop + 42,
    288,
    obsession.cover,
    obsession.title,
    assets,
    palette,
    fonts,
  );

  const rightX = padX + 506;
  const rightW = innerWidth - 506;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.accent;
  ctx.font = `700 15px ${fonts.mono}`;
  ctx.fillText("DEIN #1 OHRWURM", rightX, bodyTop + 38);

  ctx.font = `800 44px ${fonts.display}`;
  ctx.fillStyle = palette.text;
  const titleLines = wrapTextLines(obsession.title, rightW, 2, (c) => ctx.measureText(c).width);
  titleLines.forEach((line, idx) => {
    ctx.fillText(line, rightX, bodyTop + 72 + idx * 50);
  });

  const subY = bodyTop + 72 + titleLines.length * 50 + 10;
  ctx.font = `600 22px ${fonts.sans}`;
  ctx.fillStyle = palette.muted;
  ctx.fillText(truncateTextWithEllipsis(obsession.artist, rightW, (c) => ctx.measureText(c).width), rightX, subY);

  if (options.showCounts) {
    ctx.font = `800 76px ${fonts.display}`;
    ctx.fillStyle = palette.accent;
    ctx.fillText(`${obsession.play_count}×`, rightX, subY + 46);
    ctx.font = `700 17px ${fonts.mono}`;
    ctx.fillStyle = palette.text;
    ctx.fillText(`AUF DAUERSCHLEIFE · ${obsession.share_pct}% SHARE`, rightX, subY + 132);
  } else {
    ctx.font = `800 34px ${fonts.display}`;
    ctx.fillStyle = palette.accent;
    ctx.fillText("AUF DAUERSCHLEIFE", rightX, subY + 60);
  }

  // Peak Day + Runner-Ups card at bottom
  const bottomY = bodyTop + 420;
  const bottomH = bodyBottom - bottomY - 12;
  fillRoundRect(ctx, padX, bottomY, innerWidth, bottomH, 22, hexAlpha(palette.surface, 0.9), palette.border, 1.5);

  const infoY = bottomY + 26;
  if (obsession.peak_day_date) {
    const peakText = options.showCounts
      ? `HEISSESTER TAG: ${formatGermanDateShort(obsession.peak_day_date)} · ${obsession.peak_day_plays}× AN EINEM TAG`
      : `REKORD-TAG: ${formatGermanDateShort(obsession.peak_day_date)}`;
    drawPill(
      ctx,
      padX + 28,
      infoY,
      peakText,
      hexAlpha(palette.accentAlt, 0.16),
      palette.accentAlt,
      hexAlpha(palette.accentAlt, 0.45),
      `700 14px ${fonts.mono}`,
      16,
      36,
    );
  }
  if (options.showCounts) {
    const dur = formatWrappedDurationHours(obsession.listening_sec);
    ctx.textAlign = "right";
    ctx.fillStyle = palette.muted;
    ctx.font = `700 15px ${fonts.mono}`;
    ctx.fillText(`${dur.value} ${dur.unit.toUpperCase()} GESAMT`, padX + innerWidth - 28, infoY + 10);
    ctx.textAlign = "left";
  }

  const runners = report.top_tracks.slice(1, 3);
  if (runners.length > 0) {
    const divY = bottomY + 86;
    ctx.strokeStyle = hexAlpha(palette.border, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX + 28, divY);
    ctx.lineTo(padX + innerWidth - 28, divY);
    ctx.stroke();

    ctx.font = `700 14px ${fonts.mono}`;
    ctx.fillStyle = palette.muted;
    ctx.fillText("VERFOLGER AUF DEN PLÄTZEN 02 & 03", padX + 28, divY + 20);
    const colW = (innerWidth - 80) / 2;
    runners.forEach((item, idx) => {
      const rx = padX + 28 + idx * (colW + 24);
      const ry = divY + 60;
      const cSize = 104;
      drawCoverOrMonogram(ctx, item.cover, item.label, rx, ry, cSize, 12, assets, palette, fonts);
      const tx = rx + cSize + 18;
      const tw = colW - cSize - 18;
      ctx.font = `700 22px ${fonts.sans}`;
      ctx.fillStyle = palette.text;
      ctx.fillText(truncateTextWithEllipsis(`0${item.rank} · ${item.label}`, tw, (c) => ctx.measureText(c).width), tx, ry + 8);
      ctx.font = `500 17px ${fonts.sans}`;
      ctx.fillStyle = palette.muted;
      ctx.fillText(truncateTextWithEllipsis(item.sublabel, tw, (c) => ctx.measureText(c).width), tx, ry + 42);
      if (options.showCounts) {
        ctx.font = `700 15px ${fonts.mono}`;
        ctx.fillStyle = palette.accent;
        ctx.fillText(`${item.count}× gespielt`, tx, ry + 74);
      }
    });
  }
  ctx.restore();
}

function drawPolarClockRadar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outerRadius: number,
  report: WrappedReport,
  options: WrappedCardOptions,
  auraColors: readonly [string, string, string],
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const innerRadius = outerRadius * 0.34;
  const maxHourly = Math.max(1, ...report.rhythm.hourly_distribution);

  ctx.save();
  // Dashed concentric scale rings
  for (const frac of [0.34, 0.56, 0.78, 1.0]) {
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius * frac, 0, Math.PI * 2);
    ctx.strokeStyle = frac === 1.0 ? hexAlpha(palette.border, 0.95) : hexAlpha(palette.border, 0.55);
    ctx.lineWidth = 1.25;
    if (frac < 1.0 && frac > 0.35) ctx.setLineDash([5, 6]);
    else ctx.setLineDash([]);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 24 radial hourly bars (00h at top -PI/2, clockwise)
  for (let hour = 0; hour < 24; hour += 1) {
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const count = report.rhythm.hourly_distribution[hour];
    const ratio = count / maxHourly;
    const barLen = innerRadius + 10 + (outerRadius - innerRadius - 22) * Math.max(0.08, ratio);
    const isPeak = hour === report.rhythm.peak_hour && report.totals.play_count > 0;

    const color = isPeak
      ? palette.accent
      : hour < 6 || hour >= 22
        ? auraColors[0]
        : hour < 14
          ? auraColors[1]
          : auraColors[2];

    ctx.save();
    ctx.strokeStyle = isPeak ? palette.accent : hexAlpha(color, 0.35 + ratio * 0.65);
    ctx.lineWidth = isPeak ? 15 : 11;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * (innerRadius + 8), cy + Math.sin(angle) * (innerRadius + 8));
    ctx.lineTo(cx + Math.cos(angle) * barLen, cy + Math.sin(angle) * barLen);
    ctx.stroke();

    if (isPeak) {
      ctx.fillStyle = palette.text;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * (barLen + 14), cy + Math.sin(angle) * (barLen + 14), 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Cardinal clock markers (00h, 06h, 12h, 18h)
  const labelOffset = outerRadius + 24;
  ctx.font = `700 15px ${fonts.mono}`;
  ctx.fillStyle = palette.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("00h", cx, cy - labelOffset);
  ctx.fillText("06h", cx + labelOffset + 6, cy);
  ctx.fillText("12h", cx, cy + labelOffset);
  ctx.fillText("18h", cx - labelOffset - 6, cy);

  // Center core readout
  ctx.fillStyle = hexAlpha(palette.surface, 0.94);
  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.muted;
  ctx.font = `700 13px ${fonts.mono}`;
  ctx.fillText("PEAK-UHR", cx, cy - 22);
  ctx.fillStyle = palette.accent;
  ctx.font = `800 ${Math.round(innerRadius * 0.42)}px ${fonts.display}`;
  ctx.fillText(`${String(report.rhythm.peak_hour).padStart(2, "0")}:00`, cx, cy + 12);
  if (options.showCounts) {
    ctx.fillStyle = palette.muted;
    ctx.font = `600 12px ${fonts.mono}`;
    ctx.fillText(`${report.rhythm.hourly_distribution[report.rhythm.peak_hour]} PLAYS`, cx, cy + 44);
  }
  ctx.restore();
}

function renderAuraTemplate(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const { padX, bodyTop, bodyBottom, width, innerWidth } = metrics;
  const isStory = options.format === "story";
  const aura = report.aura;
  const auraColors: [string, string, string] = aura
    ? aura.colors
    : [palette.accent, palette.accentAlt, palette.accent];

  // Layered luminous organic aura mesh orbs
  ctx.save();
  const orbSpots = isStory
    ? [
        [width * 0.28, bodyTop + 340, 340, auraColors[0]],
        [width * 0.76, bodyTop + 420, 320, auraColors[1]],
        [width * 0.5, bodyTop + 820, 380, auraColors[2]],
      ]
    : [
        [width * 0.25, bodyTop + 360, 280, auraColors[0]],
        [width * 0.72, bodyTop + 260, 270, auraColors[1]],
        [width * 0.68, bodyTop + 620, 290, auraColors[2]],
      ];

  orbSpots.forEach(([ox, oy, rad, color]) => {
    const cx = ox as number;
    const cy = oy as number;
    const r = rad as number;
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
    grad.addColorStop(0, hexAlpha(color as string, palette.isLight ? 0.22 : 0.3));
    grad.addColorStop(1, hexAlpha(color as string, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  if (isStory) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = palette.accent;
    ctx.font = `700 17px ${fonts.mono}`;
    ctx.fillText("DEINE KLANG-AURA & 24H-RADAR", width / 2, bodyTop + 24);

    const auraTitle = aura ? aura.title : report.rhythm.chronotype_label;
    const titleSize = fitFontSize(ctx, auraTitle, 800, fonts.display, 72, 42, innerWidth);
    ctx.font = `800 ${titleSize}px ${fonts.display}`;
    ctx.fillStyle = palette.text;
    ctx.fillText(truncateTextWithEllipsis(auraTitle, innerWidth, (c) => ctx.measureText(c).width), width / 2, bodyTop + 62);

    const desc = aura?.description ?? `Dein Fokus liegt rund um ${String(report.rhythm.peak_hour).padStart(2, "0")}:00 Uhr.`;
    ctx.font = `500 23px ${fonts.sans}`;
    ctx.fillStyle = palette.muted;
    const descLines = wrapTextLines(desc, Math.min(780, innerWidth - 40), 2, (c) => ctx.measureText(c).width);
    descLines.forEach((line, idx) => {
      ctx.fillText(line, width / 2, bodyTop + 150 + idx * 34);
    });

    // Mood tags + color dots
    const tags = aura?.mood_tags.slice(0, 3) ?? [report.rhythm.chronotype_label];
    const tagY = bodyTop + 238;
    ctx.font = `600 16px ${fonts.mono}`;
    const pillWidths = tags.map((t) => Math.ceil(ctx.measureText(`  ${t.toUpperCase()}`).width + 44));
    const totalW = pillWidths.reduce((a, b) => a + b, 0) + Math.max(0, tags.length - 1) * 12;
    let px = width / 2 - totalW / 2;
    tags.forEach((tag, idx) => {
      const col = auraColors[idx % 3];
      const pw = drawPill(
        ctx,
        px,
        tagY,
        `  ${tag.toUpperCase()}`,
        hexAlpha(palette.surface, 0.9),
        palette.text,
        hexAlpha(col, 0.7),
        `600 16px ${fonts.mono}`,
        22,
        40,
      );
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(px + 16, tagY + 20, 4.5, 0, Math.PI * 2);
      ctx.fill();
      px += pw + 12;
    });
    ctx.restore();

    drawPolarClockRadar(ctx, width / 2, bodyTop + 660, 275, report, options, auraColors, palette, fonts);

    // Chronotype, BPM & Weekday Pulse Strip
    const stripY = bodyTop + 1045;
    const stripH = bodyBottom - stripY - 18;
    fillRoundRect(ctx, padX, stripY, innerWidth, stripH, 24, hexAlpha(palette.surface, 0.88), palette.border, 1.5);

    ctx.save();
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillStyle = palette.muted;
    ctx.font = `700 14px ${fonts.mono}`;
    ctx.fillText("WOCHEN-PULS & RHYTHMUS", padX + 28, stripY + 24);

    // Badges row inside strip
    let bx = padX + 28;
    const badgeY = stripY + 56;
    bx +=
      drawPill(
        ctx,
        bx,
        badgeY,
        `CHRONOTYP: ${report.rhythm.chronotype_label.toUpperCase()}`,
        hexAlpha(palette.accent, 0.16),
        palette.accent,
        hexAlpha(palette.accent, 0.45),
        `700 15px ${fonts.mono}`,
        16,
        38,
      ) + 12;
    if (report.tempo) {
      drawPill(
        ctx,
        bx,
        badgeY,
        `${report.tempo.avg_bpm} BPM · ${report.tempo.vibe_label.toUpperCase()}`,
        hexAlpha(palette.accentAlt, 0.16),
        palette.accentAlt,
        hexAlpha(palette.accentAlt, 0.45),
        `700 15px ${fonts.mono}`,
        16,
        38,
      );
    }

    // 7-day bar strip
    const barsY = stripY + 132;
    const barsH = stripH - 178;
    const maxWeek = Math.max(1, ...report.rhythm.weekday_distribution);
    const barGap = 20;
    const barW = (innerWidth - 56 - barGap * 6) / 7;
    WEEKDAYS_SHORT.forEach((day, idx) => {
      const val = report.rhythm.weekday_distribution[idx];
      const ratio = val / maxWeek;
      const colH = Math.max(16, ratio * (barsH - 42));
      const x = padX + 28 + idx * (barW + barGap);
      const y = barsY + (barsH - 42) - colH;
      const isPeak = idx === report.rhythm.peak_weekday && report.totals.play_count > 0;
      fillRoundRect(ctx, x, y, barW, colH, 12, isPeak ? palette.accent : hexAlpha(auraColors[idx % 3], 0.7));
      ctx.fillStyle = isPeak ? palette.accent : palette.muted;
      ctx.textAlign = "center";
      ctx.font = `700 16px ${fonts.mono}`;
      ctx.fillText(day, x + barW / 2, barsY + barsH - 26);
    });
    ctx.restore();
    return;
  }

  // SQUARE (1080x1080)
  drawPolarClockRadar(ctx, padX + 240, bodyTop + 305, 198, report, options, auraColors, palette, fonts);

  const rightX = padX + 520;
  const rightW = innerWidth - 520;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.accent;
  ctx.font = `700 15px ${fonts.mono}`;
  ctx.fillText("KLANG-AURA & 24H-RADAR", rightX, bodyTop + 34);

  const auraTitle = aura ? aura.title : report.rhythm.chronotype_label;
  const titleSize = fitFontSize(ctx, auraTitle, 800, fonts.display, 54, 34, rightW);
  ctx.font = `800 ${titleSize}px ${fonts.display}`;
  ctx.fillStyle = palette.text;
  ctx.fillText(truncateTextWithEllipsis(auraTitle, rightW, (c) => ctx.measureText(c).width), rightX, bodyTop + 68);

  const desc = aura?.description ?? `Peak um ${String(report.rhythm.peak_hour).padStart(2, "0")}:00 Uhr.`;
  ctx.font = `500 20px ${fonts.sans}`;
  ctx.fillStyle = palette.muted;
  const descLines = wrapTextLines(desc, rightW, 3, (c) => ctx.measureText(c).width);
  descLines.forEach((line, idx) => {
    ctx.fillText(line, rightX, bodyTop + 140 + idx * 28);
  });

  // Mood tags stacked cleanly in right column
  const tags = aura?.mood_tags.slice(0, 3) ?? [];
  let ty = bodyTop + 250;
  tags.forEach((tag, idx) => {
    drawPill(
      ctx,
      rightX,
      ty,
      tag.toUpperCase(),
      hexAlpha(palette.surface, 0.92),
      palette.text,
      hexAlpha(auraColors[idx % 3], 0.7),
      `600 14px ${fonts.mono}`,
      16,
      34,
    );
    ty += 44;
  });

  // Bottom badges + weekday pulse strip
  const stripY = bodyTop + 605;
  const stripH = bodyBottom - stripY - 12;
  fillRoundRect(ctx, padX, stripY, innerWidth, stripH, 20, hexAlpha(palette.surface, 0.9), palette.border, 1.5);
  ctx.font = `700 15px ${fonts.mono}`;
  ctx.fillStyle = palette.accent;
  ctx.fillText(`CHRONOTYP: ${report.rhythm.chronotype_label.toUpperCase()}`, padX + 28, stripY + 32);
  if (report.tempo) {
    ctx.fillStyle = palette.accentAlt;
    ctx.fillText(`${report.tempo.avg_bpm} BPM · ${report.tempo.vibe_label.toUpperCase()}`, padX + 28, stripY + 70);
  }
  if (options.showCounts) {
    ctx.fillStyle = palette.muted;
    ctx.fillText(`WOCHENENDE: ${report.rhythm.weekend_share_pct}%`, padX + 28, stripY + (report.tempo ? 112 : 70));
  }

  // Compact 7-day weekday pulse strip on right side
  const sqBarLeft = padX + 490;
  const sqBarW = innerWidth - 518;
  const maxWeek = Math.max(1, ...report.rhythm.weekday_distribution);
  const barGap = 12;
  const colW = (sqBarW - barGap * 6) / 7;
  const barsTop = stripY + 34;
  const barsAreaH = stripH - 84;
  WEEKDAYS_SHORT.forEach((day, idx) => {
    const val = report.rhythm.weekday_distribution[idx];
    const h = Math.max(12, (val / maxWeek) * barsAreaH);
    const bx = sqBarLeft + idx * (colW + barGap);
    const by = barsTop + barsAreaH - h;
    const isPeak = idx === report.rhythm.peak_weekday && report.totals.play_count > 0;
    fillRoundRect(ctx, bx, by, colW, h, 8, isPeak ? palette.accent : hexAlpha(auraColors[idx % 3], 0.72));
    ctx.textAlign = "center";
    ctx.fillStyle = isPeak ? palette.accent : palette.muted;
    ctx.font = `700 13px ${fonts.mono}`;
    ctx.fillText(day, bx + colW / 2, barsTop + barsAreaH + 10);
  });
  ctx.restore();
}

function drawActiveDaysRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  activeDays: number,
  totalDays: number,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  const denom = Math.max(1, activeDays, totalDays);
  const ratio = Math.min(1, Math.max(0, activeDays / denom));

  const strokeW = radius < 65 ? 11 : 14;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = hexAlpha(palette.border, 0.85);
  ctx.lineWidth = strokeW;
  ctx.stroke();

  if (ratio > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = strokeW;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.text;
  ctx.font = `800 ${Math.round(radius * 0.54)}px ${fonts.display}`;
  ctx.fillText(String(activeDays), cx, cy - Math.round(radius * 0.14));
  ctx.fillStyle = palette.muted;
  ctx.font = `700 ${radius < 65 ? 11 : 13}px ${fonts.mono}`;
  ctx.fillText(`/ ${denom} TAGE`, cx, cy + Math.round(radius * 0.34));
  ctx.restore();
}

function renderPeakTemplate(
  ctx: CanvasRenderingContext2D,
  metrics: SafeCardMetrics,
  report: WrappedReport,
  options: WrappedCardOptions,
  assets: WrappedAssets,
  palette: WrappedThemePalette,
  fonts: CanvasFontStack,
): void {
  if (report.totals.play_count === 0) {
    drawEmptyStateCard(ctx, metrics, report, palette, fonts);
    return;
  }

  const { padX, bodyTop, bodyBottom, innerWidth } = metrics;
  const isStory = options.format === "story";
  const gap = 22;

  // Top Scoreboard Row: Streaks + Active Days Ring
  const topH = isStory ? 300 : 210;
  const cardW = (innerWidth - gap * 2) / 3;

  // Card 1: Longest Streak
  fillRoundRect(ctx, padX, bodyTop + 14, cardW, topH, 22, hexAlpha(palette.surface, 0.9), palette.border, 1.5);
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = palette.accent;
  ctx.font = `700 14px ${fonts.mono}`;
  ctx.fillText("REKORD-SERIE", padX + 24, bodyTop + 36);
  ctx.fillStyle = palette.text;
  ctx.font = `800 ${isStory ? 88 : 62}px ${fonts.display}`;
  ctx.fillText(String(report.totals.longest_streak_days), padX + 24, bodyTop + (isStory ? 92 : 68));
  ctx.fillStyle = palette.muted;
  ctx.font = `600 18px ${fonts.sans}`;
  ctx.fillText(report.totals.longest_streak_days === 1 ? "Tag in Folge" : "Tage in Folge", padX + 24, bodyTop + topH - 36);

  // Card 2: Current Streak
  const c2x = padX + cardW + gap;
  fillRoundRect(ctx, c2x, bodyTop + 14, cardW, topH, 22, hexAlpha(palette.surface, 0.9), palette.border, 1.5);
  ctx.fillStyle = palette.accentAlt;
  ctx.font = `700 14px ${fonts.mono}`;
  ctx.fillText("AKTUELLE SERIE", c2x + 24, bodyTop + 36);
  ctx.fillStyle = palette.text;
  ctx.font = `800 ${isStory ? 88 : 62}px ${fonts.display}`;
  ctx.fillText(String(report.totals.current_streak_days), c2x + 24, bodyTop + (isStory ? 92 : 68));
  ctx.fillStyle = palette.muted;
  ctx.font = `600 18px ${fonts.sans}`;
  ctx.fillText("Aktiv bis heute", c2x + 24, bodyTop + topH - 36);

  // Card 3: Active Days Ring
  const c3x = padX + (cardW + gap) * 2;
  fillRoundRect(ctx, c3x, bodyTop + 14, cardW, topH, 22, hexAlpha(palette.surface, 0.9), palette.border, 1.5);
  ctx.fillStyle = palette.muted;
  ctx.font = `700 14px ${fonts.mono}`;
  ctx.fillText("AKTIVE TAGE", c3x + 24, bodyTop + 36);
  drawActiveDaysRing(
    ctx,
    c3x + cardW / 2,
    bodyTop + 14 + topH * 0.57,
    isStory ? 78 : 56,
    report.totals.active_days,
    report.totals.total_days,
    palette,
    fonts,
  );
  ctx.restore();

  // Centerpiece: Tear-Off Calendar Peak Day Card
  const calY = bodyTop + topH + (isStory ? 44 : 30);
  const calH = isStory ? 680 : 356;
  fillRoundRect(ctx, padX, calY, innerWidth, calH, 26, hexAlpha(palette.surface, 0.94), palette.border, 1.5);

  // Calendar Top Accent Ribbon with binder holes
  const ribbonH = isStory ? 78 : 58;
  ctx.save();
  roundRectPath(ctx, padX, calY, innerWidth, ribbonH, 26);
  ctx.clip();
  ctx.fillStyle = palette.accent;
  ctx.fillRect(padX, calY, innerWidth, ribbonH);
  ctx.restore();
  // Square off lower corners of ribbon cleanly
  ctx.fillStyle = palette.accent;
  ctx.fillRect(padX, calY + ribbonH - 20, innerWidth, 20);

  const ribbonInk = pickReadableInk(palette.accent);
  ctx.save();
  ctx.fillStyle = hexAlpha(ribbonInk, 0.28);
  [0.14, 0.86].forEach((frac) => {
    ctx.beginPath();
    ctx.arc(padX + innerWidth * frac, calY + ribbonH / 2, 9, 0, Math.PI * 2);
    ctx.fill();
  });

  const peak = report.peak_day;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = ribbonInk;
  ctx.font = `800 ${isStory ? 20 : 17}px ${fonts.mono}`;
  const weekdayName = peak ? WEEKDAYS_LONG[peak.weekday].toUpperCase() : WEEKDAYS_LONG[report.rhythm.peak_weekday].toUpperCase();
  ctx.fillText(`REKORD-TAG · ${weekdayName}`, metrics.width / 2, calY + ribbonH / 2 + 1);

  if (peak) {
    const parsed = new Date(peak.date);
    const validDate = !Number.isNaN(parsed.getTime());
    const dayStr = validDate ? String(parsed.getUTCDate()).padStart(2, "0") : peak.date.slice(8, 10) || "01";
    const monthYear = validDate
      ? parsed.toLocaleDateString("de-DE", { month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase()
      : peak.date;

    const bodyY = calY + ribbonH + (isStory ? 40 : 20);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = palette.text;
    ctx.font = `800 ${isStory ? 148 : 96}px ${fonts.display}`;
    ctx.fillText(dayStr, padX + 36, bodyY);

    ctx.fillStyle = palette.accent;
    ctx.font = `700 ${isStory ? 28 : 21}px ${fonts.mono}`;
    ctx.fillText(monthYear, padX + 36, bodyY + (isStory ? 156 : 102));

    if (options.showCounts) {
      const peakDur = formatWrappedDurationHours(peak.listening_sec);
      ctx.fillStyle = palette.muted;
      ctx.font = `600 ${isStory ? 26 : 18}px ${fonts.sans}`;
      const peakMeta = `${peak.play_count} Wiedergaben · ${peakDur.value} ${peakDur.unit}`;
      ctx.fillText(
        truncateTextWithEllipsis(peakMeta, isStory ? innerWidth - 72 : 292, (c) => ctx.measureText(c).width),
        padX + 36,
        bodyY + (isStory ? 202 : 138),
      );
    }

    // Track spotlight inside calendar card
    const trackBoxY = isStory ? bodyY + 280 : bodyY + 12;
    const trackBoxX = isStory ? padX + 36 : padX + 350;
    const trackBoxW = isStory ? innerWidth - 72 : innerWidth - 386;
    const trackBoxH = isStory ? 236 : 214;
    fillRoundRect(ctx, trackBoxX, trackBoxY, trackBoxW, trackBoxH, 20, hexAlpha(palette.bgSecondary, 0.92), palette.border, 1.25);

    const artSize = isStory ? 156 : 132;
    drawCoverOrMonogram(
      ctx,
      peak.top_track_cover,
      peak.top_track_title || "LoggeRythm",
      trackBoxX + 24,
      trackBoxY + (trackBoxH - artSize) / 2,
      artSize,
      14,
      assets,
      palette,
      fonts,
    );

    const tx = trackBoxX + 24 + artSize + 24;
    const tw = trackBoxW - 48 - artSize - 24;
    ctx.fillStyle = palette.accentAlt;
    ctx.font = `700 14px ${fonts.mono}`;
    ctx.fillText("AN DIESEM TAG MEISTGESPIELT", tx, trackBoxY + (isStory ? 38 : 34));

    ctx.fillStyle = palette.text;
    ctx.font = `800 ${isStory ? 34 : 26}px ${fonts.display}`;
    const tLines = wrapTextLines(peak.top_track_title || "Top-Titel", tw, 2, (c) => ctx.measureText(c).width);
    tLines.forEach((line, idx) => {
      ctx.fillText(line, tx, trackBoxY + (isStory ? 70 : 64) + idx * (isStory ? 40 : 32));
    });

    ctx.fillStyle = palette.muted;
    ctx.font = `500 ${isStory ? 22 : 18}px ${fonts.sans}`;
    ctx.fillText(
      truncateTextWithEllipsis(peak.top_track_artist || "", tw, (c) => ctx.measureText(c).width),
      tx,
      trackBoxY + (isStory ? 158 : 138),
    );
  }
  ctx.restore();

  // Bottom Weekday Equalizer Bars
  const eqY = calY + calH + (isStory ? 36 : 24);
  const eqH = bodyBottom - eqY - 10;
  fillRoundRect(ctx, padX, eqY, innerWidth, eqH, 24, hexAlpha(palette.surface, 0.9), palette.border, 1.5);

  ctx.save();
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = palette.muted;
  ctx.font = `700 14px ${fonts.mono}`;
  ctx.fillText("WOCHENTAGS-PROFIL", padX + 28, eqY + 22);

  if (options.showCounts) {
    ctx.textAlign = "right";
    ctx.fillStyle = palette.accent;
    ctx.fillText(`WOCHENENDE: ${report.rhythm.weekend_share_pct}%`, padX + innerWidth - 28, eqY + 22);
  }

  const maxWeek = Math.max(1, ...report.rhythm.weekday_distribution);
  const barsTop = eqY + (isStory ? 74 : 58);
  const barsAreaH = eqH - (isStory ? 116 : 92);
  const barGap = 20;
  const barW = (innerWidth - 56 - barGap * 6) / 7;

  WEEKDAYS_SHORT.forEach((day, idx) => {
    const val = report.rhythm.weekday_distribution[idx];
    const ratio = val / maxWeek;
    const h = Math.max(14, ratio * barsAreaH);
    const bx = padX + 28 + idx * (barW + barGap);
    const by = barsTop + barsAreaH - h;
    const isPeak = idx === report.rhythm.peak_weekday;
    fillRoundRect(ctx, bx, by, barW, h, 12, isPeak ? palette.accent : hexAlpha(palette.accentAlt, 0.65));

    ctx.textAlign = "center";
    ctx.fillStyle = isPeak ? palette.accent : palette.muted;
    ctx.font = `700 15px ${fonts.mono}`;
    ctx.fillText(day, bx + barW / 2, barsTop + barsAreaH + 10);
  });
  ctx.restore();
}

export async function renderWrappedCard(
  canvas: HTMLCanvasElement,
  report: WrappedReport,
  options: WrappedCardOptions,
  assets: WrappedAssets,
): Promise<void> {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new Error("Rendering fehlgeschlagen: Ungültiges Canvas-Element.");
  }
  if (!report || typeof report !== "object" || !report.totals) {
    throw new Error("Rendering fehlgeschlagen: Ungültiger Wrapped-Bericht.");
  }
  if (!assets || !(assets.images instanceof Map) || !Array.isArray(assets.failedUrls)) {
    throw new Error("Rendering fehlgeschlagen: Ungültiges Assets-Objekt.");
  }

  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const metrics = computeSafeCardMetrics(options.format);
  canvas.width = metrics.width;
  canvas.height = metrics.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D-Canvas-Kontext konnte nicht initialisiert werden.");
  }

  const palette = resolveCardPalette(options.theme, assets.coverPalette, report.aura);
  const fonts = resolveCanvasFonts();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, metrics.width, metrics.height);

  drawBackground(ctx, metrics, palette);
  drawHeader(ctx, metrics, report, options, assets, palette, fonts);

  if (report.totals.play_count === 0) {
    drawEmptyStateCard(ctx, metrics, report, palette, fonts);
  } else {
    switch (options.template) {
      case "summary":
        renderSummaryTemplate(ctx, metrics, report, options, assets, palette, fonts);
        break;
      case "persona":
        renderPersonaTemplate(ctx, metrics, report, options, palette, fonts);
        break;
      case "receipt":
        renderReceiptTemplate(ctx, metrics, report, options, palette, fonts);
        break;
      case "festival":
        renderFestivalTemplate(ctx, metrics, report, options, assets, palette, fonts);
        break;
      case "obsession":
        renderObsessionTemplate(ctx, metrics, report, options, assets, palette, fonts);
        break;
      case "aura":
        renderAuraTemplate(ctx, metrics, report, options, palette, fonts);
        break;
      case "peak":
        renderPeakTemplate(ctx, metrics, report, options, assets, palette, fonts);
        break;
      default:
        throw new Error(`Unbekannte Wrapped-Kartenvorlage: ${String(options.template)}.`);
    }
  }

  drawFooter(ctx, metrics, report, options, palette, fonts);
}
