import type {
  AddedTracksResult,
  AdminConnectDevice,
  AdminInvite,
  AdminOverviewStorage,
  AdminRecentPlay,
  AdminRecentTrackRequest,
  AdminRequestSourceStat,
  AdminStatEntry,
  AdminStatus,
  AdminStorageInfo,
  AdminStorageItem,
  AdminTrackRequestSource,
  AdminUsageOverview,
  AdminUsageOverviewResponse,
  AdminUsageRange,
  AdminUser,
  AdminUserLibrary,
  AdminUserStorage,
  AdminUserStorageBreakdown,
  AdminUserUsageDetailResponse,
  AdminUserUsageSummary,
  AlbumDetail,
  AlbumSummary,
  ArtistAbout,
  ArtistDetail,
  ArtistRef,
  ArtistSummary,
  CachedTrackIds,
  ConnectCommandAction,
  ConnectDevice,
  ConnectDeviceCapabilities,
  ConnectDeviceType,
  ConnectPlaybackState,
  ConnectQueueOrigin,
  ConnectRepeatMode,
  ConnectServerFrame,
  ConnectState,
  ConnectTicket,
  DeezerPlaylistDetail,
  DeezerPlaylistTrack,
  Genre,
  GenreDetail,
  HomeShelf,
  ImportJobDetail,
  ImportJobState,
  ImportJobStatus,
  LyricsLine,
  LyricsResponse,
  PartyLoadState,
  PartyMember,
  PartyState,
  PartyTrack,
  PlaybackSettings,
  Playlist,
  PlaylistCollaborator,
  PlaylistCollaboratorUser,
  PlaylistInvite,
  PlaylistInvitePreview,
  PlaylistInviteStatus,
  PlaylistJoinResult,
  PlaylistRole,
  PlaylistSearchResult,
  PlaylistSummary,
  PublicProfile,
  RadarReason,
  ReleaseRadarEntry,
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

function optionalNullableNumber(
  source: JsonObject,
  key: string,
  path: string,
): number | null | undefined {
  if (!(key in source)) return undefined;
  return nullable(source[key], `${path}.${key}`, number);
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
  for (const key of ['loudness_gain_db', 'loudness_lufs', 'loudness_peak'] as const) {
    const decoded = optionalNullableNumber(source, key, path);
    if (decoded !== undefined) track[key] = decoded;
  }
  if ('playlist_entry_id' in source) {
    const entryId = nonNegativeInteger(
      source.playlist_entry_id,
      `${path}.playlist_entry_id`,
    );
    if (entryId === 0) throw new Error(`${path}.playlist_entry_id must be positive`);
    track.playlist_entry_id = entryId;
  }
  if ('added_by' in source) {
    track.added_by = nullable(
      source.added_by,
      `${path}.added_by`,
      decodePlaylistCollaboratorUser,
    );
  }
  if ('added_at' in source) {
    track.added_at = nullableString(source.added_at, `${path}.added_at`);
  }
  return track;
}

export function decodeTrackList(value: unknown): Track[] {
  return array(value, 'Track[]', decodeTrack);
}

function decodeRadarReason(value: unknown, path: string): RadarReason {
  const source = object(value, path);
  return {
    kind: literal(source.kind, `${path}.kind`, ['followed', 'played'] as const),
    artist_id: deezerStringId(source.artist_id, `${path}.artist_id`),
    // Legitimately '' when the account's follow/play rows never stored a name.
    artist_name: string(source.artist_name, `${path}.artist_name`),
    play_count: nonNegativeInteger(source.play_count, `${path}.play_count`),
  };
}

function decodeReleaseRadarEntry(value: unknown, path: string): ReleaseRadarEntry {
  const source = object(value, path);
  if (!('radar_reason' in source)) {
    throw new Error(
      `${path}.radar_reason is missing: the server does not say why this track is in the Release Radar (it predates radar reasons)`,
    );
  }
  return {
    // decodeTrack copies only Track fields, so the reason never reaches `track`.
    track: decodeTrack(source, path),
    radar_reason: decodeRadarReason(source.radar_reason, `${path}.radar_reason`),
  };
}

export function decodeReleaseRadar(value: unknown): ReleaseRadarEntry[] {
  return array(value, 'ReleaseRadar', decodeReleaseRadarEntry);
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

const PLAYLIST_ROLES = ['owner', 'editor'] as const satisfies readonly PlaylistRole[];

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonNegativeInteger(value, path);
  if (parsed === 0) throw new Error(`${path} must be positive`);
  return parsed;
}

export function decodePlaylistCollaboratorUser(
  value: unknown,
  path = 'PlaylistCollaboratorUser',
): PlaylistCollaboratorUser {
  const source = object(value, path);
  return {
    id: nonNegativeInteger(source.id, `${path}.id`),
    display_name: nullableString(source.display_name, `${path}.display_name`),
    avatar_url: nullableString(source.avatar_url, `${path}.avatar_url`),
  };
}

export function decodePlaylistCollaborator(
  value: unknown,
  path = 'PlaylistCollaborator',
): PlaylistCollaborator {
  const source = object(value, path);
  return {
    user_id: nonNegativeInteger(source.user_id, `${path}.user_id`),
    display_name: nullableString(source.display_name, `${path}.display_name`),
    avatar_url: nullableString(source.avatar_url, `${path}.avatar_url`),
    role: literal(source.role, `${path}.role`, PLAYLIST_ROLES),
    joined_at: nullableString(source.joined_at, `${path}.joined_at`),
  };
}

export function decodePlaylistInvite(
  value: unknown,
  path = 'PlaylistInvite',
): PlaylistInvite {
  const source = object(value, path);
  const token = string(source.token, `${path}.token`);
  if (token.trim().length === 0) throw new Error(`${path}.token must not be empty`);
  const createdAt = string(source.created_at, `${path}.created_at`);
  if (createdAt.trim().length === 0) throw new Error(`${path}.created_at must not be empty`);
  return {
    token,
    created_at: createdAt,
    expires_at: nullableString(source.expires_at, `${path}.expires_at`),
  };
}

export function decodePlaylistInviteStatus(value: unknown): PlaylistInviteStatus {
  const source = object(value, 'PlaylistInviteStatus');
  return {
    invite: nullable(source.invite, 'PlaylistInviteStatus.invite', decodePlaylistInvite),
  };
}

export function decodePlaylistInvitePreview(value: unknown): PlaylistInvitePreview {
  const source = object(value, 'PlaylistInvitePreview');
  return {
    playlist_id: positiveInteger(source.playlist_id, 'PlaylistInvitePreview.playlist_id'),
    name: string(source.name, 'PlaylistInvitePreview.name'),
    description: nullableString(source.description, 'PlaylistInvitePreview.description'),
    cover_url: nullableString(source.cover_url, 'PlaylistInvitePreview.cover_url'),
    track_count: nonNegativeInteger(source.track_count, 'PlaylistInvitePreview.track_count'),
    collaborator_count: nonNegativeInteger(
      source.collaborator_count,
      'PlaylistInvitePreview.collaborator_count',
    ),
    owner: decodePlaylistCollaboratorUser(source.owner, 'PlaylistInvitePreview.owner'),
    is_owner: boolean(source.is_owner, 'PlaylistInvitePreview.is_owner'),
    already_collaborator: boolean(
      source.already_collaborator,
      'PlaylistInvitePreview.already_collaborator',
    ),
  };
}

export function decodePlaylistJoinResult(value: unknown): PlaylistJoinResult {
  const source = object(value, 'PlaylistJoinResult');
  return {
    playlist_id: positiveInteger(source.playlist_id, 'PlaylistJoinResult.playlist_id'),
    playlist_name: string(source.playlist_name, 'PlaylistJoinResult.playlist_name'),
    joined: boolean(source.joined, 'PlaylistJoinResult.joined'),
    already_member: boolean(source.already_member, 'PlaylistJoinResult.already_member'),
    role: literal(source.role, 'PlaylistJoinResult.role', PLAYLIST_ROLES),
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
    owner_id: nullable(source.owner_id, `${path}.owner_id`, nonNegativeInteger),
    owner_name: nullableString(source.owner_name, `${path}.owner_name`),
    owner_avatar_url: nullableString(source.owner_avatar_url, `${path}.owner_avatar_url`),
    is_collaborative: boolean(source.is_collaborative, `${path}.is_collaborative`),
    is_owner: boolean(source.is_owner, `${path}.is_owner`),
    is_collaborator: boolean(source.is_collaborator, `${path}.is_collaborator`),
    can_edit_tracks: boolean(source.can_edit_tracks, `${path}.can_edit_tracks`),
    collaborator_count: nonNegativeInteger(
      source.collaborator_count,
      `${path}.collaborator_count`,
    ),
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
    if (decoded.added_by === undefined) {
      throw new Error(`${path}.added_by must be present`);
    }
    if (decoded.added_at === undefined) {
      throw new Error(`${path}.added_at must be present`);
    }
    return decoded;
  });
  if (new Set(tracks.map((track) => track.playlist_entry_id)).size !== tracks.length) {
    throw new Error('Playlist.tracks playlist_entry_id values must be unique');
  }
  const collaborators = array(
    source.collaborators,
    'Playlist.collaborators',
    decodePlaylistCollaborator,
  );
  const collaboratorCount = nonNegativeInteger(
    source.collaborator_count,
    'Playlist.collaborator_count',
  );
  if (collaboratorCount !== collaborators.length) {
    throw new Error('Playlist.collaborator_count must match Playlist.collaborators length');
  }
  return {
    id: nonNegativeInteger(source.id, 'Playlist.id'),
    name: string(source.name, 'Playlist.name'),
    description: nullableString(source.description, 'Playlist.description'),
    cover_url: nullableString(source.cover_url, 'Playlist.cover_url'),
    is_public: boolean(source.is_public, 'Playlist.is_public'),
    is_owner: boolean(source.is_owner, 'Playlist.is_owner'),
    owner_id: nullable(source.owner_id, 'Playlist.owner_id', nonNegativeInteger),
    owner_name: nullableString(source.owner_name, 'Playlist.owner_name'),
    owner_avatar_url: nullableString(source.owner_avatar_url, 'Playlist.owner_avatar_url'),
    is_collaborative: boolean(source.is_collaborative, 'Playlist.is_collaborative'),
    is_collaborator: boolean(source.is_collaborator, 'Playlist.is_collaborator'),
    can_edit_tracks: boolean(source.can_edit_tracks, 'Playlist.can_edit_tracks'),
    collaborators,
    collaborator_count: collaboratorCount,
    revision: nonNegativeInteger(source.revision, 'Playlist.revision'),
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

const IMPORT_JOB_STATES = ['queued', 'running', 'done', 'failed'] as const satisfies readonly ImportJobState[];

function decodeImportJobFields(source: Record<string, unknown>, path: string): ImportJobStatus {
  return {
    id: string(source.id, `${path}.id`),
    url: string(source.url, `${path}.url`),
    status: literal(source.status, `${path}.status`, IMPORT_JOB_STATES),
    type: literal(source.type, `${path}.type`, ['', 'playlist', 'album', 'track'] as const),
    name: string(source.name, `${path}.name`),
    image: string(source.image, `${path}.image`),
    total: nonNegativeInteger(source.total, `${path}.total`),
    source_total: nonNegativeInteger(source.source_total, `${path}.source_total`),
    processed: nonNegativeInteger(source.processed, `${path}.processed`),
    matched: nonNegativeInteger(source.matched, `${path}.matched`),
    failed_lookups: nonNegativeInteger(source.failed_lookups, `${path}.failed_lookups`),
    lookup_error: nullableString(source.lookup_error, `${path}.lookup_error`),
    error: nullableString(source.error, `${path}.error`),
    created_at: string(source.created_at, `${path}.created_at`),
    updated_at: string(source.updated_at, `${path}.updated_at`),
    finished_at: nullableString(source.finished_at, `${path}.finished_at`),
  };
}

function decodeImportJobStatusAt(value: unknown, path: string): ImportJobStatus {
  return decodeImportJobFields(object(value, path), path);
}

export function decodeImportJobStatus(value: unknown): ImportJobStatus {
  return decodeImportJobStatusAt(value, 'ImportJobStatus');
}

export function decodeImportJobStatuses(value: unknown): ImportJobStatus[] {
  return array(value, 'ImportJobStatus[]', decodeImportJobStatusAt);
}

export function decodeImportJobDetail(value: unknown): ImportJobDetail {
  const source = object(value, 'ImportJobDetail');
  const job = decodeImportJobFields(source, 'ImportJobDetail');
  const result = source.result === null ? null : decodeResolveResult(source.result);
  if (job.status === 'done' && result === null) {
    throw new Error(`ImportJobDetail ${job.id} is done but carries no result`);
  }
  return { ...job, result };
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

const PARTY_LOAD_STATES = [
  'ready',
  'loading',
  'queued',
  'failed',
  'idle',
] as const satisfies readonly PartyLoadState[];

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
    added_by_member: string(source.added_by_member, `${path}.added_by_member`),
    added_by_avatar_url: nullableString(source.added_by_avatar_url, `${path}.added_by_avatar_url`),
    load_state: literal(source.load_state, `${path}.load_state`, PARTY_LOAD_STATES),
    load_error: nullableString(source.load_error, `${path}.load_error`),
    is_stored: boolean(source.is_stored, `${path}.is_stored`),
  };
}

function decodePartyMember(value: unknown, path: string): PartyMember {
  const source = object(value, path);
  return {
    key: string(source.key, `${path}.key`),
    name: string(source.name, `${path}.name`),
    avatar_url: nullableString(source.avatar_url, `${path}.avatar_url`),
    is_guest: boolean(source.is_guest, `${path}.is_guest`),
    is_host: boolean(source.is_host, `${path}.is_host`),
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
    server_time: string(source.server_time, 'PartyState.server_time'),
    guests_can_control: boolean(source.guests_can_control, 'PartyState.guests_can_control'),
    playback_changed_by: string(source.playback_changed_by, 'PartyState.playback_changed_by'),
    playback_revision: nonNegativeInteger(source.playback_revision, 'PartyState.playback_revision'),
    ended: boolean(source.ended, 'PartyState.ended'),
    members: array(source.members, 'PartyState.members', decodePartyMember),
    tracks: array(source.tracks, 'PartyState.tracks', decodePartyTrack),
    viewer_key: string(source.viewer_key, 'PartyState.viewer_key'),
    viewer_name: string(source.viewer_name, 'PartyState.viewer_name'),
    viewer_is_guest: boolean(source.viewer_is_guest, 'PartyState.viewer_is_guest'),
  };
}

export function decodeNullablePartyState(value: unknown): PartyState | null {
  return value === null ? null : decodePartyState(value);
}

const CONNECT_DEVICE_TYPES = [
  'web',
  'mobile',
  'tablet',
  'desktop',
  'tv',
  'speaker',
  'other',
] as const satisfies readonly ConnectDeviceType[];

const CONNECT_QUEUE_ORIGINS = [
  'manual',
  'context',
] as const satisfies readonly ConnectQueueOrigin[];

const CONNECT_REPEAT_MODES = [
  'off',
  'all',
  'one',
] as const satisfies readonly ConnectRepeatMode[];

const CONNECT_COMMAND_ACTIONS = [
  'play',
  'pause',
  'toggle',
  'next',
  'prev',
  'clear_queue',
  'seek',
  'set_volume',
  'set_mute',
  'set_shuffle',
  'set_repeat',
  'play_tracks',
  'queue_add',
  'queue_play_next',
  'queue_remove',
  'queue_reorder',
  'select_index',
] as const satisfies readonly ConnectCommandAction[];

function unitInterval(value: unknown, path: string): number {
  const parsed = number(value, path);
  if (parsed < 0 || parsed > 1) {
    throw new Error(`${path} must be between 0 and 1`);
  }
  return parsed;
}

function decodeConnectDeviceCapabilities(
  value: unknown,
  path: string,
): ConnectDeviceCapabilities {
  const source = object(value, path);
  return {
    can_play_audio: boolean(source.can_play_audio, `${path}.can_play_audio`),
    can_control_volume: boolean(source.can_control_volume, `${path}.can_control_volume`),
  };
}

export function decodeConnectDevice(value: unknown, path = 'ConnectDevice'): ConnectDevice {
  const source = object(value, path);
  return {
    device_id: string(source.device_id, `${path}.device_id`),
    name: string(source.name, `${path}.name`),
    device_type: literal(source.device_type, `${path}.device_type`, CONNECT_DEVICE_TYPES),
    capabilities: decodeConnectDeviceCapabilities(source.capabilities, `${path}.capabilities`),
    volume: unitInterval(source.volume, `${path}.volume`),
    muted: boolean(source.muted, `${path}.muted`),
    is_active: boolean(source.is_active, `${path}.is_active`),
    party_code: nullableString(source.party_code, `${path}.party_code`),
    connected_at: string(source.connected_at, `${path}.connected_at`),
    last_seen_at: string(source.last_seen_at, `${path}.last_seen_at`),
  };
}

export function decodeConnectPlaybackState(
  value: unknown,
  path = 'ConnectPlaybackState',
): ConnectPlaybackState {
  const source = object(value, path);
  return {
    queue: array(source.queue, `${path}.queue`, decodeTrack),
    origins: array(source.origins, `${path}.origins`, (item, itemPath) =>
      literal(item, itemPath, CONNECT_QUEUE_ORIGINS),
    ),
    queue_context: nullableString(source.queue_context, `${path}.queue_context`),
    current_index: integer(source.current_index, `${path}.current_index`),
    is_playing: boolean(source.is_playing, `${path}.is_playing`),
    position_sec: nonNegativeNumber(source.position_sec, `${path}.position_sec`),
    duration_sec: nonNegativeNumber(source.duration_sec, `${path}.duration_sec`),
    shuffle: boolean(source.shuffle, `${path}.shuffle`),
    repeat: literal(source.repeat, `${path}.repeat`, CONNECT_REPEAT_MODES),
    volume: unitInterval(source.volume, `${path}.volume`),
    muted: boolean(source.muted, `${path}.muted`),
    updated_at: nullableString(source.updated_at, `${path}.updated_at`),
  };
}

export function decodeConnectState(value: unknown, path = 'ConnectState'): ConnectState {
  const source = object(value, path);
  return {
    revision: nonNegativeInteger(source.revision, `${path}.revision`),
    active_device_id: nullableString(source.active_device_id, `${path}.active_device_id`),
    devices: array(source.devices, `${path}.devices`, decodeConnectDevice),
    playback: decodeConnectPlaybackState(source.playback, `${path}.playback`),
    server_time: string(source.server_time, `${path}.server_time`),
  };
}

export function decodeConnectTicket(value: unknown): ConnectTicket {
  const source = object(value, 'ConnectTicket');
  const ticket = string(source.ticket, 'ConnectTicket.ticket');
  if (ticket.trim().length === 0) {
    throw new Error('ConnectTicket.ticket must not be empty');
  }
  const expiresIn = nonNegativeInteger(source.expires_in_sec, 'ConnectTicket.expires_in_sec');
  if (expiresIn <= 0) {
    throw new Error('ConnectTicket.expires_in_sec must be positive');
  }
  return { ticket, expires_in_sec: expiresIn };
}

export function decodeConnectServerFrame(value: unknown): ConnectServerFrame {
  const source = object(value, 'ConnectServerFrame');
  const type = string(source.type, 'ConnectServerFrame.type');
  switch (type) {
    case 'welcome': {
      const interval = nonNegativeInteger(
        source.heartbeat_interval_sec,
        'ConnectServerFrame.heartbeat_interval_sec',
      );
      if (interval <= 0) {
        throw new Error('ConnectServerFrame.heartbeat_interval_sec must be positive');
      }
      return {
        type: 'welcome',
        self_device_id: string(source.self_device_id, 'ConnectServerFrame.self_device_id'),
        heartbeat_interval_sec: interval,
        state: decodeConnectState(source.state, 'ConnectServerFrame.state'),
      };
    }
    case 'state':
      return {
        type: 'state',
        state: decodeConnectState(source.state, 'ConnectServerFrame.state'),
      };
    case 'activate':
      return {
        type: 'activate',
        from_device_id: nullableString(source.from_device_id, 'ConnectServerFrame.from_device_id'),
        playback: decodeConnectPlaybackState(source.playback, 'ConnectServerFrame.playback'),
      };
    case 'deactivated':
      return {
        type: 'deactivated',
        new_active_device_id: string(
          source.new_active_device_id,
          'ConnectServerFrame.new_active_device_id',
        ),
        reason: literal(source.reason, 'ConnectServerFrame.reason', [
          'transferred',
          'claimed_by_other_device',
        ] as const),
      };
    case 'command':
      return {
        type: 'command',
        command_id: string(source.command_id, 'ConnectServerFrame.command_id'),
        request_id: nullableString(source.request_id, 'ConnectServerFrame.request_id'),
        from_device_id: string(source.from_device_id, 'ConnectServerFrame.from_device_id'),
        action: literal(source.action, 'ConnectServerFrame.action', CONNECT_COMMAND_ACTIONS),
        payload: source.payload === undefined || source.payload === null
          ? {}
          : object(source.payload, 'ConnectServerFrame.payload'),
      };
    case 'command_result':
      return {
        type: 'command_result',
        request_id: nullableString(source.request_id, 'ConnectServerFrame.request_id'),
        command_id: string(source.command_id, 'ConnectServerFrame.command_id'),
        ok: boolean(source.ok, 'ConnectServerFrame.ok'),
        error: nullableString(source.error, 'ConnectServerFrame.error'),
      };
    case 'ping':
    case 'pong':
      return {
        type,
        ts: string(source.ts, 'ConnectServerFrame.ts'),
      };
    case 'error':
      return {
        type: 'error',
        code: string(source.code, 'ConnectServerFrame.code'),
        detail: string(source.detail, 'ConnectServerFrame.detail'),
        request_id: nullableString(source.request_id, 'ConnectServerFrame.request_id'),
      };
    default:
      throw new Error(`ConnectServerFrame.type has unknown value "${type}"`);
  }
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

const ADMIN_USAGE_RANGES = ['7d', '30d', 'all'] as const satisfies readonly AdminUsageRange[];
const ADMIN_TRACK_REQUEST_SOURCES = [
  'stream',
  'preload',
  'playlist_export',
  'party_preload',
  'radar_preload',
  'lyrics_ai',
] as const satisfies readonly AdminTrackRequestSource[];

function nonEmptyString(value: unknown, path: string): string {
  const parsed = string(value, path).trim();
  if (parsed.length === 0) throw new Error(`${path} must be a non-empty string`);
  return parsed;
}

function isoTimestamp(value: unknown, path: string): string {
  const parsed = nonEmptyString(value, path);
  if (Number.isNaN(Date.parse(parsed))) {
    throw new Error(`${path} must be a valid ISO-8601 timestamp`);
  }
  return parsed;
}

function nullableIsoTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : isoTimestamp(value, path);
}

function canonicalStatId(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!allowEmpty && trimmed.length === 0) {
      throw new Error(`${path} must be a non-empty id`);
    }
    return trimmed;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new Error(`${path} must be a string or safe non-negative integer`);
}

