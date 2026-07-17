import React, { useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlaylistSummary, ResolveResult } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { showTrackActions } from '../trackActions';
import {
  createPlaylistWithTracks,
  invalidatePlaylistCaches,
  musicQueries,
  musicRepository,
  optimisticallyAddPlaylistTracks,
  refreshLibraryAutoBrowse,
  restorePlaylistCache,
  type PlaylistCacheSnapshot,
} from '../../data';
import { resolveRemoteVisualState } from '../../data/remoteState';
import { strings } from '../../localization';
import { playTracks } from '../../player/controller';
import { refreshBrowseTree } from '../../player/browseTree';
import { reportPlayerNotice } from '../../player/notices';
import {
  normalizeSpotifyImportInput,
  SpotifyImportInputError,
  type SpotifyImportInputErrorCode,
  type SpotifyImportRequest,
} from '../../share/spotifyImport';
import { colors, metrics } from '../../theme';
import AppIcon from '../AppIcon';
import { SearchErrorNotice, SearchRemoteBoundary } from './SearchRemoteStates';
import { SearchTrackResultRow } from './SearchResults';
import {
  SpotifyImportVirtualizedList,
  spotifyImportContextId,
  spotifyImportTrackOccurrence,
} from './SpotifyImportVirtualizedList';
import {
  createSpotifyImportListRows,
  type SpotifyImportListRow,
} from './spotifyImportListModel';

