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
  AudioQualityTier,
  BatchPreloadResponse,
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
  FriendActivityItem,
  Genre,
  GenreDetail,
  HomeShelf,
  ImportJobDetail,
  ImportJobState,
  ImportJobStatus,
  InsightsStatEntry,
  LyricsLine,
  LyricsResponse,
  LyricsWord,
  PartyLoadState,
  PartyMember,
  PartyReaction,
  PartyState,
  PartyTrack,
  PartyVoteSkipResult,
  PlaybackSettings,
  Playlist,
  PlaylistBlendResult,
  PlaylistCollaborator,
  PlaylistCollaboratorUser,
  PlaylistDeduplicateResult,
  PlaylistDuplicateGroup,
  PlaylistDuplicatesResponse,
  PlaylistIncomingInvitation,
  PlaylistInvitationPlaylist,
  PlaylistInviteCandidate,
  PlaylistInviteCandidateStatus,
  PlaylistJoinResult,
  PlaylistOutgoingInvitation,
  PlaylistLiveEvent,
  PlaylistLiveEventType,
  PlaylistRole,
  PlaylistSearchResult,
  PlaylistSummary,
  PlaylistSyncManifest,
  PlaylistSyncTrackItem,
  PublicProfile,
  RadarReason,
  ReleaseRadarEntry,
  ResolveKind,
  ResolveResult,
  SocialActivityResponse,
  StatsInsightsRange,
  StorageCleanupResult,
  TimestampedPlay,
  Track,
  TrackAudioMeta,
  TrackPlayCount,
  TrackPlayCounts,
  User,
  UserStatsInsights,
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
  if ('isrc' in source) {
    track.isrc = string(source.isrc, `${path}.isrc`);
  }
  for (const key of ['loudness_gain_db', 'loudness_lufs', 'loudness_peak', 'bpm'] as const) {
    const decoded = optionalNullableNumber(source, key, path);
    if (decoded !== undefined) track[key] = decoded;
  }
  if ('explicit' in source && source.explicit !== undefined) {
    track.explicit = nullable(source.explicit, `${path}.explicit`, boolean);
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

const PLAYLIST_INVITE_CANDIDATE_STATUSES = [
  'available',
  'invited',
  'collaborator',
] as const satisfies readonly PlaylistInviteCandidateStatus[];

function nonEmptyTimestamp(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (parsed.trim().length === 0) throw new Error(`${path} must not be empty`);
  return parsed;
}

function decodePlaylistInviteCandidate(
  value: unknown,
  path: string,
): PlaylistInviteCandidate {
  const source = object(value, path);
  return {
    user: decodePlaylistCollaboratorUser(source.user, `${path}.user`),
    status: literal(source.status, `${path}.status`, PLAYLIST_INVITE_CANDIDATE_STATUSES),
  };
}

export function decodePlaylistInviteCandidates(value: unknown): PlaylistInviteCandidate[] {
  return array(value, 'PlaylistInviteCandidate[]', decodePlaylistInviteCandidate);
}

export function decodePlaylistOutgoingInvitation(
  value: unknown,
  path = 'PlaylistOutgoingInvitation',
): PlaylistOutgoingInvitation {
  const source = object(value, path);
  return {
    invitee: decodePlaylistCollaboratorUser(source.invitee, `${path}.invitee`),
    invited_by: nullable(source.invited_by, `${path}.invited_by`, decodePlaylistCollaboratorUser),
    created_at: nonEmptyTimestamp(source.created_at, `${path}.created_at`),
  };
}

export function decodePlaylistOutgoingInvitations(value: unknown): PlaylistOutgoingInvitation[] {
  return array(value, 'PlaylistOutgoingInvitation[]', decodePlaylistOutgoingInvitation);
}

function decodePlaylistInvitationPlaylist(
  value: unknown,
  path: string,
): PlaylistInvitationPlaylist {
  const source = object(value, path);
  return {
    playlist_id: positiveInteger(source.playlist_id, `${path}.playlist_id`),
    name: string(source.name, `${path}.name`),
    description: nullableString(source.description, `${path}.description`),
    cover_url: nullableString(source.cover_url, `${path}.cover_url`),
    track_count: nonNegativeInteger(source.track_count, `${path}.track_count`),
    collaborator_count: nonNegativeInteger(
      source.collaborator_count,
      `${path}.collaborator_count`,
    ),
    owner: decodePlaylistCollaboratorUser(source.owner, `${path}.owner`),
  };
}

function decodePlaylistIncomingInvitation(
  value: unknown,
  path: string,
): PlaylistIncomingInvitation {
  const source = object(value, path);
  return {
    id: positiveInteger(source.id, `${path}.id`),
    playlist: decodePlaylistInvitationPlaylist(source.playlist, `${path}.playlist`),
    invited_by: nullable(source.invited_by, `${path}.invited_by`, decodePlaylistCollaboratorUser),
    created_at: nonEmptyTimestamp(source.created_at, `${path}.created_at`),
  };
}

export function decodePlaylistIncomingInvitations(value: unknown): PlaylistIncomingInvitation[] {
  return array(value, 'PlaylistIncomingInvitation[]', decodePlaylistIncomingInvitation);
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

const AUDIO_QUALITY_TIERS = [
  'lossless',
  'high',
  'saver',
] as const satisfies readonly AudioQualityTier[];

export function decodePlaybackSettings(value: unknown): PlaybackSettings {
  const source = object(value, 'PlaybackSettings');
  const settings: PlaybackSettings = {
    crossfade_enabled: boolean(source.crossfade_enabled, 'PlaybackSettings.crossfade_enabled'),
    crossfade_duration_sec: nonNegativeInteger(
      source.crossfade_duration_sec,
      'PlaybackSettings.crossfade_duration_sec',
    ),
  };
  if ('preferred_quality' in source && source.preferred_quality !== undefined) {
    settings.preferred_quality = literal(
      source.preferred_quality,
      'PlaybackSettings.preferred_quality',
      AUDIO_QUALITY_TIERS,
    );
  }
  if ('share_listening_activity' in source && source.share_listening_activity !== undefined) {
    settings.share_listening_activity = boolean(
      source.share_listening_activity,
      'PlaybackSettings.share_listening_activity',
    );
  }
  if ('dj_transitions_enabled' in source && source.dj_transitions_enabled !== undefined) {
    settings.dj_transitions_enabled = boolean(
      source.dj_transitions_enabled,
      'PlaybackSettings.dj_transitions_enabled',
    );
  }
  return settings;
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
  const job: ImportJobStatus = {
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
  if ('target_playlist_id' in source && source.target_playlist_id !== undefined) {
    job.target_playlist_id = nullable(
      source.target_playlist_id,
      `${path}.target_playlist_id`,
      positiveInteger,
    );
  }
  if ('create_playlist_name' in source && source.create_playlist_name !== undefined) {
    job.create_playlist_name = nullableString(
      source.create_playlist_name,
      `${path}.create_playlist_name`,
    );
  }
  if ('created_playlist_id' in source && source.created_playlist_id !== undefined) {
    job.created_playlist_id = nullable(
      source.created_playlist_id,
      `${path}.created_playlist_id`,
      positiveInteger,
    );
  }
  return job;
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

function decodeLyricsWord(value: unknown, path: string): LyricsWord {
  const source = object(value, path);
  return {
    t: nonNegativeNumber(source.t, `${path}.t`),
    end: nonNegativeNumber(source.end, `${path}.end`),
    text: string(source.text, `${path}.text`),
  };
}

function decodeLyricsLine(value: unknown, path: string): LyricsLine {
  const source = object(value, path);
  const line: LyricsLine = {
    t: nonNegativeNumber(source.t, `${path}.t`),
    text: string(source.text, `${path}.text`),
  };
  if ('words' in source && source.words !== undefined && source.words !== null) {
    line.words = array(source.words, `${path}.words`, decodeLyricsWord);
  }
  return line;
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
  if ('instrumental' in source && source.instrumental !== undefined) {
    result.instrumental = boolean(source.instrumental, 'LyricsResponse.instrumental');
  }
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
  const track: PartyTrack = {
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
  const gainDb = optionalNullableNumber(source, 'loudness_gain_db', path);
  if (gainDb !== undefined) track.loudness_gain_db = gainDb;
  return track;
}

export function decodePartyReaction(value: unknown, path = 'PartyReaction'): PartyReaction {
  const source = object(value, path);
  return {
    id: string(source.id, `${path}.id`),
    emoji: string(source.emoji, `${path}.emoji`),
    member_key: string(source.member_key, `${path}.member_key`),
    member_name: string(source.member_name, `${path}.member_name`),
    created_at: string(source.created_at, `${path}.created_at`),
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
  const state: PartyState = {
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
  if ('auto_dj' in source && source.auto_dj !== undefined) {
    state.auto_dj = boolean(source.auto_dj, 'PartyState.auto_dj');
  }
  if ('skip_votes' in source && source.skip_votes !== undefined) {
    state.skip_votes = array(source.skip_votes, 'PartyState.skip_votes', string);
  }
  if ('skip_votes_needed' in source && source.skip_votes_needed !== undefined) {
    state.skip_votes_needed = nonNegativeInteger(
      source.skip_votes_needed,
      'PartyState.skip_votes_needed',
    );
  }
  if ('latest_reaction' in source && source.latest_reaction !== undefined) {
    state.latest_reaction = nullable(
      source.latest_reaction,
      'PartyState.latest_reaction',
      decodePartyReaction,
    );
  }
  return state;
}

export function decodePartyVoteSkipResult(value: unknown): PartyVoteSkipResult {
  const source = object(value, 'PartyVoteSkipResult');
  return {
    code: string(source.code, 'PartyVoteSkipResult.code'),
    track_item_id: nonNegativeInteger(source.track_item_id, 'PartyVoteSkipResult.track_item_id'),
    votes: array(source.votes, 'PartyVoteSkipResult.votes', string),
    votes_needed: nonNegativeInteger(source.votes_needed, 'PartyVoteSkipResult.votes_needed'),
    skipped: boolean(source.skipped, 'PartyVoteSkipResult.skipped'),
    state: decodePartyState(source.state),
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

export function decodeTrackAudioMeta(value: unknown): TrackAudioMeta {
  const source = object(value, 'TrackAudioMeta');
  return {
    deezer_id: deezerStringId(source.deezer_id, 'TrackAudioMeta.deezer_id'),
    peaks: array(source.peaks, 'TrackAudioMeta.peaks', nonNegativeNumber),
    loudness_lufs: optionalNullableNumber(source, 'loudness_lufs', 'TrackAudioMeta') ?? null,
    loudness_gain_db: optionalNullableNumber(source, 'loudness_gain_db', 'TrackAudioMeta') ?? null,
    loudness_peak: optionalNullableNumber(source, 'loudness_peak', 'TrackAudioMeta') ?? null,
    bpm: optionalNullableNumber(source, 'bpm', 'TrackAudioMeta') ?? null,
    duration_sec: optionalNullableNumber(source, 'duration_sec', 'TrackAudioMeta') ?? null,
    intro_end_sec: optionalNullableNumber(source, 'intro_end_sec', 'TrackAudioMeta') ?? null,
    outro_start_sec: optionalNullableNumber(source, 'outro_start_sec', 'TrackAudioMeta') ?? null,
    analyzed_at: string(source.analyzed_at, 'TrackAudioMeta.analyzed_at'),
  };
}

export function decodeBatchPreloadResponse(value: unknown): BatchPreloadResponse {
  const source = object(value, 'BatchPreloadResponse');
  return {
    queued: array(source.queued, 'BatchPreloadResponse.queued', deezerStringId),
    already_cached: array(
      source.already_cached,
      'BatchPreloadResponse.already_cached',
      deezerStringId,
    ),
  };
}

function decodePlaylistSyncTrackItem(value: unknown, path: string): PlaylistSyncTrackItem {
  const source = object(value, path);
  return {
    playlist_entry_id: positiveInteger(source.playlist_entry_id, `${path}.playlist_entry_id`),
    deezer_id: deezerStringId(source.deezer_id, `${path}.deezer_id`),
    title: string(source.title, `${path}.title`),
    artist: string(source.artist, `${path}.artist`),
    duration_sec: nonNegativeNumber(source.duration_sec, `${path}.duration_sec`),
    is_stored: boolean(source.is_stored, `${path}.is_stored`),
    size_bytes: optionalNullableNumber(source, 'size_bytes', path) ?? null,
    audio_format:
      'audio_format' in source && source.audio_format !== undefined
        ? nullableString(source.audio_format, `${path}.audio_format`)
        : null,
    loudness_gain_db: optionalNullableNumber(source, 'loudness_gain_db', path) ?? null,
    loudness_lufs: optionalNullableNumber(source, 'loudness_lufs', path) ?? null,
    loudness_peak: optionalNullableNumber(source, 'loudness_peak', path) ?? null,
    has_lyrics: boolean(source.has_lyrics, `${path}.has_lyrics`),
  };
}

function decodeManifestLyricsEntry(value: unknown, path: string): LyricsResponse {
  const source = object(value, path);
  const lines =
    source.lines === null || source.lines === undefined
      ? null
      : array(source.lines, `${path}.lines`, decodeLyricsLine);
  const entry: LyricsResponse = {
    lines,
    synced: boolean(source.synced, `${path}.synced`),
    source:
      'source' in source && source.source !== undefined
        ? nullableString(source.source, `${path}.source`)
        : null,
    ai_generated: boolean(source.ai_generated, `${path}.ai_generated`),
  };
  if ('instrumental' in source && source.instrumental !== undefined) {
    entry.instrumental = boolean(source.instrumental, `${path}.instrumental`);
  }
  return entry;
}

export function decodePlaylistSyncManifest(value: unknown): PlaylistSyncManifest {
  const source = object(value, 'PlaylistSyncManifest');
  const manifest: PlaylistSyncManifest = {
    playlist_id: positiveInteger(source.playlist_id, 'PlaylistSyncManifest.playlist_id'),
    revision: nonNegativeInteger(source.revision, 'PlaylistSyncManifest.revision'),
    track_count: nonNegativeInteger(source.track_count, 'PlaylistSyncManifest.track_count'),
    stored_count: nonNegativeInteger(source.stored_count, 'PlaylistSyncManifest.stored_count'),
    total_known_bytes: nonNegativeInteger(
      source.total_known_bytes,
      'PlaylistSyncManifest.total_known_bytes',
    ),
    tracks: array(source.tracks, 'PlaylistSyncManifest.tracks', decodePlaylistSyncTrackItem),
  };
  if ('lyrics' in source && source.lyrics !== undefined) {
    manifest.lyrics = nullable(source.lyrics, 'PlaylistSyncManifest.lyrics', (rawMap, mapPath) => {
      const entries = object(rawMap, mapPath);
      const decoded: Record<string, LyricsResponse> = {};
      for (const [id, item] of Object.entries(entries)) {
        const trackId = deezerStringId(id, `${mapPath} key ${id}`);
        decoded[trackId] = decodeManifestLyricsEntry(item, `${mapPath}.${trackId}`);
      }
      return decoded;
    });
  }
  return manifest;
}

function decodePlaylistDuplicateGroup(value: unknown, path: string): PlaylistDuplicateGroup {
  const source = object(value, path);
  return {
    keep_entry_id: positiveInteger(source.keep_entry_id, `${path}.keep_entry_id`),
    duplicate_entry_ids: array(
      source.duplicate_entry_ids,
      `${path}.duplicate_entry_ids`,
      positiveInteger,
    ),
    title: string(source.title, `${path}.title`),
    artist: string(source.artist, `${path}.artist`),
    isrc: 'isrc' in source && source.isrc !== undefined ? string(source.isrc, `${path}.isrc`) : '',
  };
}

export function decodePlaylistDuplicates(value: unknown): PlaylistDuplicatesResponse {
  const source = object(value, 'PlaylistDuplicatesResponse');
  return {
    playlist_id: positiveInteger(source.playlist_id, 'PlaylistDuplicatesResponse.playlist_id'),
    total_duplicates: nonNegativeInteger(
      source.total_duplicates,
      'PlaylistDuplicatesResponse.total_duplicates',
    ),
    groups: array(
      source.groups,
      'PlaylistDuplicatesResponse.groups',
      decodePlaylistDuplicateGroup,
    ),
  };
}

export function decodePlaylistDeduplicateResult(value: unknown): PlaylistDeduplicateResult {
  const source = object(value, 'PlaylistDeduplicateResult');
  return {
    playlist_id: positiveInteger(source.playlist_id, 'PlaylistDeduplicateResult.playlist_id'),
    groups_merged: nonNegativeInteger(
      source.groups_merged,
      'PlaylistDeduplicateResult.groups_merged',
    ),
    removed_count: nonNegativeInteger(
      source.removed_count,
      'PlaylistDeduplicateResult.removed_count',
    ),
    removed_entry_ids: array(
      source.removed_entry_ids,
      'PlaylistDeduplicateResult.removed_entry_ids',
      positiveInteger,
    ),
    revision: nonNegativeInteger(source.revision, 'PlaylistDeduplicateResult.revision'),
  };
}

export function decodePlaylistBlendResult(value: unknown): PlaylistBlendResult {
  const source = object(value, 'PlaylistBlendResult');
  return {
    playlist: decodePlaylist(source.playlist),
    match_percent: nonNegativeNumber(source.match_percent, 'PlaylistBlendResult.match_percent'),
    shared_artists: array(source.shared_artists, 'PlaylistBlendResult.shared_artists', string),
    shared_tracks_count: nonNegativeInteger(
      source.shared_tracks_count,
      'PlaylistBlendResult.shared_tracks_count',
    ),
    other_user: decodePlaylistCollaboratorUser(
      source.other_user,
      'PlaylistBlendResult.other_user',
    ),
  };
}

const PLAYLIST_LIVE_EVENTS = [
  'snapshot',
  'updated',
  'revoked',
  'deleted',
] as const satisfies readonly PlaylistLiveEventType[];

export function decodePlaylistLiveEvent(value: unknown): PlaylistLiveEvent {
  const source = object(value, 'PlaylistLiveEvent');
  return {
    playlist_id: positiveInteger(source.playlist_id, 'PlaylistLiveEvent.playlist_id'),
    revision: nonNegativeInteger(source.revision, 'PlaylistLiveEvent.revision'),
    event: literal(source.event, 'PlaylistLiveEvent.event', PLAYLIST_LIVE_EVENTS),
  };
}

const STATS_INSIGHTS_RANGES = [
  '7d',
  '30d',
  '90d',
  'year',
  'all',
] as const satisfies readonly StatsInsightsRange[];

function decodeInsightsStatEntry(value: unknown, path: string): InsightsStatEntry {
  const source = object(value, path);
  const rawKey = source.key;
  if (typeof rawKey !== 'string' && (typeof rawKey !== 'number' || !Number.isSafeInteger(rawKey))) {
    throw new Error(`${path}.key must be a string or safe integer`);
  }
  return {
    key: rawKey,
    label: string(source.label, `${path}.label`),
    sublabel:
      'sublabel' in source && source.sublabel !== undefined
        ? string(source.sublabel, `${path}.sublabel`)
        : '',
    cover:
      'cover' in source && source.cover !== undefined
        ? string(source.cover, `${path}.cover`)
        : '',
    count: nonNegativeInteger(source.count, `${path}.count`),
  };
}

function decodeTimestampedPlay(value: unknown, path: string): TimestampedPlay {
  const source = object(value, path);
  const rawId = source.id;
  const id = typeof rawId === 'number' ? deezerStringId(String(rawId), `${path}.id`) : deezerStringId(rawId, `${path}.id`);
  return {
    id,
    title: string(source.title, `${path}.title`),
    artist: 'artist' in source && source.artist !== undefined ? string(source.artist, `${path}.artist`) : '',
    artist_id:
      'artist_id' in source && source.artist_id !== undefined
        ? deezerReferenceId(source.artist_id, `${path}.artist_id`)
        : '',
    artists:
      'artists' in source && source.artists !== undefined
        ? array(source.artists, `${path}.artists`, decodeArtist)
        : [],
    album: 'album' in source && source.album !== undefined ? string(source.album, `${path}.album`) : '',
    album_id:
      'album_id' in source && source.album_id !== undefined
        ? deezerReferenceId(source.album_id, `${path}.album_id`)
        : '',
    cover: 'cover' in source && source.cover !== undefined ? string(source.cover, `${path}.cover`) : '',
    duration_sec:
      'duration_sec' in source && source.duration_sec !== undefined
        ? nonNegativeNumber(source.duration_sec, `${path}.duration_sec`)
        : 0,
    played_at: string(source.played_at, `${path}.played_at`),
  };
}

export function decodeUserStatsInsights(value: unknown): UserStatsInsights {
  const source = object(value, 'UserStatsInsights');
  const hourly = array(
    source.hourly_distribution,
    'UserStatsInsights.hourly_distribution',
    nonNegativeInteger,
  );
  if (hourly.length !== 24) {
    throw new Error(`UserStatsInsights.hourly_distribution must have 24 buckets, got ${hourly.length}`);
  }
  const weekday = array(
    source.weekday_distribution,
    'UserStatsInsights.weekday_distribution',
    nonNegativeInteger,
  );
  if (weekday.length !== 7) {
    throw new Error(`UserStatsInsights.weekday_distribution must have 7 buckets, got ${weekday.length}`);
  }
  return {
    range: literal(source.range, 'UserStatsInsights.range', STATS_INSIGHTS_RANGES),
    listening_sec: nonNegativeNumber(source.listening_sec, 'UserStatsInsights.listening_sec'),
    play_count: nonNegativeInteger(source.play_count, 'UserStatsInsights.play_count'),
    unique_tracks: nonNegativeInteger(source.unique_tracks, 'UserStatsInsights.unique_tracks'),
    unique_artists: nonNegativeInteger(source.unique_artists, 'UserStatsInsights.unique_artists'),
    top_tracks: array(source.top_tracks, 'UserStatsInsights.top_tracks', decodeInsightsStatEntry),
    top_artists: array(source.top_artists, 'UserStatsInsights.top_artists', decodeInsightsStatEntry),
    top_albums: array(source.top_albums, 'UserStatsInsights.top_albums', decodeInsightsStatEntry),
    current_streak_days: nonNegativeInteger(
      source.current_streak_days,
      'UserStatsInsights.current_streak_days',
    ),
    longest_streak_days: nonNegativeInteger(
      source.longest_streak_days,
      'UserStatsInsights.longest_streak_days',
    ),
    hourly_distribution: hourly,
    weekday_distribution: weekday,
    new_artists_count: nonNegativeInteger(
      source.new_artists_count,
      'UserStatsInsights.new_artists_count',
    ),
    recent_plays: array(source.recent_plays, 'UserStatsInsights.recent_plays', decodeTimestampedPlay),
  };
}

function decodeFriendActivityItem(value: unknown, path: string): FriendActivityItem {
  const source = object(value, path);
  return {
    user_id: positiveInteger(source.user_id, `${path}.user_id`),
    display_name:
      'display_name' in source && source.display_name !== undefined
        ? nullableString(source.display_name, `${path}.display_name`)
        : null,
    avatar_url:
      'avatar_url' in source && source.avatar_url !== undefined
        ? nullableString(source.avatar_url, `${path}.avatar_url`)
        : null,
    is_playing: boolean(source.is_playing, `${path}.is_playing`),
    track:
      'track' in source && source.track !== undefined
        ? nullable(source.track, `${path}.track`, decodeTrack)
        : null,
    device_name:
      'device_name' in source && source.device_name !== undefined
        ? nullableString(source.device_name, `${path}.device_name`)
        : null,
    device_type:
      'device_type' in source && source.device_type !== undefined
        ? nullable(source.device_type, `${path}.device_type`, (item, itemPath) =>
            literal(item, itemPath, CONNECT_DEVICE_TYPES),
          )
        : null,
    party_code:
      'party_code' in source && source.party_code !== undefined
        ? nullableString(source.party_code, `${path}.party_code`)
        : null,
    updated_at:
      'updated_at' in source && source.updated_at !== undefined
        ? nullableString(source.updated_at, `${path}.updated_at`)
        : null,
  };
}

export function decodeSocialActivityResponse(value: unknown): SocialActivityResponse {
  const source = object(value, 'SocialActivityResponse');
  return {
    items: array(source.items, 'SocialActivityResponse.items', decodeFriendActivityItem),
    server_time: string(source.server_time, 'SocialActivityResponse.server_time'),
  };
}
