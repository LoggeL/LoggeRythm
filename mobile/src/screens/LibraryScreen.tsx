import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtistSummary, PlaylistSummary, Track } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { refreshAutoBrowse } from '../components/library/autoBrowse';
import { InlineNotice } from '../components/library/InlineNotice';
import { LibraryCreatePlaylistSheet } from '../components/library/LibraryCreatePlaylistSheet';
import { LibraryDownloadsList } from '../components/library/LibraryDownloadsList';
import { LibraryFilterBar } from '../components/library/LibraryFilterBar';
import { LibraryRecentRow } from '../components/library/LibraryRecentRow';
import {
  LibraryFollowingRow,
  LibraryLikedCollectionCard,
  LibraryPlaylistRow,
} from '../components/library/LibraryRows';
import {
  LibraryVirtualizedList,
  type LibraryFilter,
  type LibraryListItem,
  type LibrarySectionPresentations,
} from '../components/library/LibraryVirtualizedList';
import {
  LIBRARY_POLICY_SECTION_STATE,
  libraryQuerySectionState,
  refreshLibraryQueries,
} from '../components/library/librarySectionState';
import { useCreatePlaylist } from '../components/library/useCreatePlaylist';
import StandardTrackRow from '../components/track/StandardTrackRow';
import { showTrackActions } from '../components/trackActions';
import { ActionButton, IconButton, ScreenHeader } from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import type { RecentPlay } from '../domain/listeningStats';
import { useBackHandler } from '../hooks/useBackHandler';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { useOfflineDownloads } from '../offline/hooks';
import { playTrackRow, type PlayTracksOptions } from '../player/controller';
import { colors, layout, radii, spacing } from '../theme';
import { TvFocusScope, tvFocusRegistry, useTvEnvironment, useTvFocusReturn } from '../tv';
import { startRecentlyHeardPlayback } from './homePlayback';
import {
  assertLibraryRouteCallbacks,
  libraryPlaybackSelection,
  libraryTestIdSegment,
  likedTrackOccurrence,
  recentPlayTrack,
  recentTrackOccurrence,
  type LibraryAlbumRouteParams,
  type LibraryArtistRouteParams,
  type LibraryRouteCallbacks,
} from './libraryModel';
import { libraryStrings } from './libraryStrings';
import {
  accountOfflineAvailability,
  accountOfflineDownloadedTracks,
  accountOfflinePlaylistSummaries,
} from './offlineScreenModel';
import { playlistFailureMessage } from './playlistFeedback';

export {
  LibraryDownloadsList,
  type LibraryDownloadsListProps,
} from '../components/library/LibraryDownloadsList';

export type LibraryScreenProps = LibraryRouteCallbacks;
export type {
  LibraryAlbumRouteParams,
  LibraryArtistRouteParams,
  LibraryPlaylistRouteParams,
  LikedPlaylistRouteParams,
  OwnedPlaylistRouteParams,
} from './libraryModel';

/** Liked and recent tracks shown per section in the "All" overview. */
const OVERVIEW_TRACK_PREVIEW = 5;
const EMPTY_PLAYLISTS: readonly PlaylistSummary[] = [];
const EMPTY_TRACKS: readonly Track[] = [];
const EMPTY_RECENT: readonly RecentPlay[] = [];
const EMPTY_ARTISTS: readonly ArtistSummary[] = [];

async function startRecentTrackRow(
  tracks: Track[],
  startIndex: number,
  options: PlayTracksOptions,
): Promise<void> {
  await playTrackRow(tracks, startIndex, options);
}

