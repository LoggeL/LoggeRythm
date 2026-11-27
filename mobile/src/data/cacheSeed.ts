import type { QueryClient } from '@tanstack/react-query';
import type {
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  DeezerId,
  Genre,
  GenreDetail,
  HomeShelf,
  Playlist,
  PlaylistSummary,
  PublicProfile,
  ReleaseRadarEntry,
  Track,
} from '../api/types';
import type { AlbumCard } from '../domain/catalog';
import { queryKeys, type QueryScope } from './queryKeys';

function requireNonEmptyId(value: DeezerId, label: string): string {
  const normalized = String(value).trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

function requirePositivePlaylistId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`playlist id must be a positive integer, received ${String(value)}`);
  }
  return value;
}

function albumSummaryFromTrack(track: Track, albumId: string): AlbumSummary | null {
  if (String(track.album_id).trim() !== albumId) return null;
  if (track.album.trim().length === 0) return null;
  return {
    id: albumId,
    title: track.album,
    artist: track.artist,
    cover: track.cover,
    release_date: track.release_date,
  };
}

function artistNameFromTrack(track: Track, artistId: string): string | null {
  if (String(track.artist_id).trim() === artistId && track.artist.trim().length > 0) {
    return track.artist;
  }
  const ref = track.artists.find((artist) => String(artist.id).trim() === artistId);
  if (ref !== undefined && ref.name.trim().length > 0) return ref.name;
  return null;
}

function collectCachedTracks(queryClient: QueryClient, scope?: QueryScope): Track[] {
  const tracks: Track[] = [];
  const pushList = (list: readonly Track[] | undefined): void => {
    if (Array.isArray(list)) tracks.push(...list);
  };
  const pushShelves = (shelves: readonly HomeShelf[] | undefined): void => {
    if (!Array.isArray(shelves)) return;
    for (const shelf of shelves) pushList(shelf.tracks);
  };

  pushList(queryClient.getQueryData<Track[]>(queryKeys.catalog.charts()));
  pushShelves(queryClient.getQueryData<HomeShelf[]>(queryKeys.home.chartCollections()));

  for (const [, moodTracks] of queryClient.getQueriesData<Track[]>({
    queryKey: [...queryKeys.home.root(), 'mood'],
  })) {
    pushList(moodTracks);
  }
  for (const [, artist] of queryClient.getQueriesData<ArtistDetail>({
    queryKey: [...queryKeys.catalog.root(), 'artist'],
  })) {
    if (artist !== undefined) pushList(artist.top);
  }
  for (const [key, detail] of queryClient.getQueriesData<GenreDetail>({
    queryKey: queryKeys.catalog.genres(),
  })) {
    if (key.length === 4 && detail !== undefined && Array.isArray(detail.tracks)) {
      pushList(detail.tracks);
    }
  }

  // Account/origin-scoped caches (including search) are inspected strictly for the requested scope.
  if (scope !== undefined) {
    for (const [, searchTracks] of queryClient.getQueriesData<Track[]>({
      queryKey: [...queryKeys.search.scoped(scope), 'track'],
    })) {
      pushList(searchTracks);
    }
    pushList(queryClient.getQueryData<Track[]>(queryKeys.library.likes(scope)));
    pushShelves(queryClient.getQueryData<HomeShelf[]>(queryKeys.home.mixes(scope)));
    pushShelves(queryClient.getQueryData<HomeShelf[]>(queryKeys.home.becauseYouListened(scope)));
    const radar = queryClient.getQueryData<ReleaseRadarEntry[]>(queryKeys.home.releaseRadar(scope));
    if (Array.isArray(radar)) {
      for (const entry of radar) tracks.push(entry.track);
    }
    for (const [, playlist] of queryClient.getQueriesData<Playlist>({
      queryKey: queryKeys.playlists.details(scope),
    })) {
      if (playlist !== undefined) pushList(playlist.tracks);
    }
  }

  return tracks;
}

/**
 * Look up an already-cached album summary across public catalog/search caches
 * and (when `scope` is supplied) that exact account's private caches.
 * Pure, synchronous cache read so AlbumScreen can render hero metadata immediately.
 */
export function findCachedAlbumSummary(
  queryClient: QueryClient,
  albumId: DeezerId,
  scope?: QueryScope,
): AlbumSummary | null {
  const id = requireNonEmptyId(albumId, 'album id');

  const detail = queryClient.getQueryData<AlbumDetail>(queryKeys.catalog.album(id));
  if (detail !== undefined) {
    return {
      id: detail.id,
      title: detail.title,
      artist: detail.artist,
      cover: detail.cover,
      release_date: detail.release_date,
    };
  }

  const newReleases = queryClient.getQueryData<AlbumSummary[]>(queryKeys.catalog.newReleases());
  const fromNewReleases = newReleases?.find((album) => String(album.id) === id);
  if (fromNewReleases !== undefined) return fromNewReleases;

  for (const [, artist] of queryClient.getQueriesData<ArtistDetail>({
    queryKey: [...queryKeys.catalog.root(), 'artist'],
  })) {
    const match = artist?.albums?.find((album) => String(album.id) === id);
    if (match !== undefined) return match;
  }

  for (const [key, genre] of queryClient.getQueriesData<GenreDetail>({
    queryKey: queryKeys.catalog.genres(),
  })) {
    if (key.length !== 4 || genre === undefined || !Array.isArray(genre.albums)) continue;
    const match = genre.albums.find((album) => String(album.id) === id);
    if (match !== undefined) return match;
  }

  if (scope !== undefined) {
    for (const [, cards] of queryClient.getQueriesData<AlbumCard[]>({
      queryKey: [...queryKeys.search.scoped(scope), 'album'],
    })) {
      const match = cards?.find((card) => String(card.id) === id);
      if (match !== undefined) {
        return {
          id: match.id,
          title: match.title,
          artist: match.artistName,
          cover: match.artworkUrl ?? '',
          release_date: '',
        };
      }
    }
  }

  for (const track of collectCachedTracks(queryClient, scope)) {
    const summary = albumSummaryFromTrack(track, id);
    if (summary !== null) return summary;
  }

  return null;
}

