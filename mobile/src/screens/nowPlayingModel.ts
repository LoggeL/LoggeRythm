import type { NowPlayingTab } from '../components/player/NowPlayingTabs';

export type NowPlayingBody = 'loading' | 'empty' | 'content';
export type NowPlayingTabDirection = 'previous' | 'next';

export const NOW_PLAYING_TAB_ORDER: readonly NowPlayingTab[] = [
  'playing',
  'lyrics',
  'similar',
  'queue',
];

/**
 * The authenticated navigator normally gates this screen on player readiness.
 * Keeping readiness explicit prevents a future deep-link/cold-start path from
 * misreporting an unhydrated native player as an actually empty queue.
 */
export function resolveNowPlayingBody(
  playerReady: boolean,
  hasActiveTrack: boolean,
): NowPlayingBody {
  if (!playerReady) return 'loading';
  return hasActiveTrack ? 'content' : 'empty';
}

export function adjacentNowPlayingTab(
  current: NowPlayingTab,
  direction: NowPlayingTabDirection,
): NowPlayingTab {
  const currentIndex = NOW_PLAYING_TAB_ORDER.indexOf(current);
  if (currentIndex < 0) return current;
  const offset = direction === 'next' ? 1 : -1;
  const nextIndex = currentIndex + offset;
  return NOW_PLAYING_TAB_ORDER[nextIndex] ?? current;
}
