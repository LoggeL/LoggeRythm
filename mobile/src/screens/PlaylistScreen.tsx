import React, { useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { playlistEntryId, type Track } from '../api/types';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import AppIcon from '../components/AppIcon';
import { ActionButton } from '../components/ui';
import {
  PlaylistQueryGate,
  PlaylistQueryNotice,
  resolvePlaylistRemoteVisualState,
} from '../components/library/PlaylistRemoteStates';
import OfflinePlaylistControl, {
  type OfflinePlaylistControlCopy,
} from '../components/offline/OfflinePlaylistControl';
import StandardTrackRow from '../components/track/StandardTrackRow';
import { showTrackActions } from '../components/trackActions';
import { getCurrentApiBase } from '../config';
import {
  invalidatePlaylistCaches,
  musicCacheScope,
  musicMutations,
  musicQueries,
  optimisticallyRemovePlaylistTrack,
  optimisticallyReorderPlaylistTracks,
  optimisticallySetPlaylistVisibility,
  optimisticallyUpdatePlaylist,
  refreshLibraryAutoBrowse,
  removeDeletedPlaylistFromCache,
  restorePlaylistCache,
} from '../data';
import { strings } from '../localization';
import { useOfflineDownloads } from '../offline/hooks';
import {
  downloadPlaylistForOffline,
  removeOfflinePlaylist,
} from '../offline/runtime';
import {
  refreshBrowseTree,
  refreshOfflineBrowseTree,
} from '../player/browseTree';
import { playTracks } from '../player/controller';
import { reportPlayerNotice } from '../player/notices';
import { colors, metrics } from '../theme';
import {
  assertPlaylistScreenContract,
  libraryPlaybackSelection,
  libraryTestIdSegment,
  likedTrackOccurrence,
  playlistTrackOccurrence,
  playlistUpdateRequest,
  reorderedPlaylistEntryIds,
  type LibraryAlbumRouteParams,
  type LibraryArtistRouteParams,
  type LibraryTrackOccurrence,
  type PlaylistScreenContract,
  type TrackMoveDirection,
} from './libraryModel';
import { libraryStrings } from './libraryStrings';
import { runOfflinePlaylistScreenAction } from './offlineScreenActions';
import {
  accountOfflinePlaylistDetail,
  firstDownloadedOccurrenceIndex,
  localPlaylistPlaybackSelection,
  offlineRetryAction,
  playlistOfflineControlState,
  playlistScreenPlaybackOptions,
  type OfflineScreenFailure,
  type OfflineScreenOperation,
} from './offlineScreenModel';
import { playlistFailureMessage, playlistNameValidation } from './playlistFeedback';

export type PlaylistScreenProps = PlaylistScreenContract;

function PlaylistArtwork({ uri }: { uri: string | null }) {
  return uri ? (
    <Image accessible={false} source={{ uri }} style={styles.heroArtwork} />
  ) : (
    <View style={[styles.heroArtwork, styles.artworkPlaceholder]}>
      <AppIcon name="music-note" color={colors.accentSoft} size={28} />
    </View>
  );
}

function reportAutoBrowseRefreshFailure() {
  reportPlayerNotice(
    'bookkeeping',
    'auto-library-refresh',
    strings.player.autoLibraryFailed,
    strings.player.autoLibraryRefreshFailedMessage,
  );
}

export function refreshOfflineAutoBrowse(): Promise<void> {
  return refreshLibraryAutoBrowse(refreshOfflineBrowseTree, reportAutoBrowseRefreshFailure);
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
      : libraryStrings.playlist.offlineError(completedTracks),
    progress: ({ percent }) => libraryStrings.playlist.offlineProgress(percent),
    downloadAction: libraryStrings.playlist.downloadAction,
    downloadingAction: libraryStrings.playlist.downloadingAction,
    retryAction: libraryStrings.playlist.retryDownloadAction,
    removeAction: libraryStrings.playlist.removeDownloadAction,
    removingAction: libraryStrings.playlist.removingDownloadAction,
  };
}

