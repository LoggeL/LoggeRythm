import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { trackArtistLabel } from '../api/trackArtists';
import { getCurrentApiBase } from '../config';
import {
  createPlaylistWithTrack,
  invalidatePlaylistCaches,
  musicCacheScope,
  musicMutations,
  musicQueries,
  musicRepository,
  optimisticallyAddPlaylistTrack,
  refreshLibraryAutoBrowse,
  restorePlaylistCache,
} from '../data';
import { strings } from '../localization';
import { useLocaleRevision } from '../localization/LocaleProvider';
import {
  openTrackAlbum,
  openTrackArtist,
  type TrackDetailNavigationResult,
} from '../navigation';
import { trackAlbumRoute, trackArtistRoute } from '../navigationLinks';
import { useOfflineDownloads } from '../offline/hooks';
import {
  downloadTrackForOffline,
  removeOfflineTrack,
} from '../offline/runtime';
import { refreshBrowseTree, refreshOfflineBrowseTree } from '../player/browseTree';
import { reportPlayerNotice } from '../player/notices';
import { spacing } from '../theme';
import { isTvMode, tvFocusRegistry } from '../tv';
import {
  TrackActionRow,
  TrackActionsCreateForm,
  TrackActionsHeader,
  TrackActionsPlaylistRow,
  useKeyboardHeight,
  type TrackActionRowProps,
} from './TrackActionSheetParts';
import { AppText, BottomSheet, ListSeparator } from './ui';
import { TrackActionsPlaylistPicker } from './TrackActionsPlaylistPicker';
import { trackActionFailureMessage } from './trackActionFeedback';
import {
  dismissTrackActions,
  getTrackActionRequest,
  runAuthorizedTrackRemoval,
  runTrackQueueAction,
  subscribeTrackActions,
  trackActionIdsForRequest,
  type TrackActionId,
  type TrackQueueAction,
} from './trackActions';

type Mode = 'actions' | 'playlists' | 'create';
type PendingSheetAction =
  | TrackQueueAction
  | 'download'
  | 'remove-download'
  | 'remove';

function autoRefreshNotice(): void {
  reportPlayerNotice(
    'bookkeeping',
    'auto-library-refresh',
    strings.player.autoLibraryFailed,
    strings.player.autoLibraryRefreshFailedMessage,
  );
}

