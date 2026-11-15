import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import type { Track } from '../api/types';
import {
  countUnseenReleaseRadarTracks,
  readReleaseRadarSeenTrackIds,
  releaseRadarSeenStorageKey,
  releaseRadarTrackIds,
} from '../data';
import { catalogFailureMessage } from './catalogFeedback';

export interface ReleaseRadarUnseen {
  /** 0 until the seen list of the current account has been read. */
  unseenCount: number;
  /** User-facing message when the seen list could not be read; never swallowed. */
  error: string | null;
}

/**
 * How many radar tracks the account has not opened yet. The seen list is
 * re-read whenever Home regains focus (the Radar screen writes it), and a
 * list loaded for another account scope never counts.
 */
export function useReleaseRadarUnseen(scope: string, tracks: readonly Track[]): ReleaseRadarUnseen {
  const isFocused = useIsFocused();
  const [seenTrackIds, setSeenTrackIds] = useState<readonly string[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storageKey = releaseRadarSeenStorageKey(scope);

  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    void readReleaseRadarSeenTrackIds(AsyncStorage, scope)
      .then((ids) => {
        if (!active) return;
        setSeenTrackIds(ids);
        setLoadedKey(storageKey);
        setError(null);
      })
      .catch((failure) => {
        if (!active) return;
        setSeenTrackIds([]);
        setLoadedKey(null);
        setError(catalogFailureMessage('radar-seen-state', failure));
      });
    return () => { active = false; };
  }, [isFocused, storageKey, scope]);

  return {
    unseenCount:
      loadedKey === storageKey
        ? countUnseenReleaseRadarTracks(releaseRadarTrackIds([...tracks]), seenTrackIds)
        : 0,
    error,
  };
}
