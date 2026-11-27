import type {
  StatsInsightsRange,
  WrappedAura,
  WrappedCardTemplateId,
  WrappedChronotype,
  WrappedEmblemId,
  WrappedEquivalent,
  WrappedEquivalentIcon,
  WrappedFormat,
  WrappedObsession,
  WrappedPeakDay,
  WrappedPersona,
  WrappedRankedItem,
  WrappedReport,
  WrappedRhythm,
  WrappedTempo,
  WrappedThemeId,
  WrappedTotals,
  WrappedUser,
} from '../../api/types';

const RANGES: readonly StatsInsightsRange[] = ['7d', '30d', '90d', 'year', 'all'];
const CHRONOTYPES: readonly WrappedChronotype[] = [
  'night_owl',
  'early_bird',
  'day_cruiser',
  'evening_viber',
];
const EMBLEMS: readonly WrappedEmblemId[] = [
  'moon_wave',
  'infinite_vinyl',
  'compass_radar',
  'tonearm_disc',
  'strobe_bars',
  'sunrise_pulse',
  'flame_metro',
  'prism_beat',
];
const EQUIVALENT_ICONS: readonly WrappedEquivalentIcon[] = [
  'vinyl',
  'movie',
  'flight',
  'marathon',
  'concert',
];
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;

type JsonObject = Record<string, unknown>;

export class WrappedContractError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'WrappedContractError';
    this.path = path;
  }
}

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WrappedContractError(path, 'must be an object');
  }
  return value as JsonObject;
}

function text(value: unknown, path: string, nonEmpty = false): string {
  if (typeof value !== 'string') {
    throw new WrappedContractError(path, 'must be a string');
  }
  if (nonEmpty && value.trim().length === 0) {
    throw new WrappedContractError(path, 'must not be empty');
  }
  return value;
}

function nullableText(value: unknown, path: string, nonEmpty = false): string | null {
  if (value === null) return null;
  return text(value, path, nonEmpty);
}

function isoDateTime(value: unknown, path: string): string {
  const raw = text(value, path, true);
  if (!Number.isFinite(Date.parse(raw))) {
    throw new WrappedContractError(path, 'must be a valid ISO-8601 datetime string');
  }
  return raw;
}

function boundedInt(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new WrappedContractError(path, `must be a safe integer between ${min} and ${max}`);
  }
  return value;
}

function nonNegInt(value: unknown, path: string): number {
  return boundedInt(value, path, 0, Number.MAX_SAFE_INTEGER);
}

function positiveInt(value: unknown, path: string): number {
  return boundedInt(value, path, 1, Number.MAX_SAFE_INTEGER);
}

function hexColor(value: unknown, path: string): string {
  const raw = text(value, path, true);
  if (!HEX_COLOR_RE.test(raw)) {
    throw new WrappedContractError(path, 'must be a hex color (#RRGGBB)');
  }
  return raw;
}

function literal<const T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const raw = text(value, path, true);
  if (!allowed.includes(raw as T)) {
    throw new WrappedContractError(path, `must be one of ${allowed.join(', ')}`);
  }
  return raw as T;
}

function array<T>(
  value: unknown,
  path: string,
  decode: (item: unknown, itemPath: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new WrappedContractError(path, 'must be an array');
  }
  return value.map((item, index) => decode(item, `${path}[${index}]`));
}

function nullable<T>(
  value: unknown,
  path: string,
  decode: (item: unknown, itemPath: string) => T,
): T | null {
  if (value === null) return null;
  return decode(value, path);
}

function decodeUser(value: unknown, path: string): WrappedUser {
  const source = object(value, path);
  return {
    display_name: text(source.display_name, `${path}.display_name`),
    avatar_url: text(source.avatar_url, `${path}.avatar_url`),
  };
}

function decodeTotals(value: unknown, path: string): WrappedTotals {
  const source = object(value, path);
  return {
    play_count: nonNegInt(source.play_count, `${path}.play_count`),
    listening_sec: nonNegInt(source.listening_sec, `${path}.listening_sec`),
    unique_tracks: nonNegInt(source.unique_tracks, `${path}.unique_tracks`),
    unique_artists: nonNegInt(source.unique_artists, `${path}.unique_artists`),
    unique_albums: nonNegInt(source.unique_albums, `${path}.unique_albums`),
    new_artists_count: nonNegInt(source.new_artists_count, `${path}.new_artists_count`),
    active_days: nonNegInt(source.active_days, `${path}.active_days`),
    total_days: nonNegInt(source.total_days, `${path}.total_days`),
    avg_daily_sec: nonNegInt(source.avg_daily_sec, `${path}.avg_daily_sec`),
    current_streak_days: nonNegInt(source.current_streak_days, `${path}.current_streak_days`),
    longest_streak_days: nonNegInt(source.longest_streak_days, `${path}.longest_streak_days`),
  };
}