/** Global authenticated action sheet used by every shared track menu. */
export default function TrackActionsHost() {
  useLocaleRevision();
  const request = useSyncExternalStore(
    subscribeTrackActions,
    getTrackActionRequest,
    getTrackActionRequest,
  );
  const requestId = request?.requestId ?? null;
  const { user } = useAuth();
  const offlineSnapshot = useOfflineDownloads();
  const keyboardHeight = useKeyboardHeight();
  const queryClient = useQueryClient();
  const scope =
    user === null
      ? 'signed-out'
      : musicCacheScope(getCurrentApiBase(), user.id);
  const accountScope = user === null ? null : scope;
  const previousAccountScope = useRef<string | null>(accountScope);
  const wasVisibleRef = useRef(false);
  const [mode, setMode] = useState<Mode>('actions');
  const [newName, setNewName] = useState('');
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    requestId: number;
    action: PendingSheetAction;
  } | null>(null);
  const [stateRequestId, setStateRequestId] = useState(requestId);
  if (stateRequestId !== requestId) {
    setStateRequestId(requestId);
    setMode('actions');
    setNewName('');
    setRuntimeError(null);
    setPendingAction(null);
  }

  const visible = request !== null && user !== null;
  const isTv = isTvMode();

  useEffect(() => {
    const accountChanged = previousAccountScope.current !== accountScope;
    previousAccountScope.current = accountScope;
    if (requestId !== null && (accountScope === null || accountChanged)) {
      // The expected request ID makes this safe if a newer sheet opens before
      // the auth-transition effect is delivered.
      dismissTrackActions(requestId);
    }
  }, [accountScope, requestId]);

  // Preserve & restore D-Pad focus when the track action sheet opens/closes on Android TV.
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      wasVisibleRef.current = true;
      if (isTvMode()) {
        tvFocusRegistry.pushCheckpoint('track-actions');
      }
    } else if (!visible && wasVisibleRef.current) {
      wasVisibleRef.current = false;
      if (isTvMode()) {
        tvFocusRegistry.popAndRestore();
      }
    }
  }, [visible]);

  const playlists = useQuery({
    ...musicQueries.playlists(scope),
    enabled: user !== null && request !== null && mode === 'playlists',
  });

  const refreshAutoBrowse = () =>
    refreshLibraryAutoBrowse(refreshBrowseTree, autoRefreshNotice);
  const refreshOfflineAutoBrowse = () =>
    refreshLibraryAutoBrowse(refreshOfflineBrowseTree, autoRefreshNotice);

  const addMutation = useMutation({
    ...musicMutations.addToPlaylist(scope),
    onMutate: ({ id }) => {
      setRuntimeError(null);
      return request === null
        ? undefined
        : optimisticallyAddPlaylistTrack(queryClient, scope, id, request.track);
    },
    onError: (error, { id }, snapshot) => {
      if (snapshot !== undefined) restorePlaylistCache(queryClient, scope, id, snapshot);
      setRuntimeError(trackActionFailureMessage('add-to-playlist', error));
    },
    onSuccess: async (_result, { id }) => {
      if (request === null) return;
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, id),
        refreshAutoBrowse(),
      ]);
      AccessibilityInfo.announceForAccessibility(
        strings.trackActions.addToPlaylistSucceeded(request.track.title),
      );
      dismissTrackActions(request.requestId);
    },
    onSettled: async (_result, _error, { id }) => {
      await invalidatePlaylistCaches(queryClient, scope, id);
    },
  });

  const createMutation = useMutation({
    mutationKey: ['music', 'mutation', scope, 'playlist', 'create-with-track'] as const,
    mutationFn: ({ name }: { name: string }) => {
      if (request === null) throw new Error('Track action is no longer active');
      return createPlaylistWithTrack(
        musicRepository,
        { name: name.trim(), description: null },
        request.track,
      );
    },
    onError: (error) => {
      setRuntimeError(trackActionFailureMessage('create-playlist', error));
    },
    onSuccess: async (playlist) => {
      if (request === null) return;
      await Promise.all([
        invalidatePlaylistCaches(queryClient, scope, playlist.id),
        refreshAutoBrowse(),
      ]);
      AccessibilityInfo.announceForAccessibility(
        strings.trackActions.addToNamedPlaylistSucceeded(request.track.title, playlist.name),
      );
      dismissTrackActions(request.requestId);
    },
    onSettled: async () => {
      await invalidatePlaylistCaches(queryClient, scope);
    },
  });

  const activePendingAction =
    pendingAction?.requestId === requestId ? pendingAction.action : null;
  const pending =
    activePendingAction !== null || addMutation.isPending || createMutation.isPending;
  const close = () => {
    if (!pending) dismissTrackActions(requestId ?? undefined);
  };

  // Android system Back (and header Back) steps create -> playlists -> actions -> close.
  const handleBack = () => {
    if (pending) return;
    if (mode === 'create') {
      setRuntimeError(null);
      setMode('playlists');
      return;
    }
    if (mode === 'playlists') {
      setRuntimeError(null);
      setMode('actions');
      return;
    }
    close();
  };

  const runQueueAction = (action: TrackQueueAction) => {
    if (request === null || pending) return;
    const actionRequest = request;
    setRuntimeError(null);
    setPendingAction({ requestId: actionRequest.requestId, action });
    void runTrackQueueAction(actionRequest, action)
      .then((succeeded) => {
        if (
          !succeeded &&
          getTrackActionRequest()?.requestId === actionRequest.requestId
        ) {
          setRuntimeError(trackActionFailureMessage(action, null));
        }
      })
      .finally(() => {
        setPendingAction((current) =>
          current?.requestId === actionRequest.requestId ? null : current,
        );
      });
  };

  const runNavigationAction = (
    action: (track: NonNullable<typeof request>['track']) => TrackDetailNavigationResult,
  ) => {
    if (request === null || pending) return;
    setRuntimeError(null);
    if (action(request.track) !== 'opened') {
      setRuntimeError(strings.trackActions.navigationUnavailable);
      return;
    }
    dismissTrackActions(request.requestId);
  };

  const runRemove = () => {
    if (
      request === null ||
      pending ||
      accountScope === null ||
      request.authorizedRemove?.accountScope !== accountScope
    ) {
      return;
    }
    const actionRequest = request;
    setRuntimeError(null);
    setPendingAction({ requestId: actionRequest.requestId, action: 'remove' });
    void runAuthorizedTrackRemoval(actionRequest, accountScope)
      .then((result) => {
        if (
          result.status === 'failed' &&
          getTrackActionRequest()?.requestId === actionRequest.requestId
        ) {
          setRuntimeError(result.message);
        }
      })
      .finally(() => {
        setPendingAction((current) =>
          current?.requestId === actionRequest.requestId ? null : current,
        );
      });
  };

  const runOfflineTrackAction = (action: 'download' | 'remove-download') => {
    if (request === null || pending || accountScope === null) return;
    const actionRequest = request;
    setRuntimeError(null);
    setPendingAction({ requestId: actionRequest.requestId, action });
    const operation = action === 'download'
      ? downloadTrackForOffline(accountScope, actionRequest.track)
      : removeOfflineTrack(accountScope, actionRequest.track.id);
    void operation
      .then(async () => {
        await refreshOfflineAutoBrowse();
        if (getTrackActionRequest()?.requestId !== actionRequest.requestId) return;
        AccessibilityInfo.announceForAccessibility(
          action === 'download'
            ? strings.trackActions.downloadSucceeded(actionRequest.track.title)
            : strings.trackActions.removeDownloadSucceeded(actionRequest.track.title),
        );
        dismissTrackActions(actionRequest.requestId);
      })
      .catch((error) => {
        if (getTrackActionRequest()?.requestId === actionRequest.requestId) {
          setRuntimeError(trackActionFailureMessage(action, error));
        }
      })
      .finally(() => {
        setPendingAction((current) =>
          current?.requestId === actionRequest.requestId ? null : current,
        );
      });
  };

  const openPlaylists = () => {
    if (pending) return;
    setRuntimeError(null);
    addMutation.reset();
    createMutation.reset();
    setMode('playlists');
  };

  const submitCreate = () => {
    const name = newName.trim();
    if (name.length === 0 || pending) return;
    setRuntimeError(null);
    createMutation.mutate({ name });
  };

  const albumRoute = request === null ? null : trackAlbumRoute(request.track);
  const artistRoute = request === null ? null : trackArtistRoute(request.track);
  const individuallyDownloaded =
    request !== null
    && accountScope !== null
    && offlineSnapshot.hydrated
    && offlineSnapshot.scope === accountScope
    && offlineSnapshot.manifest?.tracks[request.track.id]?.individualDownload === true;
  const actionRows: Record<TrackActionId, TrackActionRowProps> = {
    'play-next': {
      testID: 'track-action-play-next',
      label: strings.trackActions.playNext,
      icon: 'playlist-play',
      disabled: pending,
      busy: activePendingAction === 'play-next',
      onPress: () => runQueueAction('play-next'),
    },
    'add-to-queue': {
      testID: 'track-action-add-queue',
      label: strings.trackActions.addToQueue,
      icon: 'playlist-plus',
      disabled: pending,
      busy: activePendingAction === 'add-to-queue',
      onPress: () => runQueueAction('add-to-queue'),
    },
    'start-radio': {
      testID: 'track-action-radio',
      label: strings.trackActions.startRadio,
      icon: 'radio-tower',
      disabled: pending,
      busy: activePendingAction === 'start-radio',
      onPress: () => runQueueAction('start-radio'),
    },
    'add-to-playlist': {
      testID: 'track-action-add-playlist',
      label: strings.trackActions.addToPlaylist,
      icon: 'playlist-music',
      disabled: pending,
      onPress: openPlaylists,
    },
    download: {
      testID: 'track-action-download',
      label: strings.trackActions.download,
      icon: 'download',
      disabled: pending || accountScope === null,
      busy: activePendingAction === 'download',
      onPress: () => runOfflineTrackAction('download'),
    },
    'remove-download': {
      testID: 'track-action-remove-download',
      label: strings.trackActions.removeDownload,
      icon: 'download-off',
      disabled: pending || accountScope === null,
      busy: activePendingAction === 'remove-download',
      onPress: () => runOfflineTrackAction('remove-download'),
    },
    'open-album': {
      testID: 'track-action-open-album',
      label: strings.trackActions.openAlbum(
        albumRoute?.title ?? strings.navigation.album,
      ),
      icon: 'album',
      disabled: pending || albumRoute === null,
      onPress: () => runNavigationAction(openTrackAlbum),
    },
    'open-artist': {
      testID: 'track-action-open-artist',
      label: strings.trackActions.openArtist(
        artistRoute?.name ?? strings.navigation.artist,
      ),
      icon: 'account-music',
      disabled: pending || artistRoute === null,
      onPress: () => runNavigationAction(openTrackArtist),
    },
    remove: {
      testID: 'track-action-remove',
      label: strings.trackActions.remove,
      icon: 'delete-outline',
      destructive: true,
      disabled: pending,
      busy: activePendingAction === 'remove',
      onPress: runRemove,
    },
  };

  const back =
    mode === 'create'
      ? {
          testID: 'track-action-create-back',
          label: strings.trackActions.backToPlaylists,
          onPress: handleBack,
        }
      : mode === 'playlists'
        ? {
            testID: 'track-action-playlists-back',
            label: strings.trackActions.back,
            onPress: handleBack,
          }
        : undefined;

  const visibleActionIds = trackActionIdsForRequest(
    request,
    accountScope,
    individuallyDownloaded,
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      onBack={handleBack}
      closeLabel={strings.trackActions.close}
      testID="track-actions-modal"
      contentStyle={mode === 'create' ? { paddingBottom: keyboardHeight } : undefined}
    >
      <TrackActionsHeader
        title={
          mode === 'actions'
            ? request?.track.title ?? ''
            : strings.trackActions.addToPlaylistTitle
        }
        subtitle={
          request === null
            ? ''
            : mode === 'actions'
              ? trackArtistLabel(request.track)
              : request.track.title
        }
        coverUri={request?.track.cover}
        back={back}
        closeDisabled={pending}
        onClose={close}
      />

      {runtimeError !== null ? (
        <AppText
          testID="track-actions-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          variant="callout"
          color="danger"
          style={styles.error}
        >
          {runtimeError}
        </AppText>
      ) : null}

      {mode === 'actions' ? (
        <ScrollView
          testID="track-actions-list"
          style={styles.scroll}
          contentContainerStyle={styles.list}
        >
          {visibleActionIds.map((action, index) => (
            <TrackActionRow
              key={action}
              {...actionRows[action]}
              hasTVPreferredFocus={isTv && visible && index === 0 ? true : undefined}
            />
          ))}
        </ScrollView>
      ) : mode === 'create' ? (
        <TrackActionsCreateForm
          name={newName}
          onChangeName={setNewName}
          disabled={pending}
          submitting={createMutation.isPending}
          onSubmit={submitCreate}
        />
      ) : (
        <View style={styles.playlistPanel}>
          <TrackActionRow
            testID="track-action-new-playlist"
            label={strings.trackActions.newPlaylist}
            icon="plus"
            disabled={pending}
            hasTVPreferredFocus={isTv && visible ? true : undefined}
            onPress={() => {
              setRuntimeError(null);
              setMode('create');
            }}
          />
          <ListSeparator />
          <TrackActionsPlaylistPicker
            hasData={playlists.data !== undefined}
            empty={(playlists.data?.length ?? 0) === 0}
            isPending={playlists.isPending}
            isFetching={playlists.isFetching}
            isStale={playlists.isStale}
            fetchStatus={playlists.fetchStatus}
            error={playlists.error}
            actionsDisabled={pending}
            onRetry={() => void playlists.refetch()}
          >
            <ScrollView
              testID="track-action-playlists-list"
              style={styles.scroll}
              contentContainerStyle={styles.list}
            >
              {(playlists.data ?? []).map((playlist) => (
                <TrackActionsPlaylistRow
                  key={playlist.id}
                  testID={`track-action-playlist-${playlist.id}`}
                  name={playlist.name}
                  detail={strings.trackActions.playlistTrackCount(playlist.track_count)}
                  accessibilityLabel={strings.trackActions.addToNamedPlaylist(
                    request?.track.title ?? '',
                    playlist.name,
                  )}
                  disabled={pending}
                  busy={addMutation.isPending && addMutation.variables?.id === playlist.id}
                  onPress={() => {
                    if (request === null) return;
                    addMutation.mutate({ id: playlist.id, track: request.track });
                  }}
                />
              ))}
            </ScrollView>
          </TrackActionsPlaylistPicker>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  error: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  scroll: { flexGrow: 0 },
  list: { paddingBottom: spacing.xs },
  playlistPanel: { flexShrink: 1, gap: spacing.xxs },
});
