import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHasActiveTrack } from '../player/player';
import { layout, metrics, spacing } from '../theme';
import { useTvEnvironment } from '../tv/tvEnvironment';

/** TV MiniPlayer surface (76dp) + bottom margin (16dp) = 92dp clearance. */
export const TV_MINI_PLAYER_SURFACE_HEIGHT = 76;
export const TV_MINI_PLAYER_HEIGHT = TV_MINI_PLAYER_SURFACE_HEIGHT + spacing.md;

export interface BottomInsetInput {
  /** Bottom safe-area inset in dp. */
  safeAreaBottom: number;
  /** The screen sits inside the bottom tabs (which already absorb the safe area). */
  hasTabBar: boolean;
  /** The floating mini player is on screen. */
  miniPlayerVisible: boolean;
  /** Android TV mode uses the taller 76dp + 16dp TV MiniPlayer and hides bottom tabs. */
  isTv?: boolean;
  /** Additional space, e.g. for a screen-specific floating button. */
  extra?: number;
}

/** Pure inset maths, exported for tests and for non-hook callers. */
export function bottomInset({
  safeAreaBottom,
  hasTabBar,
  miniPlayerVisible,
  isTv = false,
  extra = 0,
}: BottomInsetInput): number {
  if (isTv) {
    const tvMiniPlayerFootprint = miniPlayerVisible
      ? Math.max(
          TV_MINI_PLAYER_HEIGHT,
          TV_MINI_PLAYER_SURFACE_HEIGHT + safeAreaBottom + metrics.miniPlayerGap,
        )
      : 0;
    return tvMiniPlayerFootprint + layout.scrollEndGap + extra;
  }
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
 * item clears the floating mini player (only while a track is loaded, using
 * the taller 92dp footprint on Android TV) and, outside the phone tabs, the
 * bottom safe area.
 */
export function useBottomInset({ hasTabBar = true, extra }: UseBottomInsetOptions = {}): number {
  const insets = useSafeAreaInsets();
  const miniPlayerVisible = useHasActiveTrack();
  const { isTv } = useTvEnvironment();
  return bottomInset({
    safeAreaBottom: insets.bottom,
    hasTabBar,
    miniPlayerVisible,
    isTv,
    extra,
  });
}
