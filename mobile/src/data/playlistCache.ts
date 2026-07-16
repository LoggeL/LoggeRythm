import type { QueryClient } from '@tanstack/react-query';
import type {
  AddedTracksResult,
  Playlist,
  PlaylistCreateRequest,
  PlaylistSummary,
  PlaylistUpdateRequest,
  Track,
} from '../api/types';
import { playlistEntryId } from '../api/types';
import type { QueryScope } from './queryKeys';
import { queryKeys } from './queryKeys';

export interface PlaylistCacheSnapshot {
  detail: Playlist | undefined;
  owned: PlaylistSummary[] | undefined;
  public: PlaylistSummary[] | undefined;
}

export interface CreatePlaylistWithTrackRepository {
  createPlaylist(request: PlaylistCreateRequest): Promise<PlaylistSummary>;
  addToPlaylist(id: number, track: Track): Promise<void>;
  deletePlaylist(id: number): Promise<void>;
}

export interface CreatePlaylistWithTracksRepository {
  createPlaylist(request: PlaylistCreateRequest): Promise<PlaylistSummary>;
  addTracksBulk(id: number, tracks: Track[]): Promise<AddedTracksResult>;
  deletePlaylist(id: number): Promise<void>;
}

type DetailTransform = (playlist: Playlist) => Playlist;
type SummaryTransform = (playlist: PlaylistSummary) => PlaylistSummary;

function keys(scope: QueryScope, id: number) {
  return {
    detail: queryKeys.playlists.detail(scope, id),
    owned: queryKeys.playlists.owned(scope),
    public: queryKeys.playlists.public(scope),
  };
}

async function beginOptimisticPlaylistChange(
  client: QueryClient,
  scope: QueryScope,
  id: number,
  transformDetail: DetailTransform,
  transformSummary: SummaryTransform = (summary) => summary,
): Promise<PlaylistCacheSnapshot> {
  const queryKey = keys(scope, id);
  await Promise.all([
    client.cancelQueries({ queryKey: queryKey.detail, exact: true }),
    client.cancelQueries({ queryKey: queryKey.owned, exact: true }),
    client.cancelQueries({ queryKey: queryKey.public, exact: true }),
  ]);

  const snapshot: PlaylistCacheSnapshot = {
    detail: client.getQueryData<Playlist>(queryKey.detail),
    owned: client.getQueryData<PlaylistSummary[]>(queryKey.owned),
    public: client.getQueryData<PlaylistSummary[]>(queryKey.public),
  };

  if (snapshot.detail !== undefined) {
    client.setQueryData<Playlist>(queryKey.detail, transformDetail(snapshot.detail));
  }
  for (const listKey of [queryKey.owned, queryKey.public]) {
    client.setQueryData<PlaylistSummary[]>(listKey, (current) =>
      current?.map((summary) =>
        summary.id === id ? transformSummary(summary) : summary,
      ),
    );
  }
  return snapshot;
}

export function restorePlaylistCache(
  client: QueryClient,
  scope: QueryScope,
  id: number,
  snapshot: PlaylistCacheSnapshot,
): void {
  const queryKey = keys(scope, id);
  if (snapshot.detail === undefined) client.removeQueries({ queryKey: queryKey.detail, exact: true });
  else client.setQueryData(queryKey.detail, snapshot.detail);

  if (snapshot.owned === undefined) client.removeQueries({ queryKey: queryKey.owned, exact: true });
  else client.setQueryData(queryKey.owned, snapshot.owned);

  if (snapshot.public === undefined) client.removeQueries({ queryKey: queryKey.public, exact: true });
  else client.setQueryData(queryKey.public, snapshot.public);
}