interface PlaylistTrackRowProps {
  track: Track;
  index: number;
  count: number;
  occurrence: LibraryTrackOccurrence;
  canEdit: boolean;
  controlsDisabled: boolean;
  onPlay: () => void;
  onOpenActions: () => void;
  onOpenAlbum: (params: LibraryAlbumRouteParams) => void;
  onOpenArtist: (params: LibraryArtistRouteParams) => void;
  onMove: (direction: TrackMoveDirection) => void;
  onRemove: () => void;
}

export function PlaylistTrackRow({
  track,
  index,
  count,
  occurrence,
  canEdit,
  controlsDisabled,
  onPlay,
  onOpenActions,
  onOpenAlbum,
  onOpenArtist,
  onMove,
  onRemove,
}: PlaylistTrackRowProps) {
  const rowId = `playlist-track-${libraryTestIdSegment(track.id)}-${index}`;
  return (
    <StandardTrackRow
      track={track}
      testID={rowId}
      occurrence={occurrence}
      position={index + 1}
      onPlay={onPlay}
      onActions={onOpenActions}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
      trailingControls={canEdit ? (
        <View style={styles.trackControls}>
          <Pressable
            testID={`${rowId}-up`}
            accessibilityRole="button"
            accessibilityLabel={libraryStrings.playlist.moveUp(track.title)}
            accessibilityState={{ disabled: controlsDisabled || index === 0 }}
            disabled={controlsDisabled || index === 0}
            onPress={() => onMove('up')}
            style={({ pressed }) => [
              styles.iconAction,
              (controlsDisabled || index === 0) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <AppIcon name="arrow-up" color={colors.textSecondary} size={20} />
          </Pressable>
          <Pressable
            testID={`${rowId}-down`}
            accessibilityRole="button"
            accessibilityLabel={libraryStrings.playlist.moveDown(track.title)}
            accessibilityState={{ disabled: controlsDisabled || index === count - 1 }}
            disabled={controlsDisabled || index === count - 1}
            onPress={() => onMove('down')}
            style={({ pressed }) => [
              styles.iconAction,
              (controlsDisabled || index === count - 1) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <AppIcon name="arrow-down" color={colors.textSecondary} size={20} />
          </Pressable>
          <Pressable
            testID={`${rowId}-remove`}
            accessibilityRole="button"
            accessibilityLabel={libraryStrings.playlist.remove(track.title)}
            accessibilityState={{ disabled: controlsDisabled }}
            disabled={controlsDisabled}
            onPress={onRemove}
            style={({ pressed }) => [
              styles.iconAction,
              styles.removeAction,
              controlsDisabled && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <AppIcon name="close" color={colors.danger} size={20} />
          </Pressable>
        </View>
      ) : undefined}
    />
  );
}

export default function PlaylistScreen(props: PlaylistScreenProps) {
  assertPlaylistScreenContract(props);
  const { user } = useAuth();
  if (user === null) throw new Error('PlaylistScreen requires an authenticated user');

  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const offlineSnapshot = useOfflineDownloads();
  const queryClient = useQueryClient();
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
  const [playlistActionsVisible, setPlaylistActionsVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editValidation, setEditValidation] = useState<string | null>(null);
  const [offlineOperation, setOfflineOperation] = useState<OfflineScreenOperation>(null);
  const [offlineActionFailure, setOfflineActionFailure] = useState<OfflineScreenFailure>(null);

  const refreshAutoBrowse = () =>
    refreshLibraryAutoBrowse(refreshBrowseTree, reportAutoBrowseRefreshFailure);

  const updateMutation = useMutation({
    ...musicMutations.updatePlaylist(scope),
    onMutate: ({ id, patch }) => optimisticallyUpdatePlaylist(queryClient, scope, id, patch),
    onError: (_error, { id }, snapshot) => {
      if (snapshot !== undefined) restorePlaylistCache(queryClient, scope, id, snapshot);
    },
    onSuccess: async (_result, { id }) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, id),
        refreshAutoBrowse(),
      ]);
      setEditVisible(false);
      setEditValidation(null);
    },
    onSettled: async (_result, error, { id }) => {
      if (error !== null) await invalidatePlaylistCaches(queryClient, scope, id);
    },
  });
  const visibilityMutation = useMutation({
    ...musicMutations.setPlaylistVisibility(scope),
    onMutate: ({ id, isPublic }) =>
      optimisticallySetPlaylistVisibility(queryClient, scope, id, isPublic),
    onError: (_error, { id }, snapshot) => {
      if (snapshot !== undefined) restorePlaylistCache(queryClient, scope, id, snapshot);
    },
    onSuccess: async (_result, { id }) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, id),
        refreshAutoBrowse(),
      ]);
    },
    onSettled: async (_result, error, { id }) => {
      if (error !== null) await invalidatePlaylistCaches(queryClient, scope, id);
    },
  });
  const removeMutation = useMutation({
    ...musicMutations.removeFromPlaylist(scope),
    onMutate: ({ id, entryId }) =>
      optimisticallyRemovePlaylistTrack(queryClient, scope, id, entryId),
    onError: (_error, { id }, snapshot) => {
      if (snapshot !== undefined) restorePlaylistCache(queryClient, scope, id, snapshot);
    },
    onSuccess: async (_result, { id }) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, id),
        refreshAutoBrowse(),
      ]);
    },
    onSettled: async (_result, error, { id }) => {
      if (error !== null) await invalidatePlaylistCaches(queryClient, scope, id);
    },
  });
  const reorderMutation = useMutation({
    ...musicMutations.reorderPlaylist(scope),
    onMutate: ({ id, entryIds }) =>
      optimisticallyReorderPlaylistTracks(queryClient, scope, id, entryIds),
    onError: (_error, { id }, snapshot) => {
      if (snapshot !== undefined) restorePlaylistCache(queryClient, scope, id, snapshot);
    },
    onSuccess: async (_result, { id }) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, id),
        refreshAutoBrowse(),
      ]);
    },
    onSettled: async (_result, error, { id }) => {
      if (error !== null) await invalidatePlaylistCaches(queryClient, scope, id);
    },
  });
  const deleteMutation = useMutation({
    ...musicMutations.deletePlaylist(scope),
    onSuccess: async (_result, id) => {
      if (props.kind !== 'playlist') return;
      removeDeletedPlaylistFromCache(queryClient, scope, id);
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope),
        refreshAutoBrowse(),
      ]);
      props.onDeleted();
    },
  });

  const remoteDetail = props.kind === 'playlist' ? playlistQuery.data : undefined;
  const offlineDetail = props.kind === 'playlist'
    ? accountOfflinePlaylistDetail(offlineSnapshot, scope, props.playlistId)
    : null;
  const localFallback = props.kind === 'playlist'
    && remoteDetail === undefined
    && offlineDetail !== null;
  const detail = remoteDetail ?? offlineDetail?.playlist;
  const remoteTracks = props.kind === 'liked'
    ? (likedQuery.data ?? [])
    : (remoteDetail?.tracks ?? []);
  const tracks = props.kind === 'liked' ? remoteTracks : (detail?.tracks ?? []);
  const hasData = props.kind === 'liked'
    ? likedQuery.data !== undefined
    : remoteDetail !== undefined;
  const isPending = props.kind === 'liked' ? likedQuery.isPending : playlistQuery.isPending;
  const isFetching = props.kind === 'liked' ? likedQuery.isFetching : playlistQuery.isFetching;
  const isStale = props.kind === 'liked' ? likedQuery.isStale : playlistQuery.isStale;
  const fetchStatus = props.kind === 'liked' ? likedQuery.fetchStatus : playlistQuery.fetchStatus;
  const queryError = props.kind === 'liked' ? likedQuery.error : playlistQuery.error;
  const refetch = props.kind === 'liked' ? likedQuery.refetch : playlistQuery.refetch;
  const queryVisual = resolvePlaylistRemoteVisualState({
    hasData,
    empty: remoteTracks.length === 0,
    isPending,
    isFetching,
    isStale,
    fetchStatus,
    error: queryError,
  });
  const queryRetryBusy = fetchStatus === 'fetching';
  const canEdit = props.kind === 'playlist' && remoteDetail?.is_owner === true;
  const mutationPending =
    updateMutation.isPending ||
    visibilityMutation.isPending ||
    removeMutation.isPending ||
    reorderMutation.isPending ||
    deleteMutation.isPending;
  const mutationError =
    updateMutation.error ??
    visibilityMutation.error ??
    removeMutation.error ??
    reorderMutation.error ??
    deleteMutation.error;
  const offlineControlState = props.kind === 'playlist'
    ? playlistOfflineControlState({
        snapshot: offlineSnapshot,
        accountScope: scope,
        playlistId: props.playlistId,
        sourceTrackCount: detail?.tracks.length ?? 0,
        operation: offlineOperation,
        actionFailure: offlineActionFailure,
      })
    : null;
  const firstLocalPlaybackIndex = localFallback && offlineDetail !== null
    ? firstDownloadedOccurrenceIndex(offlineDetail)
    : 0;
  const offlineActionBusy =
    offlineControlState?.kind === 'downloading'
    || offlineControlState?.kind === 'removing';

  const resetMutationErrors = () => {
    updateMutation.reset();
    visibilityMutation.reset();
    removeMutation.reset();
    reorderMutation.reset();
    deleteMutation.reset();
  };

  const playContext = (index: number) => {
    try {
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
      void playTracks(
        selected.tracks,
        selected.startIndex,
        playlistScreenPlaybackOptions(context, localFallback),
      ).catch((error) => setRuntimeError(playlistFailureMessage('playback', error)));
    } catch (error) {
      setRuntimeError(playlistFailureMessage('playback', error));
    }
  };

  const startOfflineDownload = () => {
    if (props.kind !== 'playlist') return;
    const source = remoteDetail ?? offlineDetail?.playlist;
    if (source === undefined) {
      setOfflineActionFailure('download');
      return;
    }
    setOfflineActionFailure(null);
    setOfflineOperation('downloading');
    void runOfflinePlaylistScreenAction(
      () => downloadPlaylistForOffline(scope, source),
      refreshOfflineAutoBrowse,
    )
      .catch(() => setOfflineActionFailure('download'))
      .finally(() => setOfflineOperation(null));
  };

  const removeOfflineDownload = () => {
    if (props.kind !== 'playlist') return;
    setOfflineActionFailure(null);
    setOfflineOperation('removing');
    void runOfflinePlaylistScreenAction(
      () => removeOfflinePlaylist(scope, props.playlistId),
      refreshOfflineAutoBrowse,
    )
      .catch(() => setOfflineActionFailure('remove'))
      .finally(() => setOfflineOperation(null));
  };

  const openEdit = () => {
    if (!canEdit || remoteDetail === undefined) return;
    resetMutationErrors();
    setEditName(remoteDetail.name);
    setEditDescription(remoteDetail.description ?? '');
    setEditValidation(null);
    setEditVisible(true);
  };

  const submitEdit = () => {
    if (props.kind !== 'playlist' || !canEdit) return;
    const validation = playlistNameValidation(editName);
    setEditValidation(validation);
    if (validation !== null) return;
    updateMutation.reset();
    try {
      updateMutation.mutate({
        id: props.playlistId,
        patch: playlistUpdateRequest(editName, editDescription),
      });
    } catch (error) {
      setEditValidation(playlistFailureMessage('mutation', error));
    }
  };

  const changeVisibility = (isPublic: boolean) => {
    if (props.kind !== 'playlist' || !canEdit) return;
    resetMutationErrors();
    visibilityMutation.mutate({ id: props.playlistId, isPublic });
  };

  const removeTrack = async (track: Track): Promise<void> => {
    if (props.kind !== 'playlist' || !canEdit) {
      throw new Error(libraryStrings.playlist.ownerOnly);
    }
    resetMutationErrors();
    await removeMutation.mutateAsync({
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
    resetMutationErrors();
    try {
      reorderMutation.mutate({
        id: props.playlistId,
        entryIds: reorderedPlaylistEntryIds(tracks, index, direction),
      });
    } catch (error) {
      setRuntimeError(playlistFailureMessage('mutation', error));
    }
  };

  const confirmDelete = () => {
    if (props.kind !== 'playlist' || !canEdit || remoteDetail === undefined) return;
    resetMutationErrors();
    Alert.alert(
      libraryStrings.playlist.deleteTitle,
      libraryStrings.playlist.deleteMessage(remoteDetail.name),
      [
        { text: libraryStrings.common.cancel, style: 'cancel' },
        {
          text: libraryStrings.playlist.deleteConfirm,
          style: 'destructive',
          onPress: () => deleteMutation.mutate(props.playlistId),
        },
      ],
    );
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
        onRetry={() => void refetch()}
      />
    );
  }

  const title = detail?.name ?? props.name;
  const description = detail?.description ?? null;
  const coverUrl =
    detail?.cover_url === null || detail?.cover_url === undefined
      ? null
      : resolveServerUrl(detail.cover_url, apiBase);

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
        onRefresh={() => {
          void refetch();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.heroIdentity}>
              <PlaylistArtwork uri={coverUrl} />
              <View style={styles.headerCopy}>
                <View style={styles.titleRow}>
                  <Text testID="playlist-title" accessibilityRole="header" style={styles.title}>
                    {title}
                  </Text>
                  {props.kind === 'playlist' && detail !== undefined ? (
                    <Pressable
                      testID="playlist-actions"
                      accessibilityRole="button"
                      accessibilityLabel={libraryStrings.playlist.openMenu}
                      onPress={() => setPlaylistActionsVisible(true)}
                      style={({ pressed }) => [
                        styles.playlistActionsButton,
                        pressed && styles.pressed,
                      ]}
                    >
                      <AppIcon name="dots-vertical" color={colors.textSecondary} size={26} />
                    </Pressable>
                  ) : null}
                </View>
                {detail?.owner_name ? (
                  <Text style={styles.status}>{libraryStrings.playlist.byOwner(detail.owner_name)}</Text>
                ) : null}
                <Text testID="playlist-track-count" style={styles.status}>
                  {libraryStrings.common.tracks(tracks.length)}
                </Text>
              </View>
            </View>
            {description !== null ? <Text style={styles.description}>{description}</Text> : null}

            {runtimeError !== null ? (
              <Text
                testID="playlist-runtime-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.runtimeError}
              >
                {runtimeError}
              </Text>
            ) : null}

            {mutationError !== null ? (
              <Text
                testID="playlist-mutation-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.runtimeError}
              >
                {playlistFailureMessage('mutation', mutationError)}
              </Text>
            ) : null}

            {localFallback ? (
              <View
                testID="playlist-local-copy"
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={styles.offlineNotice}
              >
                <Text style={styles.offlineNoticeText}>
                  {libraryStrings.playlist.localCopy}
                </Text>
                <Pressable
                  testID="playlist-local-copy-retry"
                  accessibilityRole="button"
                  accessibilityLabel={libraryStrings.common.retry}
                  accessibilityState={{ disabled: queryRetryBusy, busy: queryRetryBusy }}
                  disabled={queryRetryBusy}
                  onPress={() => void refetch()}
                  style={({ pressed }) => [
                    styles.secondaryAction,
                    queryRetryBusy && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.secondaryActionText}>{libraryStrings.common.retry}</Text>
                </Pressable>
              </View>
            ) : (
              <PlaylistQueryNotice
                visual={queryVisual}
                retryBusy={queryRetryBusy}
                onRetry={() => void refetch()}
              />
            )}

            {tracks.length > 0 && (!localFallback || firstLocalPlaybackIndex >= 0) ? (
              <ActionButton
                testID="playlist-play-all"
                label={libraryStrings.playlist.playAll}
                icon="play"
                onPress={() => playContext(firstLocalPlaybackIndex)}
                style={styles.playAction}
              />
            ) : null}

            {canEdit && remoteDetail !== undefined ? (
              <View testID="playlist-owner-controls" style={styles.ownerPanel}>
                <View style={styles.visibilityRow}>
                  <View style={styles.trackMeta}>
                    <Text style={styles.ownerLabel}>
                      {remoteDetail.is_public
                        ? libraryStrings.playlist.public
                        : libraryStrings.playlist.private}
                    </Text>
                    <Text style={styles.status}>
                      {remoteDetail.is_public
                        ? libraryStrings.playlist.makePrivate
                        : libraryStrings.playlist.makePublic}
                    </Text>
                  </View>
                  <Switch
                    testID="playlist-visibility"
                    accessibilityLabel={
                      remoteDetail.is_public
                        ? libraryStrings.playlist.makePrivate
                        : libraryStrings.playlist.makePublic
                    }
                    accessibilityState={{ disabled: mutationPending }}
                    disabled={mutationPending}
                    value={remoteDetail.is_public}
                    onValueChange={changeVisibility}
                    trackColor={{ false: colors.border, true: colors.accentSoft }}
                    thumbColor={remoteDetail.is_public ? colors.accent : colors.textSecondary}
                  />
                </View>
                <View style={styles.ownerActions}>
                  <ActionButton
                    testID="playlist-edit"
                    label={libraryStrings.playlist.edit}
                    icon="pencil-outline"
                    variant="secondary"
                    disabled={mutationPending}
                    onPress={openEdit}
                  />
                  <ActionButton
                    testID="playlist-delete"
                    label={libraryStrings.playlist.delete}
                    icon="delete-outline"
                    variant="danger"
                    disabled={mutationPending}
                    onPress={confirmDelete}
                  />
                </View>
                {mutationPending ? (
                  <Text
                    testID="playlist-mutation-pending"
                    accessibilityLiveRegion="polite"
                    style={styles.status}
                  >
                    {libraryStrings.playlist.mutationInProgress}
                  </Text>
                ) : null}
              </View>
            ) : props.kind === 'playlist' && remoteDetail !== undefined ? (
              <Text testID="playlist-viewer-permissions" style={styles.status}>
                {libraryStrings.playlist.ownerOnly}
              </Text>
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
            canEdit={canEdit}
            controlsDisabled={mutationPending}
            onPlay={() => playContext(index)}
            onOpenActions={() => openTrackActions(item)}
            onOpenAlbum={props.onOpenAlbum}
            onOpenArtist={props.onOpenArtist}
            onMove={(direction) => moveTrack(index, direction)}
            onRemove={() => void removeTrack(item).catch(() => undefined)}
          />
        )}
        ListEmptyComponent={
          <Text
            testID="playlist-empty"
            accessibilityLiveRegion="polite"
            style={styles.empty}
          >
            {libraryStrings.playlist.noTracks}
          </Text>
        }
        contentContainerStyle={styles.listContent}
      />

      <Modal
        visible={playlistActionsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!offlineActionBusy) setPlaylistActionsVisible(false);
        }}
      >
        <View testID="playlist-actions-modal" style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text accessibilityRole="header" style={[styles.modalTitle, styles.modalHeaderTitle]}>
                {libraryStrings.playlist.menuTitle}
              </Text>
              <Pressable
                testID="playlist-actions-close"
                accessibilityRole="button"
                accessibilityLabel={libraryStrings.playlist.closeMenu}
                accessibilityState={{ disabled: offlineActionBusy }}
                disabled={offlineActionBusy}
                onPress={() => setPlaylistActionsVisible(false)}
                style={({ pressed }) => [
                  styles.playlistActionsButton,
                  offlineActionBusy && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <AppIcon name="close" color={colors.textSecondary} size={22} />
              </Pressable>
            </View>
            {props.kind === 'playlist'
              && detail !== undefined
              && offlineControlState !== null ? (
                <OfflinePlaylistControl
                  testID="playlist-offline-menu-control"
                  state={offlineControlState}
                  copy={offlineControlCopy(offlineActionFailure)}
                  disabled={tracks.length === 0}
                  onDownload={startOfflineDownload}
                  onRetry={offlineRetryAction(
                    offlineActionFailure,
                    startOfflineDownload,
                    removeOfflineDownload,
                  )}
                  onRemove={removeOfflineDownload}
                />
              ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={editVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!updateMutation.isPending) setEditVisible(false);
        }}
      >
        <KeyboardAvoidingView
          testID="playlist-edit-modal"
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalBackdrop}
        >
          <View accessibilityViewIsModal style={styles.modalCard}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              {libraryStrings.playlist.editTitle}
            </Text>
            <TextInput
              testID="playlist-edit-name"
              accessibilityLabel={libraryStrings.library.name}
              placeholder={libraryStrings.library.name}
              placeholderTextColor={colors.textSecondary}
              value={editName}
              onChangeText={setEditName}
              editable={!updateMutation.isPending}
              autoFocus
              maxLength={120}
              style={styles.input}
            />
            <TextInput
              testID="playlist-edit-description"
              accessibilityLabel={libraryStrings.library.description}
              placeholder={libraryStrings.library.description}
              placeholderTextColor={colors.textSecondary}
              value={editDescription}
              onChangeText={setEditDescription}
              editable={!updateMutation.isPending}
              multiline
              maxLength={500}
              style={[styles.input, styles.descriptionInput]}
            />
            {editValidation !== null || updateMutation.error !== null ? (
              <Text
                testID="playlist-edit-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.errorText}
              >
                {editValidation ?? playlistFailureMessage('mutation', updateMutation.error)}
              </Text>
            ) : null}
            <View style={styles.modalActions}>
              <ActionButton
                testID="playlist-edit-cancel"
                label={libraryStrings.common.cancel}
                variant="ghost"
                disabled={updateMutation.isPending}
                onPress={() => setEditVisible(false)}
              />
              <ActionButton
                testID="playlist-edit-submit"
                label={
                  updateMutation.isPending
                    ? libraryStrings.common.saving
                    : libraryStrings.common.save
                }
                busy={updateMutation.isPending}
                icon="check"
                onPress={submitEdit}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingBottom: 144 },
  header: { gap: 20, padding: 20, paddingTop: 24, alignItems: 'stretch' },
  heroIdentity: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  heroArtwork: {
    width: 112,
    height: 112,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
  },
  artworkPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerCopy: { flex: 1, minWidth: 0, gap: 6 },
  titleRow: {
    width: '100%',
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: 27,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  playlistActionsButton: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 12,
  },
  description: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  runtimeError: {
    color: colors.danger,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  offlineNotice: {
    gap: 9,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  offlineNoticeText: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 32, paddingHorizontal: 20 },
  playAction: { alignSelf: 'flex-start', minWidth: 148 },
  secondaryAction: {
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  secondaryActionText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  ownerPanel: {
    gap: 16,
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  visibilityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ownerLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  ownerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  trackMeta: { flex: 1, minWidth: 0 },
  trackControls: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 8,
    paddingBottom: 4,
  },
  iconAction: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeAction: { marginLeft: 2 },
  disabled: { opacity: 0.34 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  modalCard: {
    gap: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.backgroundElevated,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  modalHeaderTitle: { flex: 1 },
  input: {
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  descriptionInput: { minHeight: 92, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
});
