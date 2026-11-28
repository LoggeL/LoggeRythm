import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { musicQueries } from '../data';
import { artistSongSearchQuery, filterArtistTracks } from './catalogModel';

const DEBOUNCE_MS = 300;
const STALE_MS = 5 * 60_000;
const MIN_DEBOUNCED_QUERY_CHARS = 2;

/**
 * The "search this artist's songs" state: the raw input, its debounced
 * query and the filtered results. Both values are keyed by artist id, so
 * navigating from one artist to another starts with an empty field instead
 * of carrying the previous artist's query over.
 *
 * While typing a replacement query, the active observer switches off the old
 * key immediately so TanStack Query aborts the superseded request when this
 * hook was its last observer without cancelling other mounted screens.
 */
export function useArtistSongSearch(scope: string, artistId: string, artistName: string) {
  const [inputState, setInputState] = useState({ artistId, value: '' });
  const [queryState, setQueryState] = useState({ artistId, value: '' });
  const input = inputState.artistId === artistId ? inputState.value : '';
  const query = queryState.artistId === artistId ? queryState.value : '';
  const trimmedInput = input.trim();

  useEffect(() => {
    if (trimmedInput === query || Array.from(trimmedInput).length < MIN_DEBOUNCED_QUERY_CHARS) {
      return undefined;
    }
    const timer = setTimeout(
      () => setQueryState({ artistId, value: trimmedInput }),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [artistId, query, trimmedInput]);

  const queryMatchesInput = trimmedInput === query;
  const activeRequest = queryMatchesInput ? artistSongSearchQuery(artistName, query) : null;

  const search = useQuery({
    ...musicQueries.searchTracks(scope, activeRequest ?? ''),
    enabled: activeRequest !== null,
    staleTime: STALE_MS,
  });

  const setInput = useCallback((value: string) => {
    setInputState({ artistId, value });
    if (Array.from(value.trim()).length < MIN_DEBOUNCED_QUERY_CHARS) {
      setQueryState((previous) =>
        previous.artistId === artistId && previous.value === ''
          ? previous
          : { artistId, value: '' },
      );
    }
  }, [artistId]);

  const submit = useCallback(() => {
    if (trimmedInput.length === 0) return;
    setQueryState({ artistId, value: trimmedInput });
  }, [artistId, trimmedInput]);

  return {
    input,
    setInput,
    submit,
    /** The debounced (or explicitly submitted), outer-trimmed query. Empty while inactive. */
    query: queryMatchesInput ? query : '',
    active: activeRequest !== null,
    enabled: activeRequest !== null,
    search,
    results: activeRequest !== null ? filterArtistTracks(search.data ?? [], artistId, artistName) : [],
  };
}

export type ArtistSongSearch = ReturnType<typeof useArtistSongSearch>;