export function optimisticallyUpdatePlaylist(
  client: QueryClient,
  scope: QueryScope,
  id: number,
  patch: PlaylistUpdateRequest,
): Promise<PlaylistCacheSnapshot> {
  const applyPatch = <T extends Playlist | PlaylistSummary>(playlist: T): T => ({
    ...playlist,
    ...(typeof patch.name === 'string' ? { name: patch.name } : {}),
    ...(typeof patch.description === 'string' ? { description: patch.description } : {}),
  });
  return beginOptimisticPlaylistChange(
    client,
    scope,
    id,
    applyPatch,
    applyPatch,
  );
}

export function optimisticallySetPlaylistVisibility(
  client: QueryClient,
  scope: QueryScope,
  id: number,
  isPublic: boolean,
): Promise<PlaylistCacheSnapshot> {
  return beginOptimisticPlaylistChange(
    client,
    scope,
    id,
    (playlist) => ({ ...playlist, is_public: isPublic }),
    (summary) => ({ ...summary, is_public: isPublic }),
  );
}

export function optimisticallyRemovePlaylistTrack(
  client: QueryClient,
  scope: QueryScope,
  id: number,
  entryId: number,
): Promise<PlaylistCacheSnapshot> {
  let removed = 0;
  return beginOptimisticPlaylistChange(
    client,
    scope,
    id,
    (playlist) => {
      const index = playlist.tracks.findIndex(
        (track) => playlistEntryId(track) === entryId,
      );
      if (index < 0) throw new Error(`Playlist does not contain entry ${String(entryId)}`);
      const tracks = [...playlist.tracks];
      tracks.splice(index, 1);
      removed = 1;
      return { ...playlist, tracks };
    },
    (summary) => ({
      ...summary,
      track_count: Math.max(0, summary.track_count - removed),
    }),
  );
}

/** Reorder by stable occurrence identity; duplicate catalog IDs stay independent. */
export function tracksInPlaylistEntryOrder(
  tracks: readonly Track[],
  orderedEntryIds: readonly number[],
): Track[] {
  if (orderedEntryIds.length !== tracks.length) {
    throw new Error('Playlist reorder must include every track exactly once');
  }
  const byEntryId = new Map<number, Track>();
  for (const track of tracks) {
    const entryId = playlistEntryId(track);
    if (byEntryId.has(entryId)) {
      throw new Error(`Playlist contains duplicate entry ${String(entryId)}`);
    }
    byEntryId.set(entryId, track);
  }

  const requested = new Set<number>();
  const reordered = orderedEntryIds.map((entryId) => {
    if (requested.has(entryId)) {
      throw new Error(`Playlist reorder repeats entry ${String(entryId)}`);
    }
    requested.add(entryId);
    const track = byEntryId.get(entryId);
    if (track === undefined) {
      throw new Error(`Playlist reorder contains unknown entry ${String(entryId)}`);
    }
    return track;
  });
  if (requested.size !== byEntryId.size) {
    throw new Error('Playlist reorder omitted one or more track occurrences');
  }
  return reordered;
}

export function optimisticallyReorderPlaylistTracks(
  client: QueryClient,
  scope: QueryScope,
  id: number,
  orderedEntryIds: readonly number[],
): Promise<PlaylistCacheSnapshot> {
  return beginOptimisticPlaylistChange(client, scope, id, (playlist) => ({
    ...playlist,
    tracks: tracksInPlaylistEntryOrder(playlist.tracks, orderedEntryIds),
  }));
}

export function optimisticallyAddPlaylistTrack(
  client: QueryClient,
  scope: QueryScope,
  id: number,
  track: Track,
): Promise<PlaylistCacheSnapshot> {
  let added = false;
  return beginOptimisticPlaylistChange(
    client,
    scope,
    id,
    (playlist) => {
      if (playlist.tracks.some((item) => item.id === track.id)) return playlist;
      added = true;
      return { ...playlist, tracks: [...playlist.tracks, track] };
    },
    (summary) => ({
      ...summary,
      track_count: summary.track_count + (added ? 1 : 0),
    }),
  );
}

/**
 * Append only catalog IDs not already present in a loaded detail cache. If the
 * detail is absent, leave summary counts untouched because the server may
 * already contain some of the import; invalidation will reconcile it.
 */
