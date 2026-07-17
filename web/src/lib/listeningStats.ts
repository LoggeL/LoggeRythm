import type {
  ArtistRef,
  RecentPlay,
  StatEntry,
  UserStats,
} from "@/types";

type JsonObject = Record<string, unknown>;

export class ListeningStatsContractError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ListeningStatsContractError";
    this.path = path;
  }
}

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ListeningStatsContractError(path, "must be an object");
  }
  return value as JsonObject;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ListeningStatsContractError(path, "must be a string");
  }
  return value;
}

function optionalText(value: unknown, path: string): string {
  return value === undefined ? "" : text(value, path);
}

function integer(value: unknown, path: string, positive = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0)
  ) {
    throw new ListeningStatsContractError(
      path,
      positive
        ? "must be a positive safe integer"
        : "must be a safe non-negative integer",
    );
  }
  return value;
}

function canonicalId(
  value: unknown,
  path: string,
): string {
  if (
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  ) {
    throw new ListeningStatsContractError(
      path,
      "must be a string or safe non-negative integer",
    );
  }
  return String(value).trim();
}

function boundedArray<T>(
  value: unknown,
  path: string,
  maximum: number,
  decode: (item: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new ListeningStatsContractError(path, "must be an array");
  }
  if (value.length > maximum) {
    throw new ListeningStatsContractError(path, `must contain at most ${maximum} items`);
  }
  return value.map((item, index) => decode(item, `${path}[${index}]`));
}

function decodeArtist(value: unknown, path: string): ArtistRef {
  const source = object(value, path);
  return {
    id: canonicalId(source.id ?? "", `${path}.id`),
    name: optionalText(source.name, `${path}.name`).trim(),
  };
}

function decodeStatEntry(value: unknown, path: string): StatEntry {
  const source = object(value, path);
  const key = source.key;
  if (
    typeof key !== "string" &&
    !(typeof key === "number" && Number.isSafeInteger(key) && key >= 0)
  ) {
    throw new ListeningStatsContractError(
      `${path}.key`,
      "must be a string or safe non-negative integer",
    );
  }
  return {
    key: String(key).trim(),
    label: text(source.label, `${path}.label`).trim(),
    sublabel: optionalText(source.sublabel, `${path}.sublabel`).trim(),
    cover: optionalText(source.cover, `${path}.cover`).trim(),
    count: integer(source.count, `${path}.count`, true),
  };
}

function decodeRecentPlay(value: unknown, path: string): RecentPlay {
  const source = object(value, path);
  return {
    id: canonicalId(source.id, `${path}.id`),
    title: text(source.title, `${path}.title`).trim(),
    artist: optionalText(source.artist, `${path}.artist`).trim(),
    artist_id: canonicalId(source.artist_id ?? "", `${path}.artist_id`),
    artists: source.artists === undefined
      ? []
      : boundedArray(source.artists, `${path}.artists`, 100, decodeArtist),
    album: optionalText(source.album, `${path}.album`).trim(),
    album_id: canonicalId(source.album_id ?? "", `${path}.album_id`),
    cover: optionalText(source.cover, `${path}.cover`).trim(),
    duration_sec: source.duration_sec === undefined
      ? 0
      : integer(source.duration_sec, `${path}.duration_sec`),
  };
}

function requireCollectionConsistency(
  total: number,
  collections: readonly (readonly unknown[])[],
  path: string,
): void {
  const nonEmpty = collections.map((collection) => collection.length > 0);
  if (total === 0 && nonEmpty.some(Boolean)) {
    throw new ListeningStatsContractError(path, "must be empty when its total is zero");
  }
  if (total > 0 && nonEmpty.some((value) => !value)) {
    throw new ListeningStatsContractError(path, "must be populated when its total is positive");
  }
}

function requireCountsWithinTotal(
  entries: readonly StatEntry[],
  total: number,
  path: string,
): void {
  if (entries.reduce((sum, entry) => sum + entry.count, 0) > total) {
    throw new ListeningStatsContractError(path, `counts must not exceed total ${total}`);
  }
}

/** Decode and normalize one unknown API response into the shared web domain. */
export function decodeListeningStats(value: unknown): UserStats {
  const source = object(value, "UserStats");
  const totalPlays = integer(source.total_plays, "UserStats.total_plays");
  const totalPlaysMonth = integer(
    source.total_plays_month,
    "UserStats.total_plays_month",
  );
  const topTracks = boundedArray(
    source.top_tracks,
    "UserStats.top_tracks",
    10,
    decodeStatEntry,
  );
  const topArtists = boundedArray(
    source.top_artists,
    "UserStats.top_artists",
    10,
    decodeStatEntry,
  );
  const recent = boundedArray(
    source.recent,
    "UserStats.recent",
    20,
    decodeRecentPlay,
  );
  const topTracksMonth = boundedArray(
    source.top_tracks_month,
    "UserStats.top_tracks_month",
    10,
    decodeStatEntry,
  );
  const topArtistsMonth = boundedArray(
    source.top_artists_month,
    "UserStats.top_artists_month",
    10,
    decodeStatEntry,
  );

  if (totalPlaysMonth > totalPlays) {
    throw new ListeningStatsContractError(
      "UserStats.total_plays_month",
      "must not exceed total_plays",
    );
  }
  if (recent.length > totalPlays) {
    throw new ListeningStatsContractError(
      "UserStats.recent",
      "must not contain more rows than total_plays",
    );
  }
  requireCollectionConsistency(
    totalPlays,
    [topTracks, topArtists, recent],
    "UserStats all-time collections",
  );
  requireCollectionConsistency(
    totalPlaysMonth,
    [topTracksMonth, topArtistsMonth],
    "UserStats rolling-month collections",
  );
  requireCountsWithinTotal(topTracks, totalPlays, "UserStats.top_tracks");
  requireCountsWithinTotal(topArtists, totalPlays, "UserStats.top_artists");
  requireCountsWithinTotal(
    topTracksMonth,
    totalPlaysMonth,
    "UserStats.top_tracks_month",
  );
  requireCountsWithinTotal(
    topArtistsMonth,
    totalPlaysMonth,
    "UserStats.top_artists_month",
  );

  return {
    total_plays: totalPlays,
    top_tracks: topTracks,
    top_artists: topArtists,
    recent,
    total_plays_month: totalPlaysMonth,
    top_tracks_month: topTracksMonth,
    top_artists_month: topArtistsMonth,
  };
}
