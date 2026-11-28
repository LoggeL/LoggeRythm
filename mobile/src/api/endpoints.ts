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
  decodeAuthProviders,
  decodeBatchPreloadResponse,
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
  decodePartyReaction,
  decodePartyState,
  decodePartyVoteSkipResult,
  decodePlaybackSettings,
  decodePlaylist,
  decodePlaylistBlendResult,
  decodePlaylistDeduplicateResult,
  decodePlaylistDuplicates,
  decodePlaylistIncomingInvitations,
  decodePlaylistInviteCandidates,
  decodePlaylistJoinResult,
  decodePlaylistOutgoingInvitation,
  decodePlaylistOutgoingInvitations,
  decodePlaylistSummary,
  decodePlaylistSearchResults,
  decodePlaylistSummaries,
  decodePlaylistSyncManifest,
  decodePublicProfile,
  decodeReleaseRadar,
  decodeGoogleMobileStart,
  decodeImportJobDetail,
  decodeImportJobStatus,
  decodeImportJobStatuses,
  decodeSocialActivityResponse,
  decodeStorageCleanupResult,
  decodeTrack,
  decodeTrackAudioMeta,
  decodeTrackList,
  decodeTrackPlayCounts,
  decodeUser,
  decodeUserStatsInsights,
} from './decoders';
import { decodeListeningStatsWire } from '../data/mappers/listeningStats';
import { decodeWrappedReport } from '../data/mappers/wrapped';
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
  AudioQualityTier,
  AuthProviders,
  BatchPreloadResponse,
  CachedTrackIds,
  ConnectState,
  ConnectTicket,
  DeezerPlaylistDetail,
  DeezerId,
  Genre,
  GenreDetail,
  GoogleMobileStartResponse,
  HomeShelf,
  LyricsResponse,
  PartyReaction,
  PartyState,
  PartyVoteSkipResult,
  PlaybackSettings,
  Playlist,
  PlaylistBlendResult,
  PlaylistCreateRequest,
  PlaylistDeduplicateResult,
  PlaylistDuplicatesResponse,
  PlaylistIncomingInvitation,
  PlaylistInviteCandidate,
  PlaylistJoinResult,
  PlaylistOutgoingInvitation,
  PlaylistListScope,
  PlaylistSearchResult,
  PlaylistSummary,
  PlaylistSyncManifest,
  PlaylistUpdateRequest,
  PublicProfile,
  RadioSeedRequest,
  ReleaseRadarEntry,
  ImportJobDetail,
  ImportJobStatus,
  SocialActivityResponse,
  StatsInsightsRange,
  StorageCleanupResult,
  Track,
  TrackAudioMeta,
  TrackInput,
  TrackPlayCounts,
  TrackPlayQuery,
  User,
  UserStatsInsights,
  WrappedReport,
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
  preferred_quality?: AudioQualityTier | null;
  share_listening_activity?: boolean | null;
  dj_transitions_enabled?: boolean | null;
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
  auto_dj?: boolean;
}

export interface PartySettingsUpdateRequest {
  name?: string | null;
  guests_can_control?: boolean | null;
  auto_dj?: boolean | null;
}

export interface PartySavePlaylistRequest {
  name?: string | null;
  collaborative?: boolean;
}

export interface StartImportJobOptions {
  target_playlist_id?: number | null;
  create_playlist_name?: string | null;
}

export interface PlaylistSyncManifestOptions {
  includeLyrics?: boolean;
  preload?: boolean;
}

