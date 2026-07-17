import type {
  AddedTracksResult,
  AdminInvite,
  AdminStatus,
  AdminStorageInfo,
  AdminStorageItem,
  AdminUser,
  AlbumDetail,
  AlbumSummary,
  ArtistAbout,
  ArtistDetail,
  ArtistRef,
  ArtistSummary,
  CachedTrackIds,
  DeezerPlaylistDetail,
  DeezerPlaylistTrack,
  Genre,
  GenreDetail,
  HomeShelf,
  LyricsLine,
  LyricsResponse,
  PartyMember,
  PartyState,
  PartyTrack,
  PlaybackSettings,
  Playlist,
  PlaylistSearchResult,
  PlaylistSummary,
  PublicProfile,
  ResolveKind,
  ResolveResult,
  StorageCleanupResult,
  Track,
  TrackPlayCount,
  TrackPlayCounts,
  User,
} from './types';

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

function nonNegativeInteger(value: unknown, path: string): number {
  const parsed = number(value, path);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${path} must be a safe non-negative integer`);
  }
  return parsed;
}

function integer(value: unknown, path: string): number {
  const parsed = number(value, path);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${path} must be a safe integer`);
  }
  return parsed;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const parsed = number(value, path);
  if (parsed < 0) throw new Error(`${path} must be a non-negative finite number`);
  return parsed;
}

function nullable<T>(
  value: unknown,
  path: string,
  decode: (value: unknown, path: string) => T,
): T | null {
  return value === null ? null : decode(value, path);
}

