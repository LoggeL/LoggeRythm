import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { Track } from '../api/types';
import { showTrackActions } from '../components/trackActions';
import { musicQueries } from '../data';
import type { RecentPlay } from '../domain/listeningStats';
import { strings } from '../localization';
import { playTracks } from '../player/controller';
import { reportPlayerError } from '../player/errors';
import type { QueueContext } from '../player/queueContract';
import { startRecentlyHeardPlayback } from './homePlayback';

/**
 * The playback actions of the Home feed. Every failure is reported through
 * the player error surface; nothing is swallowed.
 */
export function useHomePlayback(recent: readonly RecentPlay[], userId: number) {
  const queryClient = useQueryClient();
  const [recentPlaybackIndex, setRecentPlaybackIndex] = useState<number | null>(null);
  const recentPlaybackInFlight = useRef(false);

  const playContext = (tracks: readonly Track[], index: number, context: QueueContext) => {
    if (tracks.length === 0 || index < 0 || index >= tracks.length) {
      throw new Error(`Invalid home playback context (${tracks.length} tracks, index ${index})`);
    }
    void playTracks([...tracks], index, { context }).catch((error) =>
      reportPlayerError(strings.home.playFailed, error),
    );
  };

  /** Resolves the history rows to tracks first; one hydration at a time. */
  const playRecent = (index: number) => {
    if (recentPlaybackInFlight.current) return;
    recentPlaybackInFlight.current = true;
    setRecentPlaybackIndex(index);
    void startRecentlyHeardPlayback({
      recent: [...recent],
      startIndex: index,
      contextId: userId,
      contextLabel: strings.queue.recentContext,
      resolveTrack: (id) => queryClient.fetchQuery(musicQueries.track(id)),
      startPlayback: playTracks,
    })
      .catch((error) => reportPlayerError(strings.home.playFailed, error))
      .finally(() => {
        recentPlaybackInFlight.current = false;
        setRecentPlaybackIndex(null);
      });
  };

  const showActions = (track: Track) =>
    showTrackActions(track, (message) =>
      reportPlayerError(strings.home.playFailed, new Error(message)),
    );

  return { playContext, playRecent, recentPlaybackIndex, showActions };
}
