/**
 * Android TV runtime, 16:9 layout metrics, D-Pad focus indicator, focus memory,
 * and 10-foot navigation rail foundation.
 *
 * Compatible with React Native 0.86 core (`Platform.isTV`, `Pressable`
 * `onFocus`/`onBlur`, `focusable`, `hasTVPreferredFocus`, Android `nextFocus*`).
 * Keeps phone and Android Auto behavior untouched when `isTv` is `false`.
 */
export {
  buildTvTypography,
  computeTvEnvironment,
  getTvEnvironment,
  getTvModeOverride,
  isTvMode,
  resetTvEnvironmentForTests,
  setTvModeOverride,
  subscribeTvModeOverride,
  TV_OVERSCAN_RATIO,
  TV_REFERENCE_HEIGHT,
  TV_REFERENCE_WIDTH,
  TV_WIDESCREEN_MIN_RATIO,
  useTvEnvironment,
  type TvEnvironment,
  type TvOverscanInsets,
  type TvTypographyScale,
  type TvTypeToken,
} from './tvEnvironment';

export {
  createTvFocusRegistry,
  resetTvFocusRegistryForTests,
  TvFocusScope,
  tvFocusRegistry,
  useTvFocusReturn,
  useTvFocusScope,
  type TvFocusCheckpoint,
  type TvFocusRegistry,
  type TvFocusReturnControls,
  type TvFocusScopeContextValue,
  type TvFocusScopeProps,
  type TvFocusTarget,
  type UseTvFocusReturnOptions,
} from './TvFocusRegistry';

export {
  resolveTvFocusRingColor,
  resolveTvRingRadius,
  TV_DEFAULT_FOCUS_SCALE,
  TV_FOCUS_RING_WIDTH,
  TvFocusRing,
  type TvFocusRingProps,
  type TvFocusRingTone,
} from './TvFocusRing';

export {
  TvFocusable,
  type TvFocusableProps,
  type TvFocusableRenderState,
  type TvNextFocusProps,
} from './TvFocusable';

export {
  TV_NAV_FOCUS_KEYS,
  TV_NAV_RAIL_SCOPE,
  TV_PRIMARY_DESTINATIONS,
  TvNavigationRail,
  TvShellLayout,
  type TvNavDestinationKey,
  type TvNavigationRailProps,
  type TvNavNowPlayingSummary,
  type TvNavPrimaryKey,
  type TvPrimaryDestinationMeta,
  type TvShellLayoutProps,
} from './TvNavigationRail';