function decodeAdminOverviewStorage(value: unknown, path: string): AdminOverviewStorage {
  const source = object(value, path);
  const storage: AdminOverviewStorage = {
    cached_tracks: nonNegativeInteger(source.cached_tracks, `${path}.cached_tracks`),
    total_audio_bytes: nonNegativeInteger(source.total_audio_bytes, `${path}.total_audio_bytes`),
    exclusive_audio_bytes: nonNegativeInteger(
      source.exclusive_audio_bytes,
      `${path}.exclusive_audio_bytes`,
    ),
    exclusive_audio_tracks: nonNegativeInteger(
      source.exclusive_audio_tracks,
      `${path}.exclusive_audio_tracks`,
    ),
    shared_audio_bytes: nonNegativeInteger(source.shared_audio_bytes, `${path}.shared_audio_bytes`),
    shared_audio_tracks: nonNegativeInteger(
      source.shared_audio_tracks,
      `${path}.shared_audio_tracks`,
    ),
    unattributed_audio_bytes: nonNegativeInteger(
      source.unattributed_audio_bytes,
      `${path}.unattributed_audio_bytes`,
    ),
    unattributed_audio_tracks: nonNegativeInteger(
      source.unattributed_audio_tracks,
      `${path}.unattributed_audio_tracks`,
    ),
    directly_attributed_tracks: nonNegativeInteger(
      source.directly_attributed_tracks,
      `${path}.directly_attributed_tracks`,
    ),
    directly_attributed_bytes: nonNegativeInteger(
      source.directly_attributed_bytes,
      `${path}.directly_attributed_bytes`,
    ),
    upload_bytes: nonNegativeInteger(source.upload_bytes, `${path}.upload_bytes`),
    disk_total: positiveInteger(source.disk_total, `${path}.disk_total`),
    disk_used: nonNegativeInteger(source.disk_used, `${path}.disk_used`),
    disk_free: nonNegativeInteger(source.disk_free, `${path}.disk_free`),
    retention_days: nonNegativeInteger(source.retention_days, `${path}.retention_days`),
  };

  if (
    storage.exclusive_audio_bytes + storage.shared_audio_bytes + storage.unattributed_audio_bytes
    !== storage.total_audio_bytes
  ) {
    throw new Error(
      `${path}.total_audio_bytes must equal exclusive_audio_bytes + shared_audio_bytes + unattributed_audio_bytes`,
    );
  }
  if (
    storage.exclusive_audio_tracks + storage.shared_audio_tracks + storage.unattributed_audio_tracks
    !== storage.cached_tracks
  ) {
    throw new Error(
      `${path}.cached_tracks must equal exclusive_audio_tracks + shared_audio_tracks + unattributed_audio_tracks`,
    );
  }
  if (storage.directly_attributed_tracks > storage.cached_tracks) {
    throw new Error(`${path}.directly_attributed_tracks must not exceed cached_tracks`);
  }
  if (storage.directly_attributed_bytes > storage.total_audio_bytes) {
    throw new Error(`${path}.directly_attributed_bytes must not exceed total_audio_bytes`);
  }
  if (storage.disk_used > storage.disk_total) {
    throw new Error(`${path}.disk_used must not exceed disk_total`);
  }
  return storage;
}