export function LibraryLikedTrackRow({
  track,
  index,
  accountId,
  onPlay,
  onActions,
  onOpenAlbum,
  onOpenArtist,
}: {
  track: Track;
  index: number;
  accountId: string | number;
  onPlay: () => void;
  onActions: () => void;
  onOpenAlbum: (params: LibraryAlbumRouteParams) => void;
  onOpenArtist: (params: LibraryArtistRouteParams) => void;
}) {
  const rowId = `library-liked-track-${libraryTestIdSegment(track.id)}-${index}`;
  return (
    <StandardTrackRow
      track={track}
      testID={rowId}
      occurrence={likedTrackOccurrence(accountId, index)}
      position={index + 1}
      onPlay={onPlay}
      onActions={onActions}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

export default function LibraryScreen(props: LibraryScreenProps) {
  assertLibraryRouteCallbacks(props);
  const { onOpenPlaylist, onOpenAlbum, onOpenArtist } = props;
  const { user } = useAuth();
  if (user === null) throw new Error('LibraryScreen requires an authenticated user');

  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const offlineSnapshot = useOfflineDownloads();
  const offlineAvailability = accountOfflineAvailability(offlineSnapshot, scope);
  const offlinePlaylists = accountOfflinePlaylistSummaries(offlineSnapshot, scope);
  const offlineTracks = useMemo(
    () => accountOfflineDownloadedTracks(offlineSnapshot, scope),
    [offlineSnapshot, scope],
  );
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const bottomInset = useBottomInset();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'library', active: isFocused, enabled: tv.isTv });
  const playlists = useQuery(musicQueries.playlists(scope));
  const likes = useQuery(musicQueries.likes(scope));
  const stats = useQuery(musicQueries.stats(scope));
  const following = useQuery(musicQueries.following(scope));
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [recentPlaybackIndex, setRecentPlaybackIndex] = useState<number | null>(null);
  const recentPlaybackInFlight = useRef(false);
  const createForm = useCreatePlaylist(scope, (created) =>
    onOpenPlaylist({ kind: 'playlist', playlistId: created.id, name: created.name }),
  );
  const openCreateSheet = useCallback(() => {
    if (tv.isTv) tvFocusRegistry.pushCheckpoint('library-create-playlist');
    createForm.open();
  }, [createForm, tv.isTv]);
  const createFormWithFocusReturn = useMemo(
    () => ({
      ...createForm,
      close: () => {
        createForm.close();
        if (tv.isTv) tvFocusRegistry.popAndRestore();
      },
    }),
    [createForm, tv.isTv],
  );

  // Android Back resets an active section filter back to "All" before leaving the tab.
  useBackHandler(isFocused && filter !== 'all' && !createForm.visible, () => {
    setFilter('all');
    return true;
  });

  // Explicit user pull-to-refresh state: background Like/Unlike refetches must
  // never drop Android's RefreshControl spinner.
  const refresh = useCallback(() => {
    setRuntimeError(null);
    setManualRefreshing(true);
    void refreshLibraryQueries([playlists, likes, stats, following], refreshAutoBrowse)
      .finally(() => setManualRefreshing(false));
  }, [following, likes, playlists, stats]);

  const playLiked = useCallback((tracks: readonly Track[], index: number) => {
    try {
      const selected = libraryPlaybackSelection([...tracks], index);
      setRuntimeError(null);
      void playTrackRow(selected.tracks, selected.startIndex, {
        context: {
          type: 'liked',
          id: String(user.id),
          label: strings.navigation.likedSongs,
        },
      }).catch((error) =>
        setRuntimeError(playlistFailureMessage('playback', error)),
      );
    } catch (error) {
      setRuntimeError(playlistFailureMessage('playback', error));
    }
  }, [user.id]);

  const playRecent = useCallback((recent: readonly RecentPlay[], index: number) => {
    if (recentPlaybackInFlight.current) return;
    recentPlaybackInFlight.current = true;
    setRecentPlaybackIndex(index);
    setRuntimeError(null);
    void startRecentlyHeardPlayback({
      recent,
      startIndex: index,
      contextId: user.id,
      contextLabel: strings.queue.recentContext,
      resolveTrack: (id) => queryClient.fetchQuery(musicQueries.track(id)),
      startPlayback: startRecentTrackRow,
    })
      .catch((error) => setRuntimeError(playlistFailureMessage('playback', error)))
      .finally(() => {
        recentPlaybackInFlight.current = false;
        setRecentPlaybackIndex(null);
      });
  }, [queryClient, user.id]);

  const playDownloadedTracks = useCallback((tracks: readonly Track[], index: number) => {
    try {
      const selected = libraryPlaybackSelection([...tracks], index);
      setRuntimeError(null);
      void playTrackRow(selected.tracks, selected.startIndex, {
        requireExplicitDownloads: true,
        context: {
          type: 'collection',
          id: 'downloads',
          label: libraryStrings.library.downloadedSongs,
        },
      }).catch((error) =>
        setRuntimeError(playlistFailureMessage('playback', error)),
      );
    } catch (error) {
      setRuntimeError(playlistFailureMessage('playback', error));
    }
  }, []);

  const reportTrackActionFailure = useCallback(
    (message: string) => setRuntimeError(playlistFailureMessage('track-action', message)),
    [],
  );

  const ownedPlaylists = playlists.data ?? EMPTY_PLAYLISTS;
  const likedTracks = likes.data ?? EMPTY_TRACKS;
  const recentTracks = stats.data?.recent ?? EMPTY_RECENT;
  const followedArtists = following.data ?? EMPTY_ARTISTS;

  const collections = useMemo(
    () => ({
      playlists: ownedPlaylists,
      likedTracks,
      recentTracks,
      following: followedArtists,
    }),
    [ownedPlaylists, likedTracks, recentTracks, followedArtists],
  );

  const {
    data: playlistsData,
    error: playlistsError,
    isPending: playlistsPending,
    isFetching: playlistsFetching,
    isStale: playlistsStale,
    fetchStatus: playlistsFetchStatus,
    refetch: refetchPlaylists,
  } = playlists;
  const {
    data: likesData,
    error: likesError,
    isPending: likesPending,
    isFetching: likesFetching,
    isStale: likesStale,
    fetchStatus: likesFetchStatus,
    refetch: refetchLikes,
  } = likes;
  const {
    data: statsData,
    error: statsError,
    isPending: statsPending,
    isFetching: statsFetching,
    isStale: statsStale,
    fetchStatus: statsFetchStatus,
    refetch: refetchStats,
  } = stats;
  const {
    data: followingData,
    error: followingError,
    isPending: followingPending,
    isFetching: followingFetching,
    isStale: followingStale,
    fetchStatus: followingFetchStatus,
    refetch: refetchFollowing,
  } = following;

  const playlistsPresentation = useMemo(
    () => ({
      title: libraryStrings.library.playlists,
      state: libraryQuerySectionState(
        {
          data: playlistsData,
          error: playlistsError,
          isPending: playlistsPending,
          isFetching: playlistsFetching,
          isStale: playlistsStale,
          fetchStatus: playlistsFetchStatus,
        },
        playlistsData?.length === 0,
      ),
      emptyText: libraryStrings.library.noPlaylists,
      emptyIcon: 'playlist-plus' as const,
      emptyAction: (
        <ActionButton
          testID="library-empty-create-playlist"
          label={libraryStrings.library.createPlaylist}
          icon="plus"
          variant="secondary"
          onPress={openCreateSheet}
        />
      ),
      onRetry: () => void refetchPlaylists(),
    }),
    [
      playlistsData,
      playlistsError,
      playlistsPending,
      playlistsFetching,
      playlistsStale,
      playlistsFetchStatus,
      refetchPlaylists,
      openCreateSheet,
    ],
  );
  const likedPresentation = useMemo(
    () => ({
      title: libraryStrings.library.likedTracks,
      state: libraryQuerySectionState(
        {
          data: likesData,
          error: likesError,
          isPending: likesPending,
          isFetching: likesFetching,
          isStale: likesStale,
          fetchStatus: likesFetchStatus,
        },
        likesData?.length === 0,
      ),
      emptyText: libraryStrings.library.noLikes,
      emptyHint: libraryStrings.library.noLikesHint,
      emptyIcon: 'heart-outline' as const,
      onRetry: () => void refetchLikes(),
    }),
    [
      likesData,
      likesError,
      likesPending,
      likesFetching,
      likesStale,
      likesFetchStatus,
      refetchLikes,
    ],
  );
  const recentPresentation = useMemo(
    () => ({
      title: libraryStrings.library.recentlyHeard,
      state: libraryQuerySectionState(
        {
          data: statsData,
          error: statsError,
          isPending: statsPending,
          isFetching: statsFetching,
          isStale: statsStale,
          fetchStatus: statsFetchStatus,
        },
        statsData?.recent.length === 0,
      ),
      emptyText: libraryStrings.library.noRecent,
      emptyIcon: 'history' as const,
      onRetry: () => void refetchStats(),
    }),
    [
      statsData,
      statsError,
      statsPending,
      statsFetching,
      statsStale,
      statsFetchStatus,
      refetchStats,
    ],
  );
  const downloadsPresentation = useMemo(
    () => ({
      title: libraryStrings.library.downloads,
      state: LIBRARY_POLICY_SECTION_STATE,
    }),
    [],
  );
  const followingPresentation = useMemo(
    () => ({
      title: libraryStrings.library.following,
      state: libraryQuerySectionState(
        {
          data: followingData,
          error: followingError,
          isPending: followingPending,
          isFetching: followingFetching,
          isStale: followingStale,
          fetchStatus: followingFetchStatus,
        },
        followingData?.length === 0,
      ),
      emptyText: libraryStrings.library.noFollowing,
      emptyHint: libraryStrings.library.noFollowingHint,
      emptyIcon: 'account-music' as const,
      onRetry: () => void refetchFollowing(),
    }),
    [
      followingData,
      followingError,
      followingPending,
      followingFetching,
      followingStale,
      followingFetchStatus,
      refetchFollowing,
    ],
  );
  const presentations: LibrarySectionPresentations = useMemo(
    () => ({
      playlists: playlistsPresentation,
      liked: likedPresentation,
      recent: recentPresentation,
      downloads: downloadsPresentation,
      following: followingPresentation,
    }),
    [
      playlistsPresentation,
      likedPresentation,
      recentPresentation,
      downloadsPresentation,
      followingPresentation,
    ],
  );

  // Horizontal playlist/artist cards need ~290dp+ width on 16:9 TVs so titles stay readable at 10 feet.
  const tvGridColumns = tv.isTv ? Math.min(tv.gridColumns, 2) : 1;

  const renderLibraryItem = useCallback((item: LibraryListItem) => {
    switch (item.kind) {
      case 'playlist':
        return (
          <LibraryPlaylistRow
            playlist={item.playlist}
            apiBase={apiBase}
            onOpenPlaylist={onOpenPlaylist}
          />
        );
      case 'playlist-row':
        return (
          <View style={[styles.tvGridRow, { gap: tv.gridGap, paddingHorizontal: tv.contentPaddingHorizontal }]}>
            {item.playlists.map((playlist) => (
              <View key={playlist.id} style={styles.tvGridCell}>
                <LibraryPlaylistRow
                  playlist={playlist}
                  apiBase={apiBase}
                  onOpenPlaylist={onOpenPlaylist}
                  style={styles.tvGridCard}
                />
              </View>
            ))}
            {Array.from({ length: Math.max(0, tvGridColumns - item.playlists.length) }, (_, idx) => (
              <View key={`spacer-${idx}`} style={styles.tvGridCell} />
            ))}
          </View>
        );
      case 'liked-collection':
        return (
          <LibraryLikedCollectionCard count={likedTracks.length} onOpenPlaylist={onOpenPlaylist} />
        );
      case 'liked-track':
        return (
          <LibraryLikedTrackRow
            track={item.track}
            index={item.index}
            accountId={user.id}
            onPlay={() => playLiked(likedTracks, item.index)}
            onActions={() => showTrackActions(item.track, reportTrackActionFailure)}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
          />
        );
      case 'recent-track':
        return (
          <LibraryRecentRow
            play={item.play}
            index={item.index}
            testID={`library-recent-track-${libraryTestIdSegment(item.play.id)}-${item.index}`}
            occurrence={recentTrackOccurrence(user.id, item.index)}
            busy={recentPlaybackIndex === item.index}
            disabled={recentPlaybackIndex !== null}
            onPlay={() => playRecent(recentTracks, item.index)}
            onActions={() =>
              showTrackActions(recentPlayTrack(item.play), reportTrackActionFailure)
            }
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
          />
        );
      case 'downloads-policy':
        return (
          <LibraryDownloadsList
            availability={offlineAvailability}
            playlists={offlinePlaylists}
            tracks={offlineTracks}
            apiBase={apiBase}
            onOpenPlaylist={onOpenPlaylist}
            onPlayTrack={playDownloadedTracks}
            onOpenTrackActions={(track) => showTrackActions(track, reportTrackActionFailure)}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
          />
        );
      case 'following-artist':
        return <LibraryFollowingRow artist={item.artist} onOpenArtist={onOpenArtist} />;
      case 'following-row':
        return (
          <View style={[styles.tvGridRow, { gap: tv.gridGap, paddingHorizontal: tv.contentPaddingHorizontal }]}>
            {item.artists.map((artist) => (
              <View key={artist.id} style={styles.tvGridCell}>
                <LibraryFollowingRow
                  artist={artist}
                  onOpenArtist={onOpenArtist}
                  style={styles.tvGridCard}
                />
              </View>
            ))}
            {Array.from({ length: Math.max(0, tvGridColumns - item.artists.length) }, (_, idx) => (
              <View key={`spacer-${idx}`} style={styles.tvGridCell} />
            ))}
          </View>
        );
    }
  }, [
    apiBase,
    likedTracks,
    offlineAvailability,
    offlinePlaylists,
    offlineTracks,
    onOpenAlbum,
    onOpenArtist,
    onOpenPlaylist,
    playDownloadedTracks,
    playLiked,
    playRecent,
    recentPlaybackIndex,
    recentTracks,
    reportTrackActionFailure,
    tv.contentPaddingHorizontal,
    tv.gridGap,
    tvGridColumns,
    user.id,
  ]);

  return (
    <TvFocusScope scope="library">
      <View testID="library-screen" style={styles.container}>
        <LibraryVirtualizedList
          collections={collections}
          presentations={presentations}
          filter={filter}
          previewCount={OVERVIEW_TRACK_PREVIEW}
          gridColumns={tvGridColumns}
          onShowSection={setFilter}
          refreshing={manualRefreshing}
          onRefresh={refresh}
          bottomInset={bottomInset}
          header={
            <View style={styles.listHeader}>
              <ScreenHeader
                titleTestID="library-title"
                title={libraryStrings.library.title}
                style={styles.gutter}
                action={
                  <IconButton
                    testID="library-create-playlist"
                    icon="plus"
                    variant="filled"
                    accessibilityLabel={libraryStrings.library.createPlaylist}
                    onPress={openCreateSheet}
                  />
                }
              />
              <LibraryFilterBar filter={filter} onChange={setFilter} />
              {runtimeError !== null ? (
                <InlineNotice
                  testID="library-runtime-error"
                  tone="danger"
                  live="assertive"
                  message={runtimeError}
                  style={styles.gutter}
                />
              ) : null}
            </View>
          }
          renderItem={renderLibraryItem}
        />

        <LibraryCreatePlaylistSheet form={createFormWithFocusReturn} />
      </View>
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listHeader: { gap: spacing.md },
  gutter: { marginHorizontal: layout.pagePadding },
  tvGridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: spacing.sm,
  },
  tvGridCell: { flex: 1, minWidth: 0 },
  tvGridCard: {
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
