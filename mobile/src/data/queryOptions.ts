import { queryOptions } from '@tanstack/react-query';
import { ApiError } from '../api/error';
import { canonicalDeezerIds, normalizeSearchQuery, queryKeys, type QueryScope } from './queryKeys';
import { releaseRadarTracks } from './releaseRadar';
import { musicRepository, type MusicRepository } from './repositories';
import type {
  AdminUsageRange, DeezerId,
  ImportJobStatus,
  StatsInsightsRange,
  TrackPlayQuery,
} from '../api/types';
import type { LyricsLookupOptions } from '../api/endpoints';
import { readOfflineLyrics, saveOfflineLyrics } from '../offline/lyricsCache';
import { getOfflineSnapshot, trackIsExplicitlyDownloaded } from '../offline/registry';

/** How often the import list refreshes while an import is still working. */
export const IMPORT_JOB_POLL_MS = 1500;

export function isActiveImportJob(job: Pick<ImportJobStatus, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'running';
}

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
    personalMixes(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.home.personalMixes(scope),
        queryFn: ({ signal }) => {
          if (!repository.getPersonalMixes) {
            throw new Error('HomeRepository.getPersonalMixes is not configured');
          }
          return repository.getPersonalMixes(signal);
        },
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
    /**
     * The radar as plain tracks. Shares its cache entry and request with
     * `releaseRadarEntries`; use that one wherever the reason is shown.
     */
    releaseRadar(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.home.releaseRadar(scope),
        queryFn: ({ signal }) => repository.getReleaseRadar(signal),
        select: releaseRadarTracks,
      });
    },
    /** The radar with, per track, the watched artist and reason that put it there. */
    releaseRadarEntries(scope: QueryScope) {
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
    audioMeta(id: DeezerId) {
      return queryOptions({
        queryKey: queryKeys.catalog.audioMeta(id),
        queryFn: ({ signal }) => {
          if (!repository.getTrackAudioMeta) {
            throw new Error('CatalogRepository.getTrackAudioMeta is not configured');
          }
          return repository.getTrackAudioMeta(id, signal);
        },
        staleTime: LYRICS_STALE_TIME_MS,
        retry: false,
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
    /** The account's Spotify imports; polls while one is still working. */
    importJobs(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.external.importJobs(scope),
        queryFn: ({ signal }) => repository.getImportJobs(signal),
        staleTime: 0,
        refetchInterval: (query) =>
          query.state.data?.some(isActiveImportJob) ? IMPORT_JOB_POLL_MS : false,
      });
    },
    /** A finished import's result; it never changes again. */
    importJob(scope: QueryScope, id: string) {
      return queryOptions({
        queryKey: queryKeys.external.importJob(scope, id),
        queryFn: ({ signal }) => repository.getImportJob(id, signal),
        staleTime: Infinity,
      });
    },
    deezerPlaylist(id: DeezerId) {
      return queryOptions({
        queryKey: queryKeys.external.deezerPlaylist(id),
        queryFn: ({ signal }) => repository.getDeezerPlaylist(id, signal),
      });
    },
    lyrics(
      artist: string,
      title: string,
      deezerId?: DeezerId,
      variant?: 'default' | 'ai',
      options?: LyricsLookupOptions,
    ) {
      const normalizedArtist = artist.trim();
      const normalizedTitle = title.trim();
      return queryOptions({
        queryKey: queryKeys.lyrics(normalizedArtist, normalizedTitle, deezerId, variant),
        queryFn: async ({ signal }) => {
          const offlineScope = getOfflineSnapshot().scope;
          const cacheableOffline =
            deezerId !== undefined
            && offlineScope !== null
            && variant !== 'ai';
          const hasLookupOptions =
            options !== undefined
            && (
              (options.album !== undefined && options.album.trim().length > 0)
              || (options.durationSec !== undefined && options.durationSec > 0)
            );
          try {
            const response = hasLookupOptions
              ? await repository.getLyrics(
                  normalizedArtist,
                  normalizedTitle,
                  deezerId,
                  signal,
                  variant,
                  options,
                )
              : variant === undefined
                ? await repository.getLyrics(
                    normalizedArtist,
                    normalizedTitle,
                    deezerId,
                    signal,
                  )
                : await repository.getLyrics(
                    normalizedArtist,
                    normalizedTitle,
                    deezerId,
                    signal,
                    variant,
                  );
            if (cacheableOffline && trackIsExplicitlyDownloaded(deezerId)) {
              void saveOfflineLyrics(offlineScope, deezerId, response).catch((persistError: unknown) => {
                console.error('[LoggeRythm] Failed to cache offline lyrics:', persistError);
              });
            }
            return response;
          } catch (error) {
            const isAborted =
              signal?.aborted === true
              || (error instanceof Error && error.name === 'AbortError');
            const isAuthOrClientError =
              error instanceof ApiError
              && (
                error.status === 400
                || error.status === 401
                || error.status === 403
                || error.status === 404
              );
            if (cacheableOffline && !isAborted && !isAuthOrClientError) {
              try {
                const saved = await readOfflineLyrics(offlineScope, deezerId);
                if (saved !== null) return saved;
              } catch (cacheError) {
                console.error('[LoggeRythm] Failed to read offline lyrics cache:', cacheError);
              }
            }
            throw error;
          }
        },
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
    playlistOutgoingInvitations(scope: QueryScope, id: number) {
      return queryOptions({
        queryKey: queryKeys.playlists.outgoingInvitations(scope, id),
        queryFn: ({ signal }) => repository.getPlaylistOutgoingInvitations(id, signal),
        staleTime: 0,
      });
    },
    /** Disabled while `q` is blank; the endpoint itself rejects a blank query. */
    playlistInviteCandidates(scope: QueryScope, id: number, q: string) {
      const normalized = q.trim();
      return queryOptions({
        queryKey: queryKeys.playlists.inviteCandidates(scope, id, normalized),
        queryFn: ({ signal }) =>
          repository.searchPlaylistInviteCandidates(id, normalized, signal),
        enabled: normalized.length > 0,
        staleTime: 0,
      });
    },
    incomingPlaylistInvitations(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.playlists.incomingInvitations(scope),
        queryFn: ({ signal }) => repository.getMyPlaylistInvitations(signal),
        staleTime: 0,
      });
    },
    playlistDuplicates(scope: QueryScope, id: number) {
      return queryOptions({
        queryKey: queryKeys.playlists.duplicates(scope, id),
        queryFn: ({ signal }) => {
          if (!repository.getPlaylistDuplicates) {
            throw new Error('PlaylistsRepository.getPlaylistDuplicates is not configured');
          }
          return repository.getPlaylistDuplicates(id, signal);
        },
        staleTime: 0,
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
    statsInsights(scope: QueryScope, range: StatsInsightsRange) {
      return queryOptions({
        queryKey: queryKeys.profile.insights(scope, range),
        queryFn: ({ signal }) => {
          if (!repository.getStatsInsights) {
            throw new Error('ProfileRepository.getStatsInsights is not configured');
          }
          return repository.getStatsInsights(range, signal);
        },
      });
    },
    statsWrapped(scope: QueryScope, range: StatsInsightsRange) {
      return queryOptions({
        queryKey: queryKeys.profile.wrapped(scope, range),
        queryFn: ({ signal }) => {
          if (!repository.getStatsWrapped) {
            throw new Error('ProfileRepository.getStatsWrapped is not configured');
          }
          return repository.getStatsWrapped(range, signal);
        },
      });
    },
    socialActivity(scope: QueryScope) {
      return queryOptions({
        queryKey: queryKeys.social.activity(scope),
        queryFn: ({ signal }) => {
          if (!repository.getSocialActivity) {
            throw new Error('ProfileRepository.getSocialActivity is not configured');
          }
          return repository.getSocialActivity(signal);
        },
        staleTime: 10_000,
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
    adminUsage(scope: QueryScope, range: AdminUsageRange) {
      return queryOptions({
        queryKey: queryKeys.admin.usage(scope, range),
        queryFn: ({ signal }) => repository.getAdminUsage(range, signal),
      });
    },
    adminUserUsage(scope: QueryScope, userId: number, range: AdminUsageRange) {
      return queryOptions({
        queryKey: queryKeys.admin.userUsage(scope, userId, range),
        queryFn: ({ signal }) => repository.getAdminUserUsage(userId, range, signal),
      });
    },
  };
}

export const musicQueries = createMusicQueryOptions();