function decodeAdminUsageOverviewData(value: unknown, path: string): AdminUsageOverview {
  const source = object(value, path);
  const overview: AdminUsageOverview = {
    total_users: nonNegativeInteger(source.total_users, `${path}.total_users`),
    approved_users: nonNegativeInteger(source.approved_users, `${path}.approved_users`),
    pending_users: nonNegativeInteger(source.pending_users, `${path}.pending_users`),
    active_users: nonNegativeInteger(source.active_users, `${path}.active_users`),
    total_plays: nonNegativeInteger(source.total_plays, `${path}.total_plays`),
    total_listening_sec: nonNegativeInteger(
      source.total_listening_sec,
      `${path}.total_listening_sec`,
    ),
    unique_tracks_played: nonNegativeInteger(
      source.unique_tracks_played,
      `${path}.unique_tracks_played`,
    ),
    tracks_requested: nonNegativeInteger(source.tracks_requested, `${path}.tracks_requested`),
    tracks_materialized: nonNegativeInteger(
      source.tracks_materialized,
      `${path}.tracks_materialized`,
    ),
    materialized_bytes: nonNegativeInteger(source.materialized_bytes, `${path}.materialized_bytes`),
    online_connect_devices: nonNegativeInteger(
      source.online_connect_devices,
      `${path}.online_connect_devices`,
    ),
    online_connect_users: nonNegativeInteger(
      source.online_connect_users,
      `${path}.online_connect_users`,
    ),
    active_parties: nonNegativeInteger(source.active_parties, `${path}.active_parties`),
    storage: decodeAdminOverviewStorage(source.storage, `${path}.storage`),
  };

  if (overview.approved_users + overview.pending_users !== overview.total_users) {
    throw new Error(`${path}.total_users must equal approved_users + pending_users`);
  }
  if (overview.active_users > overview.total_users) {
    throw new Error(`${path}.active_users must not exceed total_users`);
  }
  if (overview.tracks_materialized > overview.tracks_requested) {
    throw new Error(`${path}.tracks_materialized must not exceed tracks_requested`);
  }
  if (overview.online_connect_users > overview.total_users) {
    throw new Error(`${path}.online_connect_users must not exceed total_users`);
  }
  if (overview.online_connect_users > overview.online_connect_devices) {
    throw new Error(`${path}.online_connect_users must not exceed online_connect_devices`);
  }
  return overview;
}

