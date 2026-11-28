import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportPlayerError } from '../player/errors';
import { strings } from '../localization';
import type { Track } from '../api/types';
import { musicQueries } from '../data';

/**
 * Cold `/api/search` track hits carry only the primary performer to avoid
 * blocking N+1 `/track/{id}` calls on search. Hydrate full ordered contributor
 * credits lazily when a single-credit track actually starts playing.
 */
export function needsTrackCreditsHydration(track: Track | null): boolean {
  if (track === null) return false;
  return /^\d+$/.test(track.id) && track.artists.length <= 1;
}

export function mergeHydratedTrackCredits(
  track: Track,
  hydrated: Track | undefined,
): Track {
  if (
    hydrated === undefined
    || hydrated.id !== track.id
    || hydrated.artists.length <= track.artists.length
  ) {
    return track;
  }
  return {
    ...track,
    artist: hydrated.artist,
    artist_id: hydrated.artist_id,
    artists: hydrated.artists,
  };
}

/**
 * Non-blocking lazy full-credits hydration for the currently playing track.
 * Playback and primary-artist metadata render immediately; when full credits
 * arrive from `/api/tracks/{id}` (1h staleTime), contributor links appear.
 */
export function useHydratedTrackCredits(track: Track | null): Track | null {
  const shouldFetch = needsTrackCreditsHydration(track);
  const trackId = shouldFetch && track !== null ? track.id : '__unused__';
  const query = useQuery({
    ...musicQueries.track(trackId),
    enabled: shouldFetch,
    retry: false,
  });

  useEffect(() => {
    if (shouldFetch && query.error !== null) {
      reportPlayerError(strings.player.trackCreditsFailed, query.error);
    }
  }, [query.error, shouldFetch]);

  return useMemo(
    () => (track === null ? null : mergeHydratedTrackCredits(track, query.data)),
    [query.data, track],
  );
}