export function optimisticallyAddPlaylistTracks(
  client: QueryClient,
  scope: QueryScope,
  id: number,
  tracks: readonly Track[],
): Promise<PlaylistCacheSnapshot> {
  let added: Track[] = [];
  return beginOptimisticPlaylistChange(
    client,
    scope,
    id,
    (playlist) => {
      const existing = new Set(playlist.tracks.map((track) => track.id));
      added = tracks.filter((track) => {
        if (existing.has(track.id)) return false;
        existing.add(track.id);
        return true;
      });
      if (added.length === 0) return playlist;
      return {
        ...playlist,
        cover_url: playlist.cover_url || added.find((track) => track.cover)?.cover || null,
        tracks: [...playlist.tracks, ...added],
      };
    },
    (summary) => ({
      ...summary,
      cover_url: summary.cover_url || added.find((track) => track.cover)?.cover || null,
      track_count: summary.track_count + added.length,
    }),
  );
}

export function removeDeletedPlaylistFromCache(
  client: QueryClient,
  scope: QueryScope,
  id: number,
): void {
  const queryKey = keys(scope, id);
  client.removeQueries({ queryKey: queryKey.detail, exact: true });
  for (const listKey of [queryKey.owned, queryKey.public]) {
    client.setQueryData<PlaylistSummary[]>(listKey, (current) =>
      current?.filter((playlist) => playlist.id !== id),
    );
  }
}

export async function invalidatePlaylistCaches(
  client: QueryClient,
  scope: QueryScope,
  id?: number,
): Promise<void> {
  const invalidations = [
    client.invalidateQueries({ queryKey: queryKeys.playlists.owned(scope), exact: true }),
    client.invalidateQueries({ queryKey: queryKeys.playlists.public(scope), exact: true }),
  ];
  if (id !== undefined) {
    invalidations.push(
      client.invalidateQueries({
        queryKey: queryKeys.playlists.detail(scope, id),
        exact: true,
      }),
    );
  }
  await Promise.all(invalidations);
}

/**
 * The API has no combined create-and-add transaction. Compensating deletion
 * prevents a failed add from silently leaving an unintended empty playlist.
 */
export async function createPlaylistWithTrack(
  repository: CreatePlaylistWithTrackRepository,
  request: PlaylistCreateRequest,
  track: Track,
): Promise<PlaylistSummary> {
  const playlist = await repository.createPlaylist(request);
  try {
    await repository.addToPlaylist(playlist.id, track);
  } catch (error) {
    try {
      await repository.deletePlaylist(playlist.id);
    } catch {
      // Preserve the actionable add failure; later invalidation reconciles any
      // empty playlist left behind if compensating deletion also failed.
    }
    throw error;
  }
  return { ...playlist, track_count: Math.max(1, playlist.track_count) };
}

export interface CreatedPlaylistWithTracks {
  playlist: PlaylistSummary;
  added: number;
}

/**
 * Create a destination and bulk-add an import. The API has no transaction, so
 * a failed bulk write is compensated with deletion just like single-track
 * create-and-add. The original bulk error remains the actionable failure.
 */
export async function createPlaylistWithTracks(
  repository: CreatePlaylistWithTracksRepository,
  request: PlaylistCreateRequest,
  tracks: readonly Track[],
): Promise<CreatedPlaylistWithTracks> {
  if (tracks.length === 0) throw new Error('Cannot create an import playlist without tracks');
  const playlist = await repository.createPlaylist(request);
  try {
    const result = await repository.addTracksBulk(playlist.id, [...tracks]);
    return {
      playlist: {
        ...playlist,
        cover_url: playlist.cover_url || tracks.find((track) => track.cover)?.cover || null,
        track_count: result.added,
      },
      added: result.added,
    };
  } catch (error) {
    try {
      await repository.deletePlaylist(playlist.id);
    } catch {
      // Later invalidation reconciles a destination left by failed compensation.
    }
    throw error;
  }
}
