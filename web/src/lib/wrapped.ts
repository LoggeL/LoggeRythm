/**
 * Strict decoder, theme system, template registry, and PNG/Web-Share utilities
 * for LoggeRythm Wrapped Share Cards (`GET /api/me/stats/wrapped`).
 *
 * Follows AGENTS.md: fail loud and clear on invalid contracts or export errors.
 */

export type InsightsRange = "7d" | "30d" | "90d" | "year" | "all";
export type WrappedChronotype = "night_owl" | "early_bird" | "day_cruiser" | "evening_viber";
export type WrappedEmblemId =
  | "moon_wave"
  | "infinite_vinyl"
  | "compass_radar"
  | "tonearm_disc"
  | "strobe_bars"
  | "sunrise_pulse"
  | "flame_metro"
  | "prism_beat";

export interface WrappedUser {
  display_name: string;
  avatar_url: string;
}

export interface WrappedTotals {
  play_count: number;
  listening_sec: number;
  unique_tracks: number;
  unique_artists: number;
  unique_albums: number;
  new_artists_count: number;
  active_days: number;
  total_days: number;
  avg_daily_sec: number;
  current_streak_days: number;
  longest_streak_days: number;
}

export interface WrappedPersona {
  id: string;
  title: string;
  subtitle: string;
  tagline: string;
  emblem: WrappedEmblemId;
  traits: string[];
}

export interface WrappedAura {
  id: string;
  title: string;
  description: string;
  colors: [string, string, string];
  mood_tags: string[];
}

export interface WrappedRhythm {
  chronotype: WrappedChronotype;
  chronotype_label: string;
  peak_hour: number;
  peak_weekday: number;
  weekend_share_pct: number;
  discovery_score_pct: number;
  repeat_score_pct: number;
  hourly_distribution: number[];
  weekday_distribution: number[];
}

export interface WrappedObsession {
  track_key: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  play_count: number;
  listening_sec: number;
  share_pct: number;
  peak_day_date: string | null;
  peak_day_plays: number;
}

export interface WrappedPeakDay {
  date: string;
  weekday: number;
  play_count: number;
  listening_sec: number;
  top_track_title: string;
  top_track_artist: string;
  top_track_cover: string;
}

export interface WrappedTempo {
  avg_bpm: number;
  min_bpm: number;
  max_bpm: number;
  analyzed_plays: number;
  vibe_label: string;
}

export interface WrappedEquivalent {
  icon: "vinyl" | "movie" | "flight" | "marathon" | "concert";
  value: string;
  label: string;
}

export interface WrappedRankedItem {
  rank: number;
  key: string;
  label: string;
  sublabel: string;
  cover: string;
  count: number;
  listening_sec: number;
  share_pct: number;
}

export interface WrappedReport {
  range: InsightsRange;
  generated_at: string;
  period_start: string | null;
  period_end: string;
  user: WrappedUser;
  totals: WrappedTotals;
  persona: WrappedPersona | null;
  aura: WrappedAura | null;
  rhythm: WrappedRhythm;
  obsession: WrappedObsession | null;
  peak_day: WrappedPeakDay | null;
  tempo: WrappedTempo | null;
  equivalents: WrappedEquivalent[];
  top_tracks: WrappedRankedItem[];
  top_artists: WrappedRankedItem[];
  top_albums: WrappedRankedItem[];
}

export type WrappedCardTemplateId =
  | "summary"
  | "persona"
  | "receipt"
  | "festival"
  | "obsession"
  | "aura"
  | "peak";

export type WrappedThemeId = "signal" | "cover" | "vinyl" | "neon" | "paper";
export type WrappedFormat = "story" | "square";

export interface WrappedCardOptions {
  template: WrappedCardTemplateId;
  theme: WrappedThemeId;
  format: WrappedFormat;
  showUser: boolean;
  showCounts: boolean;
}

export interface WrappedThemePalette {
  bg: string;
  bgSecondary: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentAlt: string;
  border: string;
  isLight: boolean;
}

export interface WrappedTemplateMeta {
  id: WrappedCardTemplateId;
  label: string;
  shortLabel: string;
  description: string;
  badge: string;
}

export interface WrappedThemeMeta {
  id: WrappedThemeId;
  label: string;
  description: string;
  palette: WrappedThemePalette;
}

export interface WrappedShareResult {
  shared: boolean;
  cancelled?: boolean;
}