function decodeAdminUserStorage(value: unknown, path: string): AdminUserStorage {
  const source = object(value, path);
  const storage: AdminUserStorage = {
    exclusive_bytes: nonNegativeInteger(source.exclusive_bytes, `${path}.exclusive_bytes`),
    exclusive_tracks: nonNegativeInteger(source.exclusive_tracks, `${path}.exclusive_tracks`),
    shared_bytes: nonNegativeInteger(source.shared_bytes, `${path}.shared_bytes`),
    shared_tracks: nonNegativeInteger(source.shared_tracks, `${path}.shared_tracks`),
    accessed_bytes: nonNegativeInteger(source.accessed_bytes, `${path}.accessed_bytes`),
    accessed_tracks: nonNegativeInteger(source.accessed_tracks, `${path}.accessed_tracks`),
    materialized_bytes: nonNegativeInteger(source.materialized_bytes, `${path}.materialized_bytes`),
    materialized_tracks: nonNegativeInteger(
      source.materialized_tracks,
      `${path}.materialized_tracks`,
    ),
    pinned_bytes: nonNegativeInteger(source.pinned_bytes, `${path}.pinned_bytes`),
    pinned_tracks: nonNegativeInteger(source.pinned_tracks, `${path}.pinned_tracks`),
    upload_bytes: nonNegativeInteger(source.upload_bytes, `${path}.upload_bytes`),
  };

  if (storage.exclusive_bytes + storage.shared_bytes !== storage.accessed_bytes) {
    throw new Error(`${path}.accessed_bytes must equal exclusive_bytes + shared_bytes`);
  }
  if (storage.exclusive_tracks + storage.shared_tracks !== storage.accessed_tracks) {
    throw new Error(`${path}.accessed_tracks must equal exclusive_tracks + shared_tracks`);
  }
  return storage;
}