/**
 * Look up an already-cached artist summary across public catalog/search caches
 * and (when `scope` is supplied) that exact account's followed/private caches.
 * Prefers entries with artwork (`picture`) before name-only fallbacks from tracks/albums.
 */
export function findCachedArtistSummary(
  queryClient: QueryClient,
  artistId: DeezerId,
  scope?: QueryScope,
): ArtistSummary | null {
  const id = requireNonEmptyId(artistId, 'artist id');

  const detail = queryClient.getQueryData<ArtistDetail>(queryKeys.catalog.artist(id));
  if (detail !== undefined) {
    return { id: detail.id, name: detail.name, picture: detail.picture };
  }

  if (scope !== undefined) {
    const followed = queryClient.getQueryData<ArtistSummary[]>(queryKeys.follows.artists(scope));
    const fromFollowed = followed?.find((artist) => String(artist.id) === id);
    if (fromFollowed !== undefined) return fromFollowed;

    for (const [, artists] of queryClient.getQueriesData<ArtistSummary[]>({
      queryKey: [...queryKeys.search.scoped(scope), 'artist'],
    })) {
      const match = artists?.find((artist) => String(artist.id) === id);
      if (match !== undefined) return match;
    }
  }

  for (const [, artist] of queryClient.getQueriesData<ArtistDetail>({
    queryKey: [...queryKeys.catalog.root(), 'artist'],
  })) {
    const match = artist?.related?.find((entry) => String(entry.id) === id);
    if (match !== undefined) return match;
  }

  for (const [key, genre] of queryClient.getQueriesData<GenreDetail>({
    queryKey: queryKeys.catalog.genres(),
  })) {
    if (key.length !== 4 || genre === undefined || !Array.isArray(genre.artists)) continue;
    const match = genre.artists.find((artist) => String(artist.id) === id);
    if (match !== undefined) return match;
  }

  for (const [, profile] of queryClient.getQueriesData<PublicProfile>({
    queryKey: [...queryKeys.profile.root(), 'public'],
  })) {
    const match = profile?.top_artists?.find((artist) => String(artist.id) === id);
    if (match !== undefined) return match;
  }

  for (const [, album] of queryClient.getQueriesData<AlbumDetail>({
    queryKey: [...queryKeys.catalog.root(), 'album'],
  })) {
    if (album !== undefined && String(album.artist_id).trim() === id && album.artist.trim().length > 0) {
      return { id, name: album.artist, picture: '' };
    }
  }

  for (const track of collectCachedTracks(queryClient, scope)) {
    const name = artistNameFromTrack(track, id);
    if (name !== null) return { id, name, picture: '' };
  }

  return null;
}

/**
 * Look up an already-cached genre from either its detail cache or the genre
 * directory list so GenreScreen can show name/artwork immediately.
 */
export function findCachedGenre(
  queryClient: QueryClient,
  genreId: DeezerId,
): Genre | null {
  const id = requireNonEmptyId(genreId, 'genre id');

  const detail = queryClient.getQueryData<GenreDetail>(queryKeys.catalog.genre(id));
  if (detail !== undefined) {
    return { id: detail.id, name: detail.name, picture: detail.picture };
  }

  const list = queryClient.getQueryData<Genre[]>(queryKeys.catalog.genres());
  return list?.find((genre) => String(genre.id) === id) ?? null;
}

/**
 * Look up an already-cached playlist summary strictly within the given account
 * `scope` (detail, owned list, or public list). Never inspects other accounts.
 */
export function findCachedPlaylistSummary(
  queryClient: QueryClient,
  scope: QueryScope,
  playlistId: number,
): PlaylistSummary | null {
  const id = requirePositivePlaylistId(playlistId);
  // Validates scope is non-empty via queryKeys.playlists.scoped.
  const detail = queryClient.getQueryData<Playlist>(queryKeys.playlists.detail(scope, id));
  if (detail !== undefined) {
    return {
      id: detail.id,
      name: detail.name,
      description: detail.description,
      cover_url: detail.cover_url,
      is_public: detail.is_public,
      track_count: detail.tracks.length,
      owner_id: detail.owner_id,
      owner_name: detail.owner_name,
      owner_avatar_url: detail.owner_avatar_url,
      is_collaborative: detail.is_collaborative,
      is_owner: detail.is_owner,
      is_collaborator: detail.is_collaborator,
      can_edit_tracks: detail.can_edit_tracks,
      collaborator_count: detail.collaborator_count,
    };
  }

  const owned = queryClient.getQueryData<PlaylistSummary[]>(queryKeys.playlists.owned(scope));
  const fromOwned = owned?.find((playlist) => playlist.id === id);
  if (fromOwned !== undefined) return fromOwned;

  const community = queryClient.getQueryData<PlaylistSummary[]>(queryKeys.playlists.public(scope));
  const fromCommunity = community?.find((playlist) => playlist.id === id);
  return fromCommunity ?? null;
}
