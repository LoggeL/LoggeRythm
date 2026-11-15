import React, { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
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
import { ActionButton, AppText, EmptyState } from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries } from '../data';
import { useBottomInset } from '../hooks/useBottomInset';
import { strings } from '../localization';
import { useOfflineDownloads } from '../offline/hooks';
import { playTracks, toggleShuffle } from '../player/controller';
import { colors, layout, spacing } from '../theme';
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
  const offlineSnapshot = useOfflineDownloads();
  const bottomInset = useBottomInset();
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
  const mutations = usePlaylistMutations(scope, { onDeleted: props.onDeleted });
  const editForm = usePlaylistEditForm(mutations.update);

  const remoteDetail = props.kind === 'playlist' ? playlistQuery.data : undefined;
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
    ? (likedQuery.data ?? [])
    : (remoteDetail?.tracks ?? []);
  const tracks = props.kind === 'liked' ? remoteTracks : (detail?.tracks ?? []);
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
  const refetch = () => void query.refetch();
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

  const startPlayback = async (index: number, shuffle: boolean): Promise<void> => {
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
            label: detail?.name ?? props.name,
          } as const);
    setRuntimeError(null);
    await playTracks(
      selected.tracks,
      selected.startIndex,
      playlistScreenPlaybackOptions(context, localFallback),
    );
    // Product shuffle reorders the upcoming context items of the queue that
    // was just started; it is the same switch the player screen toggles.
    if (shuffle) await toggleShuffle();
  };

  const playContext = (index: number, shuffle = false) => {
    startPlayback(index, shuffle).catch((error: unknown) =>
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

  if (
    !localFallback
    && (
      queryVisual.body === 'loading'
      || queryVisual.body === 'offline'
      || queryVisual.body === 'hard-error'
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

  const title = detail?.name ?? props.name;
  const coverUrl =
    detail?.cover_url === null || detail?.cover_url === undefined
      ? null
      : resolveServerUrl(detail.cover_url, apiBase);
  const playable = tracks.length > 0 && (!localFallback || firstLocalPlaybackIndex >= 0);
  const showRowControls = canEdit && reordering;
  // The delete sheet owns the failure of its own request; every other
  // mutation failure is shown in the header.
  const headerMutationError = sheet === 'delete' ? null : mutations.error;

  return (
    <View testID="playlist-screen" style={styles.container}>
      <FlatList
        testID="playlist-list"
        data={tracks}
        keyExtractor={(track, index) => props.kind === 'playlist'
          && track.playlist_entry_id !== undefined
          ? `playlist-entry-${String(playlistEntryId(track))}`
          : `${props.kind}-track-${track.id}-${String(index)}`}
        refreshing={queryVisual.notice === 'refreshing'}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <PlaylistHero
              title={title}
              coverUrl={coverUrl}
              liked={props.kind === 'liked'}
              ownerName={detail?.owner_name ?? null}
              trackCount={tracks.length}
              durationSeconds={tracks.reduce((total, track) => total + track.duration_sec, 0)}
              visibility={
                canEdit && remoteDetail !== undefined
                  ? (remoteDetail.is_public ? 'public' : 'private')
                  : null
              }
              description={detail?.description ?? null}
              playable={playable}
              onPlay={() => playContext(firstLocalPlaybackIndex)}
              onShuffle={() => playContext(firstLocalPlaybackIndex, true)}
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
                        : () => setSheet('actions'),
                    }
              }
              onOpenActions={
                props.kind === 'playlist' && detail !== undefined
                  ? () => setSheet('actions')
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
        }
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
            onPlay={() => playContext(index)}
            onOpenActions={() => openTrackActions(item)}
            onOpenAlbum={props.onOpenAlbum}
            onOpenArtist={props.onOpenArtist}
            onMove={(direction) => moveTrack(index, direction)}
            // The rejection is already on the remove mutation and rendered as
            // `playlist-mutation-error`; only the unhandled promise is settled here.
            onRemove={() => void removeTrack(item).catch(() => undefined)}
          />
        )}
        ListEmptyComponent={
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
        }
        contentContainerStyle={{ paddingBottom: bottomInset }}
      />

      <PlaylistActionsSheet
        visible={sheet === 'actions'}
        onClose={() => setSheet(null)}
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
                  setSheet(null);
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
        form={editForm}
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
          setSheet(null);
        }}
        onConfirm={() => {
          if (props.kind === 'playlist' && canEdit) mutations.remove.mutate(props.playlistId);
        }}
      />
    </View>
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
  reorderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reorderCopy: { flex: 1 },
});
