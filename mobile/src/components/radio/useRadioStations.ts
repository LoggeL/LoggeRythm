import { useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Track } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { getCurrentApiBase } from '../../config';
import { musicCacheScope, musicQueries } from '../../data';
import type { RemoteFetchStatus } from '../../data/remoteState';
import { strings } from '../../localization';
import { playTracks, startRadio } from '../../player/controller';
import {
  RADIO_MOODS,
  orderedUniqueRadioTracks,
  personalStationIds,
  radioContentState,
} from '../../screens/radioModel';

function combinedFetchStatus(
  queries: readonly { fetchStatus: RemoteFetchStatus }[],
): RemoteFetchStatus {
  if (queries.some((query) => query.fetchStatus === 'paused')) return 'paused';
  if (queries.some((query) => query.fetchStatus === 'fetching')) return 'fetching';
  return 'idle';
}

/** Queue-context ids of the three station kinds; they double as the "starting" keys. */
export const radioStationKey = {
  personal: (trackId: string) => `personal:${trackId}`,
  mood: (tag: string) => `mood:${tag}`,
  genre: (genreId: string) => `genre:${genreId}`,
};

/**
 * Everything the radio screen needs: the personal, mood and genre queries
 * mapped to visual states, a combined refresh, and the single-flight station
 * starters with their user-facing failure message.
 */
export function useRadioStations() {
  const { user } = useAuth();
  if (user === null) throw new Error('RadioScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const scope = musicCacheScope(getCurrentApiBase(), user.id);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const stats = useQuery(musicQueries.stats(scope));
  const genres = useQuery(musicQueries.genres());
  const personalIds = useMemo(() => personalStationIds(stats.data?.recent ?? []), [stats.data?.recent]);
  const personalTracks = useQueries({
    queries: personalIds.map((id) => musicQueries.track(id)),
  });
  const moodTracks = useQueries({
    queries: RADIO_MOODS.map((mood) => musicQueries.mood(mood.tag)),
  });

  const personal = personalIds.flatMap((id, index) => {
    const track = personalTracks[index]?.data;
    return track === undefined ? [] : [{ id, track }];
  });
  const personalQueries = [stats, ...personalTracks];
  const personalError = stats.error
    ?? personalTracks.find((query) => query.error !== null)?.error
    ?? null;
  const personalHasData = stats.data !== undefined
    && (personalIds.length === 0 || personal.length > 0);
  const personalState = radioContentState({
    hasData: personalHasData,
    empty: personalHasData && personal.length === 0,
    pending: personalQueries.some((query) => query.isPending),
    fetching: personalQueries.some((query) => query.isFetching),
    stale: personalQueries.some((query) => query.isStale),
    fetchStatus: combinedFetchStatus(personalQueries),
    error: personalError,
  });
  const genreState = radioContentState({
    hasData: genres.data !== undefined,
    empty: genres.data !== undefined && genres.data.length === 0,
    pending: genres.isPending,
    fetching: genres.isFetching,
    stale: genres.isStale,
    fetchStatus: genres.fetchStatus,
    error: genres.error,
  });
  const moods = RADIO_MOODS.map((mood, index) => {
    const query = moodTracks[index];
    const tracks = orderedUniqueRadioTracks(query.data ?? []);
    return {
      tag: mood.tag,
      tracks,
      cover: tracks.find((track) => track.cover)?.cover ?? '',
      busy: query.isFetching,
      retry: () => void query.refetch(),
      state: radioContentState({
        hasData: query.data !== undefined,
        empty: query.data !== undefined && tracks.length === 0,
        pending: query.isPending,
        fetching: query.isFetching,
        stale: query.isStale,
        fetchStatus: query.fetchStatus,
        error: query.error,
      }),
    };
  });
  const everyQuery = [stats, genres, ...personalTracks, ...moodTracks];

  const runStation = async (key: string, title: string, action: () => Promise<void>) => {
    if (startingKey !== null) return;
    setStartingKey(key);
    setStartError(null);
    try {
      await action();
      AccessibilityInfo.announceForAccessibility(strings.radio.started(title));
    } catch (error) {
      setStartError(
        error instanceof Error && error.message === strings.radio.stationEmpty
          ? `${strings.radio.startFailed(title)}: ${strings.radio.stationEmpty}`
          : strings.radio.startFailed(title),
      );
    } finally {
      setStartingKey(null);
    }
  };

  const playStation = async (key: string, title: string, tracks: Track[]) => {
    if (tracks.length === 0) throw new Error(strings.radio.stationEmpty);
    await playTracks(tracks, 0, { radio: true, context: { type: 'radio', id: key, label: title } });
  };

  return {
    startingKey,
    startError,
    dismissStartError: () => setStartError(null),
    refreshing: manualRefreshing,
    refresh: () => {
      setManualRefreshing(true);
      void Promise.allSettled(everyQuery.map((query) => query.refetch())).finally(() =>
        setManualRefreshing(false),
      );
    },
    personal,
    personalState,
    personalBusy: personalQueries.some((query) => query.isFetching),
    retryPersonal: () => {
      void Promise.allSettled(personalQueries.map((query) => query.refetch()));
    },
    moods,
    genres: genres.data ?? [],
    genreState,
    genresBusy: genres.isFetching,
    retryGenres: () => void genres.refetch(),
    startPersonal: (track: Track) =>
      void runStation(radioStationKey.personal(String(track.id)), track.title, () => startRadio(track)),
    startMood: (tag: (typeof RADIO_MOODS)[number]['tag']) => {
      const key = radioStationKey.mood(tag);
      const title = strings.radio.moods[tag].title;
      const tracks = moods.find((mood) => mood.tag === tag)?.tracks ?? [];
      void runStation(key, title, () => playStation(key, title, tracks));
    },
    startGenre: (id: string, name: string) => {
      const key = radioStationKey.genre(id);
      const title = strings.radio.genreRadio(name);
      void runStation(key, title, async () => {
        const detail = await queryClient.fetchQuery(musicQueries.genre(id));
        await playStation(key, title, orderedUniqueRadioTracks(detail.tracks));
      });
    },
  };
}
