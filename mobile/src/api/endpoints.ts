import { apiRequest, type AuthenticatedRequestAuthority } from './client';
import { requestGeneratedOperation } from './generatedOperationClient';
import type { GeneratedApiResponse } from './generated/contract';
import {
  decodeAddedTracksResult,
  decodeAdminInviteResult,
  decodeAdminInvites,
  decodeAdminStatus,
  decodeAdminStorageInfo,
  decodeAdminUsageOverview,
  decodeAdminUsers,
  decodeAdminUserUsageDetail,
  decodeAlbum,
  decodeAlbumSummaries,
  decodeArtistAbout,
  decodeArtistDetail,
  decodeArtistSummaries,
  decodeBooleanMap,
  decodeCachedTrackIds,
  decodeConnectState,
  decodeConnectTicket,
  decodeDeezerPlaylistDetail,
  decodeGenreDetail,
  decodeGenres,
  decodeHomeShelves,
  decodeLyricsResponse,
  decodeNullablePartyState,
  decodeOk,
  decodePlaybackSettings,
  decodePartyState,
  decodePlaylist,
  decodePlaylistCollaborator,
  decodePlaylistInvite,
  decodePlaylistInvitePreview,
  decodePlaylistInviteStatus,
  decodePlaylistJoinResult,
  decodePlaylistSummary,
  decodePlaylistSearchResults,
  decodePlaylistSummaries,
  decodePublicProfile,
  decodeReleaseRadar,
  decodeImportJobDetail,
  decodeImportJobStatus,
  decodeImportJobStatuses,
  decodeStorageCleanupResult,
  decodeTrack,
  decodeTrackList,
  decodeTrackPlayCounts,
  decodeUser,
} from './decoders';
import { decodeListeningStatsWire } from '../data/mappers/listeningStats';
import type {
  AddedTracksResult,
  AdminInvite,
  AdminStatus,
  AdminStorageInfo,
  AdminUsageOverviewResponse,
  AdminUsageRange,
  AdminUser,
  AdminUserUsageDetailResponse,
  AlbumDetail,
  AlbumSummary,
  ArtistAbout,
  ArtistDetail,
  ArtistSummary,
  CachedTrackIds,
  ConnectState,
  ConnectTicket,
  DeezerPlaylistDetail,
  DeezerId,
  Genre,
  GenreDetail,
  HomeShelf,
  LyricsResponse,
  PartyState,
  PlaybackSettings,
  Playlist,
  PlaylistCollaborator,
  PlaylistCreateRequest,
  PlaylistInvite,
  PlaylistInvitePreview,
  PlaylistInviteStatus,
  PlaylistJoinResult,
  PlaylistListScope,
  PlaylistSearchResult,
  PlaylistSummary,
  PlaylistUpdateRequest,
  PublicProfile,
  ReleaseRadarEntry,
  ImportJobDetail,
  ImportJobStatus,
  StorageCleanupResult,
  Track,
  TrackInput,
  TrackPlayCounts,
  TrackPlayQuery,
  User,
} from './types';

// Cold personalized discovery can exceed the usual 20s request deadline while resolving provider
// recommendations. Keep its budget explicit so normal requests retain their shorter deadline.
export const DISCOVERY_TIMEOUT_MS = 90_000;

function pathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

export interface RegisterRequest {
  email: string;
  password: string;
  display_name: string | null;
  invite: string | null;
}

export interface MeUpdateRequest {
  display_name?: string | null;
  email?: string | null;
  password?: string | null;
}

export interface PlaybackSettingsUpdate {
  crossfade_enabled?: boolean | null;
  crossfade_duration_sec?: number | null;
}

export interface PartyCreateRequest {
  name?: string | null;
  /** The host's queue the party continues from (empty for a blank party). */
  tracks?: TrackInput[];
  /** Index into `tracks` that is playing, or -1 for none. */
  current_index?: number;
  is_playing?: boolean;
  position_sec?: number;
  guests_can_control?: boolean;
}

