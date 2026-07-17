import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
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
import { refreshBrowseTree } from '../player/browseTree';
import { reportPlayerNotice } from '../player/notices';
import { colors, metrics } from '../theme';
import AppIcon from './AppIcon';
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
type PendingSheetAction = TrackQueueAction | 'remove';

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
  const queryClient = useQueryClient();
  const scope =
    user === null
      ? 'signed-out'
      : musicCacheScope(getCurrentApiBase(), user.id);
  const accountScope = user === null ? null : scope;
  const previousAccountScope = useRef<string | null>(accountScope);
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

  useEffect(() => {
    const accountChanged = previousAccountScope.current !== accountScope;
    previousAccountScope.current = accountScope;
    if (requestId !== null && (accountScope === null || accountChanged)) {
      // The expected request ID makes this safe if a newer sheet opens before
      // the auth-transition effect is delivered.
      dismissTrackActions(requestId);
    }
  }, [accountScope, requestId]);

  const playlists = useQuery({
    ...musicQueries.playlists(scope),
    enabled: user !== null && request !== null && mode === 'playlists',
  });

  const refreshAutoBrowse = () =>
    refreshLibraryAutoBrowse(refreshBrowseTree, autoRefreshNotice);

  const addMutation = useMutation({
    ...musicMutations.addToPlaylist(scope),
    onMutate: ({ id, track }) => {
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
  const actionButtons: Record<TrackActionId, React.ComponentProps<typeof ActionButton>> = {
    'play-next': {
      testID: 'track-action-play-next',
      label: strings.trackActions.playNext,
      disabled: pending,
      busy: activePendingAction === 'play-next',
      onPress: () => runQueueAction('play-next'),
    },
    'add-to-queue': {
      testID: 'track-action-add-queue',
      label: strings.trackActions.addToQueue,
      disabled: pending,
      busy: activePendingAction === 'add-to-queue',
      onPress: () => runQueueAction('add-to-queue'),
    },
    'start-radio': {
      testID: 'track-action-radio',
      label: strings.trackActions.startRadio,
      disabled: pending,
      busy: activePendingAction === 'start-radio',
      onPress: () => runQueueAction('start-radio'),
    },
    'add-to-playlist': {
      testID: 'track-action-add-playlist',
      label: strings.trackActions.addToPlaylist,
      disabled: pending,
      onPress: openPlaylists,
    },
    'open-album': {
      testID: 'track-action-open-album',
      label: strings.trackActions.openAlbum(
        albumRoute?.title ?? strings.navigation.album,
      ),
      disabled: pending || albumRoute === null,
      onPress: () => runNavigationAction(openTrackAlbum),
    },
    'open-artist': {
      testID: 'track-action-open-artist',
      label: strings.trackActions.openArtist(
        artistRoute?.name ?? strings.navigation.artist,
      ),
      disabled: pending || artistRoute === null,
      onPress: () => runNavigationAction(openTrackArtist),
    },
    remove: {
      testID: 'track-action-remove',
      label: strings.trackActions.remove,
      disabled: pending,
      busy: activePendingAction === 'remove',
      onPress: runRemove,
    },
  };

  return (
    <Modal
      visible={request !== null && user !== null}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View testID="track-actions-modal" style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
                {mode === 'actions'
                  ? request?.track.title
                  : strings.trackActions.addToPlaylistTitle}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {mode === 'actions' ? request?.track.artist : request?.track.title}
              </Text>
            </View>
            <Pressable
              testID="track-actions-close"
              accessibilityRole="button"
              accessibilityLabel={strings.trackActions.close}
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={close}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <AppIcon name="close" color={colors.textSecondary} size={22} />
            </Pressable>
          </View>

          {runtimeError !== null ? (
            <Text
              testID="track-actions-error"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={styles.error}
            >
              {runtimeError}
            </Text>
          ) : null}

          {mode === 'actions' ? (
            <ScrollView
              testID="track-actions-list"
              style={styles.actionScroll}
              contentContainerStyle={styles.actionList}
            >
              {trackActionIdsForRequest(request, accountScope).map((action) => (
                <ActionButton key={action} {...actionButtons[action]} />
              ))}
            </ScrollView>
          ) : mode === 'create' ? (
            <View style={styles.createForm}>
              <TextInput
                testID="track-action-new-playlist-name"
                accessibilityLabel={strings.trackActions.newPlaylistName}
                placeholder={strings.trackActions.newPlaylistName}
                placeholderTextColor={colors.textSecondary}
                value={newName}
                onChangeText={setNewName}
                editable={!pending}
                autoFocus
                maxLength={120}
                onSubmitEditing={submitCreate}
                style={styles.input}
              />
              <View style={styles.formActions}>
                <Pressable
                  testID="track-action-create-back"
                  accessibilityRole="button"
                  accessibilityLabel={strings.trackActions.backToPlaylists}
                  disabled={pending}
                  onPress={() => setMode('playlists')}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.secondaryText}>{strings.trackActions.back}</Text>
                </Pressable>
                <Pressable
                  testID="track-action-create-submit"
                  accessibilityRole="button"
                  accessibilityLabel={strings.trackActions.createAndAdd}
                  accessibilityState={{
                    disabled: pending || newName.trim().length === 0,
                    busy: createMutation.isPending,
                  }}
                  disabled={pending || newName.trim().length === 0}
                  onPress={submitCreate}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                >
                  {createMutation.isPending ? (
                    <ActivityIndicator color={colors.onAccent} />
                  ) : (
                    <Text style={styles.primaryText}>{strings.trackActions.createAndAdd}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.playlistPanel}>
              <ActionButton
                testID="track-action-new-playlist"
                label={strings.trackActions.newPlaylist}
                icon="plus"
                disabled={pending}
                onPress={() => {
                  setRuntimeError(null);
                  setMode('create');
                }}
              />
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
                  style={styles.playlistList}
                  contentContainerStyle={styles.playlistListContent}
                >
                  {(playlists.data ?? []).map((playlist) => (
                    <Pressable
                      key={playlist.id}
                      testID={`track-action-playlist-${playlist.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={strings.trackActions.addToNamedPlaylist(
                        request?.track.title ?? '',
                        playlist.name,
                      )}
                      accessibilityState={{ disabled: pending }}
                      disabled={pending}
                      onPress={() => {
                        if (request === null) return;
                        addMutation.mutate({ id: playlist.id, track: request.track });
                      }}
                      style={({ pressed }) => [styles.playlistRow, pressed && styles.pressed]}
                    >
                      <View style={styles.playlistGlyph}>
                        <AppIcon name="music-note" color={colors.accentSoft} size={20} />
                      </View>
                      <View style={styles.headerCopy}>
                        <Text style={styles.playlistName} numberOfLines={1}>{playlist.name}</Text>
                        <Text style={styles.subtitle}>
                          {strings.trackActions.playlistTrackCount(playlist.track_count)}
                        </Text>
                      </View>
                      {addMutation.isPending && addMutation.variables?.id === playlist.id ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
              </TrackActionsPlaylistPicker>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ActionButton({
  testID,
  label,
  icon,
  disabled,
  busy = false,
  onPress,
}: {
  testID: string;
  label: string;
  icon?: React.ComponentProps<typeof AppIcon>['name'];
  disabled: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.actionButton, disabled && styles.disabled, pressed && styles.pressed]}
    >
      {icon === undefined ? null : (
        <AppIcon name={icon} color={colors.textPrimary} size={20} />
      )}
      <Text style={styles.actionText}>{label}</Text>
      {busy ? <ActivityIndicator color={colors.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  card: {
    maxHeight: '82%',
    gap: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.backgroundElevated,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.textPrimary, fontSize: 21, lineHeight: 27, fontWeight: '900' },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  closeButton: {
    width: metrics.minimumTouchTarget,
    height: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { color: colors.textSecondary, fontSize: 29, lineHeight: 32 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  actionList: { gap: 8 },
  actionScroll: { maxHeight: 460 },
  actionButton: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  actionText: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  playlistPanel: { minHeight: 160, gap: 10 },
  playlistList: { maxHeight: 360 },
  playlistListContent: { gap: 6, paddingBottom: 4 },
  playlistRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  playlistGlyph: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surfaceElevated,
  },
  playlistGlyphText: { color: colors.accentSoft, fontSize: 22 },
  playlistName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  createForm: { gap: 14 },
  input: {
    minHeight: metrics.minimumTouchTarget,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  primaryButton: {
    minHeight: metrics.minimumTouchTarget,
    minWidth: 126,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  primaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
});