interface SpotifyImportPanelProps {
  accountScope: string;
  header: React.ReactElement;
  sharedRequest: SpotifyImportRequest | null;
  rollingDeviceCacheSeconds?: unknown;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

function inputErrorMessage(code: SpotifyImportInputErrorCode): string {
  switch (code) {
    case 'ambiguous':
      return strings.search.importAmbiguous;
    case 'too-long':
      return strings.search.importTooLong;
    case 'invalid':
      return strings.search.importInvalid;
  }
}

function autoRefreshNotice(): void {
  reportPlayerNotice(
    'bookkeeping',
    'auto-library-refresh',
    strings.player.autoLibraryFailed,
    strings.player.autoLibraryRefreshFailedMessage,
  );
}

interface ExistingSaveVariables {
  playlist: PlaylistSummary;
  tracks: ResolveResult['tracks'];
}

interface ResolvedSpotifyImportProps {
  accountScope: string;
  link: string | null;
  ownerHeader: React.ReactElement;
  submissionId: number | null;
  rollingDeviceCacheSeconds?: unknown;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

const IDLE_IMPORT_QUERY_URL = 'https://open.spotify.com/track/idle';

interface ResolvedImportUiState {
  newNameOverride: string | null;
  playingIndex: number | null;
  runtimeError: string | null;
  saveFeedback: string | null;
  submissionId: number | null;
}

function emptyResolvedImportUiState(submissionId: number | null): ResolvedImportUiState {
  return {
    newNameOverride: null,
    playingIndex: null,
    runtimeError: null,
    saveFeedback: null,
    submissionId,
  };
}

function ResolvedSpotifyImport({
  link,
  accountScope,
  ownerHeader,
  submissionId,
  rollingDeviceCacheSeconds,
  onOpenAlbum,
  onOpenArtist,
}: ResolvedSpotifyImportProps) {
  const queryClient = useQueryClient();
  const resultQuery = useQuery({
    ...musicQueries.resolveExternalUrl(link ?? IDLE_IMPORT_QUERY_URL),
    enabled: link !== null,
  });
  const result = link === null ? undefined : resultQuery.data;
  const [storedUiState, setStoredUiState] = useState<ResolvedImportUiState>(() =>
    emptyResolvedImportUiState(submissionId));
  const uiState = storedUiState.submissionId === submissionId
    ? storedUiState
    : emptyResolvedImportUiState(submissionId);
  const updateUiState = (patch: Partial<Omit<ResolvedImportUiState, 'submissionId'>>) => {
    setStoredUiState((current) => ({
      ...(current.submissionId === submissionId
        ? current
        : emptyResolvedImportUiState(submissionId)),
      ...patch,
      submissionId,
    }));
  };
  const setNewName = (newNameOverride: string | null) => {
    updateUiState({ newNameOverride });
  };
  const setRuntimeError = (runtimeError: string | null) => {
    updateUiState({ runtimeError });
  };
  const setSaveFeedback = (saveFeedback: string | null) => {
    updateUiState({ saveFeedback });
  };
  const setPlayingIndex = (playingIndex: number | null) => {
    updateUiState({ playingIndex });
  };
  const {
    newNameOverride,
    playingIndex,
    runtimeError,
    saveFeedback,
  } = uiState;

  const newName = newNameOverride ?? (result?.name || strings.search.importTitle);

  const playlistsQuery = useQuery({
    ...musicQueries.playlists(accountScope),
    enabled: result !== undefined && result.tracks.length > 0,
  });
  const resultState = resolveRemoteVisualState({
    hasData: result !== undefined,
    empty: false,
    pending: resultQuery.isPending,
    fetching: resultQuery.isFetching,
    stale: resultQuery.isStale,
    fetchStatus: resultQuery.fetchStatus,
    error: resultQuery.error,
  });
  const playlistsState = resolveRemoteVisualState({
    hasData: playlistsQuery.data !== undefined,
    empty: playlistsQuery.data !== undefined && playlistsQuery.data.length === 0,
    pending: playlistsQuery.isPending,
    fetching: playlistsQuery.isFetching,
    stale: playlistsQuery.isStale,
    fetchStatus: playlistsQuery.fetchStatus,
    error: playlistsQuery.error,
  });

  const refreshAutoBrowse = () =>
    refreshLibraryAutoBrowse(refreshBrowseTree, autoRefreshNotice);

  const existingSave = useMutation<
    Awaited<ReturnType<typeof musicRepository.addTracksBulk>>,
    Error,
    ExistingSaveVariables,
    PlaylistCacheSnapshot
  >({
    mutationKey: ['music', 'mutation', accountScope, 'playlist', 'spotify-import-existing'],
    mutationFn: ({ playlist, tracks }) => musicRepository.addTracksBulk(playlist.id, tracks),
    onMutate: async ({ playlist, tracks }) => {
      setRuntimeError(null);
      setSaveFeedback(null);
      return optimisticallyAddPlaylistTracks(
        queryClient,
        accountScope,
        playlist.id,
        tracks,
      );
    },
    onError: (_error, { playlist }, snapshot) => {
      if (snapshot !== undefined) {
        restorePlaylistCache(queryClient, accountScope, playlist.id, snapshot);
      }
      setRuntimeError(strings.search.importSaveFailed);
    },
    onSuccess: async ({ added }, { playlist }) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, accountScope, playlist.id),
        refreshAutoBrowse(),
      ]);
      const message = strings.search.importSaved(added, playlist.name);
      setSaveFeedback(message);
      AccessibilityInfo.announceForAccessibility(message);
    },
    onSettled: async (_data, _error, { playlist }) => {
      await invalidatePlaylistCaches(queryClient, accountScope, playlist.id);
    },
  });

  const newSave = useMutation({
    mutationKey: ['music', 'mutation', accountScope, 'playlist', 'spotify-import-new'],
    mutationFn: (name: string) => {
      if (result === undefined) throw new Error('Import result is no longer available');
      return createPlaylistWithTracks(
        musicRepository,
        { name, description: 'Von Spotify importiert' },
        result.tracks,
      );
    },
    onMutate: () => {
      setRuntimeError(null);
      setSaveFeedback(null);
    },
    onError: () => {
      setRuntimeError(strings.search.importSaveFailed);
    },
    onSuccess: async ({ playlist, added }) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, accountScope, playlist.id),
        refreshAutoBrowse(),
      ]);
      const message = strings.search.importSaved(added, playlist.name);
      setSaveFeedback(message);
      AccessibilityInfo.announceForAccessibility(message);
    },
    onSettled: async () => {
      await invalidatePlaylistCaches(queryClient, accountScope);
    },
  });

  const saving = existingSave.isPending || newSave.isPending;
  const existingDestinationId = existingSave.variables?.playlist.id ?? null;

  const play = (index: number) => {
    if (link === null || result === undefined || index < 0 || index >= result.tracks.length) {
      return;
    }
    setRuntimeError(null);
    setPlayingIndex(index);
    void playTracks(result.tracks, index, {
      context: {
        type: 'collection',
        id: spotifyImportContextId(link, result),
        label: result.name || strings.search.importTitle,
      },
    })
      .catch(() =>
        setRuntimeError(strings.search.playFailed),
      )
      .finally(() => setPlayingIndex(null));
  };

  if (result === undefined || link === null) {
    return (
      <SpotifyImportVirtualizedList
        accessibilityLabel={strings.search.importTitle}
        rows={[]}
        renderRow={() => null}
        header={(
          <>
            {ownerHeader}
            {link !== null ? <SearchRemoteBoundary
              id="spotify-import-resolve"
              state={resultState}
              loadingLabel={strings.search.importResolving}
              emptyLabel={strings.search.importResolveFailed}
              offlineLabel={strings.search.remoteOffline(strings.search.importTitle)}
              errorLabel={strings.search.remoteLoadFailed(strings.search.importTitle)}
              cachedOfflineLabel={strings.search.remoteCachedOffline(strings.search.importTitle)}
              cachedErrorLabel={strings.search.remoteCachedRefreshFailed(strings.search.importTitle)}
              refreshingLabel={strings.search.remoteRefreshing(strings.search.importTitle)}
              staleLabel={strings.search.remoteStale(strings.search.importTitle)}
              retryLabel={strings.search.retrySection(strings.search.importTitle)}
              retryBusy={resultQuery.fetchStatus === 'fetching'}
              onRetry={() => { void resultQuery.refetch(); }}
            >
              {null}
            </SearchRemoteBoundary> : null}
          </>
        )}
      />
    );
  }

  const rows = createSpotifyImportListRows({
    result,
    playlists: playlistsQuery.data ?? [],
    showDestinationRows: playlistsState.body === 'content',
  });

  const renderRow = ({ item }: { item: SpotifyImportListRow }) => {
    switch (item.kind) {
      case 'matched-track':
        return (
          <SearchTrackResultRow
            track={item.track}
            testID={`spotify-import-track-${item.track.id}-${item.index}`}
            occurrence={spotifyImportTrackOccurrence(link, result, item.index)}
            position={item.index + 1}
            popularity="none"
            rollingDeviceCacheSeconds={rollingDeviceCacheSeconds}
            onPlay={() => play(item.index)}
            onActions={() => showTrackActions(item.track, setRuntimeError)}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
          />
        );
      case 'save-controls':
        return (
          <View style={styles.saveBlock}>
            <Text accessibilityRole="header" style={styles.saveTitle}>
              {strings.search.importSaveTitle}
            </Text>
            <TextInput
              testID="spotify-import-new-name"
              accessibilityLabel={strings.search.importNewPlaylistName}
              value={newName}
              onChangeText={setNewName}
              editable={!saving}
              maxLength={120}
              placeholder={strings.search.importNewPlaylistName}
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <Pressable
              testID="spotify-import-save-new"
              accessibilityRole="button"
              accessibilityLabel={strings.search.importCreateAndSave}
              accessibilityState={{
                disabled: saving || newName.trim().length === 0,
                busy: newSave.isPending,
              }}
              disabled={saving || newName.trim().length === 0}
              onPress={() => newSave.mutate(newName.trim())}
              style={[
                styles.secondaryButton,
                (saving || newName.trim().length === 0) && styles.disabled,
              ]}
            >
              {newSave.isPending ? (
                <ActivityIndicator color={colors.textPrimary} size="small" />
              ) : null}
              <Text style={styles.secondaryButtonText}>
                {newSave.isPending
                  ? strings.search.importSaving
                  : strings.search.importCreateAndSave}
              </Text>
            </Pressable>
            <Text style={styles.destinationTitle}>
              {strings.search.importExistingPlaylists}
            </Text>
          </View>
        );
      case 'destinations-state':
        return (
          <SearchRemoteBoundary
            id="spotify-import-destinations"
            state={playlistsState}
            loadingLabel={strings.search.remoteLoading(strings.search.importExistingPlaylists)}
            emptyLabel={strings.search.importNoPlaylists}
            offlineLabel={strings.search.remoteOffline(strings.search.importExistingPlaylists)}
            errorLabel={strings.search.remoteLoadFailed(strings.search.importExistingPlaylists)}
            cachedOfflineLabel={strings.search.remoteCachedOffline(strings.search.importExistingPlaylists)}
            cachedErrorLabel={strings.search.remoteCachedRefreshFailed(strings.search.importExistingPlaylists)}
            refreshingLabel={strings.search.remoteRefreshing(strings.search.importExistingPlaylists)}
            staleLabel={strings.search.remoteStale(strings.search.importExistingPlaylists)}
            retryLabel={strings.search.retrySection(strings.search.importExistingPlaylists)}
            retryBusy={playlistsQuery.fetchStatus === 'fetching'}
            onRetry={() => { void playlistsQuery.refetch(); }}
          >
            {null}
          </SearchRemoteBoundary>
        );
      case 'destination': {
        const busy = existingSave.isPending && existingDestinationId === item.playlist.id;
        return (
          <Pressable
            testID={`spotify-import-save-existing-${item.playlist.id}`}
            accessibilityRole="button"
            accessibilityLabel={strings.search.importSaveToPlaylist(item.playlist.name)}
            accessibilityState={{ disabled: saving, busy }}
            disabled={saving}
            onPress={() => existingSave.mutate({
              playlist: item.playlist,
              tracks: result.tracks,
            })}
            style={[styles.destinationButton, saving && styles.disabled]}
          >
            <Text style={styles.destinationName} numberOfLines={1}>
              {item.playlist.name}
            </Text>
            {busy ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <Text style={styles.destinationCount}>
                {strings.common.trackCount(item.playlist.track_count)}
              </Text>
            )}
          </Pressable>
        );
      }
      case 'unmatched-header':
        return (
          <View testID="spotify-import-unmatched" style={styles.unmatchedBlock}>
            <Text accessibilityRole="header" style={styles.destinationTitle}>
              {strings.search.importUnmatchedTitle}
            </Text>
          </View>
        );
      case 'unmatched-track':
        return (
          <Text style={styles.status} numberOfLines={1}>
            {item.track.title} — {trackArtistLabel(item.track)}
          </Text>
        );
    }
  };

  return (
    <SpotifyImportVirtualizedList
      accessibilityLabel={strings.search.importTitle}
      rows={rows}
      renderRow={renderRow}
      header={(
        <>
          {ownerHeader}
          <SearchRemoteBoundary
            id="spotify-import-resolve"
            state={resultState}
            loadingLabel={strings.search.importResolving}
            emptyLabel={strings.search.importResolveFailed}
            offlineLabel={strings.search.remoteOffline(strings.search.importTitle)}
            errorLabel={strings.search.remoteLoadFailed(strings.search.importTitle)}
            cachedOfflineLabel={strings.search.remoteCachedOffline(strings.search.importTitle)}
            cachedErrorLabel={strings.search.remoteCachedRefreshFailed(strings.search.importTitle)}
            refreshingLabel={strings.search.remoteRefreshing(strings.search.importTitle)}
            staleLabel={strings.search.remoteStale(strings.search.importTitle)}
            retryLabel={strings.search.retrySection(strings.search.importTitle)}
            retryBusy={resultQuery.fetchStatus === 'fetching'}
            onRetry={() => { void resultQuery.refetch(); }}
          >
            <View testID="spotify-import-result" style={[styles.resultPanel, styles.result]}>
            <View style={styles.resultHeader}>
              {result.image ? (
                <Image accessible={false} source={{ uri: result.image }} style={styles.cover} />
              ) : (
                <View style={[styles.cover, styles.coverPlaceholder]}>
                  <AppIcon name="music-note" color={colors.accentSoft} size={24} />
                </View>
              )}
              <View style={styles.resultHeaderCopy}>
                <Text style={styles.typeLabel}>{strings.search.importType[result.type]}</Text>
                <Text accessibilityRole="header" style={styles.resultTitle}>{result.name}</Text>
                <Text style={styles.status}>
                  {strings.search.importMatched(result.matched, result.total)}
                  {result.unmatched.length > 0
                    ? ` · ${strings.search.importUnmatched(result.unmatched.length)}`
                    : ''}
                </Text>
                {result.source_total > result.total ? (
                  <Text style={styles.smallStatus}>
                    {strings.search.importTruncated(result.source_total, result.total)}
                  </Text>
                ) : null}
              </View>
            </View>

            {runtimeError !== null ? (
              <SearchErrorNotice testID="spotify-import-runtime-error" message={runtimeError} />
            ) : null}
            {saveFeedback !== null ? (
              <Text
                testID="spotify-import-save-success"
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={styles.successText}
              >
                {saveFeedback}
              </Text>
            ) : null}

            <Pressable
              testID="spotify-import-play-all"
              accessibilityRole="button"
              accessibilityLabel={strings.search.importPlayAll}
              accessibilityState={{
                disabled: result.tracks.length === 0,
                busy: playingIndex === 0,
              }}
              disabled={result.tracks.length === 0 || playingIndex !== null}
              onPress={() => play(0)}
              style={[styles.primaryButton, result.tracks.length === 0 && styles.disabled]}
            >
              {playingIndex === 0 ? (
                <ActivityIndicator color={colors.onAccent} size="small" />
              ) : null}
              <Text style={styles.primaryButtonText}>{strings.search.importPlayAll}</Text>
            </Pressable>
            </View>
          </SearchRemoteBoundary>
        </>
      )}
    />
  );
}

