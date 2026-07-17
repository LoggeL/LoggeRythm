import type {
  GeneratedApiResponse,
  RecentPlayWire,
  StatEntryWire,
  StatsArtistRefWire,
  UserStatsWire,
} from '../../api/generated/contract';
import type {
  RecentPlay,
  StatEntry,
  UserStats,
} from '../../domain/listeningStats';

export type ListeningStatsWire = GeneratedApiResponse<'get_stats_api_me_stats_get'>;

type JsonObject = Record<string, unknown>;

export class ListeningStatsContractError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ListeningStatsContractError';
    this.path = path;
  }
}

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ListeningStatsContractError(path, 'must be an object');
  }
  return value as JsonObject;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ListeningStatsContractError(path, 'must be a string');
  }
  return value;
}

function optionalText(value: unknown, path: string): string {
  return value === undefined ? '' : text(value, path);
}

function wireId(value: unknown, path: string, optional = false): string | number {
  if (value === undefined && optional) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new ListeningStatsContractError(
    path,
    'must be a string or safe non-negative integer',
  );
}

function integer(value: unknown, path: string, positive = false): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < (positive ? 1 : 0)
  ) {
    throw new ListeningStatsContractError(
      path,
      positive ? 'must be a positive safe integer' : 'must be a safe non-negative integer',
    );
  }
  return value;
}

function array<T>(
  value: unknown,
  path: string,
  decode: (item: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new ListeningStatsContractError(path, 'must be an array');
  }
  return value.map((item, index) => decode(item, `${path}[${index}]`));
}

function boundedArray<T>(
  value: unknown,
  path: string,
  maximum: number,
  decode: (item: unknown, path: string) => T,
): T[] {
  const decoded = array(value, path, decode);
  if (decoded.length > maximum) {
    throw new ListeningStatsContractError(path, `must contain at most ${maximum} items`);
  }
  return decoded;
}

function decodeArtistRefWire(value: unknown, path: string): StatsArtistRefWire {
  const source = object(value, path);
  return {
    id: wireId(source.id, `${path}.id`, true),
    name: optionalText(source.name, `${path}.name`),
  };
}

function decodeStatEntryWire(value: unknown, path: string): StatEntryWire {
  const source = object(value, path);
  return {
    key: wireId(source.key, `${path}.key`),
    label: text(source.label, `${path}.label`),
    sublabel: optionalText(source.sublabel, `${path}.sublabel`),
    cover: optionalText(source.cover, `${path}.cover`),
    count: integer(source.count, `${path}.count`, true),
  };
}

function decodeRecentPlayWire(value: unknown, path: string): RecentPlayWire {
  const source = object(value, path);
  return {
    id: wireId(source.id, `${path}.id`),
    title: text(source.title, `${path}.title`),
    artist: optionalText(source.artist, `${path}.artist`),
    artist_id: wireId(source.artist_id, `${path}.artist_id`, true),
    artists: source.artists === undefined
      ? []
      : boundedArray(source.artists, `${path}.artists`, 100, decodeArtistRefWire),
    album: optionalText(source.album, `${path}.album`),
    album_id: wireId(source.album_id, `${path}.album_id`, true),
    cover: optionalText(source.cover, `${path}.cover`),
    duration_sec: source.duration_sec === undefined
      ? 0
      : integer(source.duration_sec, `${path}.duration_sec`),
  };
}

/** Strictly validate unknown JSON into the generated operation response. */
export function decodeListeningStatsWire(value: unknown): ListeningStatsWire {
  const source = object(value, 'UserStats');
  const decoded: UserStatsWire = {
    total_plays: integer(source.total_plays, 'UserStats.total_plays'),
    top_tracks: boundedArray(
      source.top_tracks,
      'UserStats.top_tracks',
      10,
      decodeStatEntryWire,
    ),
    top_artists: boundedArray(
      source.top_artists,
      'UserStats.top_artists',
      10,
      decodeStatEntryWire,
    ),
    recent: boundedArray(source.recent, 'UserStats.recent', 20, decodeRecentPlayWire),
    total_plays_month: integer(
      source.total_plays_month,
      'UserStats.total_plays_month',
    ),
    top_tracks_month: boundedArray(
      source.top_tracks_month,
      'UserStats.top_tracks_month',
      10,
      decodeStatEntryWire,
    ),
    top_artists_month: boundedArray(
      source.top_artists_month,
      'UserStats.top_artists_month',
      10,
      decodeStatEntryWire,
    ),
  };
  return decoded;
}

