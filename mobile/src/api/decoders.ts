import type { AlbumDetail, ArtistRef, Playlist, PlaylistSummary, Track, User } from './types';

type JsonObject = Record<string, unknown>;

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string`);
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function deezerStringId(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string containing only digits`);
  }
  if (!/^\d+$/.test(value)) throw new Error(`${path} must be a non-empty digit-only Deezer ID`);
  return value;
}

function deezerReferenceId(value: unknown, path: string): string | number {
  // Artist/album references are optional in the backend Track contract and
  // legacy likes/playlists legitimately serialize a missing reference as "".
  if (value === '') return '';
  if (typeof value === 'string') return deezerStringId(value, path);
  if (typeof value !== 'number') {
    throw new Error(`${path} must be a digit-only string or safe non-negative integer`);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a digit-only string or safe non-negative integer`);
  }
  return value;
}

function array<T>(value: unknown, path: string, decode: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => decode(item, `${path}[${index}]`));
}

function decodeArtist(value: unknown, path: string): ArtistRef {
  const source = object(value, path);
  return {
    id: deezerReferenceId(source.id, `${path}.id`),
    name: string(source.name, `${path}.name`),
  };
}

export function decodeTrack(value: unknown, path = 'Track'): Track {
  const source = object(value, path);
  return {
    id: deezerStringId(source.id, `${path}.id`),
    title: string(source.title, `${path}.title`),
    artist: string(source.artist, `${path}.artist`),
    artist_id: deezerReferenceId(source.artist_id, `${path}.artist_id`),
    artists: array(source.artists, `${path}.artists`, decodeArtist),
    album: string(source.album, `${path}.album`),
    album_id: deezerReferenceId(source.album_id, `${path}.album_id`),
    cover: string(source.cover, `${path}.cover`),
    duration_sec: number(source.duration_sec, `${path}.duration_sec`),
    preview_url: nullableString(source.preview_url, `${path}.preview_url`),
    rank: number(source.rank, `${path}.rank`),
    release_date: string(source.release_date, `${path}.release_date`),
  };
}

export function decodeTrackList(value: unknown): Track[] {
  return array(value, 'Track[]', decodeTrack);
}

export function decodeUser(value: unknown): User {
  const source = object(value, 'User');
  return {
    id: number(source.id, 'User.id'),
    email: string(source.email, 'User.email'),
    display_name: nullableString(source.display_name, 'User.display_name'),
    is_admin: boolean(source.is_admin, 'User.is_admin'),
    is_approved: boolean(source.is_approved, 'User.is_approved'),
    avatar_url: nullableString(source.avatar_url, 'User.avatar_url'),
  };
}

function decodePlaylistSummaryItem(value: unknown, path: string): PlaylistSummary {
  const source = object(value, path);
  return {
    id: number(source.id, `${path}.id`),
    name: string(source.name, `${path}.name`),
    description: nullableString(source.description, `${path}.description`),
    cover_url: nullableString(source.cover_url, `${path}.cover_url`),
    is_public: boolean(source.is_public, `${path}.is_public`),
    track_count: number(source.track_count, `${path}.track_count`),
    owner_name: nullableString(source.owner_name, `${path}.owner_name`),
  };
}

export function decodePlaylistSummaries(value: unknown): PlaylistSummary[] {
  return array(value, 'PlaylistSummary[]', decodePlaylistSummaryItem);
}

export function decodePlaylist(value: unknown): Playlist {
  const source = object(value, 'Playlist');
  return {
    id: number(source.id, 'Playlist.id'),
    name: string(source.name, 'Playlist.name'),
    cover_url: nullableString(source.cover_url, 'Playlist.cover_url'),
    is_public: boolean(source.is_public, 'Playlist.is_public'),
    is_owner: boolean(source.is_owner, 'Playlist.is_owner'),
    owner_name: nullableString(source.owner_name, 'Playlist.owner_name'),
    tracks: array(source.tracks, 'Playlist.tracks', decodeTrack),
  };
}

export function decodeAlbum(value: unknown): AlbumDetail {
  const source = object(value, 'Album');
  return {
    id: deezerStringId(source.id, 'Album.id'),
    title: string(source.title, 'Album.title'),
    artist: string(source.artist, 'Album.artist'),
    artist_id: deezerReferenceId(source.artist_id, 'Album.artist_id'),
    cover: string(source.cover, 'Album.cover'),
    release_date: string(source.release_date, 'Album.release_date'),
    nb_tracks: number(source.nb_tracks, 'Album.nb_tracks'),
    tracks: array(source.tracks, 'Album.tracks', decodeTrack),
  };
}

export function decodeBooleanMap(value: unknown): Record<string, boolean> {
  const source = object(value, 'Boolean map');
  return Object.fromEntries(
    Object.entries(source).map(([key, entry]) => [key, boolean(entry, `Boolean map.${key}`)]),
  );
}

export function decodeOk(value: unknown): { ok: boolean } {
  const source = object(value, 'Logout response');
  return { ok: boolean(source.ok, 'Logout response.ok') };
}
