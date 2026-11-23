import type { NowPlayingTab } from '../components/player/NowPlayingTabs';
import type { MediaItem } from '../player/player';
import { queueContextOf, type QueueContextType } from '../player/queueContract';

export type NowPlayingBody = 'loading' | 'empty' | 'content';
export type NowPlayingTabDirection = 'previous' | 'next';
export type NowPlayingBackAction = 'return-to-playing' | 'dismiss';

export const NOW_PLAYING_TAB_ORDER: readonly NowPlayingTab[] = [
  'playing',
  'lyrics',
  'similar',
  'queue',
];

/** Side-panel tabs shown beside the persistent stage in 16:9 Android TV split mode. */
export const TV_NOW_PLAYING_PANEL_TABS: readonly Exclude<NowPlayingTab, 'playing'>[] = [
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

/**
 * Android Back steps secondary fullscreen surfaces (`lyrics`, `similar`, `queue`)
 * back to the `'playing'` stage before dismissing the modal on phones. In 16:9
 * TV split mode the stage is permanently visible, so Back dismisses directly.
 */
export function resolveNowPlayingBackAction(
  tab: NowPlayingTab,
  isTvSplit: boolean,
): NowPlayingBackAction {
  if (!isTvSplit && tab !== 'playing') return 'return-to-playing';
  return 'dismiss';
}

/** In 16:9 TV split mode the stage is always visible on the left; default right pane to Lyrics. */
export function resolveTvPanelTab(tab: NowPlayingTab): Exclude<NowPlayingTab, 'playing'> {
  return tab === 'playing' ? 'lyrics' : tab;
}

/**
 * Resolve the human-readable playback source label ("Playing from ...") from
 * the active queue item's semantic context metadata. Throws loudly on corrupt
 * partial context metadata via `queueContextOf`.
 */
export function resolveNowPlayingContextLabel(
  item: MediaItem | null,
  legacyLabel: (type: QueueContextType) => string,
): string | null {
  if (item === null) return null;
  const context = queueContextOf(item);
  if (context === null) return null;
  return context.label ?? legacyLabel(context.type);
}
