import { queryOptions } from '@tanstack/react-query';
import { canonicalDeezerIds, normalizeSearchQuery, queryKeys, type QueryScope } from './queryKeys';
import { musicRepository, type MusicRepository } from './repositories';
import type { DeezerId, TrackPlayQuery } from '../api/types';

export const LYRICS_STALE_TIME_MS = 60 * 60_000;
export const SIMILAR_TRACKS_STALE_TIME_MS = 15 * 60_000;

/**
 * Pure option factory: screens can use these with useQuery, prefetchQuery, or
 * fetchQuery, and tests can inject a repository without mocking fetch.
 */
export function createMusicQueryOptions(repository: MusicRepository = musicRepository) {
  return {
    searchTracks(query: string) {
      const normalized = normalizeSearchQuery(query);
      return queryOptions({
        queryKey: queryKeys.search.tracks(normalized),
        queryFn: ({ signal }) => repository.searchTracks(normalized, signal),
        enabled: normalized.length > 0,
      });
    },
    searchAlbums(query: string) {
      const normalized = normalizeSearchQuery(query);
      return queryOptions({
        queryKey: queryKeys.search.albums(normalized),
        queryFn: ({ signal }) => repository.searchAlbums(normalized, signal),
        enabled: normalized.length > 0,
      });
    },
    searchArtists(query: string) {
      const normalized = normalizeSearchQuery(query);
      return queryOptions({
        queryKey: queryKeys.search.artists(normalized),
        queryFn: ({ signal }) => repository.searchArtists(normalized, signal),
        enabled: normalized.length > 0,
      });
    },
    searchPlaylists(query: string) {
      const normalized = normalizeSearchQuery(query);
      return queryOptions({
        queryKey: queryKeys.search.playlists(normalized),
        queryFn: ({ signal }) => repository.searchPlaylists(normalized, signal),
        enabled: normalized.length > 0,
      });
    },
    charts() {
      return queryOptions({
        queryKey: queryKeys.catalog.charts(),
        queryFn: ({ signal }) => repository.getCharts(signal),
      });
    },
    homeMixes(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.home.mixes(scope),
        queryFn: ({ signal }) => repository.getHomeMixes(signal),
      });
    },
    becauseYouListened(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.home.becauseYouListened(scope),
        queryFn: ({ signal }) => repository.getBecauseYouListened(signal),
      });
    },
    homeChartCollections() {
      return queryOptions({
        queryKey: queryKeys.home.chartCollections(),
        queryFn: ({ signal }) => repository.getHomeChartCollections(signal),
      });
    },
    releaseRadar(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.home.releaseRadar(scope),
        queryFn: ({ signal }) => repository.getReleaseRadar(signal),
      });
    },
    mood(tag: string) {
      const normalized = tag.trim();
      return queryOptions({
        queryKey: queryKeys.home.mood(normalized),
        queryFn: ({ signal }) => repository.getMood(normalized, signal),
      });
    },
    genres() {
      return queryOptions({
        queryKey: queryKeys.catalog.genres(),
        queryFn: ({ signal }) => repository.getGenres(signal),
      });
    },
    genre(id: DeezerId) {
      return queryOptions({
        queryKey: queryKeys.catalog.genre(id),
        queryFn: ({ signal }) => repository.getGenre(id, signal),
      });
    },
    newReleases() {
      return queryOptions({
        queryKey: queryKeys.catalog.newReleases(),
        queryFn: ({ signal }) => repository.getNewReleases(signal),
      });
    },
    track(id: DeezerId) {
      return queryOptions({
        queryKey: queryKeys.catalog.track(id),
        queryFn: ({ signal }) => repository.getTrack(id, signal),
      });
    },
    album(id: DeezerId) {
      return queryOptions({
        queryKey: queryKeys.catalog.album(id),
        queryFn: ({ signal }) => repository.getAlbum(id, signal),
      });
    },
    artist(id: DeezerId) {
      return queryOptions({
        queryKey: queryKeys.catalog.artist(id),
        queryFn: ({ signal }) => repository.getArtist(id, signal),
      });
    },
    artistAbout(name: string) {
      const normalized = name.trim();
      return queryOptions({
        queryKey: queryKeys.catalog.artistAbout(normalized),
        queryFn: ({ signal }) => repository.getArtistAbout(normalized, signal),
      });
    },
    similarTracks(seedId: DeezerId) {
      const normalizedSeedId = seedId.trim();
      return queryOptions({
        queryKey: queryKeys.radio.similar(normalizedSeedId),
        queryFn: ({ signal }) => repository.getRadio(normalizedSeedId, signal),
        staleTime: SIMILAR_TRACKS_STALE_TIME_MS,
      });
    },
    resolveExternalUrl(url: string) {
      const normalized = url.trim();
      return queryOptions({
        queryKey: queryKeys.external.resolve(normalized),
        queryFn: ({ signal }) => repository.resolveExternalUrl(normalized, signal),
      });
    },
    deezerPlaylist(id: DeezerId) {
      return queryOptions({
        queryKey: queryKeys.external.deezerPlaylist(id),
        queryFn: ({ signal }) => repository.getDeezerPlaylist(id, signal),
      });
    },
    lyrics(artist: string, title: string, deezerId?: DeezerId) {
      const normalizedArtist = artist.trim();
      const normalizedTitle = title.trim();
      return queryOptions({
        queryKey: queryKeys.lyrics(normalizedArtist, normalizedTitle, deezerId),
        queryFn: ({ signal }) =>
          repository.getLyrics(normalizedArtist, normalizedTitle, deezerId, signal),
        staleTime: LYRICS_STALE_TIME_MS,
        // Lyrics resolution can materialize/transcribe audio server-side. Never
        // repeat that expensive request invisibly; the UI exposes explicit Retry.
        retry: false,
      });
    },
    cachedTrackIds() {
      return queryOptions({
        queryKey: queryKeys.storage.cachedTrackIds(),
        queryFn: ({ signal }) => repository.getCachedTrackIds(signal),
      });
    },
    trackPlayCounts(tracks: readonly TrackPlayQuery[]) {
      const request = tracks.map((track) => ({ ...track }));
      return queryOptions({
        queryKey: queryKeys.plays.counts(request),
        queryFn: ({ signal }) => repository.getTrackPlayCounts(request, signal),
      });
    },
    playlists(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.playlists.owned(scope),
        queryFn: ({ signal }) => repository.getPlaylists(signal),
      });
    },
    publicPlaylists(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.playlists.public(scope),
        queryFn: ({ signal }) => repository.getPublicPlaylists(signal),
      });
    },
    playlist(scope: QueryScope, id: number) {
      return queryOptions({
        queryKey: queryKeys.playlists.detail(scope, id),
        queryFn: ({ signal }) => repository.getPlaylist(id, signal),
      });
    },
    likes(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.library.likes(scope),
        queryFn: ({ signal }) => repository.getLikes(signal),
      });
    },
    following(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.follows.artists(scope),
        queryFn: ({ signal }) => repository.getFollowingArtists(signal),
      });
    },
    followingContains(scope: QueryScope, ids: readonly DeezerId[]) {
      const canonicalIds = canonicalDeezerIds(ids);
      return queryOptions({
        queryKey: queryKeys.follows.contains(scope, canonicalIds),
        queryFn: ({ signal }) => repository.followingContains(canonicalIds, signal),
      });
    },
    publicProfile(userId: number) {
      return queryOptions({
        queryKey: queryKeys.profile.public(userId),
        queryFn: ({ signal }) => repository.getPublicProfile(userId, signal),
      });
    },
    stats(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.profile.stats(scope),
        queryFn: ({ signal }) => repository.getStats(signal),
      });
    },
    playbackSettings(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.profile.settings(scope),
        queryFn: ({ signal }) => repository.getPlaybackSettings(signal),
      });
    },
    party(scope: QueryScope, code: string) {
      const normalized = code.trim();
      return queryOptions({
        queryKey: queryKeys.party.state(scope, normalized),
        queryFn: ({ signal }) => repository.getParty(normalized, signal),
      });
    },
    adminUsers(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.admin.users(scope),
        queryFn: ({ signal }) => repository.getAdminUsers(signal),
      });
    },
    adminStatus(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.admin.status(scope),
        queryFn: ({ signal }) => repository.getAdminStatus(signal),
      });
    },
    adminStorage(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.admin.storage(scope),
        queryFn: ({ signal }) => repository.getAdminStorage(signal),
      });
    },
    adminInvites(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.admin.invites(scope),
        queryFn: ({ signal }) => repository.getAdminInvites(signal),
      });
    },
  };
}

export const musicQueries = createMusicQueryOptions();