function decodeAdminUserStorageBreakdown(
  value: unknown,
  path: string,
): AdminUserStorageBreakdown {
  const source = object(value, path);
  const base = decodeAdminUserStorage(source, path);
  const totalCacheBytes = nonNegativeInteger(source.total_cache_bytes, `${path}.total_cache_bytes`);
  if (base.accessed_bytes > totalCacheBytes) {
    throw new Error(`${path}.accessed_bytes must not exceed total_cache_bytes`);
  }
  if (base.materialized_bytes > totalCacheBytes) {
    throw new Error(`${path}.materialized_bytes must not exceed total_cache_bytes`);
  }
  if (base.pinned_bytes > totalCacheBytes) {
    throw new Error(`${path}.pinned_bytes must not exceed total_cache_bytes`);
  }
  return { ...base, total_cache_bytes: totalCacheBytes };
}

function decodeAdminUserLibrary(value: unknown, path: string): AdminUserLibrary {
  const source = object(value, path);
  const library: AdminUserLibrary = {
    likes: nonNegativeInteger(source.likes, `${path}.likes`),
    playlists: nonNegativeInteger(source.playlists, `${path}.playlists`),
    public_playlists: nonNegativeInteger(source.public_playlists, `${path}.public_playlists`),
    playlist_tracks: nonNegativeInteger(source.playlist_tracks, `${path}.playlist_tracks`),
    follows: nonNegativeInteger(source.follows, `${path}.follows`),
    party_tracks_added: nonNegativeInteger(source.party_tracks_added, `${path}.party_tracks_added`),
    party_hosted: nonNegativeInteger(source.party_hosted, `${path}.party_hosted`),
    import_jobs: nonNegativeInteger(source.import_jobs, `${path}.import_jobs`),
    import_tracks_matched: nonNegativeInteger(
      source.import_tracks_matched,
      `${path}.import_tracks_matched`,
    ),
  };
  if (library.public_playlists > library.playlists) {
    throw new Error(`${path}.public_playlists must not exceed playlists`);
  }
  return library;
}

