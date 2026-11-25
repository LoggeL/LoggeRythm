import React, { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StartImportJobOptions } from '../../api/endpoints';
import type { ImportJobStatus } from '../../api/types';
import { isActiveImportJob, musicQueries, musicRepository, queryKeys } from '../../data';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { useBottomInset } from '../../hooks/useBottomInset';
import { strings } from '../../localization';
import { wave2Strings } from '../../localization/wave2Strings';
import { rootNavigation } from '../../navigation/rootNavigation';
import {
  normalizeSpotifyImportInput,
  SpotifyImportInputError,
  type SpotifyImportInputErrorCode,
  type SpotifyImportRequest,
} from '../../share/spotifyImport';
import { showTrackActions } from '../trackActions';
import { ActionButton, TrackRowSkeleton } from '../ui';
import { importJobErrorDetail, importJobTitle } from './importJobModel';
import { SearchErrorNotice, SearchRemoteBoundary } from './SearchRemoteStates';
import { SearchTrackResultRow } from './SearchResults';
import { SpotifyImportForm, type ImportTargetMode } from './SpotifyImportForm';
import { SpotifyImportJobList, SpotifyImportProgress } from './SpotifyImportJobs';
import { SpotifyImportResultSummary } from './SpotifyImportResultSummary';
import {
  SpotifyImportDestinationRow,
  SpotifyImportSaveControls,
  SpotifyImportUnmatchedHeader,
  SpotifyImportUnmatchedRow,
} from './SpotifyImportRows';
import {
  SpotifyImportVirtualizedList,
  spotifyImportTrackOccurrence,
} from './SpotifyImportVirtualizedList';
import {
  createSpotifyImportListRows,
  type SpotifyImportListRow,
} from './spotifyImportListModel';
import { useSpotifyImportSession } from './useSpotifyImportSession';

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

/**
 * The Spotify link import: a link form that starts a background import job,
 * the account's imports with their progress, and for a finished import its
 * matches and save destinations, all rows of one vertical list so every
 * control stays reachable in landscape and with the keyboard open.
 */