function literal<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const parsed = string(value, path);
  if (!allowed.includes(parsed as T)) {
    throw new Error(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return parsed as T;
}

function optionalTrue(source: JsonObject, key: string, path: string): true | undefined {
  if (!(key in source)) return undefined;
  if (source[key] !== true) throw new Error(`${path}.${key} must be true when present`);
  return true;
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
  const track: Track = {
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
  if ('playlist_entry_id' in source) {
    const entryId = nonNegativeInteger(
      source.playlist_entry_id,
      `${path}.playlist_entry_id`,
    );
    if (entryId === 0) throw new Error(`${path}.playlist_entry_id must be positive`);
    track.playlist_entry_id = entryId;
  }
  return track;
}

export function decodeTrackList(value: unknown): Track[] {
  return array(value, 'Track[]', decodeTrack);
}

export function decodeUser(value: unknown): User {
  const source = object(value, 'User');
  return {
    id: nonNegativeInteger(source.id, 'User.id'),
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
    id: nonNegativeInteger(source.id, `${path}.id`),
    name: string(source.name, `${path}.name`),
    description: nullableString(source.description, `${path}.description`),
    cover_url: nullableString(source.cover_url, `${path}.cover_url`),
    is_public: boolean(source.is_public, `${path}.is_public`),
    track_count: nonNegativeInteger(source.track_count, `${path}.track_count`),
    owner_name: nullableString(source.owner_name, `${path}.owner_name`),
  };
}

export function decodePlaylistSummaries(value: unknown): PlaylistSummary[] {
  return array(value, 'PlaylistSummary[]', decodePlaylistSummaryItem);
}

export function decodePlaylistSummary(value: unknown): PlaylistSummary {
  return decodePlaylistSummaryItem(value, 'PlaylistSummary');
}

export function decodePlaylist(value: unknown): Playlist {
  const source = object(value, 'Playlist');
  const tracks = array(source.tracks, 'Playlist.tracks', (track, path) => {
    const decoded = decodeTrack(track, path);
    if (decoded.playlist_entry_id === undefined) {
      throw new Error(`${path}.playlist_entry_id must be present`);
    }
    return decoded;
  });
  if (new Set(tracks.map((track) => track.playlist_entry_id)).size !== tracks.length) {
    throw new Error('Playlist.tracks playlist_entry_id values must be unique');
  }
  return {
    id: nonNegativeInteger(source.id, 'Playlist.id'),
    name: string(source.name, 'Playlist.name'),
    description: nullableString(source.description, 'Playlist.description'),
    cover_url: nullableString(source.cover_url, 'Playlist.cover_url'),
    is_public: boolean(source.is_public, 'Playlist.is_public'),
    is_owner: boolean(source.is_owner, 'Playlist.is_owner'),
    owner_name: nullableString(source.owner_name, 'Playlist.owner_name'),
    tracks,
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

function decodeAlbumSummaryItem(value: unknown, path: string): AlbumSummary {
  const source = object(value, path);
  return {
    id: deezerStringId(source.id, `${path}.id`),
    title: string(source.title, `${path}.title`),
    artist: string(source.artist, `${path}.artist`),
    cover: string(source.cover, `${path}.cover`),
    release_date: string(source.release_date, `${path}.release_date`),
  };
}

export function decodeAlbumSummaries(value: unknown): AlbumSummary[] {
  return array(value, 'AlbumSummary[]', decodeAlbumSummaryItem);
}

function decodeArtistSummaryItem(value: unknown, path: string): ArtistSummary {
  const source = object(value, path);
  return {
    id: deezerStringId(source.id, `${path}.id`),
    name: string(source.name, `${path}.name`),
    picture: string(source.picture, `${path}.picture`),
  };
}

export function decodeArtistSummaries(value: unknown): ArtistSummary[] {
  return array(value, 'ArtistSummary[]', decodeArtistSummaryItem);
}

export function decodeArtistDetail(value: unknown): ArtistDetail {
  const source = object(value, 'ArtistDetail');
  return {
    ...decodeArtistSummaryItem(source, 'ArtistDetail'),
    fans: nonNegativeInteger(source.fans, 'ArtistDetail.fans'),
    albums_count: nonNegativeInteger(source.albums_count, 'ArtistDetail.albums_count'),
    top: array(source.top, 'ArtistDetail.top', decodeTrack),
    albums: array(source.albums, 'ArtistDetail.albums', decodeAlbumSummaryItem),
    related: array(source.related, 'ArtistDetail.related', decodeArtistSummaryItem),
  };
}

export function decodeArtistAbout(value: unknown): ArtistAbout {
  const source = object(value, 'ArtistAbout');
  return {
    bio: string(source.bio, 'ArtistAbout.bio'),
    listeners: nonNegativeInteger(source.listeners, 'ArtistAbout.listeners'),
    playcount: nonNegativeInteger(source.playcount, 'ArtistAbout.playcount'),
    tags: array(source.tags, 'ArtistAbout.tags', string),
  };
}

function decodePlaylistSearchResultItem(value: unknown, path: string): PlaylistSearchResult {
  const source = object(value, path);
  return {
    id: deezerStringId(source.id, `${path}.id`),
    title: string(source.title, `${path}.title`),
    cover: string(source.cover, `${path}.cover`),
    track_count: nonNegativeInteger(source.track_count, `${path}.track_count`),
  };
}

export function decodePlaylistSearchResults(value: unknown): PlaylistSearchResult[] {
  return array(value, 'PlaylistSearchResult[]', decodePlaylistSearchResultItem);
}

function decodeGenreItem(value: unknown, path: string): Genre {
  const source = object(value, path);
  return {
    id: deezerStringId(source.id, `${path}.id`),
    name: string(source.name, `${path}.name`),
    picture: string(source.picture, `${path}.picture`),
  };
}

export function decodeGenres(value: unknown): Genre[] {
  return array(value, 'Genre[]', decodeGenreItem);
}

export function decodeGenreDetail(value: unknown): GenreDetail {
  const source = object(value, 'GenreDetail');
  return {
    ...decodeGenreItem(source, 'GenreDetail'),
    tracks: array(source.tracks, 'GenreDetail.tracks', decodeTrack),
    albums: array(source.albums, 'GenreDetail.albums', decodeAlbumSummaryItem),
    artists: array(source.artists, 'GenreDetail.artists', decodeArtistSummaryItem),
  };
}

function decodeHomeShelfItem(value: unknown, path: string): HomeShelf {
  const source = object(value, path);
  return {
    key: string(source.key, `${path}.key`),
    title: string(source.title, `${path}.title`),
    subtitle: string(source.subtitle, `${path}.subtitle`),
    cover: string(source.cover, `${path}.cover`),
    tracks: array(source.tracks, `${path}.tracks`, decodeTrack),
  };
}

export function decodeHomeShelves(value: unknown): HomeShelf[] {
  return array(value, 'HomeShelf[]', decodeHomeShelfItem);
}

export function decodePublicProfile(value: unknown): PublicProfile {
  const source = object(value, 'PublicProfile');
  return {
    id: nonNegativeInteger(source.id, 'PublicProfile.id'),
    display_name: nullableString(source.display_name, 'PublicProfile.display_name'),
    avatar_url: nullableString(source.avatar_url, 'PublicProfile.avatar_url'),
    playlists: array(source.playlists, 'PublicProfile.playlists', decodePlaylistSummaryItem),
    top_artists: array(source.top_artists, 'PublicProfile.top_artists', decodeArtistSummaryItem),
  };
}

export function decodePlaybackSettings(value: unknown): PlaybackSettings {
  const source = object(value, 'PlaybackSettings');
  return {
    crossfade_enabled: boolean(source.crossfade_enabled, 'PlaybackSettings.crossfade_enabled'),
    crossfade_duration_sec: nonNegativeInteger(
      source.crossfade_duration_sec,
      'PlaybackSettings.crossfade_duration_sec',
    ),
  };
}

export function decodeAddedTracksResult(value: unknown): AddedTracksResult {
  const source = object(value, 'AddedTracksResult');
  return { added: nonNegativeInteger(source.added, 'AddedTracksResult.added') };
}

function decodeResolveKind(value: unknown, path: string): ResolveKind {
  return literal(value, path, ['playlist', 'album', 'track'] as const);
}

function decodeUnmatchedTrack(value: unknown, path: string): ResolveResult['unmatched'][number] {
  const source = object(value, path);
  return {
    title: string(source.title, `${path}.title`),
    artist: string(source.artist, `${path}.artist`),
  };
}

export function decodeResolveResult(value: unknown): ResolveResult {
  const source = object(value, 'ResolveResult');
  return {
    type: decodeResolveKind(source.type, 'ResolveResult.type'),
    name: string(source.name, 'ResolveResult.name'),
    image: string(source.image, 'ResolveResult.image'),
    total: nonNegativeInteger(source.total, 'ResolveResult.total'),
    source_total: nonNegativeInteger(source.source_total, 'ResolveResult.source_total'),
    matched: nonNegativeInteger(source.matched, 'ResolveResult.matched'),
    tracks: array(source.tracks, 'ResolveResult.tracks', decodeTrack),
    unmatched: array(source.unmatched, 'ResolveResult.unmatched', decodeUnmatchedTrack),
  };
}

function decodeDeezerPlaylistTrack(value: unknown, path: string): DeezerPlaylistTrack {
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
  };
}

export function decodeDeezerPlaylistDetail(value: unknown): DeezerPlaylistDetail {
  const source = object(value, 'DeezerPlaylistDetail');
  return {
    id: deezerStringId(source.id, 'DeezerPlaylistDetail.id'),
    name: string(source.name, 'DeezerPlaylistDetail.name'),
    cover: string(source.cover, 'DeezerPlaylistDetail.cover'),
    tracks: array(
      source.tracks,
      'DeezerPlaylistDetail.tracks',
      decodeDeezerPlaylistTrack,
    ),
  };
}

function decodeLyricsLine(value: unknown, path: string): LyricsLine {
  const source = object(value, path);
  return {
    t: nonNegativeNumber(source.t, `${path}.t`),
    text: string(source.text, `${path}.text`),
  };
}

export function decodeLyricsResponse(value: unknown): LyricsResponse {
  const source = object(value, 'LyricsResponse');
  const result: LyricsResponse = {
    lines: nullable(source.lines, 'LyricsResponse.lines', (lines, path) =>
      array(lines, path, decodeLyricsLine),
    ),
    synced: boolean(source.synced, 'LyricsResponse.synced'),
    source: nullableString(source.source, 'LyricsResponse.source'),
    ai_generated: boolean(source.ai_generated, 'LyricsResponse.ai_generated'),
  };
  const cached = optionalTrue(source, 'cached', 'LyricsResponse');
  return cached === undefined ? result : { ...result, cached };
}

export function decodeCachedTrackIds(value: unknown): CachedTrackIds {
  const source = object(value, 'CachedTrackIds');
  return {
    ids: array(source.ids, 'CachedTrackIds.ids', deezerStringId),
  };
}

function decodeTrackPlayCount(value: unknown, path: string): TrackPlayCount {
  const source = object(value, path);
  return {
    plays: nonNegativeInteger(source.plays, `${path}.plays`),
    listeners: nonNegativeInteger(source.listeners, `${path}.listeners`),
  };
}

export function decodeTrackPlayCounts(value: unknown): TrackPlayCounts {
  const source = object(value, 'TrackPlayCounts');
  const result: TrackPlayCounts = {};
  for (const [id, count] of Object.entries(source)) {
    const decodedId = deezerStringId(id, `TrackPlayCounts key ${id}`);
    result[decodedId] = decodeTrackPlayCount(count, `TrackPlayCounts.${id}`);
  }
  return result;
}

function decodePartyTrack(value: unknown, path: string): PartyTrack {
  const source = object(value, path);
  return {
    id: nonNegativeInteger(source.id, `${path}.id`),
    deezer_id: deezerStringId(source.deezer_id, `${path}.deezer_id`),
    title: string(source.title, `${path}.title`),
    artist: string(source.artist, `${path}.artist`),
    artist_id: string(source.artist_id, `${path}.artist_id`),
    artists: array(source.artists, `${path}.artists`, decodeArtist),
    album: string(source.album, `${path}.album`),
    album_id: string(source.album_id, `${path}.album_id`),
    cover: string(source.cover, `${path}.cover`),
    duration_sec: nonNegativeInteger(source.duration_sec, `${path}.duration_sec`),
    added_by: string(source.added_by, `${path}.added_by`),
  };
}

function decodePartyMember(value: unknown, path: string): PartyMember {
  const source = object(value, path);
  return {
    name: string(source.name, `${path}.name`),
    avatar_url: nullableString(source.avatar_url, `${path}.avatar_url`),
  };
}

export function decodePartyState(value: unknown): PartyState {
  const source = object(value, 'PartyState');
  return {
    code: string(source.code, 'PartyState.code'),
    name: string(source.name, 'PartyState.name'),
    host_name: string(source.host_name, 'PartyState.host_name'),
    is_host: boolean(source.is_host, 'PartyState.is_host'),
    current_index: integer(source.current_index, 'PartyState.current_index'),
    is_playing: boolean(source.is_playing, 'PartyState.is_playing'),
    position_sec: nonNegativeNumber(source.position_sec, 'PartyState.position_sec'),
    playback_updated_at: nullableString(
      source.playback_updated_at,
      'PartyState.playback_updated_at',
    ),
    members: array(source.members, 'PartyState.members', decodePartyMember),
    tracks: array(source.tracks, 'PartyState.tracks', decodePartyTrack),
  };
}

function decodeAdminUser(value: unknown, path: string): AdminUser {
  const source = object(value, path);
  return {
    id: nonNegativeInteger(source.id, `${path}.id`),
    email: string(source.email, `${path}.email`),
    display_name: nullableString(source.display_name, `${path}.display_name`),
    avatar_url: nullableString(source.avatar_url, `${path}.avatar_url`),
    is_admin: boolean(source.is_admin, `${path}.is_admin`),
    is_approved: boolean(source.is_approved, `${path}.is_approved`),
    created_at: nullableString(source.created_at, `${path}.created_at`),
  };
}

export function decodeAdminUsers(value: unknown): AdminUser[] {
  return array(value, 'AdminUser[]', decodeAdminUser);
}

function decodeAdminStorageItem(value: unknown, path: string): AdminStorageItem {
  const source = object(value, path);
  return {
    deezer_id: deezerStringId(source.deezer_id, `${path}.deezer_id`),
    title: string(source.title, `${path}.title`),
    artist: string(source.artist, `${path}.artist`),
    size_bytes: nonNegativeInteger(source.size_bytes, `${path}.size_bytes`),
    last_accessed: nullableString(source.last_accessed, `${path}.last_accessed`),
  };
}

function decodeStorageCounters(source: JsonObject, path: string): Omit<AdminStorageInfo, 'tracks'> {
  return {
    track_count: nonNegativeInteger(source.track_count, `${path}.track_count`),
    total_bytes: nonNegativeInteger(source.total_bytes, `${path}.total_bytes`),
    disk_total: nonNegativeInteger(source.disk_total, `${path}.disk_total`),
    disk_used: nonNegativeInteger(source.disk_used, `${path}.disk_used`),
    disk_free: nonNegativeInteger(source.disk_free, `${path}.disk_free`),
    retention_days: nonNegativeInteger(source.retention_days, `${path}.retention_days`),
  };
}

export function decodeAdminStorageInfo(value: unknown): AdminStorageInfo {
  const source = object(value, 'AdminStorageInfo');
  return {
    ...decodeStorageCounters(source, 'AdminStorageInfo'),
    tracks: array(source.tracks, 'AdminStorageInfo.tracks', decodeAdminStorageItem),
  };
}

function decodeAdminInvite(value: unknown, path: string): AdminInvite {
  const source = object(value, path);
  return {
    code: string(source.code, `${path}.code`),
    url: string(source.url, `${path}.url`),
    used_by_name: nullableString(source.used_by_name, `${path}.used_by_name`),
    created_at: string(source.created_at, `${path}.created_at`),
  };
}

export function decodeAdminInviteResult(value: unknown): AdminInvite {
  return decodeAdminInvite(value, 'AdminInvite');
}

export function decodeAdminInvites(value: unknown): AdminInvite[] {
  return array(value, 'AdminInvite[]', decodeAdminInvite);
}

function decodeStatusCounts(
  source: JsonObject,
  path: string,
  keys: readonly string[],
): Record<string, number> {
  return Object.fromEntries(
    keys.map((key) => [key, nonNegativeInteger(source[key], `${path}.${key}`)]),
  );
}

export function decodeAdminStatus(value: unknown): AdminStatus {
  const source = object(value, 'AdminStatus');
  const deezer = object(source.deezer, 'AdminStatus.deezer');
  const storage = object(source.storage, 'AdminStatus.storage');
  const users = object(source.users, 'AdminStatus.users');
  const content = object(source.content, 'AdminStatus.content');
  const integrations = object(source.integrations, 'AdminStatus.integrations');
  const system = object(source.system, 'AdminStatus.system');
  return {
    deezer: {
      arl_configured: boolean(deezer.arl_configured, 'AdminStatus.deezer.arl_configured'),
      arl_ok: boolean(deezer.arl_ok, 'AdminStatus.deezer.arl_ok'),
      quality: string(deezer.quality, 'AdminStatus.deezer.quality'),
    },
    storage: decodeStorageCounters(storage, 'AdminStatus.storage'),
    users: decodeStatusCounts(users, 'AdminStatus.users', [
      'total',
      'approved',
      'pending',
      'admins',
    ]) as AdminStatus['users'],
    content: decodeStatusCounts(content, 'AdminStatus.content', [
      'playlists',
      'likes',
      'follows',
      'plays',
      'stored_lyrics',
      'parties',
      'invites_total',
      'invites_used',
    ]) as AdminStatus['content'],
    integrations: {
      spotify_configured: boolean(
        integrations.spotify_configured,
        'AdminStatus.integrations.spotify_configured',
      ),
      lastfm_configured: boolean(
        integrations.lastfm_configured,
        'AdminStatus.integrations.lastfm_configured',
      ),
    },
    system: {
      app_env: string(system.app_env, 'AdminStatus.system.app_env'),
      database: string(system.database, 'AdminStatus.system.database'),
      jwt_secure: boolean(system.jwt_secure, 'AdminStatus.system.jwt_secure'),
      cookie_secure: boolean(system.cookie_secure, 'AdminStatus.system.cookie_secure'),
    },
  };
}

export function decodeStorageCleanupResult(value: unknown): StorageCleanupResult {
  const source = object(value, 'StorageCleanupResult');
  return {
    removed: nonNegativeInteger(source.removed, 'StorageCleanupResult.removed'),
    freed_bytes: nonNegativeInteger(source.freed_bytes, 'StorageCleanupResult.freed_bytes'),
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