export interface PartySettingsUpdateRequest {
  name?: string | null;
  guests_can_control?: boolean | null;
}

export type PartyTrackInsertMode = 'end' | 'next';

export interface PartyPlaybackUpdate {
  is_playing: boolean;
  position_sec: number;
}

// --- Auth ---
export function login(email: string, password: string, apiBase?: string): Promise<User> {
  return apiRequest<User>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    captureSession: true,
    noAuth: true,
    ...(apiBase === undefined ? {} : { apiBase }),
    decode: decodeUser,
  });
}

export function register(request: RegisterRequest, apiBase?: string): Promise<User> {
  return apiRequest<User>('/api/auth/register', {
    method: 'POST',
    body: request,
    captureSession: true,
    noAuth: true,
    ...(apiBase === undefined ? {} : { apiBase }),
    decode: decodeUser,
  });
}

export function me(): Promise<User> {
  return apiRequest<User>('/api/auth/me', { decode: decodeUser });
}

export function logout(apiBase?: string): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/auth/logout', {
    method: 'POST',
    decode: decodeOk,
    noAuth: true,
    ...(apiBase === undefined ? {} : { apiBase }),
    timeoutMs: 2_000,
  });
}

// --- Browse / search ---
export function searchTracks(q: string, signal?: AbortSignal): Promise<Track[]> {
  return apiRequest<Track[]>(`/api/search?q=${encodeURIComponent(q)}&type=track`, {
    signal,
    decode: decodeTrackList,
  });
}

/** Album search currently uses the backend's generated Track-shaped album wire contract. */
export function searchAlbums(
  q: string,
  signal?: AbortSignal,
): Promise<GeneratedApiResponse<'search_api_search_get'>> {
  return requestGeneratedOperation('search_api_search_get', {
    request: { query: { q, type: 'album' } },
    signal,
    decode: decodeTrackList,
  });
}

export function searchArtists(q: string, signal?: AbortSignal): Promise<ArtistSummary[]> {
  return apiRequest<ArtistSummary[]>(`/api/search/artist?q=${encodeURIComponent(q)}`, {
    signal,
    decode: decodeArtistSummaries,
  });
}

export function searchPlaylists(q: string, signal?: AbortSignal): Promise<PlaylistSearchResult[]> {
  return apiRequest<PlaylistSearchResult[]>(`/api/search/playlist?q=${encodeURIComponent(q)}`, {
    signal,
    decode: decodePlaylistSearchResults,
  });
}

export function getCharts(signal?: AbortSignal): Promise<Track[]> {
  return apiRequest<Track[]>('/api/charts', { signal, decode: decodeTrackList });
}

export function getHomeMixes(signal?: AbortSignal): Promise<HomeShelf[]> {
  return apiRequest<HomeShelf[]>('/api/home/mixes', {
    signal,
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    decode: decodeHomeShelves,
  });
}

export function getBecauseYouListened(signal?: AbortSignal): Promise<HomeShelf[]> {
  return apiRequest<HomeShelf[]>('/api/home/because-you-listened', {
    signal,
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    decode: decodeHomeShelves,
  });
}

export function getHomeChartCollections(signal?: AbortSignal): Promise<HomeShelf[]> {
  return apiRequest<HomeShelf[]>('/api/home/charts-collections', {
    signal,
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    decode: decodeHomeShelves,
  });
}

/** Each entry is a plain `Track` plus the reason it is in the radar. */
export function getReleaseRadar(signal?: AbortSignal): Promise<ReleaseRadarEntry[]> {
  return apiRequest<ReleaseRadarEntry[]>('/api/home/release-radar', {
    signal,
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    decode: decodeReleaseRadar,
  });
}

export function getMood(tag: string, signal?: AbortSignal): Promise<Track[]> {
  return apiRequest<Track[]>(`/api/home/mood/${pathSegment(tag)}`, {
    signal,
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    decode: decodeTrackList,
  });
}

