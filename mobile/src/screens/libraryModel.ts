import {
  playlistEntryId,
  type ArtistSummary,
  type DeezerId,
  type PlaylistEntryId,
  type PlaylistCreateRequest,
  type PlaylistUpdateRequest,
  type RecentPlay,
  type Track,
} from '../api/types';
import type { TrackOccurrenceIdentity } from '../player/trackPresentation';

export interface OwnedPlaylistRouteParams {
  kind: 'playlist';
  playlistId: number;
  name: string;
}

export interface LikedPlaylistRouteParams {
  kind: 'liked';
  name: string;
}

export type LibraryPlaylistRouteParams =
  | OwnedPlaylistRouteParams
  | LikedPlaylistRouteParams;

export interface LibraryArtistRouteParams {
  artistId: DeezerId;
  name?: string;
}

export interface LibraryAlbumRouteParams {
  albumId: DeezerId;
  title?: string;
}

export interface LibraryRouteCallbacks {
  onOpenPlaylist: (params: LibraryPlaylistRouteParams) => void;
  onOpenAlbum: (params: LibraryAlbumRouteParams) => void;
  onOpenArtist: (params: LibraryArtistRouteParams) => void;
}

export function libraryFollowArtistRoute(artist: ArtistSummary): LibraryArtistRouteParams {
  const artistId = String(artist.id).trim();
  if (artistId.length === 0) throw new Error('Followed artist id must not be empty');
  return { artistId, name: artist.name };
}

interface PlaylistScreenCallbacks {
  onDeleted: () => void;
  onOpenAlbum: (params: LibraryAlbumRouteParams) => void;
  onOpenArtist: (params: LibraryArtistRouteParams) => void;
}

export type PlaylistScreenContract =
  | (LikedPlaylistRouteParams & PlaylistScreenCallbacks)
  | (OwnedPlaylistRouteParams & PlaylistScreenCallbacks);

function isCallback(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

export function assertLibraryRouteCallbacks(
  value: unknown,
): asserts value is LibraryRouteCallbacks {
  const candidate = value as Partial<LibraryRouteCallbacks> | null;
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    !isCallback(candidate.onOpenPlaylist) ||
    !isCallback(candidate.onOpenAlbum) ||
    !isCallback(candidate.onOpenArtist)
  ) {
    throw new Error(
      'LibraryScreen requires onOpenPlaylist, onOpenAlbum, and onOpenArtist route callbacks',
    );
  }
}

export function assertPlaylistScreenContract(
  value: PlaylistScreenContract,
): asserts value is PlaylistScreenContract {
  if (
    !isCallback(value.onDeleted)
    || !isCallback(value.onOpenAlbum)
    || !isCallback(value.onOpenArtist)
  ) {
    throw new Error(
      'PlaylistScreen requires onDeleted, onOpenAlbum, and onOpenArtist route callbacks',
    );
  }
  if (value.kind === 'playlist') {
    if (!Number.isSafeInteger(value.playlistId) || value.playlistId <= 0) {
      throw new Error('PlaylistScreen requires a positive playlistId');
    }
  }
}

export type LibraryTrackOccurrence = Omit<TrackOccurrenceIdentity, 'trackId'> & {
  queueContext: {
    type: 'liked' | 'playlist' | 'recent';
    id: string;
  };
  originalContextOrder: number;
};

function trackOccurrence(
  type: LibraryTrackOccurrence['queueContext']['type'],
  contextId: string | number,
  originalContextOrder: number,
): LibraryTrackOccurrence {
  const id = String(contextId).trim();
  if (id.length === 0) throw new Error(`${type} track context id must not be empty`);
  if (!Number.isInteger(originalContextOrder) || originalContextOrder < 0) {
    throw new Error(`${type} track occurrence index must be a non-negative integer`);
  }
  return {
    queueContext: { type, id },
    originalContextOrder,
  };
}

export function likedTrackOccurrence(
  accountId: string | number,
  originalContextOrder: number,
): LibraryTrackOccurrence {
  return trackOccurrence('liked', accountId, originalContextOrder);
}

export function recentTrackOccurrence(
  accountId: string | number,
  originalContextOrder: number,
): LibraryTrackOccurrence {
  return trackOccurrence('recent', accountId, originalContextOrder);
}

export function playlistTrackOccurrence(
  playlistId: string | number,
  originalContextOrder: number,
): LibraryTrackOccurrence {
  return trackOccurrence('playlist', playlistId, originalContextOrder);
}

/**
 * Persisted history already contains every identity/action field used by a
 * Track. Fill only wire-format fields that RecentPlay intentionally omits.
 */
export function recentPlayTrack(play: RecentPlay): Track {
  return {
    ...play,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

function normalizedDescription(description: string): string | null {
  const normalized = description.trim();
  return normalized.length === 0 ? null : normalized;
}

export function playlistCreateRequest(
  name: string,
  description: string,
): PlaylistCreateRequest {
  const normalizedName = name.trim();
  if (normalizedName.length === 0) throw new Error('Playlist name must not be empty');
  return { name: normalizedName, description: normalizedDescription(description) };
}

export function playlistUpdateRequest(
  name: string,
  description: string,
): PlaylistUpdateRequest {
  const normalizedName = name.trim();
  if (normalizedName.length === 0) throw new Error('Playlist name must not be empty');
  // Production PATCH treats null as "leave unchanged". An explicit empty
  // string is therefore required to clear an existing description.
  return { name: normalizedName, description: description.trim() };
}

export interface LibraryPlaybackSelection {
  tracks: Track[];
  startIndex: number;
}

/** Keep the backend's exact order and duplicate entries as the queue context. */
export function libraryPlaybackSelection(
  tracks: Track[],
  startIndex: number,
): LibraryPlaybackSelection {
  if (tracks.length === 0) throw new Error('Playback context must contain at least one track');
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= tracks.length) {
    throw new Error(
      `Playback start index ${String(startIndex)} is outside a ${tracks.length}-track context`,
    );
  }
  return { tracks, startIndex };
}

export type TrackMoveDirection = 'up' | 'down';

/** Returns the complete server reorder payload without mutating the rendered queue. */
export function reorderedPlaylistEntryIds(
  tracks: readonly Track[],
  index: number,
  direction: TrackMoveDirection,
): PlaylistEntryId[] {
  if (!Number.isInteger(index) || index < 0 || index >= tracks.length) {
    throw new Error(`Track index ${String(index)} is outside the playlist`);
  }
  const destination = direction === 'up' ? index - 1 : index + 1;
  if (destination < 0 || destination >= tracks.length) {
    throw new Error(`Track at index ${index} cannot move ${direction}`);
  }
  const ids = tracks.map(playlistEntryId);
  [ids[index], ids[destination]] = [ids[destination], ids[index]];
  return ids;
}

export function libraryTestIdSegment(value: string | number): string {
  const normalized = String(value)
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'item';
}