export default function SpotifyImportPanel({
  accountScope,
  header,
  sharedRequest,
  rollingDeviceCacheSeconds,
  onOpenAlbum,
  onOpenArtist,
}: SpotifyImportPanelProps) {
  const [input, setInput] = useState(sharedRequest?.link ?? '');
  const [inputError, setInputError] = useState<string | null>(
    sharedRequest?.errorCode ? inputErrorMessage(sharedRequest.errorCode) : null,
  );
  const [submission, setSubmission] = useState<{ id: number; link: string } | null>(() =>
    sharedRequest?.link ? { id: sharedRequest.id, link: sharedRequest.link } : null,
  );
  const nextSubmissionId = useMemo(() => (submission?.id ?? 0) + 1, [submission?.id]);

  const updateInput = (value: string) => {
    setInput(value);
    setInputError(null);
    setSubmission(null);
  };

  const submit = () => {
    try {
      const link = normalizeSpotifyImportInput(input);
      setInput(link);
      setInputError(null);
      setSubmission({ id: nextSubmissionId, link });
    } catch (error) {
      const code = error instanceof SpotifyImportInputError ? error.code : 'invalid';
      setInputError(inputErrorMessage(code));
      setSubmission(null);
    }
  };

  const ownerHeader = (
    <>
      {header}
    <View testID="spotify-import-panel" style={styles.panel}>
      <Text accessibilityRole="header" style={styles.panelTitle}>{strings.search.importTitle}</Text>
      <Text style={styles.intro}>{strings.search.importIntro}</Text>
      <TextInput
        testID="spotify-import-input"
        accessibilityLabel={strings.search.importInputLabel}
        value={input}
        onChangeText={updateInput}
        placeholder={strings.search.importPlaceholder}
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={submit}
        maxLength={8_192}
        style={styles.input}
      />
      <Pressable
        testID="spotify-import-resolve"
        accessibilityRole="button"
        accessibilityLabel={strings.search.importResolve}
        disabled={input.trim().length === 0}
        onPress={submit}
        style={[styles.primaryButton, input.trim().length === 0 && styles.disabled]}
      >
        <Text style={styles.primaryButtonText}>{strings.search.importResolve}</Text>
      </Pressable>
      {inputError !== null ? (
        <SearchErrorNotice testID="spotify-import-input-error" message={inputError} />
      ) : null}
    </View>
    </>
  );

  return (
    <ResolvedSpotifyImport
      link={submission?.link ?? null}
      accountScope={accountScope}
      ownerHeader={ownerHeader}
      submissionId={submission?.id ?? null}
      rollingDeviceCacheSeconds={rollingDeviceCacheSeconds}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 16,
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  panelTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  input: {
    minHeight: metrics.minimumTouchTarget,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    fontSize: 14,
  },
  primaryButton: {
    minHeight: metrics.minimumTouchTarget,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    paddingHorizontal: 18,
    backgroundColor: colors.accent,
  },
  primaryButtonText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  secondaryButton: {
    minHeight: metrics.minimumTouchTarget,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  loadingRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  smallStatus: { color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  errorBox: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.danger },
  successText: { color: colors.success, fontSize: 13, lineHeight: 19 },
  resultPanel: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  result: { gap: 14, paddingBottom: 4 },
  resultHeader: { flexDirection: 'row', gap: 14, alignItems: 'flex-end' },
  cover: { width: 104, height: 104, borderRadius: 10, backgroundColor: colors.surfaceElevated },
  coverPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  coverGlyph: { color: colors.accentSoft, fontSize: 28 },
  resultHeaderCopy: { flex: 1, minWidth: 0, gap: 3 },
  typeLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  resultTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '900' },
  saveBlock: { gap: 10, marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  saveTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  destinationTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', marginTop: 4 },
  destinationButton: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  destinationName: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  destinationCount: { color: colors.textSecondary, fontSize: 12 },
  unmatchedBlock: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
});