export function getGenres(signal?: AbortSignal): Promise<Genre[]> {
  return apiRequest<Genre[]>('/api/genres', { signal, decode: decodeGenres });
}

export function getGenre(genreId: DeezerId, signal?: AbortSignal): Promise<GenreDetail> {
  return apiRequest<GenreDetail>(`/api/genres/${pathSegment(genreId)}`, {
    signal,
    decode: decodeGenreDetail,
  });
}

export function getNewReleases(signal?: AbortSignal): Promise<AlbumSummary[]> {
  return apiRequest<AlbumSummary[]>('/api/new-releases', {
    signal,
    decode: decodeAlbumSummaries,
  });
}

export function getTrack(deezerId: DeezerId, signal?: AbortSignal): Promise<Track> {
  return apiRequest<Track>(`/api/tracks/${pathSegment(deezerId)}`, {
    signal,
    decode: decodeTrack,
  });
}

export function getAlbum(albumId: DeezerId, signal?: AbortSignal): Promise<AlbumDetail> {
  return apiRequest<AlbumDetail>(`/api/albums/${pathSegment(albumId)}`, {
    signal,
    decode: decodeAlbum,
  });
}

export function getArtist(artistId: DeezerId, signal?: AbortSignal): Promise<ArtistDetail> {
  return apiRequest<ArtistDetail>(`/api/artists/${pathSegment(artistId)}`, {
    signal,
    decode: decodeArtistDetail,
  });
}

export function getArtistAbout(name: string, signal?: AbortSignal): Promise<ArtistAbout> {
  return apiRequest<ArtistAbout>(`/api/artist-about?name=${encodeURIComponent(name)}`, {
    signal,
    decode: decodeArtistAbout,
  });
}

/** Endless similar-track radio seeded from a track (~40 tracks). */
export function getRadio(
  deezerId: DeezerId,
  signal?: AbortSignal,
  timeoutMs: number = DISCOVERY_TIMEOUT_MS,
  authenticatedRequestAuthority?: AuthenticatedRequestAuthority,
): Promise<Track[]> {
  return apiRequest<Track[]>(`/api/radio/${pathSegment(deezerId)}`, {
    signal,
    timeoutMs,
    ...(authenticatedRequestAuthority === undefined
      ? {}
      : { authenticatedRequestAuthority }),
    decode: decodeTrackList,
  });
}

/** Starts a background Spotify import; the server answers 202 with the queued job. */
export function startImportJob(url: string): Promise<ImportJobStatus> {
  return apiRequest<ImportJobStatus>('/api/resolve/jobs', {
    method: 'POST',
    body: { url },
    successStatuses: [202],
    decode: decodeImportJobStatus,
  });
}

/** The account's Spotify imports, newest first. */
export function getImportJobs(signal?: AbortSignal): Promise<ImportJobStatus[]> {
  return apiRequest<ImportJobStatus[]>('/api/resolve/jobs', {
    signal,
    decode: decodeImportJobStatuses,
  });
}

/** One import with its matched tracks once it is done. */
export function getImportJob(id: string, signal?: AbortSignal): Promise<ImportJobDetail> {
  return apiRequest<ImportJobDetail>(`/api/resolve/jobs/${pathSegment(id)}`, {
    signal,
    decode: decodeImportJobDetail,
  });
}

/** Removes a finished import or cancels a running one. */
export function deleteImportJob(id: string): Promise<void> {
  return apiRequest<void>(`/api/resolve/jobs/${pathSegment(id)}`, {
    method: 'DELETE',
    successStatuses: [204],
  });
}

export function getDeezerPlaylist(
  playlistId: DeezerId,
  signal?: AbortSignal,
): Promise<DeezerPlaylistDetail> {
  return apiRequest<DeezerPlaylistDetail>(
    `/api/deezer-playlist/${pathSegment(playlistId)}`,
    { signal, decode: decodeDeezerPlaylistDetail },
  );
}