function decodeAdminUserUsageSummary(value: unknown, path: string): AdminUserUsageSummary {
  const source = object(value, path);
  const tracksRequested = nonNegativeInteger(source.tracks_requested, `${path}.tracks_requested`);
  const tracksMaterialized = nonNegativeInteger(
    source.tracks_materialized,
    `${path}.tracks_materialized`,
  );
  if (tracksMaterialized > tracksRequested) {
    throw new Error(`${path}.tracks_materialized must not exceed tracks_requested`);
  }
  const rawDisplayName = nullableString(source.display_name, `${path}.display_name`);
  const displayName = rawDisplayName === null ? null : rawDisplayName.trim() || null;

  return {
    id: nonNegativeInteger(source.id, `${path}.id`),
    email: nonEmptyString(source.email, `${path}.email`),
    display_name: displayName,
    avatar_url: nullableString(source.avatar_url, `${path}.avatar_url`),
    is_admin: boolean(source.is_admin, `${path}.is_admin`),
    is_approved: boolean(source.is_approved, `${path}.is_approved`),
    created_at: nullableIsoTimestamp(source.created_at, `${path}.created_at`),
    last_active_at: nullableIsoTimestamp(source.last_active_at, `${path}.last_active_at`),
    plays: nonNegativeInteger(source.plays, `${path}.plays`),
    listening_sec: nonNegativeInteger(source.listening_sec, `${path}.listening_sec`),
    unique_tracks: nonNegativeInteger(source.unique_tracks, `${path}.unique_tracks`),
    tracks_requested: tracksRequested,
    tracks_materialized: tracksMaterialized,
    materialized_bytes: nonNegativeInteger(source.materialized_bytes, `${path}.materialized_bytes`),
    storage: decodeAdminUserStorage(source.storage, `${path}.storage`),
    library: decodeAdminUserLibrary(source.library, `${path}.library`),
    online_devices: nonNegativeInteger(source.online_devices, `${path}.online_devices`),
    is_playing_now: boolean(source.is_playing_now, `${path}.is_playing_now`),
    active_device_name: nullableString(source.active_device_name, `${path}.active_device_name`),
    active_party_code: nullableString(source.active_party_code, `${path}.active_party_code`),
  };
}

