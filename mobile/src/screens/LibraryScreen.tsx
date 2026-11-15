import React, { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../api/types';
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
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { useOfflineDownloads } from '../offline/hooks';
import { playTracks } from '../player/controller';
import { colors, layout, spacing } from '../theme';
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
  const queryClient = useQueryClient();
  const bottomInset = useBottomInset();
  const playlists = useQuery(musicQueries.playlists(scope));
  const likes = useQuery(musicQueries.likes(scope));
  const stats = useQuery(musicQueries.stats(scope));
  const following = useQuery(musicQueries.following(scope));
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [refreshingAuto, setRefreshingAuto] = useState(false);
  const [recentPlaybackIndex, setRecentPlaybackIndex] = useState<number | null>(null);
  const recentPlaybackInFlight = useRef(false);
  const createForm = useCreatePlaylist(scope, (created) =>
    onOpenPlaylist({ kind: 'playlist', playlistId: created.id, name: created.name }),
  );

  const queries = [playlists, likes, stats, following];
  const refreshing = refreshingAuto || queries.some((query) => query.isFetching && !query.isPending);

  const refresh = () => {
    setRuntimeError(null);
    setRefreshingAuto(true);
    void refreshLibraryQueries(queries, refreshAutoBrowse)
      .finally(() => setRefreshingAuto(false));
  };

  const playLiked = (tracks: Track[], index: number) => {
    try {
      const selected = libraryPlaybackSelection(tracks, index);
      setRuntimeError(null);
      void playTracks(selected.tracks, selected.startIndex, {
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
  };

  const playRecent = (recent: readonly RecentPlay[], index: number) => {
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
      startPlayback: playTracks,
    })
      .catch((error) => setRuntimeError(playlistFailureMessage('playback', error)))
      .finally(() => {
        recentPlaybackInFlight.current = false;
        setRecentPlaybackIndex(null);
      });
  };

  const reportTrackActionFailure = (message: string) =>
    setRuntimeError(playlistFailureMessage('track-action', message));

  const likedTracks = likes.data ?? [];
  const recentTracks = stats.data?.recent ?? [];

  const presentations: LibrarySectionPresentations = {
    playlists: {
      title: libraryStrings.library.playlists,
      state: libraryQuerySectionState(playlists, playlists.data?.length === 0),
      emptyText: libraryStrings.library.noPlaylists,
      emptyHint: libraryStrings.library.noPlaylistsHint,
      emptyIcon: 'playlist-plus',
      emptyAction: (
        <ActionButton
          testID="library-empty-create-playlist"
          label={libraryStrings.library.createPlaylist}
          icon="plus"
          variant="secondary"
          onPress={createForm.open}
        />
      ),
      onRetry: () => void playlists.refetch(),
    },
    liked: {
      title: libraryStrings.library.likedTracks,
      state: libraryQuerySectionState(likes, likes.data?.length === 0),
      emptyText: libraryStrings.library.noLikes,
      emptyHint: libraryStrings.library.noLikesHint,
      emptyIcon: 'heart-outline',
      onRetry: () => void likes.refetch(),
    },
    recent: {
      title: libraryStrings.library.recentlyHeard,
      state: libraryQuerySectionState(stats, stats.data?.recent.length === 0),
      emptyText: libraryStrings.library.noRecent,
      emptyHint: libraryStrings.library.noRecentHint,
      emptyIcon: 'history',
      onRetry: () => void stats.refetch(),
    },
    downloads: {
      title: libraryStrings.library.downloads,
      state: LIBRARY_POLICY_SECTION_STATE,
    },
    following: {
      title: libraryStrings.library.following,
      state: libraryQuerySectionState(following, following.data?.length === 0),
      emptyText: libraryStrings.library.noFollowing,
      emptyHint: libraryStrings.library.noFollowingHint,
      emptyIcon: 'account-music',
      onRetry: () => void following.refetch(),
    },
  };

  const renderLibraryItem = (item: LibraryListItem) => {
    switch (item.kind) {
      case 'playlist':
        return (
          <LibraryPlaylistRow
            playlist={item.playlist}
            apiBase={apiBase}
            onOpenPlaylist={onOpenPlaylist}
          />
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
            apiBase={apiBase}
            onOpenPlaylist={onOpenPlaylist}
          />
        );
      case 'following-artist':
        return <LibraryFollowingRow artist={item.artist} onOpenArtist={onOpenArtist} />;
    }
  };

  return (
    <View testID="library-screen" style={styles.container}>
      <LibraryVirtualizedList
        collections={{
          playlists: playlists.data ?? [],
          likedTracks,
          recentTracks,
          following: following.data ?? [],
        }}
        presentations={presentations}
        filter={filter}
        previewCount={OVERVIEW_TRACK_PREVIEW}
        onShowSection={setFilter}
        refreshing={refreshing}
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
                  onPress={createForm.open}
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

      <LibraryCreatePlaylistSheet form={createForm} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listHeader: { gap: spacing.md },
  gutter: { marginHorizontal: layout.pagePadding },
});