export function getLyrics(
  artist: string,
  title: string,
  deezerId?: DeezerId,
  signal?: AbortSignal,
): Promise<LyricsResponse> {
  const track = deezerId === undefined ? '' : `&deezer_id=${encodeURIComponent(deezerId)}`;
  return apiRequest<LyricsResponse>(
    `/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}${track}`,
    {
      signal,
      // A cache miss can perform two bounded LRCLIB lookups, materialize the
      // complete track, and run a 90-second Groq transcription. The ordinary
      // 20-second request budget aborts that valid server operation before it
      // can return and persist the generated lyrics.
      timeoutMs: 180_000,
      decode: decodeLyricsResponse,
    },
  );
}

export function getCachedTrackIds(signal?: AbortSignal): Promise<CachedTrackIds> {
  return apiRequest<CachedTrackIds>('/api/cached-tracks', {
    signal,
    decode: decodeCachedTrackIds,
  });
}

export function preloadTrack(
  deezerId: DeezerId,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  const request: { method: 'POST'; signal?: AbortSignal; timeoutMs?: number } = {
    method: 'POST',
  };
  if (options.signal !== undefined) request.signal = options.signal;
  if (options.timeoutMs !== undefined) request.timeoutMs = options.timeoutMs;
  return apiRequest<void>(`/api/tracks/${pathSegment(deezerId)}/preload`, request);
}

export function getTrackPlayCounts(
  tracks: TrackPlayQuery[],
  signal?: AbortSignal,
): Promise<TrackPlayCounts> {
  if (tracks.length === 0) return Promise.resolve({});
  return apiRequest<TrackPlayCounts>('/api/track-plays', {
    method: 'POST',
    body: { tracks },
    signal,
    decode: decodeTrackPlayCounts,
  });
}

// --- Playlists ---
export function getPlaylists(
  signal?: AbortSignal,
  scope?: PlaylistListScope,
): Promise<PlaylistSummary[]> {
  const query = scope === undefined ? '' : `?scope=${encodeURIComponent(scope)}`;
  return apiRequest<PlaylistSummary[]>(`/api/playlists${query}`, {
    signal,
    decode: decodePlaylistSummaries,
  });
}

export function getPublicPlaylists(signal?: AbortSignal): Promise<PlaylistSummary[]> {
  return apiRequest<PlaylistSummary[]>('/api/playlists/public', {
    signal,
    decode: decodePlaylistSummaries,
  });
}

export function getPlaylist(id: number, signal?: AbortSignal): Promise<Playlist> {
  return apiRequest<Playlist>(`/api/playlists/${pathSegment(id)}`, { signal, decode: decodePlaylist });
}

export function createPlaylist(request: PlaylistCreateRequest): Promise<PlaylistSummary> {
  return apiRequest<PlaylistSummary>('/api/playlists', {
    method: 'POST',
    body: request,
    decode: decodePlaylistSummary,
  });
}

export function updatePlaylist(
  id: number,
  patch: PlaylistUpdateRequest,
): Promise<PlaylistSummary> {
  return apiRequest<PlaylistSummary>(`/api/playlists/${pathSegment(id)}`, {
    method: 'PATCH',
    body: patch,
    decode: decodePlaylistSummary,
  });
}

export function deletePlaylist(id: number): Promise<void> {
  return apiRequest<void>(`/api/playlists/${pathSegment(id)}`, { method: 'DELETE' });
}

export function addToPlaylist(id: number, track: TrackInput): Promise<void> {
  return apiRequest<void>(`/api/playlists/${pathSegment(id)}/tracks`, {
    method: 'POST',
    body: track,
  });
}

export function removeFromPlaylist(id: number, deezerId: DeezerId): Promise<void> {
  return apiRequest<void>(
    `/api/playlists/${pathSegment(id)}/tracks/${pathSegment(deezerId)}`,
    { method: 'DELETE' },
  );
}