function decodeAdminRequestSourceStat(value: unknown, path: string): AdminRequestSourceStat {
  const source = object(value, path);
  const requests = nonNegativeInteger(source.requests, `${path}.requests`);
  const materialized = nonNegativeInteger(source.materialized, `${path}.materialized`);
  if (materialized > requests) {
    throw new Error(`${path}.materialized must not exceed requests`);
  }
  return {
    source: literal(source.source, `${path}.source`, ADMIN_TRACK_REQUEST_SOURCES),
    requests,
    materialized,
    materialized_bytes: nonNegativeInteger(source.materialized_bytes, `${path}.materialized_bytes`),
  };
}

function decodeAdminConnectDevice(value: unknown, path: string): AdminConnectDevice {
  const source = object(value, path);
  return {
    device_id: nonEmptyString(source.device_id, `${path}.device_id`),
    name: nonEmptyString(source.name, `${path}.name`),
    device_type: literal(source.device_type, `${path}.device_type`, CONNECT_DEVICE_TYPES),
    is_active: boolean(source.is_active, `${path}.is_active`),
    party_code: nullableString(source.party_code, `${path}.party_code`),
    connected_at: isoTimestamp(source.connected_at, `${path}.connected_at`),
    last_seen_at: isoTimestamp(source.last_seen_at, `${path}.last_seen_at`),
  };
}

function decodeAdminStatEntry(
  value: unknown,
  path: string,
  allowEmptyKey: boolean,
): AdminStatEntry {
  const source = object(value, path);
  return {
    key: canonicalStatId(source.key, `${path}.key`, allowEmptyKey),
    label: string(source.label, `${path}.label`).trim(),
    sublabel: string(source.sublabel, `${path}.sublabel`).trim(),
    cover: string(source.cover, `${path}.cover`).trim(),
    count: positiveInteger(source.count, `${path}.count`),
  };
}

function decodeAdminRecentPlay(value: unknown, path: string): AdminRecentPlay {
  const source = object(value, path);
  return {
    id: canonicalStatId(source.id, `${path}.id`),
    title: string(source.title, `${path}.title`).trim(),
    artist: string(source.artist, `${path}.artist`).trim(),
    album: string(source.album, `${path}.album`).trim(),
    cover: string(source.cover, `${path}.cover`).trim(),
    duration_sec: nonNegativeInteger(source.duration_sec, `${path}.duration_sec`),
    played_at: isoTimestamp(source.played_at, `${path}.played_at`),
  };
}