export class WrappedContractError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Wrapped-Bericht (${path}): ${message}`);
    this.name = "WrappedContractError";
    this.path = path;
  }
}

export const WRAPPED_RANGES: readonly { key: InsightsRange; label: string }[] = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "90d", label: "90 Tage" },
  { key: "year", label: "Jahr" },
  { key: "all", label: "Gesamt" },
];

export const WRAPPED_TEMPLATES: readonly WrappedTemplateMeta[] = [
  {
    id: "summary",
    label: "Rückblick-Übersicht",
    shortLabel: "Übersicht",
    description: "Hörzeit, Cover-Stapel, Top-5-Künstler & Titel und deine Klang-Persönlichkeit.",
    badge: "01 · Übersicht",
  },
  {
    id: "persona",
    label: "Klang-Persönlichkeit",
    shortLabel: "Persona",
    description: "Dein musikalischer Archetyp mit individuellem Emblem und Sound-DNA-Welle.",
    badge: "02 · Archetyp",
  },
  {
    id: "receipt",
    label: "Sound-Beleg",
    shortLabel: "Beleg",
    description: "Deine Top-10-Titel als präziser Studio-Kassenbon mit Spieldauer und Barcode.",
    badge: "03 · Studio-Bon",
  },
  {
    id: "festival",
    label: "Festival-Poster",
    shortLabel: "Festival",
    description: "Dein persönliches Konzertplakat mit Headliner, Co-Headlinern und Undercard.",
    badge: "04 · Lineup",
  },
  {
    id: "obsession",
    label: "Ohrwurm-Vinyl",
    shortLabel: "Ohrwurm",
    description: "Dein #1-Track auf glänzendem Vinyl mit Endlosschleifen-Zähler und Rekordtag.",
    badge: "05 · Vinyl",
  },
  {
    id: "aura",
    label: "Klang-Aura & 24h-Radar",
    shortLabel: "Aura",
    description: "Farb-Aura und zirkuläre 24-Stunden-Uhr deines persönlichen Hörrhythmus.",
    badge: "06 · 24h-Radar",
  },
  {
    id: "peak",
    label: "Rekord-Tag & Serie",
    shortLabel: "Rekorde",
    description: "Abreißkalender für deinen intensivsten Musiktag, aktive Tage und längste Serie.",
    badge: "07 · Rekorde",
  },
];

const SIGNAL_PALETTE: WrappedThemePalette = {
  bg: "#09090b",
  bgSecondary: "#151418",
  surface: "#1a191e",
  text: "#f4f0e6",
  muted: "#a9a59c",
  accent: "#d6ff4b",
  accentAlt: "#6fe0a8",
  border: "#302e36",
  isLight: false,
};

export const WRAPPED_THEMES: readonly WrappedThemeMeta[] = [
  {
    id: "signal",
    label: "Signal Ink",
    description: "Originales LoggeRythm Studio-Dunkel mit Signal-Lime und warmem Papierweiß.",
    palette: SIGNAL_PALETTE,
  },
  {
    id: "cover",
    label: "Cover-Aura",
    description: "Dynamisch aus deinem #1-Cover extrahierte Farbpalette mit kontrastgeprüftem Akzent.",
    palette: {
      bg: "#0e0c14",
      bgSecondary: "#191524",
      surface: "#211c30",
      text: "#f6f2eb",
      muted: "#b5afc4",
      accent: "#ff84cc",
      accentAlt: "#9d7bff",
      border: "#38304d",
      isLight: false,
    },
  },
  {
    id: "vinyl",
    label: "Analog Sunset",
    description: "Warmes Mahagoni, Bernsteingold und Studio-Röhrenwärme für Vinyl-Ästhetik.",
    palette: {
      bg: "#120c0a",
      bgSecondary: "#1d1411",
      surface: "#271b16",
      text: "#f8efe4",
      muted: "#c6b0a3",
      accent: "#ff9a4d",
      accentAlt: "#ffd166",
      border: "#453028",
      isLight: false,
    },
  },
  {
    id: "neon",
    label: "Mitternachts-Club",
    description: "Tiefes Mitternachts-Indigo mit elektrischem Cyan und Club-Magenta.",
    palette: {
      bg: "#070914",
      bgSecondary: "#0e1226",
      surface: "#151a36",
      text: "#eef3ff",
      muted: "#9aa8cc",
      accent: "#47f3ff",
      accentAlt: "#ff5ec4",
      border: "#28325c",
      isLight: false,
    },
  },
  {
    id: "paper",
    label: "Studio Paper",
    description: "Heller Archival-Print auf warmem Kunstdruckpapier mit internationalem Signal-Orange.",
    palette: {
      bg: "#f3efe4",
      bgSecondary: "#eae4d5",
      surface: "#fbf8f1",
      text: "#121114",
      muted: "#57534b",
      accent: "#b93210",
      accentAlt: "#1f47cc",
      border: "#cfc7b4",
      isLight: true,
    },
  },
];

const VALID_RANGES = new Set<string>(WRAPPED_RANGES.map((r) => r.key));
const VALID_CHRONOTYPES = new Set<string>(["night_owl", "early_bird", "day_cruiser", "evening_viber"]);
const VALID_EMBLEMS = new Set<string>([
  "moon_wave",
  "infinite_vinyl",
  "compass_radar",
  "tonearm_disc",
  "strobe_bars",
  "sunrise_pulse",
  "flame_metro",
  "prism_beat",
]);
const VALID_EQUIVALENT_ICONS = new Set<string>(["vinyl", "movie", "flight", "marathon", "concert"]);
const VALID_TEMPLATES = new Set<string>(WRAPPED_TEMPLATES.map((t) => t.id));
const VALID_THEMES = new Set<string>(WRAPPED_THEMES.map((t) => t.id));
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type RgbTuple = readonly [number, number, number];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function parseHexRgb(hex: string): [number, number, number] {
  const cleaned = hex.trim();
  if (!HEX_COLOR_RE.test(cleaned)) {
    throw new RangeError(`Ungültige Hex-Farbe: ${JSON.stringify(hex)}.`);
  }
  const raw = cleaned.slice(1);
  if (raw.length === 3) {
    return [
      Number.parseInt(raw[0] + raw[0], 16),
      Number.parseInt(raw[1] + raw[1], 16),
      Number.parseInt(raw[2] + raw[2], 16),
    ];
  }
  return [
    Number.parseInt(raw.slice(0, 2), 16),
    Number.parseInt(raw.slice(2, 4), 16),
    Number.parseInt(raw.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: RgbTuple): string {
  const [r, g, b] = rgb.map(clampByte);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function relativeLuminanceRgb(rgb: RgbTuple): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

export function contrastRatioRgb(first: RgbTuple, second: RgbTuple): number {
  const a = relativeLuminanceRgb(first);
  const b = relativeLuminanceRgb(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function pickReadableInk(backgroundHex: string): string {
  const bg = parseHexRgb(backgroundHex);
  const dark: RgbTuple = [16, 15, 19];
  const light: RgbTuple = [248, 246, 240];
  return contrastRatioRgb(bg, dark) >= contrastRatioRgb(bg, light) ? "#100f13" : "#f8f6f0";
}

function rgbToHsl(rgb: RgbTuple): [number, number, number] {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp01(s);
  const lit = clamp01(l);
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [clampByte((r + m) * 255), clampByte((g + m) * 255), clampByte((b + m) * 255)];
}

function liftContrastOnDark(
  hue: number,
  saturation: number,
  initialLightness: number,
  surfaceRgb: RgbTuple,
  minRatio: number,
): [number, number, number] {
  let low = clamp01(initialLightness);
  const candidate = hslToRgb(hue, saturation, low);
  if (contrastRatioRgb(candidate, surfaceRgb) >= minRatio) {
    return candidate;
  }
  let high = 0.96;
  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2;
    if (contrastRatioRgb(hslToRgb(hue, saturation, mid), surfaceRgb) >= minRatio) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return hslToRgb(hue, saturation, high);
}

/**
 * Derive a high-contrast dark Wrapped theme palette from an extracted cover RGB triple.
 * Throws loudly if `rgb` is malformed; uses `fallback` hue when the cover is achromatic.
 */
export function buildCoverThemePalette(
  rgb: RgbTuple,
  fallback: WrappedThemePalette = SIGNAL_PALETTE,
): WrappedThemePalette {
  if (
    !Array.isArray(rgb) ||
    rgb.length !== 3 ||
    rgb.some((channel) => typeof channel !== "number" || !Number.isFinite(channel) || channel < 0 || channel > 255)
  ) {
    throw new RangeError("Cover-Palette erfordert exakt drei RGB-Werte zwischen 0 und 255.");
  }

  const [rawHue, rawSat, rawLit] = rgbToHsl(rgb);
  const [fallbackHue, fallbackSat] = rgbToHsl(parseHexRgb(fallback.accent));
  const isAchromatic = rawSat < 0.12;
  const hue = isAchromatic ? fallbackHue : rawHue;
  const baseSat = isAchromatic ? Math.max(0.32, fallbackSat * 0.55) : rawSat;

  const bgRgb = hslToRgb(hue, clamp01(Math.max(0.18, Math.min(0.46, baseSat * 0.55))), 0.08);
  const bgSecondaryRgb = hslToRgb(hue, clamp01(Math.max(0.16, Math.min(0.4, baseSat * 0.48))), 0.125);
  const surfaceRgb = hslToRgb(hue, clamp01(Math.max(0.14, Math.min(0.36, baseSat * 0.42))), 0.165);
  const borderRgb = hslToRgb(hue, clamp01(Math.max(0.14, Math.min(0.32, baseSat * 0.35))), 0.27);

  const textRgb: [number, number, number] = [245, 242, 235];
  const mutedRgb = liftContrastOnDark(hue, 0.16, 0.71, surfaceRgb, 4.8);
  const accentSat = isAchromatic ? Math.max(0.7, fallbackSat) : clamp01(Math.max(0.68, Math.min(0.95, rawSat)));
  const accentRgb = liftContrastOnDark(
    hue,
    accentSat,
    Math.max(0.56, Math.min(0.74, rawLit)),
    surfaceRgb,
    5.4,
  );
  const altHue = (hue + 44) % 360;
  const accentAltRgb = liftContrastOnDark(altHue, clamp01(Math.max(0.62, accentSat * 0.9)), 0.64, surfaceRgb, 4.8);

  return {
    bg: rgbToHex(bgRgb),
    bgSecondary: rgbToHex(bgSecondaryRgb),
    surface: rgbToHex(surfaceRgb),
    text: rgbToHex(textRgb),
    muted: rgbToHex(mutedRgb),
    accent: rgbToHex(accentRgb),
    accentAlt: rgbToHex(accentAltRgb),
    border: rgbToHex(borderRgb),
    isLight: false,
  };
}

export function getWrappedThemeById(themeId: WrappedThemeId): WrappedThemeMeta {
  if (!VALID_THEMES.has(themeId)) {
    throw new Error(`Unbekanntes Wrapped-Farbthema: ${JSON.stringify(themeId)}.`);
  }
  const found = WRAPPED_THEMES.find((theme) => theme.id === themeId);
  if (!found) {
    throw new Error(`Wrapped-Farbthema ${JSON.stringify(themeId)} nicht registriert.`);
  }
  return found;
}

export function getWrappedTemplateById(templateId: WrappedCardTemplateId): WrappedTemplateMeta {
  if (!VALID_TEMPLATES.has(templateId)) {
    throw new Error(`Unbekannte Wrapped-Vorlage: ${JSON.stringify(templateId)}.`);
  }
  const found = WRAPPED_TEMPLATES.find((template) => template.id === templateId);
  if (!found) {
    throw new Error(`Wrapped-Vorlage ${JSON.stringify(templateId)} nicht registriert.`);
  }
  return found;
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WrappedContractError(path, "Ein Objekt wurde erwartet.");
  }
  return value as Record<string, unknown>;
}

function expectString(value: unknown, path: string, allowEmpty = true): string {
  if (typeof value !== "string") {
    throw new WrappedContractError(path, "Eine Zeichenkette wurde erwartet.");
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new WrappedContractError(path, "Eine nicht-leere Zeichenkette wurde erwartet.");
  }
  return value;
}

function expectIsoDateString(value: unknown, path: string): string {
  const s = expectString(value, path, false);
  if (Number.isNaN(Date.parse(s))) {
    throw new WrappedContractError(path, `Ungültiges ISO-Datum ${JSON.stringify(s)}.`);
  }
  return s;
}

function expectNonNegativeInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new WrappedContractError(path, "Eine nicht-negative Ganzzahl wurde erwartet.");
  }
  return value;
}

function expectPositiveInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new WrappedContractError(path, "Eine positive Ganzzahl (>= 1) wurde erwartet.");
  }
  return value;
}

function expectIntInRange(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new WrappedContractError(path, `Eine Ganzzahl zwischen ${min} und ${max} wurde erwartet.`);
  }
  return value;
}

function decodeStringArray(value: unknown, path: string, exactLength?: number): string[] {
  if (!Array.isArray(value)) {
    throw new WrappedContractError(path, "Ein Array wurde erwartet.");
  }
  if (exactLength !== undefined && value.length !== exactLength) {
    throw new WrappedContractError(path, `Genau ${exactLength} Einträge wurden erwartet.`);
  }
  return value.map((item, idx) => expectString(item, `${path}[${idx}]`));
}

function decodeHistogram(value: unknown, expectedLength: number, path: string): number[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new WrappedContractError(path, `Genau ${expectedLength} Werte wurden erwartet.`);
  }
  return value.map((entry, idx) => expectNonNegativeInt(entry, `${path}[${idx}]`));
}

function decodeUser(value: unknown, path: string): WrappedUser {
  const obj = expectObject(value, path);
  return {
    display_name: expectString(obj.display_name, `${path}.display_name`),
    avatar_url: expectString(obj.avatar_url, `${path}.avatar_url`),
  };
}

function decodeTotals(value: unknown, path: string): WrappedTotals {
  const obj = expectObject(value, path);
  const currentStreak = expectNonNegativeInt(obj.current_streak_days, `${path}.current_streak_days`);
  const longestStreak = expectNonNegativeInt(obj.longest_streak_days, `${path}.longest_streak_days`);
  if (currentStreak > longestStreak) {
    throw new WrappedContractError(
      `${path}.current_streak_days`,
      "Aktuelle Serie darf die längste Serie nicht überschreiten.",
    );
  }
  return {
    play_count: expectNonNegativeInt(obj.play_count, `${path}.play_count`),
    listening_sec: expectNonNegativeInt(obj.listening_sec, `${path}.listening_sec`),
    unique_tracks: expectNonNegativeInt(obj.unique_tracks, `${path}.unique_tracks`),
    unique_artists: expectNonNegativeInt(obj.unique_artists, `${path}.unique_artists`),
    unique_albums: expectNonNegativeInt(obj.unique_albums, `${path}.unique_albums`),
    new_artists_count: expectNonNegativeInt(obj.new_artists_count, `${path}.new_artists_count`),
    active_days: expectNonNegativeInt(obj.active_days, `${path}.active_days`),
    total_days: expectNonNegativeInt(obj.total_days, `${path}.total_days`),
    avg_daily_sec: expectNonNegativeInt(obj.avg_daily_sec, `${path}.avg_daily_sec`),
    current_streak_days: currentStreak,
    longest_streak_days: longestStreak,
  };
}

function decodePersona(value: unknown, path: string): WrappedPersona | null {
  if (value === null) return null;
  const obj = expectObject(value, path);
  const emblem = expectString(obj.emblem, `${path}.emblem`, false);
  if (!VALID_EMBLEMS.has(emblem)) {
    throw new WrappedContractError(`${path}.emblem`, `Unbekanntes Emblem ${JSON.stringify(emblem)}.`);
  }
  return {
    id: expectString(obj.id, `${path}.id`, false),
    title: expectString(obj.title, `${path}.title`, false),
    subtitle: expectString(obj.subtitle, `${path}.subtitle`),
    tagline: expectString(obj.tagline, `${path}.tagline`),
    emblem: emblem as WrappedEmblemId,
    traits: decodeStringArray(obj.traits, `${path}.traits`),
  };
}

function decodeAura(value: unknown, path: string): WrappedAura | null {
  if (value === null) return null;
  const obj = expectObject(value, path);
  const colors = decodeStringArray(obj.colors, `${path}.colors`, 3);
  colors.forEach((color, idx) => {
    if (!HEX_COLOR_RE.test(color.trim())) {
      throw new WrappedContractError(`${path}.colors[${idx}]`, `Ungültige Hex-Farbe ${JSON.stringify(color)}.`);
    }
  });
  return {
    id: expectString(obj.id, `${path}.id`, false),
    title: expectString(obj.title, `${path}.title`, false),
    description: expectString(obj.description, `${path}.description`),
    colors: [colors[0].trim(), colors[1].trim(), colors[2].trim()],
    mood_tags: decodeStringArray(obj.mood_tags, `${path}.mood_tags`),
  };
}

function decodeRhythm(value: unknown, path: string): WrappedRhythm {
  const obj = expectObject(value, path);
  const chronotype = expectString(obj.chronotype, `${path}.chronotype`, false);
  if (!VALID_CHRONOTYPES.has(chronotype)) {
    throw new WrappedContractError(`${path}.chronotype`, `Unbekannter Chronotyp ${JSON.stringify(chronotype)}.`);
  }
  return {
    chronotype: chronotype as WrappedChronotype,
    chronotype_label: expectString(obj.chronotype_label, `${path}.chronotype_label`, false),
    peak_hour: expectIntInRange(obj.peak_hour, 0, 23, `${path}.peak_hour`),
    peak_weekday: expectIntInRange(obj.peak_weekday, 0, 6, `${path}.peak_weekday`),
    weekend_share_pct: expectIntInRange(obj.weekend_share_pct, 0, 100, `${path}.weekend_share_pct`),
    discovery_score_pct: expectIntInRange(obj.discovery_score_pct, 0, 100, `${path}.discovery_score_pct`),
    repeat_score_pct: expectIntInRange(obj.repeat_score_pct, 0, 100, `${path}.repeat_score_pct`),
    hourly_distribution: decodeHistogram(obj.hourly_distribution, 24, `${path}.hourly_distribution`),
    weekday_distribution: decodeHistogram(obj.weekday_distribution, 7, `${path}.weekday_distribution`),
  };
}

function decodeObsession(value: unknown, path: string): WrappedObsession | null {
  if (value === null) return null;
  const obj = expectObject(value, path);
  let peakDayDate: string | null = null;
  if (obj.peak_day_date !== null && obj.peak_day_date !== undefined) {
    peakDayDate = expectIsoDateString(obj.peak_day_date, `${path}.peak_day_date`);
  }
  return {
    track_key: expectString(obj.track_key, `${path}.track_key`, false),
    title: expectString(obj.title, `${path}.title`, false),
    artist: expectString(obj.artist, `${path}.artist`),
    album: expectString(obj.album, `${path}.album`),
    cover: expectString(obj.cover, `${path}.cover`),
    play_count: expectNonNegativeInt(obj.play_count, `${path}.play_count`),
    listening_sec: expectNonNegativeInt(obj.listening_sec, `${path}.listening_sec`),
    share_pct: expectIntInRange(obj.share_pct, 0, 100, `${path}.share_pct`),
    peak_day_date: peakDayDate,
    peak_day_plays: expectNonNegativeInt(obj.peak_day_plays, `${path}.peak_day_plays`),
  };
}

function decodePeakDay(value: unknown, path: string): WrappedPeakDay | null {
  if (value === null) return null;
  const obj = expectObject(value, path);
  return {
    date: expectIsoDateString(obj.date, `${path}.date`),
    weekday: expectIntInRange(obj.weekday, 0, 6, `${path}.weekday`),
    play_count: expectNonNegativeInt(obj.play_count, `${path}.play_count`),
    listening_sec: expectNonNegativeInt(obj.listening_sec, `${path}.listening_sec`),
    top_track_title: expectString(obj.top_track_title, `${path}.top_track_title`),
    top_track_artist: expectString(obj.top_track_artist, `${path}.top_track_artist`),
    top_track_cover: expectString(obj.top_track_cover, `${path}.top_track_cover`),
  };
}

function decodeTempo(value: unknown, path: string): WrappedTempo | null {
  if (value === null) return null;
  const obj = expectObject(value, path);
  const avgBpm = expectNonNegativeInt(obj.avg_bpm, `${path}.avg_bpm`);
  const minBpm = expectNonNegativeInt(obj.min_bpm, `${path}.min_bpm`);
  const maxBpm = expectNonNegativeInt(obj.max_bpm, `${path}.max_bpm`);
  if (minBpm > maxBpm) {
    throw new WrappedContractError(`${path}.min_bpm`, "min_bpm darf max_bpm nicht überschreiten.");
  }
  return {
    avg_bpm: avgBpm,
    min_bpm: minBpm,
    max_bpm: maxBpm,
    analyzed_plays: expectNonNegativeInt(obj.analyzed_plays, `${path}.analyzed_plays`),
    vibe_label: expectString(obj.vibe_label, `${path}.vibe_label`, false),
  };
}

function decodeEquivalents(value: unknown, path: string): WrappedEquivalent[] {
  if (!Array.isArray(value)) {
    throw new WrappedContractError(path, "Ein Array wurde erwartet.");
  }
  return value.map((raw, idx) => {
    const obj = expectObject(raw, `${path}[${idx}]`);
    const icon = expectString(obj.icon, `${path}[${idx}].icon`, false);
    if (!VALID_EQUIVALENT_ICONS.has(icon)) {
      throw new WrappedContractError(
        `${path}[${idx}].icon`,
        `Unbekanntes Äquivalent-Icon ${JSON.stringify(icon)}.`,
      );
    }
    return {
      icon: icon as WrappedEquivalent["icon"],
      value: expectString(obj.value, `${path}[${idx}].value`, false),
      label: expectString(obj.label, `${path}[${idx}].label`, false),
    };
  });
}

function decodeRankedList(value: unknown, path: string): WrappedRankedItem[] {
  if (!Array.isArray(value)) {
    throw new WrappedContractError(path, "Ein Array wurde erwartet.");
  }
  if (value.length > 10) {
    throw new WrappedContractError(path, "Es sind maximal 10 Einträge erlaubt.");
  }
  return value.map((raw, idx) => {
    const itemPath = `${path}[${idx}]`;
    const obj = expectObject(raw, itemPath);
    return {
      rank: expectIntInRange(obj.rank, 1, 10, `${itemPath}.rank`),
      key: expectString(obj.key, `${itemPath}.key`),
      label: expectString(obj.label, `${itemPath}.label`),
      sublabel: expectString(obj.sublabel, `${itemPath}.sublabel`),
      cover: expectString(obj.cover, `${itemPath}.cover`),
      count: expectPositiveInt(obj.count, `${itemPath}.count`),
      listening_sec: expectNonNegativeInt(obj.listening_sec, `${itemPath}.listening_sec`),
      share_pct: expectIntInRange(obj.share_pct, 0, 100, `${itemPath}.share_pct`),
    };
  });
}

export function decodeWrappedReport(raw: unknown): WrappedReport {
  const obj = expectObject(raw, "root");
  const range = expectString(obj.range, "range", false);
  if (!VALID_RANGES.has(range)) {
    throw new WrappedContractError("range", `Unbekannter Zeitraum ${JSON.stringify(range)}.`);
  }
  const generatedAt = expectIsoDateString(obj.generated_at, "generated_at");
  const periodStart =
    obj.period_start === null ? null : expectIsoDateString(obj.period_start, "period_start");
  const periodEnd = expectIsoDateString(obj.period_end, "period_end");

  const user = decodeUser(obj.user, "user");
  const totals = decodeTotals(obj.totals, "totals");
  const persona = decodePersona(obj.persona, "persona");
  const aura = decodeAura(obj.aura, "aura");
  const rhythm = decodeRhythm(obj.rhythm, "rhythm");
  const obsession = decodeObsession(obj.obsession, "obsession");
  const peakDay = decodePeakDay(obj.peak_day, "peak_day");
  const tempo = decodeTempo(obj.tempo, "tempo");
  const equivalents = decodeEquivalents(obj.equivalents, "equivalents");
  const topTracks = decodeRankedList(obj.top_tracks, "top_tracks");
  const topArtists = decodeRankedList(obj.top_artists, "top_artists");
  const topAlbums = decodeRankedList(obj.top_albums, "top_albums");

  if (totals.play_count === 0) {
    if (
      topTracks.length > 0 ||
      topArtists.length > 0 ||
      topAlbums.length > 0 ||
      equivalents.length > 0 ||
      obsession !== null ||
      peakDay !== null
    ) {
      throw new WrappedContractError(
        "totals.play_count",
        "Bei 0 Wiedergaben müssen Ranglisten, Äquivalente, Obsession und Rekord-Tag leer sein.",
      );
    }
  }

  return {
    range: range as InsightsRange,
    generated_at: generatedAt,
    period_start: periodStart,
    period_end: periodEnd,
    user,
    totals,
    persona,
    aura,
    rhythm,
    obsession,
    peak_day: peakDay,
    tempo,
    equivalents,
    top_tracks: topTracks,
    top_artists: topArtists,
    top_albums: topAlbums,
  };
}

export function wrappedArtworkProxyUrl(coverUrl: string): string {
  if (typeof coverUrl !== "string" || coverUrl.trim().length === 0) {
    throw new Error("Wrapped-Cover-URL darf nicht leer sein.");
  }
  return `/api/me/stats/wrapped/artwork?url=${encodeURIComponent(coverUrl.trim())}`;
}

export function formatWrappedListeningDuration(seconds: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`Ungültige Hörzeit in Sekunden: ${String(seconds)}.`);
  }
  if (seconds < 60) return `${Math.round(seconds)} Sek.`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} Min.`;
  const hours = seconds / 3600;
  return `${hours.toLocaleString("de-DE", { maximumFractionDigits: hours >= 100 ? 0 : 1 })} Std.`;
}