export function removePlaylistEntry(id: number, entryId: number): Promise<void> {
  return apiRequest<void>(
    `/api/playlists/${pathSegment(id)}/tracks/entries/${pathSegment(entryId)}`,
    { method: 'DELETE' },
  );
}

export function reorderPlaylistTracks(id: number, deezerIds: DeezerId[]): Promise<void> {
  return apiRequest<void>(`/api/playlists/${pathSegment(id)}/tracks/order`, {
    method: 'PATCH',
    body: { deezer_ids: deezerIds },
  });
}

export function reorderPlaylistEntries(id: number, entryIds: number[]): Promise<void> {
  return apiRequest<void>(`/api/playlists/${pathSegment(id)}/tracks/entries/order`, {
    method: 'PATCH',
    body: { entry_ids: entryIds },
  });
}

export function addTracksBulk(id: number, tracks: TrackInput[]): Promise<AddedTracksResult> {
  return apiRequest<AddedTracksResult>(`/api/playlists/${pathSegment(id)}/tracks/bulk`, {
    method: 'POST',
    body: tracks,
    decode: decodeAddedTracksResult,
  });
}

export function setPlaylistVisibility(id: number, isPublic: boolean): Promise<PlaylistSummary> {
  return apiRequest<PlaylistSummary>(`/api/playlists/${pathSegment(id)}/visibility`, {
    method: 'PATCH',
    body: { is_public: isPublic },
    decode: decodePlaylistSummary,
  });
}

export function setPlaylistCollaborative(
  id: number,
  isCollaborative: boolean,
): Promise<PlaylistSummary> {
  return apiRequest<PlaylistSummary>(`/api/playlists/${pathSegment(id)}/collaborative`, {
    method: 'PATCH',
    body: { is_collaborative: isCollaborative },
    decode: decodePlaylistSummary,
  });
}

export function getPlaylistInvite(
  id: number,
  signal?: AbortSignal,
): Promise<PlaylistInviteStatus> {
  return apiRequest<PlaylistInviteStatus>(`/api/playlists/${pathSegment(id)}/invite`, {
    signal,
    decode: decodePlaylistInviteStatus,
  });
}

export function createPlaylistInvite(id: number): Promise<PlaylistInvite> {
  return apiRequest<PlaylistInvite>(`/api/playlists/${pathSegment(id)}/invite`, {
    method: 'POST',
    successStatuses: [201],
    decode: decodePlaylistInvite,
  });
}

export function revokePlaylistInvite(id: number): Promise<void> {
  return apiRequest<void>(`/api/playlists/${pathSegment(id)}/invite`, {
    method: 'DELETE',
    successStatuses: [204],
  });
}

export function getPlaylistInvitePreview(
  token: string,
  signal?: AbortSignal,
): Promise<PlaylistInvitePreview> {
  return apiRequest<PlaylistInvitePreview>(`/api/playlists/invites/${pathSegment(token)}`, {
    signal,
    decode: decodePlaylistInvitePreview,
  });
}

export function acceptPlaylistInvite(token: string): Promise<PlaylistJoinResult> {
  return apiRequest<PlaylistJoinResult>(`/api/playlists/invites/${pathSegment(token)}/accept`, {
    method: 'POST',
    decode: decodePlaylistJoinResult,
  });
}

export function addPlaylistCollaborator(
  id: number,
  email: string,
): Promise<PlaylistCollaborator> {
  return apiRequest<PlaylistCollaborator>(`/api/playlists/${pathSegment(id)}/collaborators`, {
    method: 'POST',
    body: { email },
    successStatuses: [201],
    decode: decodePlaylistCollaborator,
  });
}

export function removePlaylistCollaborator(id: number, userId: number): Promise<void> {
  return apiRequest<void>(
    `/api/playlists/${pathSegment(id)}/collaborators/${pathSegment(userId)}`,
    {
      method: 'DELETE',
      successStatuses: [204],
    },
  );
}

