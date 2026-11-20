import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ImportJobStatus, PlaylistSummary, ResolveResult } from '../../api/types';
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
import { refreshBrowseTree } from '../../player/browseTree';
import { playTracks } from '../../player/controller';
import { reportPlayerNotice } from '../../player/notices';
import { spotifyImportContextId } from './SpotifyImportVirtualizedList';

/** Query key placeholder while no finished import is open; the query stays disabled. */
const IDLE_IMPORT_JOB_ID = 'idle';

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

/** Per-import UI state; opening another import resets all of it. */
interface ImportUiState {
  newNameOverride: string | null;
  playingIndex: number | null;
  runtimeError: string | null;
  saveFeedback: string | null;
  submissionId: string | null;
}

function emptyUiState(submissionId: string | null): ImportUiState {
  return {
    newNameOverride: null,
    playingIndex: null,
    runtimeError: null,
    saveFeedback: null,
    submissionId,
  };
}

interface SpotifyImportSessionInput {
  accountScope: string;
  /** The open import; its result loads once it is done. */
  job: ImportJobStatus | null;
}

/**
 * Everything behind one finished Spotify import: its result, the
 * destination playlists, both save mutations and playback of the matches.
 */
export function useSpotifyImportSession({ accountScope, job }: SpotifyImportSessionInput) {
  const queryClient = useQueryClient();
  const done = job !== null && job.status === 'done';
  const submissionId = job?.id ?? null;
  const link = done ? job.url : null;
  const resultQuery = useQuery({
    ...musicQueries.importJob(accountScope, job?.id ?? IDLE_IMPORT_JOB_ID),
    enabled: done,
  });
  const detail = done ? resultQuery.data : undefined;
  if (detail !== undefined && detail.result === null) {
    throw new Error(`Finished Spotify import ${detail.id} has no result`);
  }
  const result: ResolveResult | undefined = detail?.result ?? undefined;

  const [storedUiState, setStoredUiState] = useState<ImportUiState>(() =>
    emptyUiState(submissionId));
  const uiState = storedUiState.submissionId === submissionId
    ? storedUiState
    : emptyUiState(submissionId);
  const updateUiState = (patch: Partial<Omit<ImportUiState, 'submissionId'>>) => {
    setStoredUiState((current) => ({
      ...(current.submissionId === submissionId ? current : emptyUiState(submissionId)),
      ...patch,
      submissionId,
    }));
  };
  const setRuntimeError = (runtimeError: string | null) => updateUiState({ runtimeError });
  const setSaveFeedback = (saveFeedback: string | null) => updateUiState({ saveFeedback });

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
  const announceSaved = (added: number, playlistName: string) => {
    const message = strings.search.importSaved(added, playlistName);
    setSaveFeedback(message);
    AccessibilityInfo.announceForAccessibility(message);
  };

  const existingSave = useMutation<
    Awaited<ReturnType<typeof musicRepository.addTracksBulk>>,
    Error,
    ExistingSaveVariables,
    PlaylistCacheSnapshot
  >({
    mutationKey: ['music', 'mutation', accountScope, 'playlist', 'spotify-import-existing'],
    mutationFn: ({ playlist, tracks }) => musicRepository.addTracksBulk(playlist.id, tracks),
    onMutate: async ({ playlist, tracks }) => {
      updateUiState({ runtimeError: null, saveFeedback: null });
      return optimisticallyAddPlaylistTracks(queryClient, accountScope, playlist.id, tracks);
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
      announceSaved(added, playlist.name);
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
      updateUiState({ runtimeError: null, saveFeedback: null });
    },
    onError: () => {
      setRuntimeError(strings.search.importSaveFailed);
    },
    onSuccess: async ({ playlist, added }) => {
      await Promise.all([
        invalidatePlaylistCaches(queryClient, accountScope, playlist.id),
        refreshAutoBrowse(),
      ]);
      announceSaved(added, playlist.name);
    },
    onSettled: async () => {
      await invalidatePlaylistCaches(queryClient, accountScope);
    },
  });

  const play = (index: number) => {
    if (link === null || result === undefined) {
      throw new Error('Spotify import playback requires a resolved import');
    }
    if (!Number.isInteger(index) || index < 0 || index >= result.tracks.length) {
      throw new Error(`Spotify import playback index ${index} is outside ${result.tracks.length} matched tracks`);
    }
    updateUiState({ runtimeError: null, playingIndex: index });
    void playTracks(result.tracks, index, {
      context: {
        type: 'collection',
        id: spotifyImportContextId(link, result),
        label: result.name || strings.search.importTitle,
      },
    })
      .catch(() => setRuntimeError(strings.search.playFailed))
      .finally(() => updateUiState({ playingIndex: null }));
  };

  return {
    result,
    resultState,
    resolveBusy: resultQuery.fetchStatus === 'fetching',
    retryResolve: () => { void resultQuery.refetch(); },
    playlists: playlistsQuery.data ?? [],
    playlistsState,
    playlistsBusy: playlistsQuery.fetchStatus === 'fetching',
    retryPlaylists: () => { void playlistsQuery.refetch(); },
    newName: uiState.newNameOverride ?? (result?.name || strings.search.importTitle),
    setNewName: (newNameOverride: string) => updateUiState({ newNameOverride }),
    runtimeError: uiState.runtimeError,
    setRuntimeError,
    saveFeedback: uiState.saveFeedback,
    playingIndex: uiState.playingIndex,
    play,
    saving: existingSave.isPending || newSave.isPending,
    savingNew: newSave.isPending,
    /** Destination playlist of the in-flight "add to existing" save, if any. */
    savingPlaylistId: existingSave.isPending ? existingSave.variables.playlist.id : null,
    saveToNew: (name: string) => newSave.mutate(name),
    saveToExisting: (playlist: PlaylistSummary) => {
      if (result === undefined) throw new Error('Import result is no longer available');
      existingSave.mutate({ playlist, tracks: result.tracks });
    },
  };
}

export type SpotifyImportSession = ReturnType<typeof useSpotifyImportSession>;
