import React, { useMemo, useState } from 'react';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import { useBottomInset } from '../../hooks/useBottomInset';
import { strings } from '../../localization';
import {
  normalizeSpotifyImportInput,
  SpotifyImportInputError,
  type SpotifyImportInputErrorCode,
  type SpotifyImportRequest,
} from '../../share/spotifyImport';
import { showTrackActions } from '../trackActions';
import { TrackRowSkeleton } from '../ui';
import { SearchRemoteBoundary } from './SearchRemoteStates';
import { SearchTrackResultRow } from './SearchResults';
import { SpotifyImportForm } from './SpotifyImportForm';
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
 * The Spotify link import: a link form, the resolved matches and the save
 * destinations, all rows of one vertical list so every control stays
 * reachable in landscape and with the keyboard open.
 */
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
  const bottomInset = useBottomInset();
  const link = submission?.link ?? null;
  const session = useSpotifyImportSession({
    accountScope,
    link,
    submissionId: submission?.id ?? null,
  });
  const { result } = session;

  const updateInput = (value: string) => {
    setInput(value);
    setInputError(null);
    setSubmission(null);
  };

  const submit = () => {
    try {
      const normalized = normalizeSpotifyImportInput(input);
      setInput(normalized);
      setInputError(null);
      setSubmission({ id: nextSubmissionId, link: normalized });
    } catch (error) {
      const code = error instanceof SpotifyImportInputError ? error.code : 'invalid';
      setInputError(inputErrorMessage(code));
      setSubmission(null);
    }
  };

  const title = strings.search.importTitle;
  const destinationsTitle = strings.search.importExistingPlaylists;
  const listHeader = (
    <>
      {header}
      <SpotifyImportForm
        value={input}
        error={inputError}
        onChangeText={updateInput}
        onSubmit={submit}
      />
      {link !== null ? (
        <SearchRemoteBoundary
          id="spotify-import-resolve"
          state={session.resultState}
          loadingLabel={strings.search.importResolving}
          emptyLabel={strings.search.importResolveFailed}
          offlineLabel={strings.search.remoteOffline(title)}
          errorLabel={strings.search.remoteLoadFailed(title)}
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
