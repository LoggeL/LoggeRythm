import { ApiError } from '../api/client';
import { trackArtistLabel } from '../api/trackArtists';
import type {
  AlbumDetail,
  ArtistDetail,
  ArtistSummary,
  DeezerId,
  DeezerPlaylistDetail,
  DeezerPlaylistTrack,
  Genre,
  GenreDetail,
  Playlist,
  PlaylistSearchResult,
  PlaylistSummary,
  Track,
} from '../api/types';
import type { AlbumCard } from '../domain/catalog';
import type { RecentPlay, UserStats } from '../domain/listeningStats';
import { strings } from '../localization';
import { UserFacingPlayerError } from '../player/errors';
import type { PlayTracksOptions } from '../player/controller';
import type { MediaPlayFromSearchRequest } from './mediaPlayFromSearchIntent';

export interface VoiceSearchRepository {
  getLikes(): Promise<Track[]>;
  getPlaylists(): Promise<PlaylistSummary[]>;
  getPlaylist(id: number): Promise<Playlist>;
  getStats(): Promise<UserStats>;
  getCharts(): Promise<Track[]>;
  getGenres(): Promise<Genre[]>;
  getGenre(id: DeezerId): Promise<GenreDetail>;
  searchTracks(query: string): Promise<Track[]>;
  searchAlbums(query: string): Promise<AlbumCard[]>;
  searchArtists(query: string): Promise<ArtistSummary[]>;
  searchPlaylists(query: string): Promise<PlaylistSearchResult[]>;
  getAlbum(id: DeezerId): Promise<AlbumDetail>;
  getArtist(id: DeezerId): Promise<ArtistDetail>;
  getDeezerPlaylist(id: DeezerId): Promise<DeezerPlaylistDetail>;
}

export interface VoicePlaybackPort {
  hasActiveQueue(): boolean;
  activeTrackId(): string | null;
  isPlaying(): boolean;
  resume(): void;
  playTracks(tracks: Track[], startIndex: number, opts: PlayTracksOptions): Promise<void>;
  playTrackWithRadio(seed: Track): Promise<'toggled-current' | 'started-radio'>;
  isTrackRadioError(error: unknown): boolean;
}

export interface VoiceSearchDeps {
  readonly repository: VoiceSearchRepository;
  readonly player: VoicePlaybackPort;
  readonly onNavigateNowPlaying?: () => void;
  readonly onAnnounce?: (message: string) => void;
  readonly onRadioNotice?: (title: string, message: string) => void;
}

export type MediaPlayFromSearchOutcome =
  | { readonly kind: 'resumed' }
  | { readonly kind: 'played-track'; readonly track: Track; readonly radioAttached: boolean }
  | { readonly kind: 'played-album'; readonly title: string; readonly trackCount: number }
  | { readonly kind: 'played-artist'; readonly name: string; readonly trackCount: number }
  | {
      readonly kind: 'played-playlist';
      readonly name: string;
      readonly trackCount: number;
      readonly source: 'user' | 'public';
    }
  | { readonly kind: 'played-genre'; readonly name: string; readonly trackCount: number }
  | {
      readonly kind: 'played-library-fallback';
      readonly source: 'likes' | 'recent' | 'charts';
      readonly trackCount: number;
    };

export function normalizeVoiceText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textMatchScore(candidate: string, needle: string): number {
  const normalizedNeedle = normalizeVoiceText(needle);
  if (normalizedNeedle.length === 0) return 0;
  const normalizedCandidate = normalizeVoiceText(candidate);
  if (normalizedCandidate.length === 0) return 0;

  if (normalizedCandidate === normalizedNeedle) return 100;
  if (normalizedCandidate.startsWith(`${normalizedNeedle} `)) return 85;
  if (normalizedCandidate.startsWith(normalizedNeedle)) return 80;
  if (` ${normalizedCandidate} `.includes(` ${normalizedNeedle} `)) return 70;
  if (normalizedCandidate.includes(normalizedNeedle)) return 60;

  const needleTokens = normalizedNeedle.split(' ');
  const candidateTokens = new Set(normalizedCandidate.split(' '));
  if (needleTokens.every((token) => candidateTokens.has(token))) return 50;

  const matchedTokens = needleTokens.filter((token) =>
    normalizedCandidate.includes(token),
  ).length;
  if (matchedTokens === needleTokens.length) return 40;
  if (matchedTokens > 0) return Math.round((matchedTokens / needleTokens.length) * 30);
  return 0;
}

