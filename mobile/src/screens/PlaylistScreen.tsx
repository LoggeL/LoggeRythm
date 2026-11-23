import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { playlistEntryId, type Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import { InlineNotice } from '../components/library/InlineNotice';
import { PlaylistActionsSheet } from '../components/library/PlaylistActionsSheet';
import { PlaylistDeleteSheet } from '../components/library/PlaylistDeleteSheet';
import { PlaylistEditSheet, usePlaylistEditForm } from '../components/library/PlaylistEditSheet';
import { PlaylistHero } from '../components/library/PlaylistHero';
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
import { findCachedPlaylistSummary, musicCacheScope, musicQueries } from '../data';
import { useBackHandler } from '../hooks/useBackHandler';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { useOfflineDownloads } from '../offline/hooks';
import { playTrackRow, playTracks, toggleShuffle } from '../player/controller';
import { colors, layout, spacing } from '../theme';
import { TvFocusScope, tvFocusRegistry, useTvEnvironment, useTvFocusReturn } from '../tv';
import {
  assertPlaylistScreenContract,
  libraryPlaybackSelection,
  likedTrackOccurrence,
  playlistTrackOccurrence,
  reorderedPlaylistEntryIds,
  type PlaylistScreenContract,
  type TrackMoveDirection,
} from './libraryModel';
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

type PlaylistSheet = 'actions' | 'delete' | null;
const EMPTY_TRACKS: Track[] = [];

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
  const canEdit = props.kind === 'playlist' && remoteDetail?.is_owner === true;
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
    if (props.kind !== 'playlist' || !canEdit) return;
    mutations.resetErrors();
    mutations.visibility.mutate({ id: props.playlistId, isPublic });
  };

  const removeTrack = async (track: Track): Promise<void> => {
    if (props.kind !== 'playlist' || !canEdit) {
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
      canEdit && props.kind === 'playlist'
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
    if (props.kind !== 'playlist' || !canEdit) return;
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

  const seededInitialLoading =
    !localFallback
    && queryVisual.body === 'loading'
    && (props.kind === 'liked' || seededSummary !== null);

  const keyExtractor = useCallback(
    (track: Track, index: number) =>
      props.kind === 'playlist' && track.playlist_entry_id !== undefined
        ? `playlist-entry-${String(playlistEntryId(track))}`
        : `${props.kind}-track-${track.id}-${String(index)}`,
    [props.kind],
  );
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
  const showRowControls = canEdit && reordering;
  // The delete sheet owns the failure of its own request; every other
  // mutation failure is shown in the header.
  const headerMutationError = sheet === 'delete' ? null : mutations.error;

  const heroHeaderContent = (
    <View style={tv.isTv ? styles.tvHeroHeader : styles.header}>
      <PlaylistHero
        title={title}
        coverUrl={coverUrl}
        liked={props.kind === 'liked'}
        ownerName={ownerName}
        trackCount={trackCount}
        durationSeconds={tracks.reduce((total, track) => total + track.duration_sec, 0)}
        visibility={
          canEdit && remoteDetail !== undefined
            ? (remoteDetail.is_public ? 'public' : 'private')
            : null
        }
        description={description}
        playable={playable}
        preferredPlayFocus={tv.isTv && isFocused && playable}
        onPlay={() => playContext(firstLocalPlaybackIndex)}
        onShuffle={() => playContext(firstLocalPlaybackIndex, true)}
        reorder={
          tv.isTv && canEdit && tracks.length > 0
            ? {
                active: reordering,
                disabled: mutations.pending,
                onPress: () => setReordering((current) => !current),
              }
            : null
        }
        download={
          offlineControlState === null || detail === undefined
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

      {runtimeError !== null ? (
        <InlineNotice
          testID="playlist-runtime-error"
          tone="danger"
          live="assertive"
          message={runtimeError}
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

  const trackList = (
    <FlatList
      testID="playlist-list"
      data={tracks}
      keyExtractor={keyExtractor}
      refreshing={manualRefreshing}
      onRefresh={pullToRefresh}
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={9}
      // Keep false on RN 0.86 Fabric: clipping detaches updated/active track cells into blank gaps.
      removeClippedSubviews={false}
      ListHeaderComponent={tv.isTv ? null : heroHeaderContent}
      renderItem={({ item, index }) => (
        <PlaylistTrackRow
          track={item}
          index={index}
          count={tracks.length}
          occurrence={
            props.kind === 'liked'
              ? likedTrackOccurrence(user.id, index)
              : playlistTrackOccurrence(props.playlistId, index)
          }
          canEdit={showRowControls}
          controlsDisabled={mutations.pending}
          onPlay={() => playRow(index)}
          onOpenActions={() => openTrackActions(item)}
          onOpenAlbum={props.onOpenAlbum}
          onOpenArtist={props.onOpenArtist}
          onMove={(direction) => moveTrack(index, direction)}
          // The rejection is already on the remove mutation and rendered as
          // `playlist-mutation-error`; only the unhandled promise is settled here.
          onRemove={() => void removeTrack(item).catch(() => undefined)}
        />
      )}
      ListEmptyComponent={emptyOrLoading}
      contentContainerStyle={listContentStyle}
    />
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
            props.kind === 'playlist' && canEdit && remoteDetail !== undefined
              ? {
                  isPublic: remoteDetail.is_public,
                  busy: mutations.pending,
                  canReorder: tracks.length > 0,
                  reordering,
                  onVisibilityChange: changeVisibility,
                  onEdit: () => {
                    mutations.resetErrors();
                    setSheet(null);
                    editForm.open(remoteDetail);
                  },
                  onToggleReorder: () => {
                    closeSheet();
                    setReordering((current) => !current);
                  },
                  onDelete: () => {
                    mutations.resetErrors();
                    setSheet('delete');
                  },
                }
              : null
          }
          showViewerNotice={props.kind === 'playlist' && remoteDetail !== undefined && !canEdit}
        />

        <PlaylistEditSheet
          form={editFormWithFocusReturn}
          onSubmit={() => {
            if (props.kind === 'playlist' && canEdit) editForm.submit(props.playlistId);
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
            if (props.kind === 'playlist' && canEdit) mutations.remove.mutate(props.playlistId);
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
  reorderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reorderCopy: { flex: 1 },
});
