import { useSyncExternalStore } from 'react';
import { getDefaultPlayerPort } from './nativePlayerPort';
import type { MediaItem, PlaybackState, PlayerPort, Progress } from './playerPort';

function usePlayerSelector<T>(selector: (player: PlayerPort) => T): T {
  const player = getDefaultPlayerPort();
  return useSyncExternalStore(
    player.subscribe.bind(player),
    () => selector(player),
    () => selector(player),
  );
}

export function useActiveMediaItem(): MediaItem | null {
  return usePlayerSelector((player) => player.getActiveMediaItem());
}

export function useIsPlaying(): boolean {
  return usePlayerSelector((player) => player.isPlaying());
}

export function usePlaybackState(): PlaybackState {
  return usePlayerSelector((player) => player.getPlaybackState());
}

/**
 * Progress arrives through immutable native snapshots. `updateInterval` is kept
 * for drop-in call-site compatibility; native controls the actual event cadence.
 */
export function useProgress(updateInterval = 1): Progress {
  if (!Number.isFinite(updateInterval) || updateInterval <= 0) {
    throw new RangeError('Progress update interval must be positive');
  }
  return usePlayerSelector((player) => player.getSnapshot().progress as Progress);
}