function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

function toLoudLookupError(errors: readonly unknown[]): Error {
  if (errors.some(isNetworkFailure)) {
    return new UserFacingPlayerError(strings.voice.offlineUnavailable);
  }
  const first = errors[0];
  if (first instanceof Error) return first;
  return new Error(String(first));
}

function recentPlayToTrack(entry: RecentPlay): Track {
  return {
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    artist_id: entry.artist_id,
    artists: entry.artists,
    album: entry.album,
    album_id: entry.album_id,
    cover: entry.cover,
    duration_sec: entry.duration_sec,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

function deezerPlaylistTrackToTrack(entry: DeezerPlaylistTrack): Track {
  return {
    ...entry,
    release_date: '',
  };
}

function isBlankRequest(request: MediaPlayFromSearchRequest): boolean {
  return (
    request.query.length === 0
    && request.artist === null
    && request.album === null
    && request.title === null
    && request.playlist === null
    && request.genre === null
  );
}

function combineQueryParts(parts: readonly (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const collected: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const key = normalizeVoiceText(trimmed);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    collected.push(trimmed);
  }
  return collected.join(' ');
}

function displayQueryFor(request: MediaPlayFromSearchRequest): string {
  return (
    request.query
    || combineQueryParts([
      request.title,
      request.playlist,
      request.album,
      request.artist,
      request.genre,
    ])
  );
}

function finishPlayback(deps: VoiceSearchDeps, announcement: string): void {
  deps.onNavigateNowPlaying?.();
  deps.onAnnounce?.(announcement);
}

async function handleBlankRequest(
  deps: VoiceSearchDeps,
): Promise<MediaPlayFromSearchOutcome> {
  if (deps.player.hasActiveQueue()) {
    deps.player.resume();
    finishPlayback(deps, strings.voice.resumedPlayback);
    return { kind: 'resumed' };
  }

  const errors: unknown[] = [];

  try {
    const likes = await deps.repository.getLikes();
    if (likes.length > 0) {
      await deps.player.playTracks(likes, 0, {
        context: { type: 'liked', id: 'liked', label: strings.navigation.likedSongs },
      });
      finishPlayback(deps, strings.voice.startedPlayback(strings.navigation.likedSongs));
      return { kind: 'played-library-fallback', source: 'likes', trackCount: likes.length };
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    const stats = await deps.repository.getStats();
    const recentTracks = stats.recent.map(recentPlayToTrack);
    if (recentTracks.length > 0) {
      await deps.player.playTracks(recentTracks, 0, {
        context: { type: 'recent', id: 'recent', label: strings.queue.recentContext },
      });
      finishPlayback(deps, strings.voice.startedPlayback(strings.queue.recentContext));
      return {
        kind: 'played-library-fallback',
        source: 'recent',
        trackCount: recentTracks.length,
      };
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    const charts = await deps.repository.getCharts();
    if (charts.length > 0) {
      await deps.player.playTracks(charts, 0, {
        context: { type: 'chart', id: 'charts', label: strings.home.charts },
      });
      finishPlayback(deps, strings.voice.startedPlayback(strings.home.charts));
      return { kind: 'played-library-fallback', source: 'charts', trackCount: charts.length };
    }
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw toLoudLookupError(errors);
  }
  throw new UserFacingPlayerError(strings.voice.emptyLibrary);
}

async function tryPlayUserPlaylist(
  playlists: readonly PlaylistSummary[],
  targetName: string,
  requireExact: boolean,
  deps: VoiceSearchDeps,
): Promise<MediaPlayFromSearchOutcome | null> {
  const ranked = playlists
    .filter((item) => item.track_count > 0)
    .map((item, index) => ({
      item,
      index,
      score: textMatchScore(item.name, targetName),
    }))
    .filter((entry) => (requireExact ? entry.score === 100 : entry.score >= 50))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  for (const candidate of ranked) {
    const detail = await deps.repository.getPlaylist(candidate.item.id);
    if (detail.tracks.length === 0) continue;
    await deps.player.playTracks(detail.tracks, 0, {
      context: {
        type: 'playlist',
        id: String(detail.id),
        label: detail.name,
      },
    });
    finishPlayback(deps, strings.voice.startedPlayback(detail.name));
    return {
      kind: 'played-playlist',
      name: detail.name,
      trackCount: detail.tracks.length,
      source: 'user',
    };
  }
  return null;
}

async function resolvePlaylistRequest(
  targetName: string,
  deps: VoiceSearchDeps,
): Promise<{ outcome: MediaPlayFromSearchOutcome | null; errors: unknown[] }> {
  const errors: unknown[] = [];
  const [userPlaylistsResult, publicPlaylistsResult] = await Promise.allSettled([
    deps.repository.getPlaylists(),
    deps.repository.searchPlaylists(targetName),
  ]);

  if (userPlaylistsResult.status === 'fulfilled') {
    const userOutcome = await tryPlayUserPlaylist(
      userPlaylistsResult.value,
      targetName,
      false,
      deps,
    );
    if (userOutcome !== null) return { outcome: userOutcome, errors };
  } else {
    errors.push(userPlaylistsResult.reason);
  }

  if (publicPlaylistsResult.status === 'fulfilled') {
    const ranked = publicPlaylistsResult.value
      .map((item, index) => ({
        item,
        index,
        score: textMatchScore(item.title, targetName),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);

    for (const candidate of ranked.slice(0, 3)) {
      const detail = await deps.repository.getDeezerPlaylist(candidate.item.id);
      const tracks = detail.tracks.map(deezerPlaylistTrackToTrack);
      if (tracks.length === 0) continue;
      await deps.player.playTracks(tracks, 0, {
        context: {
          type: 'playlist',
          id: detail.id,
          label: detail.name,
        },
      });
      finishPlayback(deps, strings.voice.startedPlayback(detail.name));
      return {
        outcome: {
          kind: 'played-playlist',
          name: detail.name,
          trackCount: tracks.length,
          source: 'public',
        },
        errors,
      };
    }
  } else {
    errors.push(publicPlaylistsResult.reason);
  }

  return { outcome: null, errors };
}

async function resolveAlbumRequest(
  request: MediaPlayFromSearchRequest,
  deps: VoiceSearchDeps,
): Promise<{ outcome: MediaPlayFromSearchOutcome | null; errors: unknown[] }> {
  const albumNeedle = request.album ?? request.query;
  const searchQuery = combineQueryParts([request.album, request.artist]) || request.query;
  const errors: unknown[] = [];
  let albums: AlbumCard[];
  try {
    albums = await deps.repository.searchAlbums(searchQuery);
  } catch (error) {
    errors.push(error);
    return { outcome: null, errors };
  }

  const ranked = albums
    .map((album, index) => {
      const titleScore = textMatchScore(album.title, albumNeedle);
      const artistScore = request.artist ? textMatchScore(album.artistName, request.artist) : 0;
      const combinedScore = textMatchScore(`${album.title} ${album.artistName}`, searchQuery);
      return {
        album,
        index,
        score: titleScore * 3 + artistScore * 2 + combinedScore,
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  for (const candidate of ranked.slice(0, 3)) {
    const detail = await deps.repository.getAlbum(candidate.album.id);
    if (detail.tracks.length === 0) continue;
    await deps.player.playTracks(detail.tracks, 0, {
      context: {
        type: 'album',
        id: detail.id,
        label: detail.title,
      },
    });
    finishPlayback(deps, strings.voice.startedPlayback(detail.title));
    return {
      outcome: {
        kind: 'played-album',
        title: detail.title,
        trackCount: detail.tracks.length,
      },
      errors,
    };
  }
  return { outcome: null, errors };
}

async function resolveArtistRequest(
  targetArtist: string,
  deps: VoiceSearchDeps,
): Promise<{ outcome: MediaPlayFromSearchOutcome | null; errors: unknown[] }> {
  const errors: unknown[] = [];
  let artists: ArtistSummary[];
  try {
    artists = await deps.repository.searchArtists(targetArtist);
  } catch (error) {
    errors.push(error);
    return { outcome: null, errors };
  }

  const ranked = artists
    .map((artist, index) => ({
      artist,
      index,
      score: textMatchScore(artist.name, targetArtist),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  for (const candidate of ranked.slice(0, 3)) {
    const detail = await deps.repository.getArtist(candidate.artist.id);
    if (detail.top.length === 0) continue;
    await deps.player.playTracks(detail.top, 0, {
      context: {
        type: 'artist',
        id: detail.id,
        label: detail.name,
      },
    });
    finishPlayback(deps, strings.voice.startedPlayback(detail.name));
    return {
      outcome: {
        kind: 'played-artist',
        name: detail.name,
        trackCount: detail.top.length,
      },
      errors,
    };
  }
  return { outcome: null, errors };
}

async function resolveGenreRequest(
  targetGenre: string,
  deps: VoiceSearchDeps,
): Promise<{ outcome: MediaPlayFromSearchOutcome | null; errors: unknown[] }> {
  const errors: unknown[] = [];
  let genres: Genre[];
  try {
    genres = await deps.repository.getGenres();
  } catch (error) {
    errors.push(error);
    return { outcome: null, errors };
  }

  const ranked = genres
    .map((genre, index) => ({
      genre,
      index,
      score: textMatchScore(genre.name, targetGenre),
    }))
    .filter((entry) => entry.score >= 50)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  for (const candidate of ranked.slice(0, 2)) {
    const detail = await deps.repository.getGenre(candidate.genre.id);
    if (detail.tracks.length === 0) continue;
    await deps.player.playTracks(detail.tracks, 0, {
      context: {
        type: 'genre',
        id: detail.id,
        label: detail.name,
      },
    });
    finishPlayback(deps, strings.voice.startedPlayback(detail.name));
    return {
      outcome: {
        kind: 'played-genre',
        name: detail.name,
        trackCount: detail.tracks.length,
      },
      errors,
    };
  }
  return { outcome: null, errors };
}

function scoreTrackCandidate(
  track: Track,
  request: MediaPlayFromSearchRequest,
  searchQuery: string,
  liked: boolean,
): number {
  const artistText = trackArtistLabel(track);
  const fullText = `${track.title} ${artistText} ${track.album}`;

  let score = 0;
  if (request.title !== null) {
    score += textMatchScore(track.title, request.title) * 3;
  }
  if (request.artist !== null) {
    score += textMatchScore(artistText, request.artist) * 2;
  }
  if (request.album !== null) {
    score += Math.round(textMatchScore(track.album, request.album) * 1.5);
  }
  if (searchQuery.length > 0) {
    const titleDirect = textMatchScore(track.title, searchQuery);
    const artistDirect = textMatchScore(artistText, searchQuery);
    const combinedDirect = textMatchScore(fullText, searchQuery);
    score += Math.max(titleDirect * 2, combinedDirect * 2, artistDirect);
  }
  if (liked && score > 0) {
    score += 5;
  }
  return score;
}

async function startTrackPlayback(
  track: Track,
  deps: VoiceSearchDeps,
): Promise<MediaPlayFromSearchOutcome> {
  // Never accidentally pause an already-playing requested track via togglePlay().
  if (deps.player.activeTrackId() === track.id) {
    if (!deps.player.isPlaying()) {
      deps.player.resume();
    }
    finishPlayback(deps, strings.voice.startedPlayback(track.title));
    return { kind: 'played-track', track, radioAttached: false };
  }

  try {
    await deps.player.playTrackWithRadio(track);
    finishPlayback(deps, strings.voice.startedPlayback(track.title));
    return { kind: 'played-track', track, radioAttached: true };
  } catch (error) {
    if (deps.player.isTrackRadioError(error)) {
      deps.onRadioNotice?.(strings.search.radioFailed, strings.search.radioFailed);
      finishPlayback(deps, strings.voice.startedPlayback(track.title));
      return { kind: 'played-track', track, radioAttached: false };
    }
    throw error;
  }
}

async function resolveTrackOrUnstructuredRequest(
  request: MediaPlayFromSearchRequest,
  deps: VoiceSearchDeps,
  priorErrors: readonly unknown[],
): Promise<MediaPlayFromSearchOutcome> {
  const searchQuery =
    combineQueryParts([request.title, request.artist, request.album]) || request.query;
  const allowExactUserPlaylist =
    request.focusKind === 'unstructured'
    && request.title === null
    && request.artist === null
    && request.album === null
    && request.genre === null;

  const [tracksResult, likesResult, playlistsResult] = await Promise.allSettled([
    deps.repository.searchTracks(searchQuery),
    deps.repository.getLikes(),
    allowExactUserPlaylist ? deps.repository.getPlaylists() : Promise.resolve<PlaylistSummary[]>([]),
  ]);

  const errors: unknown[] = [...priorErrors];
  if (tracksResult.status === 'rejected') errors.push(tracksResult.reason);
  if (likesResult.status === 'rejected') errors.push(likesResult.reason);
  if (playlistsResult.status === 'rejected') errors.push(playlistsResult.reason);

  if (allowExactUserPlaylist && playlistsResult.status === 'fulfilled') {
    const exactPlaylistOutcome = await tryPlayUserPlaylist(
      playlistsResult.value,
      searchQuery,
      true,
      deps,
    );
    if (exactPlaylistOutcome !== null) return exactPlaylistOutcome;
  }

  const likedTracks = likesResult.status === 'fulfilled' ? likesResult.value : [];
  const likedIds = new Set(likedTracks.map((track) => track.id));
  const remoteTracks = tracksResult.status === 'fulfilled' ? tracksResult.value : [];

  const candidates = new Map<string, { track: Track; order: number; fromRemote: boolean }>();
  remoteTracks.forEach((track, index) => {
    if (!candidates.has(track.id)) {
      candidates.set(track.id, { track, order: index, fromRemote: true });
    }
  });
  likedTracks.forEach((track, index) => {
    if (candidates.has(track.id)) return;
    const score = scoreTrackCandidate(track, request, searchQuery, true);
    if (score >= 70) {
      candidates.set(track.id, {
        track,
        order: remoteTracks.length + index,
        fromRemote: false,
      });
    }
  });

  const ranked = [...candidates.values()]
    .map((entry) => ({
      ...entry,
      score: scoreTrackCandidate(entry.track, request, searchQuery, likedIds.has(entry.track.id)),
    }))
    .sort((left, right) => right.score - left.score || left.order - right.order);

  if (ranked.length > 0) {
    return startTrackPlayback(ranked[0].track, deps);
  }

  if (errors.length > 0) {
    throw toLoudLookupError(errors);
  }

  const label = displayQueryFor(request);
  throw new UserFacingPlayerError(
    label.length > 0 ? strings.voice.noMatchesFor(label) : strings.voice.noMatchesGeneric,
  );
}

/**
 * Execute an Android `MEDIA_PLAY_FROM_SEARCH` request across Phone and TV:
 * resolves user library + live catalog according to `mediaFocus` and structured
 * extras, starts playback immediately, and fails loudly when no playable match
 * exists or network/API lookups fail.
 */
export async function executeMediaPlayFromSearch(
  request: MediaPlayFromSearchRequest,
  deps: VoiceSearchDeps,
): Promise<MediaPlayFromSearchOutcome> {
  if (isBlankRequest(request)) {
    return handleBlankRequest(deps);
  }

  const collectedErrors: unknown[] = [];

  if (request.focusKind === 'playlist' || request.playlist !== null) {
    const target = request.playlist ?? request.query;
    const result = await resolvePlaylistRequest(target, deps);
    if (result.outcome !== null) return result.outcome;
    collectedErrors.push(...result.errors);
  } else if (
    request.focusKind === 'album'
    || (request.album !== null && request.title === null)
  ) {
    const result = await resolveAlbumRequest(request, deps);
    if (result.outcome !== null) return result.outcome;
    collectedErrors.push(...result.errors);
  } else if (
    request.focusKind === 'artist'
    || (request.artist !== null && request.title === null && request.album === null)
  ) {
    const target = request.artist ?? request.query;
    const result = await resolveArtistRequest(target, deps);
    if (result.outcome !== null) return result.outcome;
    collectedErrors.push(...result.errors);
  } else if (
    request.focusKind === 'genre'
    || (request.genre !== null
      && request.title === null
      && request.artist === null
      && request.album === null)
  ) {
    const target = request.genre ?? request.query;
    const result = await resolveGenreRequest(target, deps);
    if (result.outcome !== null) return result.outcome;
    collectedErrors.push(...result.errors);
  }

  return resolveTrackOrUnstructuredRequest(request, deps, collectedErrors);
}