export function leavePlaylist(id: number): Promise<void> {
  return apiRequest<void>(`/api/playlists/${pathSegment(id)}/leave`, {
    method: 'POST',
    successStatuses: [204],
  });
}

// --- Likes ---
export function getLikes(signal?: AbortSignal): Promise<Track[]> {
  return apiRequest<Track[]>('/api/me/likes', { signal, decode: decodeTrackList });
}

export function likeTrack(
  track: Track,
  timeoutMs?: number,
  authenticatedRequestAuthority?: AuthenticatedRequestAuthority,
): Promise<void> {
  return apiRequest<void>(`/api/me/likes/${pathSegment(track.id)}`, {
    method: 'PUT',
    body: track,
    timeoutMs,
    ...(authenticatedRequestAuthority === undefined
      ? {}
      : { authenticatedRequestAuthority }),
  });
}

export function unlikeTrack(
  deezerId: DeezerId,
  timeoutMs?: number,
  authenticatedRequestAuthority?: AuthenticatedRequestAuthority,
): Promise<void> {
  return apiRequest<void>(`/api/me/likes/${pathSegment(deezerId)}`, {
    method: 'DELETE',
    timeoutMs,
    ...(authenticatedRequestAuthority === undefined
      ? {}
      : { authenticatedRequestAuthority }),
  });
}

/** Which of the given track ids are liked, as an id→bool map. */
export function likesContains(
  ids: DeezerId[],
  signal?: AbortSignal,
): Promise<Record<string, boolean>> {
  if (ids.length === 0) return Promise.resolve({});
  const encodedIds = encodeURIComponent(ids.join(','));
  return apiRequest<Record<string, boolean>>(
    `/api/me/likes/contains?ids=${encodedIds}`,
    {
      signal,
      decode: decodeBooleanMap,
    },
  );
}

// --- Followed artists ---
export function getFollowingArtists(signal?: AbortSignal): Promise<ArtistSummary[]> {
  return apiRequest<ArtistSummary[]>('/api/me/following/artists', {
    signal,
    decode: decodeArtistSummaries,
  });
}

export function followingContains(
  ids: DeezerId[],
  signal?: AbortSignal,
): Promise<Record<string, boolean>> {
  if (ids.length === 0) return Promise.resolve({});
  const encodedIds = encodeURIComponent(ids.join(','));
  return apiRequest<Record<string, boolean>>(
    `/api/me/following/artists/contains?ids=${encodedIds}`,
    { signal, decode: decodeBooleanMap },
  );
}

export function followArtist(artist: ArtistSummary): Promise<void> {
  return apiRequest<void>(`/api/me/following/artists/${pathSegment(artist.id)}`, {
    method: 'PUT',
    body: artist,
  });
}

export function unfollowArtist(artistId: DeezerId): Promise<void> {
  return apiRequest<void>(`/api/me/following/artists/${pathSegment(artistId)}`, {
    method: 'DELETE',
  });
}

// --- Profile / listening stats ---
export function updateMe(patch: MeUpdateRequest): Promise<User> {
  return apiRequest<User>('/api/me', { method: 'PATCH', body: patch, decode: decodeUser });
}

export function deleteMe(): Promise<void> {
  return apiRequest<void>('/api/me', { method: 'DELETE' });
}

export function getPlaybackSettings(signal?: AbortSignal): Promise<PlaybackSettings> {
  return apiRequest<PlaybackSettings>('/api/me/settings', {
    signal,
    decode: decodePlaybackSettings,
  });
}

export function updatePlaybackSettings(
  patch: PlaybackSettingsUpdate,
): Promise<PlaybackSettings> {
  return apiRequest<PlaybackSettings>('/api/me/settings', {
    method: 'PATCH',
    body: patch,
    decode: decodePlaybackSettings,
  });
}

