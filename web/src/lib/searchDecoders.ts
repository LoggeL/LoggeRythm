import type { ArtistSummary, PlaylistSearchResult, Track } from "@/types";

type SearchRecord = Record<string, unknown>;

function invalid(path: string, expected: string): never {
  throw new Error(`Ungültige Suchantwort: ${path} muss ${expected} sein.`);
}

function record(value: unknown, path: string): SearchRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "ein Objekt");
  }
  return value as SearchRecord;
}

function identifier(value: unknown, path: string, stringOnly = false): void {
  const validString = typeof value === "string" && /^[0-9]+$/.test(value) && /[1-9]/.test(value);
  const validNumber = !stringOnly && typeof value === "number" && Number.isSafeInteger(value) && value > 0;
  if (!validString && !validNumber) invalid(path, "eine positive numerische ID");
}

function text(value: unknown, path: string, required = false): void {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || (required && !value.trim())) {
    invalid(path, required ? "nichtleerer Text" : "Text");
  }
}

function number(value: unknown, path: string, integer = false, nullable = false): void {
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== "number" || !Number.isFinite(value) || (integer && (!Number.isSafeInteger(value) || value < 0))) {
    invalid(path, integer ? "eine nichtnegative ganze Zahl" : "eine endliche Zahl");
  }
}

function rows(value: unknown, validate: (row: SearchRecord, path: string) => void): SearchRecord[] {
  if (!Array.isArray(value)) invalid("results", "eine Liste");
  value.forEach((item, index) => {
    const path = `results[${index}]`;
    validate(record(item, path), path);
  });
  return value as SearchRecord[];
}

export function decodeSearchTracks(value: unknown): Track[] {
  return rows(value, (row, path) => {
    identifier(row.id, `${path}.id`, true);
    text(row.title, `${path}.title`, true);
    for (const field of ["artist", "album", "cover", "release_date"]) {
      text(row[field], `${path}.${field}`);
    }
    for (const field of ["artist_id", "album_id"]) {
      if (row[field] !== undefined && row[field] !== "") identifier(row[field], `${path}.${field}`);
    }
    if (row.artists !== undefined) {
      if (!Array.isArray(row.artists)) invalid(`${path}.artists`, "eine Liste");
      row.artists.forEach((artist, index) => {
        const artistPath = `${path}.artists[${index}]`;
        const credit = record(artist, artistPath);
        if (credit.id !== undefined && credit.id !== "") identifier(credit.id, `${artistPath}.id`);
        text(credit.name, `${artistPath}.name`, true);
      });
    }
    number(row.duration_sec, `${path}.duration_sec`, true);
    number(row.rank, `${path}.rank`, true);
    if (row.preview_url !== null) text(row.preview_url, `${path}.preview_url`);
    for (const field of ["loudness_gain_db", "loudness_lufs", "loudness_peak"]) {
      number(row[field], `${path}.${field}`, false, true);
    }
  }) as unknown as Track[];
}

export function decodeSearchArtists(value: unknown): ArtistSummary[] {
  return rows(value, (row, path) => {
    identifier(row.id, `${path}.id`);
    text(row.name, `${path}.name`, true);
    text(row.picture, `${path}.picture`);
  }) as unknown as ArtistSummary[];
}

export function decodeSearchPlaylists(value: unknown): PlaylistSearchResult[] {
  return rows(value, (row, path) => {
    identifier(row.id, `${path}.id`);
    text(row.title, `${path}.title`, true);
    text(row.cover, `${path}.cover`);
    if (row.track_count === undefined) invalid(`${path}.track_count`, "eine nichtnegative ganze Zahl");
    number(row.track_count, `${path}.track_count`, true);
  }) as unknown as PlaylistSearchResult[];
}