export function formatWrappedSummaryText(report: WrappedReport): string {
  if (!report || typeof report !== "object" || !report.totals) {
    throw new Error("Wrapped-Bericht für Text-Zusammenfassung ist ungültig.");
  }
  const rangeLabel = WRAPPED_RANGES.find((r) => r.key === report.range)?.label ?? report.range;
  const name = report.user.display_name.trim();
  const header = name
    ? `LoggeRythm Wrapped (${rangeLabel}) – ${name}`
    : `LoggeRythm Wrapped (${rangeLabel})`;

  if (report.totals.play_count === 0) {
    return `${header}\n• Noch keine Wiedergaben in diesem Zeitraum.`;
  }

  const lines = [
    header,
    `• ${formatWrappedListeningDuration(report.totals.listening_sec)} gehört · ${report.totals.play_count} Wiedergaben`,
    `• ${report.totals.unique_tracks} Titel · ${report.totals.unique_artists} Künstler (${report.totals.new_artists_count} neu entdeckt)`,
  ];

  if (report.persona) {
    lines.push(`• Klang-Persönlichkeit: ${report.persona.title} – ${report.persona.subtitle}`);
  }
  if (report.obsession) {
    lines.push(
      `• #1 Ohrwurm: ${report.obsession.title}${report.obsession.artist ? ` (${report.obsession.artist})` : ""} · ${report.obsession.play_count}×`,
    );
  }
  if (report.totals.longest_streak_days > 0) {
    lines.push(
      `• Serie: ${report.totals.current_streak_days} Tage aktuell · ${report.totals.longest_streak_days} Tage Rekord`,
    );
  }
  if (report.top_artists.length > 0) {
    lines.push(`• Top-Künstler: ${report.top_artists.slice(0, 3).map((a) => a.label).join(", ")}`);
  }
  if (report.top_tracks.length > 0) {
    lines.push(
      `• Top-Titel: ${report.top_tracks
        .slice(0, 3)
        .map((t) => `${t.label}${t.sublabel ? ` (${t.sublabel})` : ""}`)
        .join(" · ")}`,
    );
  }
  return lines.join("\n");
}