export function getPublicProfile(userId: number, signal?: AbortSignal): Promise<PublicProfile> {
  return apiRequest<PublicProfile>(`/api/users/${pathSegment(userId)}`, {
    signal,
    decode: decodePublicProfile,
  });
}

export function getStats(
  signal?: AbortSignal,
): Promise<GeneratedApiResponse<'get_stats_api_me_stats_get'>> {
  return requestGeneratedOperation('get_stats_api_me_stats_get', {
    request: {},
    signal,
    decode: decodeListeningStatsWire,
  });
}

/** Record a play (drives personal stats), optionally replay-safe by native event UUID. */
export function recordPlay(
  track: Track,
  timeoutMs?: number,
  eventId?: string,
  authenticatedRequestAuthority?: AuthenticatedRequestAuthority,
): Promise<void> {
  return apiRequest<void>('/api/me/plays', {
    method: 'POST',
    body: track,
    timeoutMs,
    ...(authenticatedRequestAuthority === undefined
      ? {}
      : { authenticatedRequestAuthority }),
    ...(eventId === undefined ? {} : { idempotencyKey: eventId }),
  });
}

// --- Collaborative parties ---
export function createParty(request: PartyCreateRequest = {}): Promise<PartyState> {
  return apiRequest<PartyState>('/api/party', {
    method: 'POST',
    body: request,
    decode: decodePartyState,
  });
}

export function getActiveParty(signal?: AbortSignal): Promise<PartyState | null> {
  return apiRequest<PartyState | null>('/api/party/active', {
    signal,
    decode: decodeNullablePartyState,
  });
}

export function getParty(code: string, signal?: AbortSignal): Promise<PartyState> {
  return apiRequest<PartyState>(`/api/party/${pathSegment(code)}`, {
    signal,
    decode: decodePartyState,
  });
}

export function joinParty(code: string): Promise<PartyState> {
  return apiRequest<PartyState>(`/api/party/${pathSegment(code)}/join`, {
    method: 'POST',
    decode: decodePartyState,
  });
}

export function partyAddTrack(
  code: string,
  track: TrackInput,
  insert?: PartyTrackInsertMode,
): Promise<void> {
  const query = insert === 'next' ? '?insert=next' : '';
  return apiRequest<void>(`/api/party/${pathSegment(code)}/tracks${query}`, {
    method: 'POST',
    body: track,
  });
}

export function partyRemoveTrack(code: string, itemId: number): Promise<void> {
  return apiRequest<void>(
    `/api/party/${pathSegment(code)}/tracks/${pathSegment(itemId)}`,
    { method: 'DELETE' },
  );
}

export function partyReorder(code: string, ids: number[]): Promise<void> {
  return apiRequest<void>(`/api/party/${pathSegment(code)}/tracks/order`, {
    method: 'PATCH',
    body: { ids },
  });
}

export function partySetCurrent(code: string, index: number): Promise<void> {
  return apiRequest<void>(`/api/party/${pathSegment(code)}/current`, {
    method: 'PATCH',
    body: { index },
  });
}

export function partySetPlayback(code: string, update: PartyPlaybackUpdate): Promise<void> {
  return apiRequest<void>(`/api/party/${pathSegment(code)}/playback`, {
    method: 'PATCH',
    body: update,
  });
}

export function partyUpdateSettings(
  code: string,
  patch: PartySettingsUpdateRequest,
): Promise<PartyState> {
  return apiRequest<PartyState>(`/api/party/${pathSegment(code)}/settings`, {
    method: 'PATCH',
    body: patch,
    decode: decodePartyState,
  });
}

export function endParty(code: string): Promise<void> {
  return apiRequest<void>(`/api/party/${pathSegment(code)}`, {
    method: 'DELETE',
    successStatuses: [204],
  });
}

export function partyKickMember(code: string, memberKey: string): Promise<void> {
  return apiRequest<void>(
    `/api/party/${pathSegment(code)}/members/${pathSegment(memberKey)}`,
    {
      method: 'DELETE',
      successStatuses: [204],
    },
  );
}