function decodePersona(value: unknown, path: string): WrappedPersona {
  const source = object(value, path);
  const traits = array(source.traits, `${path}.traits`, (item, itemPath) =>
    text(item, itemPath, true),
  );
  return {
    id: text(source.id, `${path}.id`, true),
    title: text(source.title, `${path}.title`, true),
    subtitle: text(source.subtitle, `${path}.subtitle`),
    tagline: text(source.tagline, `${path}.tagline`),
    emblem: literal(source.emblem, `${path}.emblem`, EMBLEMS),
    traits,
  };
}

function decodeAura(value: unknown, path: string): WrappedAura {
  const source = object(value, path);
  const colors = array(source.colors, `${path}.colors`, hexColor);
  if (colors.length !== 3) {
    throw new WrappedContractError(`${path}.colors`, `must contain exactly 3 hex colors, got ${colors.length}`);
  }
  const moodTags = array(source.mood_tags, `${path}.mood_tags`, (item, itemPath) =>
    text(item, itemPath, true),
  );
  return {
    id: text(source.id, `${path}.id`, true),
    title: text(source.title, `${path}.title`, true),
    description: text(source.description, `${path}.description`),
    colors: [colors[0], colors[1], colors[2]],
    mood_tags: moodTags,
  };
}

function decodeRhythm(value: unknown, path: string): WrappedRhythm {
  const source = object(value, path);
  const hourly = array(source.hourly_distribution, `${path}.hourly_distribution`, nonNegInt);
  if (hourly.length !== 24) {
    throw new WrappedContractError(
      `${path}.hourly_distribution`,
      `must contain 24 buckets, got ${hourly.length}`,
    );
  }
  const weekday = array(source.weekday_distribution, `${path}.weekday_distribution`, nonNegInt);
  if (weekday.length !== 7) {
    throw new WrappedContractError(
      `${path}.weekday_distribution`,
      `must contain 7 buckets, got ${weekday.length}`,
    );
  }
  return {
    chronotype: literal(source.chronotype, `${path}.chronotype`, CHRONOTYPES),
    chronotype_label: text(source.chronotype_label, `${path}.chronotype_label`, true),
    peak_hour: boundedInt(source.peak_hour, `${path}.peak_hour`, 0, 23),
    peak_weekday: boundedInt(source.peak_weekday, `${path}.peak_weekday`, 0, 6),
    weekend_share_pct: boundedInt(source.weekend_share_pct, `${path}.weekend_share_pct`, 0, 100),
    discovery_score_pct: boundedInt(source.discovery_score_pct, `${path}.discovery_score_pct`, 0, 100),
    repeat_score_pct: boundedInt(source.repeat_score_pct, `${path}.repeat_score_pct`, 0, 100),
    hourly_distribution: hourly,
    weekday_distribution: weekday,
  };
}

function decodeObsession(value: unknown, path: string): WrappedObsession {
  const source = object(value, path);
  return {
    track_key: text(source.track_key, `${path}.track_key`),
    title: text(source.title, `${path}.title`, true),
    artist: text(source.artist, `${path}.artist`),
    album: text(source.album, `${path}.album`),
    cover: text(source.cover, `${path}.cover`),
    play_count: nonNegInt(source.play_count, `${path}.play_count`),
    listening_sec: nonNegInt(source.listening_sec, `${path}.listening_sec`),
    share_pct: boundedInt(source.share_pct, `${path}.share_pct`, 0, 100),
    peak_day_date: nullableText(source.peak_day_date, `${path}.peak_day_date`, true),
    peak_day_plays: nonNegInt(source.peak_day_plays, `${path}.peak_day_plays`),
  };
}

function decodePeakDay(value: unknown, path: string): WrappedPeakDay {
  const source = object(value, path);
  return {
    date: text(source.date, `${path}.date`, true),
    weekday: boundedInt(source.weekday, `${path}.weekday`, 0, 6),
    play_count: nonNegInt(source.play_count, `${path}.play_count`),
    listening_sec: nonNegInt(source.listening_sec, `${path}.listening_sec`),
    top_track_title: text(source.top_track_title, `${path}.top_track_title`),
    top_track_artist: text(source.top_track_artist, `${path}.top_track_artist`),
    top_track_cover: text(source.top_track_cover, `${path}.top_track_cover`),
  };
}

