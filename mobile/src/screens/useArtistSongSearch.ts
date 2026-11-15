import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { musicQueries } from '../data';
import { artistSongSearchQuery, filterArtistTracks } from './catalogModel';

const DEBOUNCE_MS = 300;
const STALE_MS = 5 * 60_000;

/**
 * The "search this artist's songs" state: the raw input, its debounced
 * query and the filtered results. Both values are keyed by artist id, so
 * navigating from one artist to another starts with an empty field instead
 * of carrying the previous artist's query over.
 */
export function useArtistSongSearch(artistId: string, artistName: string) {
  const [inputState, setInputState] = useState({ artistId, value: '' });
  const [queryState, setQueryState] = useState({ artistId, value: '' });
  const input = inputState.artistId === artistId ? inputState.value : '';
  const query = queryState.artistId === artistId ? queryState.value : '';

  useEffect(() => {
    const timer = setTimeout(
      () => setQueryState({ artistId, value: input.trim() }),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [artistId, input]);

  const request = artistSongSearchQuery(artistName, query);
  const search = useQuery({
    ...musicQueries.searchTracks(request ?? ''),
    enabled: request !== null,
    staleTime: STALE_MS,
  });

  return {
    input,
    setInput: (value: string) => setInputState({ artistId, value }),
    /** The debounced, trimmed query. Empty while the search is inactive. */
    query,
    active: query.length > 0,
    enabled: request !== null,
    search,
    results: filterArtistTracks(search.data ?? [], artistId, artistName),
  };
}

export type ArtistSongSearch = ReturnType<typeof useArtistSongSearch>;
