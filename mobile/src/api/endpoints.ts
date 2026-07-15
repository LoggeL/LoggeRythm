import { apiRequest } from './client';
import {
  decodeAlbum,
  decodeBooleanMap,
  decodeOk,
  decodePlaylist,
  decodePlaylistSummaries,
  decodeTrack,
  decodeTrackList,
  decodeUser,
} from './decoders';
import type { AlbumDetail, DeezerId, Playlist, PlaylistSummary, Track, User } from './types';

function pathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

export interface RegisterRequest {
  email: string;
  password: string;
  display_name: string | null;
  invite: string | null;
}

// --- Auth ---
export function login(email: string, password: string): Promise<User> {
  return apiRequest<User>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    captureSession: true,
    noAuth: true,
    decode: decodeUser,
  });
}

export function register(request: RegisterRequest): Promise<User> {
  return apiRequest<User>('/api/auth/register', {
    method: 'POST',
    body: request,
    captureSession: true,
    noAuth: true,
    decode: decodeUser,
  });
}

export function me(): Promise<User> {
  return apiRequest<User>('/api/auth/me', { decode: decodeUser });
}

export function logout(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST', decode: decodeOk });
}

// --- Browse / search ---
export function searchTracks(q: string, signal?: AbortSignal): Promise<Track[]> {
  return apiRequest<Track[]>(`/api/search?q=${encodeURIComponent(q)}&type=track`, {
    signal,
    decode: decodeTrackList,
  });
}

export function getTrack(deezerId: DeezerId): Promise<Track> {
  return apiRequest<Track>(`/api/tracks/${pathSegment(deezerId)}`, { decode: decodeTrack });
}

export function getAlbum(albumId: DeezerId): Promise<AlbumDetail> {
  return apiRequest<AlbumDetail>(`/api/albums/${pathSegment(albumId)}`, { decode: decodeAlbum });
}

/** Endless similar-track radio seeded from a track (~40 tracks). */
export function getRadio(
  deezerId: DeezerId,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<Track[]> {
  return apiRequest<Track[]>(`/api/radio/${pathSegment(deezerId)}`, {
    signal,
    timeoutMs,
    decode: decodeTrackList,
  });
}

// --- Playlists ---
export function getPlaylists(signal?: AbortSignal): Promise<PlaylistSummary[]> {
  return apiRequest<PlaylistSummary[]>('/api/playlists', {
    signal,
    decode: decodePlaylistSummaries,
  });
}

export function getPlaylist(id: number, signal?: AbortSignal): Promise<Playlist> {
  return apiRequest<Playlist>(`/api/playlists/${pathSegment(id)}`, { signal, decode: decodePlaylist });
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

/** Record a play (drives personal stats). Body is the full Track (server denormalizes it). */
export function recordPlay(track: Track, timeoutMs?: number): Promise<void> {
  return apiRequest<void>('/api/me/plays', {
    method: 'POST',
    body: track,
    timeoutMs,
  });
}