export interface LyricsLookupOptions {
  album?: string;
  durationSec?: number;
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

export function getAuthProviders(apiBase?: string, signal?: AbortSignal): Promise<AuthProviders> {
  return apiRequest<AuthProviders>('/api/auth/providers', {
    noAuth: true,
    signal,
    ...(apiBase === undefined ? {} : { apiBase }),
    decode: decodeAuthProviders,
  });
}

export function startGoogleMobileAuth(
  invite: string | null,
  apiBase?: string,
): Promise<GoogleMobileStartResponse> {
  return apiRequest<GoogleMobileStartResponse>('/api/auth/google/mobile/start', {
    method: 'POST',
    body: { invite },
    noAuth: true,
    ...(apiBase === undefined ? {} : { apiBase }),
    decode: decodeGoogleMobileStart,
  });
}

export function exchangeGoogleMobileAuth(
  code: string,
  handoffSecret: string,
  apiBase?: string,
): Promise<User> {
  return apiRequest<User>('/api/auth/google/mobile/exchange', {
    method: 'POST',
    body: { code, handoff_secret: handoffSecret },
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

export function getPersonalMixes(signal?: AbortSignal): Promise<HomeShelf[]> {
  return apiRequest<HomeShelf[]>('/api/home/personal-mixes', {
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

export function getTrackAudioMeta(
  deezerId: DeezerId,
  signal?: AbortSignal,
): Promise<TrackAudioMeta> {
  return apiRequest<TrackAudioMeta>(`/api/tracks/${pathSegment(deezerId)}/audio-meta`, {
    signal,
    decode: decodeTrackAudioMeta,
  });
}

export function preloadTracksBatch(
  trackIds: DeezerId[],
  signal?: AbortSignal,
): Promise<BatchPreloadResponse> {
  return apiRequest<BatchPreloadResponse>('/api/tracks/preload', {
    method: 'POST',
    body: { track_ids: trackIds },
    signal,
    decode: decodeBatchPreloadResponse,
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

export function getSeededRadio(
  request: RadioSeedRequest,
  signal?: AbortSignal,
): Promise<Track[]> {
  return apiRequest<Track[]>('/api/radio/seed', {
    method: 'POST',
    body: request,
    signal,
    timeoutMs: DISCOVERY_TIMEOUT_MS,
    decode: decodeTrackList,
  });
}

/** Starts a background Spotify import; the server answers 202 with the queued job. */
export function startImportJob(
  url: string,
  options?: StartImportJobOptions,
): Promise<ImportJobStatus> {
  const body: Record<string, unknown> = { url };
  if (options?.target_playlist_id !== undefined) {
    body.target_playlist_id = options.target_playlist_id;
  }
  if (options?.create_playlist_name !== undefined) {
    body.create_playlist_name = options.create_playlist_name;
  }
  return apiRequest<ImportJobStatus>('/api/resolve/jobs', {
    method: 'POST',
    body,
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

export type LyricsVariant = 'default' | 'ai';

export function getLyrics(
  artist: string,
  title: string,
  deezerId?: DeezerId,
  signal?: AbortSignal,
  variant?: LyricsVariant,
  options?: LyricsLookupOptions,
): Promise<LyricsResponse> {
  const track = deezerId === undefined ? '' : `&deezer_id=${encodeURIComponent(deezerId)}`;
  const variantQuery = variant === 'ai' ? '&variant=ai' : '';
  const albumQuery =
    options?.album !== undefined && options.album.trim().length > 0
      ? `&album=${encodeURIComponent(options.album.trim())}`
      : '';
  const durationQuery =
    options?.durationSec !== undefined && Number.isFinite(options.durationSec) && options.durationSec > 0
      ? `&duration_sec=${Math.round(options.durationSec)}`
      : '';
  return apiRequest<LyricsResponse>(
    `/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}${track}${variantQuery}${albumQuery}${durationQuery}`,
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

/** Owner-only: approved accounts whose display name contains `q` (max 20, owner excluded). */
export function searchPlaylistInviteCandidates(
  id: number,
  q: string,
  signal?: AbortSignal,
): Promise<PlaylistInviteCandidate[]> {
  const needle = q.trim();
  if (needle.length === 0) {
    throw new Error('searchPlaylistInviteCandidates requires a non-empty display-name query');
  }
  return apiRequest<PlaylistInviteCandidate[]>(
    `/api/playlists/${pathSegment(id)}/invite-candidates?q=${encodeURIComponent(needle)}`,
    {
      signal,
      decode: decodePlaylistInviteCandidates,
    },
  );
}

/** Owner-only: pending invitations the invitees have not answered yet. */
export function getPlaylistOutgoingInvitations(
  id: number,
  signal?: AbortSignal,
): Promise<PlaylistOutgoingInvitation[]> {
  return apiRequest<PlaylistOutgoingInvitation[]>(
    `/api/playlists/${pathSegment(id)}/invitations`,
    {
      signal,
      decode: decodePlaylistOutgoingInvitations,
    },
  );
}

export function invitePlaylistCollaborator(
  id: number,
  userId: number,
): Promise<PlaylistOutgoingInvitation> {
  return apiRequest<PlaylistOutgoingInvitation>(
    `/api/playlists/${pathSegment(id)}/invitations`,
    {
      method: 'POST',
      body: { user_id: userId },
      successStatuses: [201],
      decode: decodePlaylistOutgoingInvitation,
    },
  );
}

export function withdrawPlaylistInvitation(id: number, userId: number): Promise<void> {
  return apiRequest<void>(
    `/api/playlists/${pathSegment(id)}/invitations/${pathSegment(userId)}`,
    {
      method: 'DELETE',
      successStatuses: [204],
    },
  );
}

/** Pending playlist invitations addressed to the current account, newest first. */
export function getMyPlaylistInvitations(
  signal?: AbortSignal,
): Promise<PlaylistIncomingInvitation[]> {
  return apiRequest<PlaylistIncomingInvitation[]>('/api/playlists/invitations', {
    signal,
    decode: decodePlaylistIncomingInvitations,
  });
}

export function acceptPlaylistInvitation(invitationId: number): Promise<PlaylistJoinResult> {
  return apiRequest<PlaylistJoinResult>(
    `/api/playlists/invitations/${pathSegment(invitationId)}/accept`,
    {
      method: 'POST',
      decode: decodePlaylistJoinResult,
    },
  );
}

export function declinePlaylistInvitation(invitationId: number): Promise<void> {
  return apiRequest<void>(
    `/api/playlists/invitations/${pathSegment(invitationId)}/decline`,
    {
      method: 'POST',
      successStatuses: [204],
    },
  );
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

export function getPlaylistSyncManifest(
  id: number,
  options: PlaylistSyncManifestOptions = {},
  signal?: AbortSignal,
): Promise<PlaylistSyncManifest> {
  const params: string[] = [];
  if (options.includeLyrics) params.push('include_lyrics=true');
  if (options.preload) params.push('preload=true');
  const query = params.length > 0 ? `?${params.join('&')}` : '';
  return apiRequest<PlaylistSyncManifest>(
    `/api/playlists/${pathSegment(id)}/sync-manifest${query}`,
    {
      signal,
      decode: decodePlaylistSyncManifest,
    },
  );
}

export function getPlaylistDuplicates(
  id: number,
  signal?: AbortSignal,
): Promise<PlaylistDuplicatesResponse> {
  return apiRequest<PlaylistDuplicatesResponse>(
    `/api/playlists/${pathSegment(id)}/duplicates`,
    {
      signal,
      decode: decodePlaylistDuplicates,
    },
  );
}

export function deduplicatePlaylist(id: number): Promise<PlaylistDeduplicateResult> {
  return apiRequest<PlaylistDeduplicateResult>(
    `/api/playlists/${pathSegment(id)}/deduplicate`,
    {
      method: 'POST',
      decode: decodePlaylistDeduplicateResult,
    },
  );
}

export function createPlaylistBlend(otherUserId: number): Promise<PlaylistBlendResult> {
  return apiRequest<PlaylistBlendResult>(
    `/api/playlists/blend/${pathSegment(otherUserId)}`,
    {
      method: 'POST',
      successStatuses: [201],
      decode: decodePlaylistBlendResult,
    },
  );
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

export function getStatsInsights(
  range: StatsInsightsRange = '30d',
  signal?: AbortSignal,
): Promise<UserStatsInsights> {
  return apiRequest<UserStatsInsights>(
    `/api/me/stats/insights?range=${encodeURIComponent(range)}`,
    {
      signal,
      decode: decodeUserStatsInsights,
    },
  );
}

export function getStatsWrapped(
  range: StatsInsightsRange = '30d',
  signal?: AbortSignal,
): Promise<WrappedReport> {
  return apiRequest<WrappedReport>(
    `/api/me/stats/wrapped?range=${encodeURIComponent(range)}`,
    {
      signal,
      decode: decodeWrappedReport,
    },
  );
}

export function getSocialActivity(signal?: AbortSignal): Promise<SocialActivityResponse> {
  return apiRequest<SocialActivityResponse>('/api/social/activity', {
    signal,
    decode: decodeSocialActivityResponse,
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

export function savePartyAsPlaylist(
  code: string,
  request: PartySavePlaylistRequest = {},
): Promise<PlaylistSummary> {
  return apiRequest<PlaylistSummary>(`/api/party/${pathSegment(code)}/save-playlist`, {
    method: 'POST',
    body: request,
    successStatuses: [201],
    decode: decodePlaylistSummary,
  });
}

export function transferPartyHost(code: string, memberKey: string): Promise<PartyState> {
  return apiRequest<PartyState>(`/api/party/${pathSegment(code)}/host`, {
    method: 'PATCH',
    body: { member_key: memberKey },
    decode: decodePartyState,
  });
}

export function fillPartyAutoDj(code: string, count = 5): Promise<PartyState> {
  return apiRequest<PartyState>(
    `/api/party/${pathSegment(code)}/auto-dj/fill?count=${encodeURIComponent(String(count))}`,
    {
      method: 'POST',
      decode: decodePartyState,
    },
  );
}

export function reactInParty(code: string, emoji: string): Promise<PartyReaction> {
  return apiRequest<PartyReaction>(`/api/party/${pathSegment(code)}/react`, {
    method: 'POST',
    body: { emoji },
    decode: decodePartyReaction,
  });
}

export function voteSkipPartyTrack(code: string): Promise<PartyVoteSkipResult> {
  return apiRequest<PartyVoteSkipResult>(`/api/party/${pathSegment(code)}/vote-skip`, {
    method: 'POST',
    decode: decodePartyVoteSkipResult,
  });
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
