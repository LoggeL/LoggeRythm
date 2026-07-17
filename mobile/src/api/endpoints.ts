import { apiRequest, type AuthenticatedRequestAuthority } from './client';
import { requestGeneratedOperation } from './generatedOperationClient';
import type { GeneratedApiResponse } from './generated/contract';
import {
  decodeAddedTracksResult,
  decodeAdminInviteResult,
  decodeAdminInvites,
  decodeAdminStatus,
  decodeAdminStorageInfo,
  decodeAdminUsers,
  decodeAlbum,
  decodeAlbumSummaries,
  decodeArtistAbout,
  decodeArtistDetail,
  decodeArtistSummaries,
  decodeBooleanMap,
  decodeCachedTrackIds,
  decodeDeezerPlaylistDetail,
  decodeGenreDetail,
  decodeGenres,
  decodeHomeShelves,
  decodeLyricsResponse,
  decodeOk,
  decodePlaybackSettings,
  decodePartyState,
  decodePlaylist,
  decodePlaylistSummary,
  decodePlaylistSearchResults,
  decodePlaylistSummaries,
  decodePublicProfile,
  decodeResolveResult,
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
  AdminUser,
  AlbumDetail,
  AlbumSummary,
  ArtistAbout,
  ArtistDetail,
  ArtistSummary,
  CachedTrackIds,
  DeezerPlaylistDetail,
  DeezerId,
  Genre,
  GenreDetail,
  HomeShelf,
  LyricsResponse,
  PartyState,
  PlaybackSettings,
  Playlist,
  PlaylistCreateRequest,
  PlaylistSearchResult,
  PlaylistSummary,
  PlaylistUpdateRequest,
  PublicProfile,
  ResolveResult,
  StorageCleanupResult,
  Track,
  TrackInput,
  TrackPlayCounts,
  TrackPlayQuery,
  User,
} from './types';

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
}

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
  return apiRequest<HomeShelf[]>('/api/home/mixes', { signal, decode: decodeHomeShelves });
}

export function getBecauseYouListened(signal?: AbortSignal): Promise<HomeShelf[]> {
  return apiRequest<HomeShelf[]>('/api/home/because-you-listened', {
    signal,
    decode: decodeHomeShelves,
  });
}

export function getHomeChartCollections(signal?: AbortSignal): Promise<HomeShelf[]> {
  return apiRequest<HomeShelf[]>('/api/home/charts-collections', {
    signal,
    decode: decodeHomeShelves,
  });
}

export function getReleaseRadar(signal?: AbortSignal): Promise<Track[]> {
  return apiRequest<Track[]>('/api/home/release-radar', { signal, decode: decodeTrackList });
}

export function getMood(tag: string, signal?: AbortSignal): Promise<Track[]> {
  return apiRequest<Track[]>(`/api/home/mood/${pathSegment(tag)}`, {
    signal,
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
  timeoutMs?: number,
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

export function resolveExternalUrl(url: string, signal?: AbortSignal): Promise<ResolveResult> {
  return apiRequest<ResolveResult>(`/api/resolve?url=${encodeURIComponent(url)}`, {
    signal,
    // The production resolver may match up to 200 tracks against Deezer in
    // bounded batches; the ordinary 20 s request budget is too short for that
    // server contract. Cancellation from query unmount/replacement still wins.
    timeoutMs: 120_000,
    decode: decodeResolveResult,
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
export function getPlaylists(signal?: AbortSignal): Promise<PlaylistSummary[]> {
  return apiRequest<PlaylistSummary[]>('/api/playlists', {
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

// --- Likes ---
export function getLikes(signal?: AbortSignal): Promise<Track[]> {
  return apiRequest<Track[]>('/api/me/likes', { signal, decode: decodeTrackList });
}

export function likeTrack(track: Track): Promise<void> {
  return apiRequest<void>(`/api/me/likes/${pathSegment(track.id)}`, { method: 'PUT', body: track });
}

export function unlikeTrack(deezerId: DeezerId): Promise<void> {
  return apiRequest<void>(`/api/me/likes/${pathSegment(deezerId)}`, { method: 'DELETE' });
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

export function partyAddTrack(code: string, track: TrackInput): Promise<void> {
  return apiRequest<void>(`/api/party/${pathSegment(code)}/tracks`, {
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

export function leaveParty(code: string): Promise<void> {
  return apiRequest<void>(`/api/party/${pathSegment(code)}/leave`, { method: 'POST' });
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