function canonicalId(value: string | number): string {
  return String(value).trim();
}

function mapStatEntry(wire: StatEntryWire, path: string): StatEntry {
  return {
    key: String(wire.key).trim(),
    label: wire.label.trim(),
    sublabel: (wire.sublabel ?? '').trim(),
    cover: (wire.cover ?? '').trim(),
    count: wire.count,
  };
}

function mapRecentPlay(wire: RecentPlayWire, path: string): RecentPlay {
  return {
    id: canonicalId(wire.id),
    title: wire.title.trim(),
    artist: (wire.artist ?? '').trim(),
    artist_id: canonicalId(wire.artist_id ?? ''),
    artists: (wire.artists ?? []).map((artist) => ({
      id: canonicalId(artist.id ?? ''),
      name: (artist.name ?? '').trim(),
    })),
    album: (wire.album ?? '').trim(),
    album_id: canonicalId(wire.album_id ?? ''),
    cover: (wire.cover ?? '').trim(),
    duration_sec: wire.duration_sec ?? 0,
  };
}

function requireCollectionConsistency(
  total: number,
  collections: readonly (readonly unknown[])[],
  path: string,
): void {
  const nonEmpty = collections.map((collection) => collection.length > 0);
  if (total === 0 && nonEmpty.some(Boolean)) {
    throw new ListeningStatsContractError(path, 'must be empty when its total is zero');
  }
  if (total > 0 && nonEmpty.some((value) => !value)) {
    throw new ListeningStatsContractError(path, 'must be populated when its total is positive');
  }
}

function requireCountsWithinTotal(
  entries: readonly StatEntry[],
  total: number,
  path: string,
): void {
  const sum = entries.reduce((totalCount, entry) => totalCount + entry.count, 0);
  if (sum > total) {
    throw new ListeningStatsContractError(path, `counts must not exceed total ${total}`);
  }
  entries.forEach((entry, index) => {
    if (entry.count > total) {
      throw new ListeningStatsContractError(
        `${path}[${index}].count`,
        `must not exceed total ${total}`,
      );
    }
  });
}

/** Map the generated transport response into the human-owned product model. */
export function mapListeningStatsWire(wire: ListeningStatsWire): UserStats {
  const topTracks = wire.top_tracks.map((entry, index) =>
    mapStatEntry(entry, `UserStats.top_tracks[${index}]`),
  );
  const topArtists = wire.top_artists.map((entry, index) =>
    mapStatEntry(entry, `UserStats.top_artists[${index}]`),
  );
  const recent = wire.recent.map((entry, index) =>
    mapRecentPlay(entry, `UserStats.recent[${index}]`),
  );
  const topTracksMonth = wire.top_tracks_month.map((entry, index) =>
    mapStatEntry(entry, `UserStats.top_tracks_month[${index}]`),
  );
  const topArtistsMonth = wire.top_artists_month.map((entry, index) =>
    mapStatEntry(entry, `UserStats.top_artists_month[${index}]`),
  );

  if (wire.total_plays_month > wire.total_plays) {
    throw new ListeningStatsContractError(
      'UserStats.total_plays_month',
      'must not exceed total_plays',
    );
  }
  if (recent.length > wire.total_plays) {
    throw new ListeningStatsContractError(
      'UserStats.recent',
      'must not contain more rows than total_plays',
    );
  }
  requireCollectionConsistency(
    wire.total_plays,
    [topTracks, topArtists, recent],
    'UserStats all-time collections',
  );
  requireCollectionConsistency(
    wire.total_plays_month,
    [topTracksMonth, topArtistsMonth],
    'UserStats rolling-month collections',
  );
  requireCountsWithinTotal(topTracks, wire.total_plays, 'UserStats.top_tracks');
  requireCountsWithinTotal(topArtists, wire.total_plays, 'UserStats.top_artists');
  requireCountsWithinTotal(
    topTracksMonth,
    wire.total_plays_month,
    'UserStats.top_tracks_month',
  );
  requireCountsWithinTotal(
    topArtistsMonth,
    wire.total_plays_month,
    'UserStats.top_artists_month',
  );

  return {
    total_plays: wire.total_plays,
    top_tracks: topTracks,
    top_artists: topArtists,
    recent,
    total_plays_month: wire.total_plays_month,
    top_tracks_month: topTracksMonth,
    top_artists_month: topArtistsMonth,
  };
}
