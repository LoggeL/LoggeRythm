/**
 * Strict decoder & shareable summary formatter for `GET /api/me/stats/insights`
 * (Personal Wrapped Insights, S4.4). Fails loudly on contract violations.
 */

import type {
  ArtistRef,
  StatEntry,
  StatsInsightsRange,
  TimestampedPlay,
  UserStatsInsights,
} from "@/types";

export const INSIGHTS_RANGES: readonly { key: StatsInsightsRange; label: string }[] = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "90d", label: "90 Tage" },
  { key: "year", label: "Jahr" },
  { key: "all", label: "Gesamt" },
];

const VALID_RANGES = new Set<string>(INSIGHTS_RANGES.map((r) => r.key));

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Hörprofil-Einblicke (${path}): Ein Objekt wurde erwartet.`);
  }
  return value as Record<string, unknown>;
}

function expectNonNegativeInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Hörprofil-Einblicke (${path}): Eine nicht-negative Ganzzahl wurde erwartet.`);
  }
  return value;
}

function expectNonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Hörprofil-Einblicke (${path}): Eine nicht-negative Zahl wurde erwartet.`);
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`Hörprofil-Einblicke (${path}): Eine Zeichenkette wurde erwartet.`);
  }
  return value;
}

function decodeStatEntries(value: unknown, path: string): StatEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`Hörprofil-Einblicke (${path}): Ein Array wurde erwartet.`);
  }
  return value.map((raw, idx) => {
    const obj = expectObject(raw, `${path}[${idx}]`);
    return {
      key: expectString(obj.key, `${path}[${idx}].key`),
      label: expectString(obj.label, `${path}[${idx}].label`),
      sublabel: expectString(obj.sublabel ?? "", `${path}[${idx}].sublabel`),
      cover: expectString(obj.cover ?? "", `${path}[${idx}].cover`),
      count: expectNonNegativeInt(obj.count, `${path}[${idx}].count`),
    };
  });
}

function decodeArtistRefs(value: unknown, path: string): ArtistRef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Hörprofil-Einblicke (${path}): Ein Array wurde erwartet.`);
  }
  return value.map((raw, idx) => {
    const obj = expectObject(raw, `${path}[${idx}]`);
    const id = obj.id;
    if (typeof id !== "string" && typeof id !== "number") {
      throw new Error(`Hörprofil-Einblicke (${path}[${idx}].id): Ungültige Künstler-ID.`);
    }
    return { id, name: expectString(obj.name, `${path}[${idx}].name`) };
  });
}

function decodeRecentPlays(value: unknown, path: string): TimestampedPlay[] {
  if (!Array.isArray(value)) {
    throw new Error(`Hörprofil-Einblicke (${path}): Ein Array wurde erwartet.`);
  }
  return value.map((raw, idx) => {
    const obj = expectObject(raw, `${path}[${idx}]`);
    return {
      id: expectString(obj.id, `${path}[${idx}].id`),
      title: expectString(obj.title, `${path}[${idx}].title`),
      artist: expectString(obj.artist, `${path}[${idx}].artist`),
      artist_id: expectString(obj.artist_id ?? "", `${path}[${idx}].artist_id`),
      artists: decodeArtistRefs(obj.artists, `${path}[${idx}].artists`),
      album: expectString(obj.album ?? "", `${path}[${idx}].album`),
      album_id: expectString(obj.album_id ?? "", `${path}[${idx}].album_id`),
      cover: expectString(obj.cover ?? "", `${path}[${idx}].cover`),
      duration_sec: expectNonNegativeNumber(obj.duration_sec ?? 0, `${path}[${idx}].duration_sec`),
      played_at: expectString(obj.played_at, `${path}[${idx}].played_at`),
    };
  });
}

function decodeIntHistogram(value: unknown, expectedLength: number, path: string): number[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(`Hörprofil-Einblicke (${path}): Genau ${expectedLength} Werte wurden erwartet.`);
  }
  return value.map((entry, idx) => expectNonNegativeInt(entry, `${path}[${idx}]`));
}

export function decodeUserStatsInsights(raw: unknown): UserStatsInsights {
  const obj = expectObject(raw, "root");
  const range = expectString(obj.range, "range");
  if (!VALID_RANGES.has(range)) {
    throw new Error(`Hörprofil-Einblicke (range): Unbekannter Zeitraum ${JSON.stringify(range)}.`);
  }
  return {
    range: range as StatsInsightsRange,
    listening_sec: expectNonNegativeNumber(obj.listening_sec, "listening_sec"),
    play_count: expectNonNegativeInt(obj.play_count, "play_count"),
    unique_tracks: expectNonNegativeInt(obj.unique_tracks, "unique_tracks"),
    unique_artists: expectNonNegativeInt(obj.unique_artists, "unique_artists"),
    top_tracks: decodeStatEntries(obj.top_tracks, "top_tracks"),
    top_artists: decodeStatEntries(obj.top_artists, "top_artists"),
    top_albums: decodeStatEntries(obj.top_albums, "top_albums"),
    current_streak_days: expectNonNegativeInt(obj.current_streak_days, "current_streak_days"),
    longest_streak_days: expectNonNegativeInt(obj.longest_streak_days, "longest_streak_days"),
    hourly_distribution: decodeIntHistogram(obj.hourly_distribution, 24, "hourly_distribution"),
    weekday_distribution: decodeIntHistogram(obj.weekday_distribution, 7, "weekday_distribution"),
    new_artists_count: expectNonNegativeInt(obj.new_artists_count, "new_artists_count"),
    recent_plays: decodeRecentPlays(obj.recent_plays, "recent_plays"),
  };
}

export function formatListeningHours(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} Sek.`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} Min.`;
  const hours = seconds / 3600;
  return `${hours.toLocaleString("de-DE", { maximumFractionDigits: hours >= 100 ? 0 : 1 })} Std.`;
}

export function formatInsightsSummaryText(
  insights: UserStatsInsights,
  displayName?: string | null,
): string {
  const rangeLabel =
    INSIGHTS_RANGES.find((r) => r.key === insights.range)?.label ?? insights.range;
  const header = displayName
    ? `LoggeRythm Rückblick (${rangeLabel}) – ${displayName}`
    : `LoggeRythm Rückblick (${rangeLabel})`;
  const lines = [
    header,
    `• ${formatListeningHours(insights.listening_sec)} gehört · ${insights.play_count} Wiedergaben`,
    `• ${insights.unique_tracks} Titel · ${insights.unique_artists} Künstler (${insights.new_artists_count} neu entdeckt)`,
  ];
  if (insights.longest_streak_days > 0) {
    lines.push(
      `• Serie: ${insights.current_streak_days} Tage aktuell · ${insights.longest_streak_days} Tage Rekord`,
    );
  }
  if (insights.top_artists.length > 0) {
    lines.push(
      `• Top-Künstler: ${insights.top_artists.slice(0, 3).map((a) => a.label).join(", ")}`,
    );
  }
  if (insights.top_tracks.length > 0) {
    lines.push(
      `• Top-Titel: ${insights.top_tracks.slice(0, 3).map((t) => `${t.label}${t.sublabel ? ` (${t.sublabel})` : ""}`).join(" · ")}`,
    );
  }
  return lines.join("\n");
}