function decodeTempo(value: unknown, path: string): WrappedTempo {
  const source = object(value, path);
  const avgBpm = nonNegInt(source.avg_bpm, `${path}.avg_bpm`);
  const minBpm = nonNegInt(source.min_bpm, `${path}.min_bpm`);
  const maxBpm = nonNegInt(source.max_bpm, `${path}.max_bpm`);
  if (minBpm > maxBpm) {
    throw new WrappedContractError(`${path}.min_bpm`, 'must not exceed max_bpm');
  }
  return {
    avg_bpm: avgBpm,
    min_bpm: minBpm,
    max_bpm: maxBpm,
    analyzed_plays: nonNegInt(source.analyzed_plays, `${path}.analyzed_plays`),
    vibe_label: text(source.vibe_label, `${path}.vibe_label`, true),
  };
}

function decodeEquivalent(value: unknown, path: string): WrappedEquivalent {
  const source = object(value, path);
  return {
    icon: literal(source.icon, `${path}.icon`, EQUIVALENT_ICONS),
    value: text(source.value, `${path}.value`, true),
    label: text(source.label, `${path}.label`, true),
  };
}

function decodeRankedItem(value: unknown, path: string): WrappedRankedItem {
  const source = object(value, path);
  return {
    rank: boundedInt(source.rank, `${path}.rank`, 1, 10),
    key: text(source.key, `${path}.key`),
    label: text(source.label, `${path}.label`, true),
    sublabel: text(source.sublabel, `${path}.sublabel`),
    cover: text(source.cover, `${path}.cover`),
    count: positiveInt(source.count, `${path}.count`),
    listening_sec: nonNegInt(source.listening_sec, `${path}.listening_sec`),
    share_pct: boundedInt(source.share_pct, `${path}.share_pct`, 0, 100),
  };
}

function decodeRankedList(value: unknown, path: string): WrappedRankedItem[] {
  const items = array(value, path, decodeRankedItem);
  if (items.length > 10) {
    throw new WrappedContractError(path, `must contain at most 10 items, got ${items.length}`);
  }
  return items;
}

/** Strictly decode `GET /api/me/stats/wrapped` into a typed `WrappedReport`. */
export function decodeWrappedReport(value: unknown): WrappedReport {
  const source = object(value, 'WrappedReport');
  const range = literal(source.range, 'WrappedReport.range', RANGES);
  const generatedAt = isoDateTime(source.generated_at, 'WrappedReport.generated_at');
  const periodStart = source.period_start === null
    ? null
    : isoDateTime(source.period_start, 'WrappedReport.period_start');
  const periodEnd = isoDateTime(source.period_end, 'WrappedReport.period_end');
  const user = decodeUser(source.user, 'WrappedReport.user');
  const totals = decodeTotals(source.totals, 'WrappedReport.totals');
  const persona = nullable(source.persona, 'WrappedReport.persona', decodePersona);
  const aura = nullable(source.aura, 'WrappedReport.aura', decodeAura);
  const rhythm = decodeRhythm(source.rhythm, 'WrappedReport.rhythm');
  const obsession = nullable(source.obsession, 'WrappedReport.obsession', decodeObsession);
  const peakDay = nullable(source.peak_day, 'WrappedReport.peak_day', decodePeakDay);
  const tempo = nullable(source.tempo, 'WrappedReport.tempo', decodeTempo);
  const equivalents = array(source.equivalents, 'WrappedReport.equivalents', decodeEquivalent);
  const topTracks = decodeRankedList(source.top_tracks, 'WrappedReport.top_tracks');
  const topArtists = decodeRankedList(source.top_artists, 'WrappedReport.top_artists');
  const topAlbums = decodeRankedList(source.top_albums, 'WrappedReport.top_albums');

  if (totals.play_count === 0) {
    if (
      topTracks.length > 0
      || topArtists.length > 0
      || topAlbums.length > 0
      || equivalents.length > 0
      || persona !== null
      || aura !== null
      || obsession !== null
      || peakDay !== null
      || tempo !== null
    ) {
      throw new WrappedContractError(
        'WrappedReport',
        'collections and highlight blocks must be empty/null when totals.play_count is 0',
      );
    }
  }

  return {
    range,
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

/** Build the authenticated backend SVG card endpoint URL for a chosen template/theme/format. */
export function buildWrappedCardSvgUrl(
  apiBase: string,
  options: {
    range: StatsInsightsRange;
    template: WrappedCardTemplateId;
    theme: WrappedThemeId;
    format?: WrappedFormat;
  },
): string {
  const origin = apiBase.trim().replace(/\/+$/u, '');
  if (origin.length === 0) {
    throw new Error('Cannot build Wrapped SVG card URL without a configured server origin');
  }
  const format = options.format ?? 'story';
  const params = new URLSearchParams({
    range: options.range,
    template: options.template,
    theme: options.theme,
    format,
  });
  return `${origin}/api/me/stats/wrapped/card.svg?${params.toString()}`;
}