function decodeAdminRecentTrackRequest(value: unknown, path: string): AdminRecentTrackRequest {
  const source = object(value, path);
  return {
    deezer_id: canonicalStatId(source.deezer_id, `${path}.deezer_id`),
    title: string(source.title, `${path}.title`).trim(),
    artist: string(source.artist, `${path}.artist`).trim(),
    cover: string(source.cover, `${path}.cover`).trim(),
    source: literal(source.source, `${path}.source`, ADMIN_TRACK_REQUEST_SOURCES),
    materialized: boolean(source.materialized, `${path}.materialized`),
    size_bytes: nonNegativeInteger(source.size_bytes, `${path}.size_bytes`),
    requested_at: isoTimestamp(source.requested_at, `${path}.requested_at`),
    is_currently_stored: boolean(source.is_currently_stored, `${path}.is_currently_stored`),
  };
}

export function decodeAdminUsageOverview(value: unknown): AdminUsageOverviewResponse {
  const source = object(value, 'AdminUsageOverviewResponse');
  const range = literal(source.range, 'AdminUsageOverviewResponse.range', ADMIN_USAGE_RANGES);
  const generatedAt = isoTimestamp(source.generated_at, 'AdminUsageOverviewResponse.generated_at');
  const trackingSince = nullableIsoTimestamp(
    source.request_tracking_since,
    'AdminUsageOverviewResponse.request_tracking_since',
  );
  const overview = decodeAdminUsageOverviewData(
    source.overview,
    'AdminUsageOverviewResponse.overview',
  );
  const users = array(source.users, 'AdminUsageOverviewResponse.users', decodeAdminUserUsageSummary);

  if (users.length !== overview.total_users) {
    throw new Error(
      `AdminUsageOverviewResponse.users length (${users.length}) must equal overview.total_users (${overview.total_users})`,
    );
  }
  const exclusiveBytesSum = users.reduce((sum, entry) => sum + entry.storage.exclusive_bytes, 0);
  if (exclusiveBytesSum !== overview.storage.exclusive_audio_bytes) {
    throw new Error(
      `AdminUsageOverviewResponse.users exclusive_bytes sum (${exclusiveBytesSum}) must equal overview.storage.exclusive_audio_bytes (${overview.storage.exclusive_audio_bytes})`,
    );
  }
  const exclusiveTracksSum = users.reduce((sum, entry) => sum + entry.storage.exclusive_tracks, 0);
  if (exclusiveTracksSum !== overview.storage.exclusive_audio_tracks) {
    throw new Error(
      `AdminUsageOverviewResponse.users exclusive_tracks sum (${exclusiveTracksSum}) must equal overview.storage.exclusive_audio_tracks (${overview.storage.exclusive_audio_tracks})`,
    );
  }

  return {
    range,
    generated_at: generatedAt,
    request_tracking_since: trackingSince,
    overview,
    users,
  };
}

export function decodeAdminUserUsageDetail(value: unknown): AdminUserUsageDetailResponse {
  const source = object(value, 'AdminUserUsageDetailResponse');
  const range = literal(source.range, 'AdminUserUsageDetailResponse.range', ADMIN_USAGE_RANGES);
  const generatedAt = isoTimestamp(
    source.generated_at,
    'AdminUserUsageDetailResponse.generated_at',
  );
  const trackingSince = nullableIsoTimestamp(
    source.request_tracking_since,
    'AdminUserUsageDetailResponse.request_tracking_since',
  );
  const user = decodeAdminUserUsageSummary(source.user, 'AdminUserUsageDetailResponse.user');
  const storageBreakdown = decodeAdminUserStorageBreakdown(
    source.storage_breakdown,
    'AdminUserUsageDetailResponse.storage_breakdown',
  );

  if (storageBreakdown.exclusive_bytes !== user.storage.exclusive_bytes) {
    throw new Error(
      'AdminUserUsageDetailResponse.storage_breakdown.exclusive_bytes must equal user.storage.exclusive_bytes',
    );
  }
  if (storageBreakdown.accessed_bytes !== user.storage.accessed_bytes) {
    throw new Error(
      'AdminUserUsageDetailResponse.storage_breakdown.accessed_bytes must equal user.storage.accessed_bytes',
    );
  }

  return {
    range,
    generated_at: generatedAt,
    request_tracking_since: trackingSince,
    user,
    storage_breakdown: storageBreakdown,
    requests_by_source: array(
      source.requests_by_source,
      'AdminUserUsageDetailResponse.requests_by_source',
      decodeAdminRequestSourceStat,
    ),
    active_devices: array(
      source.active_devices,
      'AdminUserUsageDetailResponse.active_devices',
      decodeAdminConnectDevice,
    ),
    top_tracks: array(
      source.top_tracks,
      'AdminUserUsageDetailResponse.top_tracks',
      (entry, path) => decodeAdminStatEntry(entry, path, false),
    ),
    top_artists: array(
      source.top_artists,
      'AdminUserUsageDetailResponse.top_artists',
      (entry, path) => decodeAdminStatEntry(entry, path, true),
    ),
    recent_plays: array(
      source.recent_plays,
      'AdminUserUsageDetailResponse.recent_plays',
      decodeAdminRecentPlay,
    ),
    recent_requests: array(
      source.recent_requests,
      'AdminUserUsageDetailResponse.recent_requests',
      decodeAdminRecentTrackRequest,
    ),
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
