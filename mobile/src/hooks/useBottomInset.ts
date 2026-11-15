import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mediaItemToTrack } from '../player/mediaItem';
import { useActiveMediaItem } from '../player/player';
import { layout } from '../theme';

export interface BottomInsetInput {
  /** Bottom safe-area inset in dp. */
  safeAreaBottom: number;
  /** The screen sits inside the bottom tabs (which already absorb the safe area). */
  hasTabBar: boolean;
  /** The floating mini player is on screen. */
  miniPlayerVisible: boolean;
  /** Additional space, e.g. for a screen-specific floating button. */
  extra?: number;
}

/** Pure inset maths, exported for tests and for non-hook callers. */
export function bottomInset({
  safeAreaBottom,
  hasTabBar,
  miniPlayerVisible,
  extra = 0,
}: BottomInsetInput): number {
  return (
    (hasTabBar ? 0 : safeAreaBottom) +
    (miniPlayerVisible ? layout.miniPlayerHeight : 0) +
    layout.scrollEndGap +
    extra
  );
}

export interface UseBottomInsetOptions {
  /** false for screens outside the tab navigator (Profile, modals). Default true. */
  hasTabBar?: boolean;
  extra?: number;
}

/**
 * The `paddingBottom` a scroll view's content container needs so its last
 * item clears the floating mini player (only while a track is loaded) and,
 * outside the tabs, the bottom safe area. Replaces the hardcoded
 * `paddingBottom: 144/140/120` values:
 *
 *   const bottom = useBottomInset();
 *   <FlatList contentContainerStyle={[styles.content, { paddingBottom: bottom }]} />
 */
export function useBottomInset({ hasTabBar = true, extra }: UseBottomInsetOptions = {}): number {
  const insets = useSafeAreaInsets();
  const item = useActiveMediaItem();
  return bottomInset({
    safeAreaBottom: insets.bottom,
    hasTabBar,
    miniPlayerVisible: mediaItemToTrack(item) !== null,
    extra,
  });
}