export function canWebShareFiles(): boolean {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.share !== "function" ||
    typeof navigator.canShare !== "function" ||
    typeof File === "undefined"
  ) {
    return false;
  }
  const probe = new File(["wrapped"], "loggerythm-wrapped.png", { type: "image/png" });
  return Boolean(navigator.canShare({ files: [probe] }));
}

export async function exportCanvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (!canvas || typeof canvas.toBlob !== "function") {
    throw new Error("PNG-Export fehlgeschlagen: Canvas-Element ist ungültig.");
  }
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob || blob.size === 0) {
          reject(
            new Error(
              "PNG-Export fehlgeschlagen: Vom Canvas wurden keine gültigen Bilddaten erzeugt.",
            ),
          );
          return;
        }
        resolve(blob);
      }, "image/png");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      reject(new Error(`PNG-Export fehlgeschlagen: ${detail}`));
    }
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("Download fehlgeschlagen: Die Bilddatei ist leer oder ungültig.");
  }
  if (typeof filename !== "string" || filename.trim().length === 0) {
    throw new Error("Download fehlgeschlagen: Dateiname darf nicht leer sein.");
  }
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Download wird in dieser Laufzeitumgebung nicht unterstützt.");
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename.trim();
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  }
}

export async function copyPngBlobToClipboard(blob: Blob): Promise<void> {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("Zwischenablage fehlgeschlagen: Die Bilddatei ist leer oder ungültig.");
  }
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== "function" ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error(
      "Bild-Zwischenablage wird in diesem Browser nicht unterstützt (HTTPS oder Berechtigung erforderlich).",
    );
  }
  try {
    const mimeType = blob.type || "image/png";
    await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Bild konnte nicht in die Zwischenablage kopiert werden: ${detail}`);
  }
}

export async function sharePngBlob(
  blob: Blob,
  title: string,
  text: string,
): Promise<WrappedShareResult> {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("Teilen fehlgeschlagen: Die Bilddatei ist leer oder ungültig.");
  }
  if (!canWebShareFiles()) {
    throw new Error(
      "Direktes Teilen von Bilddateien wird von diesem Browser nicht unterstützt.",
    );
  }
  const file = new File([blob], "loggerythm-wrapped.png", { type: "image/png" });
  try {
    await navigator.share({ title, text, files: [file] });
    return { shared: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { shared: false, cancelled: true };
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Teilen fehlgeschlagen: ${detail}`);
  }
}