export function getPartyCachedTrackIds(
  code: string,
  signal?: AbortSignal,
): Promise<CachedTrackIds> {
  return apiRequest<CachedTrackIds>(`/api/party/${pathSegment(code)}/cached-tracks`, {
    signal,
    decode: decodeCachedTrackIds,
  });
}

export function leaveParty(code: string): Promise<void> {
  return apiRequest<void>(`/api/party/${pathSegment(code)}/leave`, { method: 'POST' });
}

// --- Personal multi-device Connect ---
export function createConnectTicket(): Promise<ConnectTicket> {
  return apiRequest<ConnectTicket>('/api/connect/ticket', {
    method: 'POST',
    decode: decodeConnectTicket,
  });
}

export function getConnectState(signal?: AbortSignal): Promise<ConnectState> {
  return apiRequest<ConnectState>('/api/connect/state', {
    signal,
    decode: decodeConnectState,
  });
}

// --- Admin ---
export function getAdminUsers(signal?: AbortSignal): Promise<AdminUser[]> {
  return apiRequest<AdminUser[]>('/api/admin/users', { signal, decode: decodeAdminUsers });
}

export function approveAdminUser(userId: number): Promise<void> {
  return apiRequest<void>(`/api/admin/users/${pathSegment(userId)}/approve`, { method: 'PUT' });
}

export function deleteAdminUser(userId: number): Promise<void> {
  return apiRequest<void>(`/api/admin/users/${pathSegment(userId)}`, { method: 'DELETE' });
}

export function getAdminStatus(signal?: AbortSignal): Promise<AdminStatus> {
  return apiRequest<AdminStatus>('/api/admin/status', { signal, decode: decodeAdminStatus });
}

export function getAdminStorage(signal?: AbortSignal): Promise<AdminStorageInfo> {
  return apiRequest<AdminStorageInfo>('/api/admin/storage', {
    signal,
    decode: decodeAdminStorageInfo,
  });
}

export function cleanupAdminStorage(): Promise<StorageCleanupResult> {
  return apiRequest<StorageCleanupResult>('/api/admin/storage/cleanup', {
    method: 'POST',
    decode: decodeStorageCleanupResult,
  });
}

export function getAdminInvites(signal?: AbortSignal): Promise<AdminInvite[]> {
  return apiRequest<AdminInvite[]>('/api/admin/invites', {
    signal,
    decode: decodeAdminInvites,
  });
}

export function createAdminInvite(): Promise<AdminInvite> {
  return apiRequest<AdminInvite>('/api/admin/invites', {
    method: 'POST',
    decode: decodeAdminInviteResult,
  });
}

function assertAdminUsageRange(range: AdminUsageRange): AdminUsageRange {
  if (range !== '7d' && range !== '30d' && range !== 'all') {
    throw new Error(`Unsupported admin usage range: ${String(range)}`);
  }
  return range;
}

export function getAdminUsage(
  range: AdminUsageRange = 'all',
  signal?: AbortSignal,
): Promise<AdminUsageOverviewResponse> {
  const validRange = assertAdminUsageRange(range);
  return apiRequest<AdminUsageOverviewResponse>(
    `/api/admin/usage?range=${encodeURIComponent(validRange)}`,
    {
      signal,
      decode: decodeAdminUsageOverview,
    },
  );
}

export function getAdminUserUsage(
  userId: number,
  range: AdminUsageRange = 'all',
  signal?: AbortSignal,
): Promise<AdminUserUsageDetailResponse> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('Admin user usage requires a positive integer userId');
  }
  const validRange = assertAdminUsageRange(range);
  return apiRequest<AdminUserUsageDetailResponse>(
    `/api/admin/usage/users/${pathSegment(userId)}?range=${encodeURIComponent(validRange)}`,
    {
      signal,
      decode: decodeAdminUserUsageDetail,
    },
  );
}
