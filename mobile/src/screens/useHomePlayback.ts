import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import type { DeezerId, Track } from '../api/types';
import { showTrackActions } from '../components/trackActions';
import { musicQueries, queryKeys } from '../data';
import type { RecentPlay } from '../domain/listeningStats';
import { strings } from '../localization';
import { playTrackRow, playTracks, togglePlay } from '../player/controller';
import { reportPlayerError } from '../player/errors';
import { mediaItemToTrack } from '../player/mediaItem';
import Player from '../player/player';
import type { QueueContext } from '../player/queueContract';
import { startRecentlyHeardPlayback } from './homePlayback';

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  return String(error);
}

/**
 * The playback actions of the Home feed. Every failure is reported through
 * the player error surface; nothing is swallowed.
 */
export function useHomePlayback(recent: readonly RecentPlay[], userId: number) {
  const queryClient = useQueryClient();
  const [recentPlaybackIndex, setRecentPlaybackIndex] = useState<number | null>(null);
  const recentPlaybackInFlight = useRef(false);

  /** Explicit shelf/collection play-all: replaces queue and starts playback. */
  const playContext = useCallback(
    (tracks: readonly Track[], index: number, context: QueueContext) => {
      if (tracks.length === 0 || index < 0 || index >= tracks.length) {
        throw new Error(`Invalid home playback context (${tracks.length} tracks, index ${index})`);
      }
      void playTracks([...tracks], index, { context }).catch((error) =>
        reportPlayerError(strings.home.playFailed, error),
      );
    },
    [],
  );

  /** Track-rail card activation: toggles play/pause if the tapped track is already active. */
  const playTrackContext = useCallback(
    (tracks: readonly Track[], index: number, context: QueueContext) => {
      if (tracks.length === 0 || index < 0 || index >= tracks.length) {
        throw new Error(`Invalid home playback context (${tracks.length} tracks, index ${index})`);
      }
      void playTrackRow([...tracks], index, { context }).catch((error) =>
        reportPlayerError(strings.home.playFailed, error),
      );
    },
    [],
  );

  /**
   * Starts the tapped recent track immediately without waiting on the rest of
   * history, toggles play/pause if already active, and hydrates remaining
   * recent tracks cleanly in the background.
   */
  const playRecent = useCallback(
    (index: number) => {
      if (recentPlaybackInFlight.current) return;
      recentPlaybackInFlight.current = true;
      setRecentPlaybackIndex(index);
      void startRecentlyHeardPlayback({
        recent: [...recent],
        startIndex: index,
        contextId: userId,
        contextLabel: strings.queue.recentContext,
        resolveTrack: (id) => queryClient.fetchQuery(musicQueries.track(id)),
        getCachedTrack: (id) => queryClient.getQueryData<Track>(queryKeys.catalog.track(id)),
        toggleActiveTrack: (trackId) => {
          const activeItem = Player.getActiveMediaItem();
          const activeTrack = activeItem === null ? null : mediaItemToTrack(activeItem);
          if (activeTrack?.id === trackId) {
            togglePlay();
            return true;
          }
          return false;
        },
        startPlayback: playTrackRow,
        hydrateRemaining: async (remainingIds: readonly DeezerId[]) => {
          const uncached = remainingIds.filter(
            (id) => queryClient.getQueryData<Track>(queryKeys.catalog.track(id)) === undefined,
          );
          if (uncached.length === 0) return;
          const settled = await Promise.allSettled(
            uncached.map((id) => queryClient.fetchQuery(musicQueries.track(id))),
          );
          const failures: string[] = [];
          settled.forEach((outcome, position) => {
            if (outcome.status === 'rejected') {
              failures.push(`${uncached[position]}: ${formatErrorMessage(outcome.reason)}`);
            }
          });
          if (failures.length > 0) {
            throw new Error(
              `Failed to hydrate ${failures.length} recent track(s): ${failures.join('; ')}`,
            );
          }
        },
        onHydrationError: (error) => reportPlayerError(strings.home.playFailed, error),
      })
        .catch((error) => reportPlayerError(strings.home.playFailed, error))
        .finally(() => {
          recentPlaybackInFlight.current = false;
          setRecentPlaybackIndex(null);
        });
    },
    [queryClient, recent, userId],
  );

  const showActions = useCallback(
    (track: Track) =>
      showTrackActions(track, (message) =>
        reportPlayerError(strings.home.playFailed, new Error(message)),
      ),
    [],
  );

  return { playContext, playTrackContext, playRecent, recentPlaybackIndex, showActions };
}
