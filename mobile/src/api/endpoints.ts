import { apiRequest } from './client';
import type { AlbumDetail, Playlist, PlaylistSummary, Track, User } from './types';

// --- Auth ---
export function login(email: string, password: string): Promise<User> {
  return apiRequest<User>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    captureSession: true,
    noAuth: true,
  });
}

export function me(): Promise<User> {
  return apiRequest<User>('/api/auth/me');
}

export function logout(): Promise<void> {
  return apiRequest<void>('/api/auth/logout', { method: 'POST' });
}

// --- Browse / search ---
export function searchTracks(q: string): Promise<Track[]> {
  return apiRequest<Track[]>(`/api/search?q=${encodeURIComponent(q)}&type=track`);
}

export function getTrack(deezerId: number): Promise<Track> {
  return apiRequest<Track>(`/api/tracks/${deezerId}`);
}

export function getAlbum(albumId: number): Promise<AlbumDetail> {
  return apiRequest<AlbumDetail>(`/api/albums/${albumId}`);
}

/** Endless similar-track radio seeded from a track (~40 tracks). */
export function getRadio(deezerId: number): Promise<Track[]> {
  return apiRequest<Track[]>(`/api/radio/${deezerId}`);
}

// --- Playlists ---
export function getPlaylists(): Promise<PlaylistSummary[]> {
  return apiRequest<PlaylistSummary[]>('/api/playlists');
}

export function getPlaylist(id: number): Promise<Playlist> {
  return apiRequest<Playlist>(`/api/playlists/${id}`);
}

// --- Likes ---
export function getLikes(): Promise<Track[]> {
  return apiRequest<Track[]>('/api/me/likes');
}

export function likeTrack(track: Track): Promise<void> {
  return apiRequest<void>(`/api/me/likes/${track.id}`, { method: 'PUT', body: track });
}

export function unlikeTrack(deezerId: number): Promise<void> {
  return apiRequest<void>(`/api/me/likes/${deezerId}`, { method: 'DELETE' });
}

/** Which of the given track ids are liked, as an id→bool map. */
export function likesContains(ids: number[]): Promise<Record<string, boolean>> {
  if (ids.length === 0) return Promise.resolve({});
  return apiRequest<Record<string, boolean>>(`/api/me/likes/contains?ids=${ids.join(',')}`);
}

/** Record a play (drives personal stats). Body is the full Track (server denormalizes it). */
export function recordPlay(track: Track): Promise<void> {
  return apiRequest<void>('/api/me/plays', { method: 'POST', body: track });
}
