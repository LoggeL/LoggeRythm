import React, { useCallback, useMemo, useState } from 'react';
import { Animated, FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { playlistEntryId, type Playlist, type Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { InlineNotice } from '../components/library/InlineNotice';
import { PlaylistActionsSheet } from '../components/library/PlaylistActionsSheet';
import { PlaylistCollaboratorsSheet } from '../components/library/PlaylistCollaboratorsSheet';
import { PlaylistDeleteSheet } from '../components/library/PlaylistDeleteSheet';
import { PlaylistDuplicatesSheet } from '../components/library/PlaylistDuplicatesSheet';
import { PlaylistEditSheet, usePlaylistEditForm } from '../components/library/PlaylistEditSheet';
import { PlaylistHero } from '../components/library/PlaylistHero';
import {
  PlaylistFilterSortBar,
  filterAndSortPlaylistTracks,
  type IndexedPlaylistTrack,
  type PlaylistSortKey,
} from '../components/library/PlaylistFilterSortBar';
import { PlaylistLeaveSheet } from '../components/library/PlaylistLeaveSheet';
import { PlaylistLiveSyncBanner } from '../components/library/PlaylistLiveSyncBanner';
import { PlaylistQuickAddSheet } from '../components/library/PlaylistQuickAddSheet';
import {
  PlaylistQueryGate,
  PlaylistQueryNotice,
  resolvePlaylistRemoteVisualState,
} from '../components/library/PlaylistRemoteStates';
import { PlaylistTrackRow } from '../components/library/PlaylistTrackRow';
import { usePlaylistMutations } from '../components/library/usePlaylistMutations';
import { usePlaylistOffline } from '../components/library/usePlaylistOffline';
import type { OfflinePlaylistControlCopy } from '../components/offline/OfflinePlaylistControl';
import { showTrackActions } from '../components/trackActions';
import { ActionButton, AppText, EmptyState, TrackRowSkeleton } from '../components/ui';
import { getCurrentApiBase } from '../config';
import { findCachedPlaylistSummary, musicCacheScope, musicQueries, musicRepository } from '../data';
import { wave2Strings } from '../localization/wave2Strings';
import { useBackHandler } from '../hooks/useBackHandler';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { useOfflineDownloads } from '../offline/hooks';
import { useTrackCollectionOffline } from '../offline/useTrackCollectionOffline';
import { playTrackRow, playTracks, toggleShuffle } from '../player/controller';
import { sharePlaylist } from '../share/outboundShare';
import { colors, elevation, layout, radii, spacing } from '../theme';
import { TvFocusScope, tvFocusRegistry, useTvEnvironment, useTvFocusReturn } from '../tv';
import {
  assertPlaylistScreenContract,
  libraryPlaybackSelection,
  likedTrackOccurrence,
  playlistTrackOccurrence,
  reorderedPlaylistEntryIds,
  reorderedPlaylistEntryIdsByMove,
  type PlaylistScreenContract,
  type TrackMoveDirection,
} from './libraryModel';
import { useQueueDrag } from './useQueueDrag';
import { libraryStrings } from './libraryStrings';
import {
  accountOfflinePlaylistDetail,
  firstDownloadedOccurrenceIndex,
  localPlaylistPlaybackSelection,
  offlineRetryAction,
  playlistOfflineControlState,
  playlistScreenPlaybackOptions,
  type OfflineScreenFailure,
} from './offlineScreenModel';
import { playlistFailureMessage } from './playlistFeedback';

export { PlaylistTrackRow } from '../components/library/PlaylistTrackRow';
export { refreshOfflineAutoBrowse } from '../components/library/autoBrowse';

export type PlaylistScreenProps = PlaylistScreenContract;

type PlaylistSheet = 'actions' | 'delete' | 'collaborators' | 'leave' | 'quick-add' | 'duplicates' | null;
const EMPTY_TRACKS: Track[] = [];

export function playlistTrackAddedByLabel(
  track: Pick<Track, 'added_by'>,
  currentUserId: number,
): string | undefined {
  const addedBy = track.added_by;
  if (addedBy === undefined || addedBy === null) return undefined;
  if (addedBy.id === currentUserId) return libraryStrings.playlist.addedByYou;
  const displayName = addedBy.display_name?.trim() || libraryStrings.playlist.unknownUser;
  return libraryStrings.playlist.addedBy(displayName);
}

export function shouldShowPlaylistTrackAttribution(
  detail: Pick<
    Playlist,
    'is_collaborative' | 'collaborator_count' | 'is_collaborator' | 'owner_id' | 'tracks'
  >,
): boolean {
  if (detail.is_collaborative || detail.collaborator_count > 0 || detail.is_collaborator) {
    return true;
  }
  if (detail.owner_id === null) return false;
  return detail.tracks.some(
    (track) =>
      track.added_by !== undefined
      && track.added_by !== null
      && track.added_by.id !== detail.owner_id,
  );
}

export function offlineControlCopy(
  failure: OfflineScreenFailure,
): OfflinePlaylistControlCopy {
  return {
    unavailable: libraryStrings.playlist.offlineUnavailable,
    idle: libraryStrings.playlist.offlineIdle,
    downloading: ({ completedTracks, totalTracks }) =>
      libraryStrings.playlist.offlineDownloading(completedTracks, totalTracks),
    partial: ({ completedTracks, totalTracks, failedTracks }) =>
      libraryStrings.playlist.offlinePartial(completedTracks, totalTracks, failedTracks),
    downloaded: ({ completedTracks, totalTracks }) =>
      libraryStrings.playlist.offlineDownloaded(completedTracks, totalTracks),
    removing: ({ completedTracks, totalTracks }) =>
      libraryStrings.playlist.offlineRemoving(completedTracks, totalTracks),
    error: ({ completedTracks }) => failure === 'remove'
      ? libraryStrings.playlist.offlineRemoveError
      : failure === 'wifi-required'
        ? strings.profile.wifiRequiredError
        : libraryStrings.playlist.offlineError(completedTracks),
    progress: ({ percent }) => libraryStrings.playlist.offlineProgress(percent),
    downloadAction: libraryStrings.playlist.downloadAction,
    downloadingAction: libraryStrings.playlist.downloadingAction,
    retryAction: libraryStrings.playlist.retryDownloadAction,
    removeAction: libraryStrings.playlist.removeDownloadAction,
    removingAction: libraryStrings.playlist.removingDownloadAction,
  };
}

export default function PlaylistScreen(props: PlaylistScreenProps) {
  assertPlaylistScreenContract(props);
  const { user } = useAuth();
  if (user === null) throw new Error('PlaylistScreen requires an authenticated user');

  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const offlineSnapshot = useOfflineDownloads();
  const bottomInset = useBottomInset();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope: 'playlist', active: isFocused, enabled: tv.isTv });
  const playlistId = props.kind === 'playlist' ? props.playlistId : 1;
  const likedQuery = useQuery({
    ...musicQueries.likes(scope),
    enabled: props.kind === 'liked',
  });
  const playlistQuery = useQuery({
    ...musicQueries.playlist(scope, playlistId),
    enabled: props.kind === 'playlist',
  });
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<PlaylistSheet>(null);
  const [reordering, setReordering] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [sortKey, setSortKey] = useState<PlaylistSortKey>('custom');
  const mutations = usePlaylistMutations(scope, { onDeleted: props.onDeleted });
  const editForm = usePlaylistEditForm(mutations.update);

  // Android Back exits reorder mode cleanly before popping PlaylistScreen.
  useBackHandler(isFocused && reordering && sheet === null && !editForm.visible, () => {
    setReordering(false);
    return true;
  });

  const remoteDetail = props.kind === 'playlist' ? playlistQuery.data : undefined;
  const seededSummary =
    props.kind === 'playlist' && remoteDetail === undefined
      ? findCachedPlaylistSummary(queryClient, scope, props.playlistId)
      : null;
  const offlineDetail = props.kind === 'playlist'
    ? accountOfflinePlaylistDetail(offlineSnapshot, scope, props.playlistId)
    : null;
  const offline = usePlaylistOffline(
    scope,
    props.kind === 'playlist' ? props.playlistId : null,
    remoteDetail ?? offlineDetail?.playlist,
  );
  const localFallback = props.kind === 'playlist'
    && remoteDetail === undefined
    && offlineDetail !== null;
  const detail = remoteDetail ?? offlineDetail?.playlist;
  const remoteTracks = props.kind === 'liked'
    ? (likedQuery.data ?? EMPTY_TRACKS)
    : (remoteDetail?.tracks ?? EMPTY_TRACKS);
  const tracks = props.kind === 'liked' ? remoteTracks : (detail?.tracks ?? EMPTY_TRACKS);
  const likedOffline = useTrackCollectionOffline({
    scope: props.kind === 'liked' ? scope : null,
    jobId: props.kind === 'liked' ? (remoteTracks[0]?.id ?? null) : null,
    tracks: props.kind === 'liked' ? remoteTracks : EMPTY_TRACKS,
    downloadFailedMessage: libraryStrings.playlist.collectionDownloadFailed,
    removeFailedMessage: libraryStrings.playlist.collectionRemoveFailed,
    onError: setRuntimeError,
  });
  const query = props.kind === 'liked' ? likedQuery : playlistQuery;
  const queryVisual = resolvePlaylistRemoteVisualState({
    hasData: props.kind === 'liked' ? likedQuery.data !== undefined : remoteDetail !== undefined,
    empty: remoteTracks.length === 0,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isStale: query.isStale,
    fetchStatus: query.fetchStatus,
    error: query.error,
  });
  const queryRetryBusy = query.fetchStatus === 'fetching';
  const refetch = useCallback(() => void query.refetch(), [query]);
  // Track explicit user pull-to-refresh so Like/Unlike refetches never drop Android's RefreshControl spinner.
  const pullToRefresh = useCallback(() => {
    setManualRefreshing(true);
    void query.refetch().finally(() => setManualRefreshing(false));
  }, [query]);
  const isTv = tv.isTv;
  const openSheet = (next: PlaylistSheet) => {
    if (next !== null && isTv) tvFocusRegistry.pushCheckpoint(`playlist-sheet-${next}`);
    setSheet(next);
  };
  const closeSheet = () => {
    setSheet(null);
    if (isTv) tvFocusRegistry.popAndRestore();
  };
  const editFormWithFocusReturn = {
    ...editForm,
    close: () => {
      editForm.close();
      if (isTv) tvFocusRegistry.popAndRestore();
    },
  };
  const isOwner = props.kind === 'playlist' && remoteDetail?.is_owner === true;
  const isCollaborator = props.kind === 'playlist' && remoteDetail?.is_collaborator === true;
  const canEditTracks = props.kind === 'playlist' && remoteDetail?.can_edit_tracks === true;
  const isFrozenCollaborator =
    !isOwner && isCollaborator && remoteDetail?.is_collaborative === false;
  const offlineControlState = props.kind === 'playlist'
    ? playlistOfflineControlState({
        snapshot: offlineSnapshot,
        accountScope: scope,
        playlistId: props.playlistId,
        sourceTrackCount: detail?.tracks.length ?? 0,
        operation: offline.operation,
        actionFailure: offline.failure,
      })
    : null;
  const firstLocalPlaybackIndex = localFallback && offlineDetail !== null
    ? firstDownloadedOccurrenceIndex(offlineDetail)
    : 0;

  const startPlayback = async (
    index: number,
    shuffle: boolean,
    mode: 'context' | 'row',
  ): Promise<void> => {
    const selected = localFallback && offlineDetail !== null
      ? localPlaylistPlaybackSelection(offlineDetail, index)
      : libraryPlaybackSelection(tracks, index);
    if (selected === null || offlineControlState?.kind === 'removing') {
      setRuntimeError(libraryStrings.playlist.localTrackUnavailable);
      return;
    }
    const context =
      props.kind === 'liked'
        ? ({
            type: 'liked',
            id: String(user.id),
            label: strings.navigation.likedSongs,
          } as const)
        : ({
            type: 'playlist',
            id: String(props.playlistId),
            label: detail?.name ?? seededSummary?.name ?? props.name,
          } as const);
    setRuntimeError(null);
    const playbackOptions = playlistScreenPlaybackOptions(context, localFallback);
    if (mode === 'row' && !shuffle) {
      await playTrackRow(selected.tracks, selected.startIndex, playbackOptions);
      return;
    }
    await playTracks(selected.tracks, selected.startIndex, playbackOptions);
    // Product shuffle reorders the upcoming context items of the queue that
    // was just started; it is the same switch the player screen toggles.
    if (shuffle) await toggleShuffle();
  };

  const playContext = (index: number, shuffle = false) => {
    startPlayback(index, shuffle, 'context').catch((error: unknown) =>
      setRuntimeError(playlistFailureMessage('playback', error)),
    );
  };

  const playRow = (index: number) => {
    startPlayback(index, false, 'row').catch((error: unknown) =>
      setRuntimeError(playlistFailureMessage('playback', error)),
    );
  };

  const changeVisibility = (isPublic: boolean) => {
    if (props.kind !== 'playlist' || !isOwner) return;
    mutations.resetErrors();
    mutations.visibility.mutate({ id: props.playlistId, isPublic });
  };

  const changeCollaborative = (isCollaborative: boolean) => {
    if (props.kind !== 'playlist' || !isOwner) return;
    mutations.resetErrors();
    mutations.collaborative.mutate({ id: props.playlistId, isCollaborative });
  };

  const removeTrack = async (track: Track): Promise<void> => {
    if (props.kind !== 'playlist' || !canEditTracks) {
      throw new Error(libraryStrings.playlist.ownerOnly);
    }
    mutations.resetErrors();
    await mutations.removeTrack.mutateAsync({
      id: props.playlistId,
      entryId: playlistEntryId(track),
    });
  };

  const openTrackActions = (track: Track) => {
    showTrackActions(
      track,
      (message) => setRuntimeError(playlistFailureMessage('track-action', message)),
      canEditTracks && props.kind === 'playlist'
        ? {
            authorizedRemove: {
              accountScope: scope,
              onRemove: () => removeTrack(track),
            },
          }
        : undefined,
    );
  };

  const moveTrack = (index: number, direction: TrackMoveDirection) => {
    if (props.kind !== 'playlist' || !canEditTracks) return;
    mutations.resetErrors();
    try {
      mutations.reorder.mutate({
        id: props.playlistId,
        entryIds: reorderedPlaylistEntryIds(tracks, index, direction),
      });
    } catch (error) {
      setRuntimeError(playlistFailureMessage('mutation', error));
    }
  };

  const moveTrackByDrag = (fromIndex: number, toIndex: number) => {
    if (props.kind !== 'playlist' || !canEditTracks) return;
    mutations.resetErrors();
    try {
      mutations.reorder.mutate({
        id: props.playlistId,
        entryIds: reorderedPlaylistEntryIdsByMove(tracks, fromIndex, toIndex),
      });
    } catch (error) {
      setRuntimeError(playlistFailureMessage('mutation', error));
    }
  };

  const keyExtractor = useCallback(
    (track: Track, index: number) =>
      props.kind === 'playlist' && track.playlist_entry_id !== undefined
        ? `playlist-entry-${String(playlistEntryId(track))}`
        : `${props.kind}-track-${track.id}-${String(index)}`,
    [props.kind],
  );

  const dragRows = tracks.map((track, index) => ({
    stableId: keyExtractor(track, index),
    origin: 'context' as const,
  }));
  const activeFilterQuery = reordering ? '' : filterQuery;
  const activeSortKey: PlaylistSortKey = reordering ? 'custom' : sortKey;
  const displayedTracks: IndexedPlaylistTrack[] = filterAndSortPlaylistTracks(
    tracks,
    activeFilterQuery,
    activeSortKey,
  );
  const existingTrackIds = new Set(tracks.map((track) => track.id));
  const toggleReordering = () => {
    setReordering((current) => {
      const next = !current;
      if (next) {
        setFilterQuery('');
        setSortKey('custom');
      }
      return next;
    });
  };

  // Take ref callbacks out of the drag controller so passing `attachFrame` to
  // `ref` does not mark the entire controller object as a ref for the hooks linter.
  const { attachFrame, attachList, attachRow, ...drag } = useQueueDrag({
    rows: dragRows,
    activeIndex: null,
    disabled: !(canEditTracks && reordering) || mutations.pending || tv.isTv,
    onDrop: moveTrackByDrag,
    onTap: () => undefined,
  });

  const seededInitialLoading =
    !localFallback
    && queryVisual.body === 'loading'
    && (props.kind === 'liked' || seededSummary !== null);

  const listContentStyle = useMemo(
    () => ({ paddingBottom: bottomInset }),
    [bottomInset],
  );

  if (
    !localFallback
    && (
      queryVisual.body === 'offline'
      || queryVisual.body === 'hard-error'
      || (queryVisual.body === 'loading' && !seededInitialLoading)
    )
  ) {
    return (
      <PlaylistQueryGate
        visual={queryVisual}
        retryBusy={queryRetryBusy}
        onRetry={refetch}
      />
    );
  }

  const title = detail?.name ?? seededSummary?.name ?? props.name;
  const rawCoverUrl = detail?.cover_url ?? seededSummary?.cover_url ?? null;
  const coverUrl =
    rawCoverUrl === null || rawCoverUrl === undefined
      ? null
      : resolveServerUrl(rawCoverUrl, apiBase);
  const ownerName = detail?.owner_name ?? seededSummary?.owner_name ?? null;
  const description = detail?.description ?? seededSummary?.description ?? null;
  const trackCount = detail !== undefined || props.kind === 'liked'
    ? (seededInitialLoading && props.kind === 'liked' ? null : tracks.length)
    : (seededSummary?.track_count ?? null);
  const playable = !seededInitialLoading && tracks.length > 0 && (!localFallback || firstLocalPlaybackIndex >= 0);
  const showRowControls = canEditTracks && reordering;
  const isCollaborative = detail?.is_collaborative ?? seededSummary?.is_collaborative ?? false;
  const showTrackAttribution =
    props.kind === 'playlist'
    && detail !== undefined
    && shouldShowPlaylistTrackAttribution(detail);
  // The delete and leave sheets own the failure of their own requests; every
  // other mutation failure is shown in the header.
  const headerMutationError =
    sheet === 'delete' || sheet === 'leave' ? null : mutations.error;

  const heroCollaborators =
    props.kind === 'playlist' && remoteDetail !== undefined && (remoteDetail.is_collaborative || remoteDetail.collaborators.length > 0)
      ? {
          owner: {
            key: `owner-${remoteDetail.owner_id ?? '0'}`,
            name: remoteDetail.owner_name,
            avatarUrl:
              remoteDetail.owner_avatar_url === null
                ? null
                : resolveServerUrl(remoteDetail.owner_avatar_url, apiBase),
          },
          members: remoteDetail.collaborators.map((member) => ({
            key: `member-${member.user_id}`,
            name: member.display_name,
            avatarUrl:
              member.avatar_url === null ? null : resolveServerUrl(member.avatar_url, apiBase),
          })),
          onPress:
            isOwner || isCollaborator
              ? () => {
                  mutations.resetErrors();
                  openSheet('collaborators');
                }
              : undefined,
        }
      : null;

  const liveSyncEnabled =
    props.kind === 'playlist'
    && remoteDetail !== undefined
    && (isCollaborative || isCollaborator || remoteDetail.collaborators.length > 0);

  const heroHeaderContent = (
    <View style={tv.isTv ? styles.tvHeroHeader : styles.header}>
      {liveSyncEnabled && props.kind === 'playlist' && remoteDetail !== undefined ? (
        <PlaylistLiveSyncBanner
          playlistId={props.playlistId}
          scope={scope}
          currentRevision={remoteDetail.revision}
          focused={isFocused}
          isCollaborative={liveSyncEnabled}
          onExit={props.onDeleted}
        />
      ) : null}
      <PlaylistHero
        title={title}
        coverUrl={coverUrl}
        liked={props.kind === 'liked'}
        ownerName={ownerName}
        onOpenOwner={
          props.kind === 'playlist'
          && detail?.owner_id !== null
          && detail?.owner_id !== undefined
          && props.onOpenUser !== undefined
            ? () => props.onOpenUser?.({
                userId: detail.owner_id!,
                name: ownerName ?? undefined,
              })
            : undefined
        }
        trackCount={trackCount}
        durationSeconds={tracks.reduce((total, track) => total + track.duration_sec, 0)}
        visibility={
          isOwner && remoteDetail !== undefined
            ? (remoteDetail.is_public ? 'public' : 'private')
            : null
        }
        collaborative={props.kind === 'playlist' && isCollaborative}
        collaborators={heroCollaborators}
        description={description}
        playable={playable}
        preferredPlayFocus={tv.isTv && isFocused && playable}
        onPlay={() => playContext(firstLocalPlaybackIndex)}
        onShuffle={() => playContext(firstLocalPlaybackIndex, true)}
        reorder={
          tv.isTv && canEditTracks && tracks.length > 0
            ? {
                active: reordering,
                disabled: mutations.pending,
                onPress: toggleReordering,
              }
            : null
        }
        download={
          props.kind === 'liked'
            ? {
                kind: likedOffline.phase,
                accessibilityLabel:
                  likedOffline.phase === 'downloaded'
                    ? libraryStrings.playlist.removeCollectionDownloads
                    : libraryStrings.playlist.downloadCollection,
                disabled: tracks.length === 0 || likedOffline.busy,
                onPress:
                  likedOffline.phase === 'downloaded'
                    ? likedOffline.removeAll
                    : likedOffline.downloadAll,
              }
            : offlineControlState === null || detail === undefined
              ? null
              : {
                  kind: offlineControlState.kind,
                  accessibilityLabel: offlineControlState.kind === 'idle'
                    ? libraryStrings.playlist.downloadAction
                    : libraryStrings.playlist.downloadStatus,
                  disabled: offlineControlState.kind === 'idle' && tracks.length === 0,
                  onPress: offlineControlState.kind === 'idle'
                    ? offline.download
                    : () => openSheet('actions'),
                }
        }
        onOpenActions={
          props.kind === 'playlist' && detail !== undefined
            ? () => openSheet('actions')
            : undefined
        }
      />

      {isFrozenCollaborator ? (
        <InlineNotice
          testID="playlist-frozen-banner"
          message={libraryStrings.playlist.frozenNotice}
        />
      ) : null}

      {runtimeError !== null ? (
        <InlineNotice
          testID="playlist-runtime-error"
          tone="danger"
          live="assertive"
          message={runtimeError}
        />
      ) : null}

      {offline.failure === 'wifi-required' ? (
        <InlineNotice
          testID="playlist-wifi-required-error"
          tone="danger"
          live="assertive"
          message={strings.profile.wifiRequiredError}
        />
      ) : null}

      {headerMutationError !== null ? (
        <InlineNotice
          testID="playlist-mutation-error"
          tone="danger"
          live="assertive"
          message={playlistFailureMessage('mutation', headerMutationError)}
        />
      ) : null}

      {localFallback ? (
        <InlineNotice
          testID="playlist-local-copy"
          message={libraryStrings.playlist.localCopy}
          retry={{
            testID: 'playlist-local-copy-retry',
            accessibilityLabel: libraryStrings.common.retry,
            busy: queryRetryBusy,
            onRetry: refetch,
          }}
        />
      ) : (
        <PlaylistQueryNotice
          visual={queryVisual}
          retryBusy={queryRetryBusy}
          onRetry={refetch}
          // The list's own pull-to-refresh spinner reports a refetch.
          refreshIndicator={false}
        />
      )}

      {!showRowControls && !seededInitialLoading && (tracks.length > 0 || (props.kind === 'playlist' && canEditTracks)) ? (
        <PlaylistFilterSortBar
          query={filterQuery}
          onChangeQuery={setFilterQuery}
          sort={sortKey}
          onChangeSort={setSortKey}
          canQuickAdd={props.kind === 'playlist' && canEditTracks}
          onOpenQuickAdd={
            props.kind === 'playlist' && canEditTracks
              ? () => openSheet('quick-add')
              : undefined
          }
        />
      ) : null}

      {showRowControls ? (
        <View testID="playlist-reorder-bar" style={styles.reorderBar}>
          <AppText variant="callout" color="accent" style={styles.reorderCopy}>
            {libraryStrings.playlist.reorderActive}
          </AppText>
          <ActionButton
            testID="playlist-reorder-done"
            label={libraryStrings.playlist.reorderDone}
            icon="check"
            variant="secondary"
            onPress={() => setReordering(false)}
          />
        </View>
      ) : null}

      {mutations.pending ? (
        <AppText
          testID="playlist-mutation-pending"
          accessibilityLiveRegion="polite"
          variant="caption"
          color="muted"
          align="center"
        >
          {libraryStrings.playlist.mutationInProgress}
        </AppText>
      ) : null}
    </View>
  );

  const emptyOrLoading = seededInitialLoading ? (
    <TrackRowSkeleton
      testID="playlist-loading"
      accessibilityLabel={libraryStrings.playlist.loading}
      count={
        seededSummary !== null && seededSummary.track_count > 0
          ? Math.min(seededSummary.track_count, 6)
          : 5
      }
    />
  ) : tracks.length > 0 && displayedTracks.length === 0 ? (
    <EmptyState
      testID="playlist-filter-empty"
      icon="magnify"
      title={libraryStrings.playlist.filterEmpty}
    />
  ) : (
    <EmptyState
      testID="playlist-empty"
      icon={props.kind === 'liked' ? 'heart-outline' : 'playlist-plus'}
      title={
        props.kind === 'liked'
          ? libraryStrings.library.noLikes
          : libraryStrings.playlist.noTracks
      }
      message={
        props.kind === 'liked'
          ? libraryStrings.library.noLikesHint
          : libraryStrings.playlist.noTracksHint
      }
    />
  );

  const draggedIndex =
    drag.draggingId === null
      ? -1
      : dragRows.findIndex((row) => row.stableId === drag.draggingId);
  const draggedTrack = draggedIndex >= 0 ? tracks[draggedIndex] ?? null : null;

  const trackList = (
    <View
      ref={attachFrame}
      onLayout={drag.onFrameLayout}
      style={styles.listFrame}
    >
      <FlatList
        ref={(list) =>
          attachList(
            list === null
              ? null
              : {
                  getScrollResponder: () => ({
                    scrollTo: ({ y, animated }) => list.scrollToOffset({ offset: y, animated }),
                  }),
                },
          )
        }
        testID="playlist-list"
        data={displayedTracks}
        keyExtractor={(entry) => keyExtractor(entry.track, entry.sourceIndex)}
        scrollEnabled={drag.draggingId === null}
        onScroll={drag.onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={drag.onContentSizeChange}
        refreshing={manualRefreshing}
        onRefresh={pullToRefresh}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={9}
        // Keep false on RN 0.86 Fabric: clipping detaches updated/active track cells into blank gaps.
        removeClippedSubviews={false}
        ListHeaderComponent={tv.isTv ? null : heroHeaderContent}
        renderItem={({ item }) => {
          const { track, sourceIndex } = item;
          const stableId = keyExtractor(track, sourceIndex);
          const enableDrag = showRowControls && !tv.isTv && drag.canDrag(sourceIndex);
          return (
            <PlaylistTrackRow
              track={track}
              index={sourceIndex}
              count={tracks.length}
              occurrence={
                props.kind === 'liked'
                  ? likedTrackOccurrence(user.id, sourceIndex)
                  : playlistTrackOccurrence(props.playlistId, sourceIndex)
              }
              canEdit={showRowControls}
              controlsDisabled={mutations.pending}
              dragHandle={
                enableDrag
                  ? {
                      handlers: drag.handlersFor(stableId),
                      dragging: drag.draggingId === stableId,
                    }
                  : undefined
              }
              rowRef={showRowControls && !tv.isTv ? attachRow(stableId) : undefined}
              addedByLabel={
                showTrackAttribution ? playlistTrackAddedByLabel(track, user.id) : undefined
              }
              onPlay={() => playRow(sourceIndex)}
              onOpenActions={() => openTrackActions(track)}
              onOpenAlbum={props.onOpenAlbum}
              onOpenArtist={props.onOpenArtist}
              onMove={(direction) => moveTrack(sourceIndex, direction)}
              // The rejection is already on the remove mutation and rendered as
              // `playlist-mutation-error`; only the unhandled promise is settled here.
              onRemove={() => void removeTrack(track).catch(() => undefined)}
            />
          );
        }}
        ListEmptyComponent={emptyOrLoading}
        contentContainerStyle={listContentStyle}
      />
      {draggedTrack !== null ? (
        <>
          <Animated.View
            testID="playlist-drag-indicator"
            pointerEvents="none"
            style={[
              styles.dragIndicator,
              {
                opacity: drag.indicatorOpacity,
                transform: [{ translateY: drag.indicatorTop }],
              },
            ]}
          />
          <Animated.View
            testID="playlist-drag-ghost"
            pointerEvents="none"
            style={[
              styles.dragGhost,
              { transform: [{ translateY: drag.ghostTop }] },
            ]}
          >
            <AppText variant="bodyStrong" numberOfLines={1}>
              {draggedTrack.title}
            </AppText>
            <AppText variant="caption" color="secondary" numberOfLines={1}>
              {draggedTrack.artist}
            </AppText>
          </Animated.View>
        </>
      ) : null}
    </View>
  );

  return (
    <TvFocusScope scope="playlist">
      <View
        testID="playlist-screen"
        style={[
          styles.container,
          tv.isTv ? [styles.tvSplit, { gap: tv.gridGap }] : null,
        ]}
      >
        {tv.isTv ? (
          <>
            <ScrollView
              testID="playlist-tv-hero-pane"
              showsVerticalScrollIndicator={false}
              style={{
                width: Math.round(tv.contentWidth * tv.splitPrimaryRatio),
                flexGrow: 0,
                flexShrink: 0,
              }}
              contentContainerStyle={listContentStyle}
            >
              {heroHeaderContent}
            </ScrollView>
            <View testID="playlist-tv-tracks-pane" style={styles.tvTracksPane}>
              {trackList}
            </View>
          </>
        ) : (
          trackList
        )}

        <PlaylistActionsSheet
          visible={sheet === 'actions'}
          onClose={closeSheet}
          onStartRadio={
            tracks.length > 0
              ? () => {
                  closeSheet();
                  setRuntimeError(null);
                  void (async () => {
                    if (!musicRepository.getSeededRadio) {
                      throw new Error('Seeded radio endpoint unavailable');
                    }
                    const seedIds = tracks.slice(0, 10).map((t) => t.id);
                    const radioTracks = await musicRepository.getSeededRadio({
                      track_ids: seedIds,
                      limit: 35,
                    });
                    if (radioTracks.length === 0) {
                      throw new Error(wave2Strings.playlistTools.radioFailed);
                    }
                    await playTracks(radioTracks, 0, {
                      context: {
                        type: 'collection',
                        id: props.kind === 'playlist' ? `playlist-radio:${props.playlistId}` : 'liked-radio',
                        label: `${title} Radio`,
                      },
                    });
                  })().catch(() => {
                    setRuntimeError(wave2Strings.playlistTools.radioFailed);
                  });
                }
              : undefined
          }
          onFindDuplicates={
            props.kind === 'playlist' && canEditTracks && tracks.length > 1
              ? () => {
                  mutations.resetErrors();
                  setSheet('duplicates');
                }
              : undefined
          }
          onShare={
            props.kind === 'playlist' && detail !== undefined
              ? () => {
                  closeSheet();
                  setRuntimeError(null);
                  void sharePlaylist(props.playlistId, title).catch(() => {
                    setRuntimeError(libraryStrings.playlist.shareFailed);
                  });
                }
              : undefined
          }
          offline={
            props.kind === 'playlist' && detail !== undefined && offlineControlState !== null
              ? {
                  state: offlineControlState,
                  copy: offlineControlCopy(offline.failure),
                  disabled: tracks.length === 0,
                  onDownload: offline.download,
                  onRetry: offlineRetryAction(offline.failure, offline.download, offline.remove),
                  onRemove: offline.remove,
                }
              : null
          }
          owner={
            props.kind === 'playlist' && isOwner && remoteDetail !== undefined
              ? {
                  isPublic: remoteDetail.is_public,
                  isCollaborative: remoteDetail.is_collaborative,
                  collaboratorCount: remoteDetail.collaborator_count,
                  busy: mutations.pending,
                  canReorder: tracks.length > 0,
                  reordering,
                  onVisibilityChange: changeVisibility,
                  onCollaborativeChange: changeCollaborative,
                  onOpenCollaborators: () => {
                    mutations.resetErrors();
                    setSheet('collaborators');
                  },
                  onEdit: () => {
                    mutations.resetErrors();
                    setSheet(null);
                    editForm.open(remoteDetail);
                  },
                  onToggleReorder: () => {
                    closeSheet();
                    toggleReordering();
                  },
                  onDelete: () => {
                    mutations.resetErrors();
                    setSheet('delete');
                  },
                }
              : null
          }
          collaborator={
            props.kind === 'playlist' && !isOwner && isCollaborator && remoteDetail !== undefined
              ? {
                  isCollaborative: remoteDetail.is_collaborative,
                  canEditTracks,
                  collaboratorCount: remoteDetail.collaborator_count,
                  busy: mutations.pending,
                  canReorder: tracks.length > 0,
                  reordering,
                  onOpenCollaborators: () => {
                    mutations.resetErrors();
                    setSheet('collaborators');
                  },
                  onToggleReorder: () => {
                    closeSheet();
                    toggleReordering();
                  },
                  onLeave: () => {
                    mutations.resetErrors();
                    setSheet('leave');
                  },
                }
              : null
          }
          showViewerNotice={
            props.kind === 'playlist'
            && remoteDetail !== undefined
            && !isOwner
            && !isCollaborator
          }
        />

        {props.kind === 'playlist' && remoteDetail !== undefined && (isOwner || isCollaborator) ? (
          <PlaylistCollaboratorsSheet
            visible={sheet === 'collaborators'}
            onClose={closeSheet}
            scope={scope}
            apiBase={apiBase}
            playlist={remoteDetail}
            busy={mutations.pending}
            onToggleCollaborative={changeCollaborative}
            onOpenUser={props.onOpenUser}
            onLeave={() => {
              mutations.resetErrors();
              setSheet('leave');
            }}
          />
        ) : null}

        {props.kind === 'playlist' && canEditTracks ? (
          <PlaylistQuickAddSheet
            visible={sheet === 'quick-add'}
            playlistId={props.playlistId}
            scope={scope}
            existingTrackIds={existingTrackIds}
            onClose={closeSheet}
          />
        ) : null}

        {props.kind === 'playlist' && canEditTracks ? (
          <PlaylistDuplicatesSheet
            visible={sheet === 'duplicates'}
            playlistId={props.playlistId}
            scope={scope}
            onClose={closeSheet}
          />
        ) : null}

        <PlaylistEditSheet
          form={editFormWithFocusReturn}
          onSubmit={() => {
            if (props.kind === 'playlist' && isOwner) editForm.submit(props.playlistId);
          }}
        />

        <PlaylistDeleteSheet
          visible={sheet === 'delete'}
          name={title}
          busy={mutations.remove.isPending}
          error={
            mutations.remove.error !== null
              ? playlistFailureMessage('mutation', mutations.remove.error)
              : null
          }
          onCancel={() => {
            if (mutations.remove.isPending) return;
            mutations.remove.reset();
            closeSheet();
          }}
          onConfirm={() => {
            if (props.kind === 'playlist' && isOwner) mutations.remove.mutate(props.playlistId);
          }}
        />

        <PlaylistLeaveSheet
          visible={sheet === 'leave'}
          name={title}
          busy={mutations.leave.isPending}
          error={
            mutations.leave.error !== null
              ? playlistFailureMessage('leave', mutations.leave.error)
              : null
          }
          onCancel={() => {
            if (mutations.leave.isPending) return;
            mutations.leave.reset();
            closeSheet();
          }}
          onConfirm={() => {
            if (props.kind === 'playlist' && isCollaborator) {
              mutations.leave.mutate(props.playlistId);
            }
          }}
        />
      </View>
    </TvFocusScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    gap: layout.stackGap,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  tvHeroHeader: {
    gap: layout.stackGap,
    paddingHorizontal: layout.pagePadding,
    paddingBottom: spacing.lg,
  },
  tvSplit: { flexDirection: 'row', alignItems: 'stretch' },
  tvTracksPane: { flex: 1, minWidth: 0 },
  listFrame: { flex: 1, position: 'relative' },
  dragIndicator: {
    position: 'absolute',
    top: 0,
    left: layout.pagePadding,
    right: layout.pagePadding,
    height: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  dragGhost: {
    position: 'absolute',
    top: 0,
    left: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surfaceElevated,
    ...elevation.floating,
  },
  reorderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reorderCopy: { flex: 1 },
});