export default function SpotifyImportPanel({
  accountScope,
  header,
  sharedRequest,
  rollingDeviceCacheSeconds,
  onOpenAlbum,
  onOpenArtist,
}: SpotifyImportPanelProps) {
  const queryClient = useQueryClient();
  const jobsKey = queryKeys.external.importJobs(accountScope);
  const [input, setInput] = useState(sharedRequest?.link ?? '');
  const [inputError, setInputError] = useState<string | null>(
    sharedRequest?.errorCode ? inputErrorMessage(sharedRequest.errorCode) : null,
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [targetMode, setTargetMode] = useState<ImportTargetMode>('none');
  const [createPlaylistName, setCreatePlaylistName] = useState('');
  const [targetPlaylistId, setTargetPlaylistId] = useState<number | null>(null);
  const bottomInset = useBottomInset();

  const jobsQuery = useQuery(musicQueries.importJobs(accountScope));
  const jobs = jobsQuery.data;
  const selectedJob = jobs?.find((job) => job.id === selectedJobId) ?? null;
  const session = useSpotifyImportSession({ accountScope, job: selectedJob });
  const { result } = session;
  const link = result === undefined || selectedJob === null ? null : selectedJob.url;

  const start = useMutation({
    mutationKey: ['music', 'mutation', accountScope, 'spotify-import-job', 'start'],
    mutationFn: (payload: { url: string; options?: StartImportJobOptions }) =>
      musicRepository.startImportJob(payload.url, payload.options),
    onMutate: () => {
      setInputError(null);
      setRemoveError(null);
    },
    onSuccess: (job) => {
      queryClient.setQueryData<ImportJobStatus[]>(jobsKey, (current) =>
        [job, ...(current ?? []).filter((entry) => entry.id !== job.id)]);
      void queryClient.invalidateQueries({ queryKey: jobsKey, exact: true });
      setSelectedJobId(job.id);
      setInput('');
      setCreatePlaylistName('');
    },
    onError: (error) => {
      setInputError(strings.search.importStartFailed(importJobErrorDetail(error)));
    },
  });

  const remove = useMutation({
    mutationKey: ['music', 'mutation', accountScope, 'spotify-import-job', 'remove'],
    mutationFn: (job: ImportJobStatus) => musicRepository.deleteImportJob(job.id),
    onMutate: () => setRemoveError(null),
    onSuccess: (_data, job) => {
      queryClient.setQueryData<ImportJobStatus[]>(jobsKey, (current) =>
        (current ?? []).filter((entry) => entry.id !== job.id));
      queryClient.removeQueries({
        queryKey: queryKeys.external.importJob(accountScope, job.id),
        exact: true,
      });
      setSelectedJobId((current) => (current === job.id ? null : current));
    },
    onError: (error) => {
      setRemoveError(strings.search.importJobRemoveFailed(importJobErrorDetail(error)));
    },
  });

  // A link shared into the app starts its import right away, exactly once
  // per share (the panel is keyed by the share id).
  const startedShare = useRef<number | null>(null);
  const startImport = start.mutate;
  useEffect(() => {
    if (sharedRequest?.link === undefined || sharedRequest.link === null) return;
    if (startedShare.current === sharedRequest.id) return;
    startedShare.current = sharedRequest.id;
    startImport({ url: sharedRequest.link });
  }, [sharedRequest, startImport]);

  const updateInput = (value: string) => {
    setInput(value);
    setInputError(null);
  };

  const submit = () => {
    if (start.isPending) return;
    try {
      const normalized = normalizeSpotifyImportInput(input);
      setInput(normalized);
      let options: StartImportJobOptions | undefined;
      if (targetMode === 'new' && createPlaylistName.trim().length > 0) {
        options = { create_playlist_name: createPlaylistName.trim() };
      } else if (targetMode === 'existing' && targetPlaylistId !== null) {
        options = { target_playlist_id: targetPlaylistId };
      }
      start.mutate({ url: normalized, options });
    } catch (error) {
      const code = error instanceof SpotifyImportInputError ? error.code : 'invalid';
      setInputError(inputErrorMessage(code));
    }
  };

  const removeJob = (job: ImportJobStatus) => {
    if (!isActiveImportJob(job)) {
      remove.mutate(job);
      return;
    }
    Alert.alert(
      strings.search.importJobCancelConfirmTitle,
      strings.search.importJobCancelConfirmMessage(importJobTitle(job)),
      [
        { text: strings.search.importJobKeepRunning, style: 'cancel' },
        {
          text: strings.search.importJobCancelConfirm,
          style: 'destructive',
          onPress: () => remove.mutate(job),
        },
      ],
    );
  };

  const title = strings.search.importTitle;
  const destinationsTitle = strings.search.importExistingPlaylists;
  const listHeader = (
    <>
      {header}
      <SpotifyImportForm
        value={input}
        error={inputError}
        starting={start.isPending}
        onChangeText={updateInput}
        onSubmit={submit}
        targetMode={targetMode}
        onTargetModeChange={setTargetMode}
        createPlaylistName={createPlaylistName}
        onCreatePlaylistNameChange={setCreatePlaylistName}
        targetPlaylistId={targetPlaylistId}
        onTargetPlaylistIdChange={setTargetPlaylistId}
        playlists={session.playlists}
      />
      <SpotifyImportJobList
        jobs={jobs}
        loadError={jobsQuery.error === null ? null : importJobErrorDetail(jobsQuery.error)}
        retryBusy={jobsQuery.fetchStatus === 'fetching'}
        onRetry={() => { void jobsQuery.refetch(); }}
        selectedId={selectedJobId}
        removingId={remove.isPending ? remove.variables.id : null}
        onSelect={(job) => {
          setRemoveError(null);
          setSelectedJobId(job.id);
        }}
        onRemove={removeJob}
      />
      {removeError !== null ? (
        <SearchErrorNotice testID="spotify-import-remove-error" message={removeError} />
      ) : null}
      {selectedJob !== null && isActiveImportJob(selectedJob) ? (
        <SpotifyImportProgress job={selectedJob} />
      ) : null}
      {selectedJob !== null && selectedJob.status === 'failed' ? (
        <SearchErrorNotice
          testID="spotify-import-job-failed"
          message={`${importJobTitle(selectedJob)}: ${
            selectedJob.error ?? strings.search.importJobNoServerError
          }`}
        />
      ) : null}
      {selectedJob !== null
      && selectedJob.status === 'done'
      && selectedJob.created_playlist_id !== null
      && selectedJob.created_playlist_id !== undefined ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <ActionButton
            testID="spotify-import-open-created-playlist"
            icon="playlist-music"
            variant="primary"
            label={wave2Strings.importTarget.openCreatedPlaylist}
            onPress={() => {
              const createdId = selectedJob.created_playlist_id!;
              rootNavigation.navigate('Tabs', {
                screen: 'LibraryTab',
                params: {
                  screen: 'Playlist',
                  params: {
                    kind: 'playlist',
                    playlistId: createdId,
                    name: selectedJob.create_playlist_name || importJobTitle(selectedJob),
                  },
                },
              });
            }}
          />
        </View>
      ) : null}
      {selectedJob !== null && selectedJob.status === 'done' ? (
        <SearchRemoteBoundary
          id="spotify-import-resolve"
          state={session.resultState}
          loadingLabel={strings.search.importJobResultLoading}
          emptyLabel={strings.search.importJobResultFailed}
          offlineLabel={strings.search.remoteOffline(title)}
          errorLabel={strings.search.importJobResultFailed}
          cachedOfflineLabel={strings.search.remoteCachedOffline(title)}
          cachedErrorLabel={strings.search.remoteCachedRefreshFailed(title)}
          refreshingLabel={strings.search.remoteRefreshing(title)}
          staleLabel={strings.search.remoteStale(title)}
          retryLabel={strings.search.retrySection(title)}
          retryBusy={session.resolveBusy}
          onRetry={session.retryResolve}
          loadingFallback={(props) => <TrackRowSkeleton {...props} />}
        >
          {result !== undefined ? (
            <SpotifyImportResultSummary
              result={result}
              runtimeError={session.runtimeError}
              saveFeedback={session.saveFeedback}
              playingIndex={session.playingIndex}
              onPlayAll={() => session.play(0)}
            />
          ) : null}
        </SearchRemoteBoundary>
      ) : null}
    </>
  );

  const rows = result === undefined || link === null
    ? []
    : createSpotifyImportListRows({
      result,
      playlists: session.playlists,
      showDestinationRows: session.playlistsState.body === 'content',
    });

  const renderRow = ({ item }: { item: SpotifyImportListRow }) => {
    if (result === undefined || link === null) return null;
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
            onPlay={() => session.play(item.index)}
            onActions={() => showTrackActions(item.track, session.setRuntimeError)}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
          />
        );
      case 'save-controls':
        return (
          <SpotifyImportSaveControls
            name={session.newName}
            saving={session.saving}
            savingNew={session.savingNew}
            onChangeName={session.setNewName}
            onSaveNew={session.saveToNew}
          />
        );
      case 'destinations-state':
        return (
          <SearchRemoteBoundary
            id="spotify-import-destinations"
            state={session.playlistsState}
            loadingLabel={strings.search.remoteLoading(destinationsTitle)}
            emptyLabel={strings.search.importNoPlaylists}
            offlineLabel={strings.search.remoteOffline(destinationsTitle)}
            errorLabel={strings.search.remoteLoadFailed(destinationsTitle)}
            cachedOfflineLabel={strings.search.remoteCachedOffline(destinationsTitle)}
            cachedErrorLabel={strings.search.remoteCachedRefreshFailed(destinationsTitle)}
            refreshingLabel={strings.search.remoteRefreshing(destinationsTitle)}
            staleLabel={strings.search.remoteStale(destinationsTitle)}
            retryLabel={strings.search.retrySection(destinationsTitle)}
            retryBusy={session.playlistsBusy}
            onRetry={session.retryPlaylists}
            loadingFallback={(props) => <TrackRowSkeleton count={3} {...props} />}
          >
            {null}
          </SearchRemoteBoundary>
        );
      case 'destination':
        return (
          <SpotifyImportDestinationRow
            playlist={item.playlist}
            saving={session.saving}
            busy={session.savingPlaylistId === item.playlist.id}
            onPress={() => session.saveToExisting(item.playlist)}
          />
        );
      case 'unmatched-header':
        return <SpotifyImportUnmatchedHeader />;
      case 'unmatched-track':
        return <SpotifyImportUnmatchedRow track={item.track} />;
    }
  };

  return (
    <SpotifyImportVirtualizedList
      accessibilityLabel={title}
      rows={rows}
      bottomInset={bottomInset}
      renderRow={renderRow}
      header={listHeader}
    />
  );
}
