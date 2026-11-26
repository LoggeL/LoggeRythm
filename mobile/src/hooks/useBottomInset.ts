import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveConnectSnapshot } from '../connect/activeConnect';
import { useHasEffectiveActiveTrack } from '../connect/effectivePlaybackState';
import { useActivePartySnapshot } from '../party/activeParty';
import { layout, metrics, spacing } from '../theme';
import { useTvEnvironment } from '../tv/tvEnvironment';

/** Extra height occupied by the MiniPlayer output strip (remote Connect or active Jam). */
export const MINI_PLAYER_OUTPUT_STRIP_HEIGHT = 32;

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
 * Height of the mini player's second row ("Wiedergabe auf …" / Jam), or 0
 * while it is not shown. Everything that sits above the mini player has to
 * add it, or it lands on top of the bar while that row is visible.
 */
export function useMiniPlayerOutputStripHeight(): number {
  const miniPlayerVisible = useHasEffectiveActiveTrack();
  const connect = useActiveConnectSnapshot();
  const party = useActivePartySnapshot();
  const hasOutputStrip =
    miniPlayerVisible
    && (connect.isControllingRemote || (party.party !== null && !party.detached));
  return hasOutputStrip ? MINI_PLAYER_OUTPUT_STRIP_HEIGHT : 0;
}

/**
 * The `paddingBottom` a scroll view's content container needs so its last
 * item clears the floating mini player (only while a track is loaded, using
 * the taller 92dp footprint on Android TV) and, outside the phone tabs, the
 * bottom safe area.
 */
export function useBottomInset({ hasTabBar = true, extra = 0 }: UseBottomInsetOptions = {}): number {
  const insets = useSafeAreaInsets();
  const miniPlayerVisible = useHasEffectiveActiveTrack();
  const outputStripHeight = useMiniPlayerOutputStripHeight();
  const { isTv } = useTvEnvironment();
  return bottomInset({
    safeAreaBottom: insets.bottom,
    hasTabBar,
    miniPlayerVisible,
    isTv,
    extra: extra + outputStripHeight,
  });
}
