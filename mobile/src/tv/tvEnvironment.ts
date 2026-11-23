import { useMemo, useSyncExternalStore } from 'react';
import { Dimensions, Platform, useWindowDimensions } from 'react-native';
import { layout, metrics, spacing, typography, type TypographyVariant } from '../theme';

/** Official Android TV Leanback overscan safety margin (5% on each edge). */
export const TV_OVERSCAN_RATIO = 0.05;
/** Canonical Android TV dp canvas (720p tvdpi, 1080p xhdpi, and 4K xxxhdpi normalize to ~960x540dp). */
export const TV_REFERENCE_WIDTH = 960;
export const TV_REFERENCE_HEIGHT = 540;
/** Minimum width/height ratio considered a 16:9 / widescreen TV viewport. */
export const TV_WIDESCREEN_MIN_RATIO = 1.5;

export interface TvOverscanInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface TvTypeToken {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: (typeof typography)[TypographyVariant]['fontWeight'];
  readonly letterSpacing?: number;
  readonly textTransform?: 'uppercase';
}

export type TvTypographyScale = Readonly<Record<TypographyVariant, TvTypeToken>>;

export interface TvEnvironment {
  readonly isTv: boolean;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: number;
  readonly isWidescreen: boolean;
  /** Scale factor relative to the canonical 960x540dp Android TV canvas (1 on phones). */
  readonly scale: number;
  /** 5% TV overscan insets when in TV mode; zero insets on phones. */
  readonly overscan: TvOverscanInsets;
  /** Inner width of the persistent left TV navigation rail (excluding left overscan). */
  readonly navRailWidth: number;
  /** Total left rail footprint including left overscan inset (0 on phones). */
  readonly navRailTotalWidth: number;
  /** Usable horizontal content width to the right of the TV rail and inside right overscan. */
  readonly contentWidth: number;
  readonly contentPaddingHorizontal: number;
  readonly sectionGap: number;
  readonly headerGap: number;
  readonly gridGap: number;
  readonly cardSize: number;
  readonly gridColumns: number;
  /** Primary column ratio for side-by-side 16:9 TV views (NowPlaying, Queue, Search, Library). */
  readonly splitPrimaryRatio: number;
  /** Minimum D-Pad focusable row/button height on TV (52dp) vs phone (48dp). */
  readonly minFocusTargetHeight: number;
  readonly focusRingWidth: number;
  readonly focusScale: number;
  /** 10-foot legible type scale on TV; exact theme typography on phones. */
  readonly typography: TvTypographyScale;
}

const ZERO_OVERSCAN: TvOverscanInsets = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

const TV_BASE_NAV_RAIL_WIDTH = 212;
const TV_BASE_CONTENT_PADDING = 28;
const TV_BASE_MIN_FOCUS_HEIGHT = 52;
const TV_BASE_FOCUS_RING_WIDTH = 3;
const TV_BASE_FOCUS_SCALE = 1.04;
const TV_SPLIT_PRIMARY_RATIO = 0.44;
const TV_MIN_SCALE = 0.9;
const TV_MAX_SCALE = 1.5;

/**
 * 10-foot viewing distance sizes at canonical 960x540dp TV viewport.
 * Keeps every body/label/metadata line legible at 3 meters (no 11-12dp copy).
 */
const TV_BASE_TYPE_SIZES: Readonly<
  Record<TypographyVariant, { readonly fontSize: number; readonly lineHeight: number }>
> = Object.freeze({
  display: { fontSize: 44, lineHeight: 52 },
  hero: { fontSize: 36, lineHeight: 44 },
  title: { fontSize: 28, lineHeight: 36 },
  section: { fontSize: 24, lineHeight: 30 },
  bodyStrong: { fontSize: 17, lineHeight: 24 },
  body: { fontSize: 17, lineHeight: 24 },
  callout: { fontSize: 15, lineHeight: 22 },
  caption: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 16, lineHeight: 22 },
  micro: { fontSize: 13, lineHeight: 18 },
  overline: { fontSize: 13, lineHeight: 18 },
});

const overrideListeners = new Set<() => void>();
let tvModeOverride: boolean | null = null;

function readPlatformTvFlag(): boolean {
  if (Platform === undefined || Platform === null) {
    throw new Error('React Native Platform API is unavailable');
  }
  const rawIsTv = (Platform as { isTV?: unknown }).isTV;
  if (typeof rawIsTv === 'boolean') return rawIsTv;
  if (rawIsTv !== undefined) {
    throw new TypeError(`Expected boolean Platform.isTV, received ${typeof rawIsTv}`);
  }
  if (Platform.OS === 'android') {
    const constants = (Platform as { constants?: { uiMode?: unknown } }).constants;
    if (constants?.uiMode !== undefined) {
      if (typeof constants.uiMode !== 'string') {
        throw new TypeError(
          `Expected string Platform.constants.uiMode, received ${typeof constants.uiMode}`,
        );
      }
      return constants.uiMode === 'tv';
    }
  }
  return false;
}

/**
 * Override TV mode explicitly (primarily for deterministic unit tests and dev previews).
 * Pass `null` to restore native `Platform.isTV` detection.
 */
export function setTvModeOverride(override: boolean | null): void {
  if (override !== null && typeof override !== 'boolean') {
    throw new TypeError(`Expected boolean or null TV mode override, received ${typeof override}`);
  }
  if (override === tvModeOverride) return;
  tvModeOverride = override;
  overrideListeners.forEach((listener) => listener());
}

/** Current explicit TV mode override, or `null` when following native `Platform.isTV`. */
export function getTvModeOverride(): boolean | null {
  return tvModeOverride;
}

/** Subscribe to runtime TV mode override changes. */
export function subscribeTvModeOverride(listener: () => void): () => void {
  overrideListeners.add(listener);
  return () => {
    overrideListeners.delete(listener);
  };
}

/** Whether the app is currently running in Android TV mode (native `Platform.isTV` or explicit override). */
export function isTvMode(): boolean {
  return tvModeOverride ?? readPlatformTvFlag();
}

/** Pure, deterministic TV typography scale builder. Returns `theme.typography` unchanged on phones. */
export function buildTvTypography(isTv: boolean, scale: number): TvTypographyScale {
  if (!isTv) return typography;
  const entries = (Object.keys(typography) as TypographyVariant[]).map((variant) => {
    const base = typography[variant];
    const tvBase = TV_BASE_TYPE_SIZES[variant];
    const fontSize = Math.round(tvBase.fontSize * scale);
    const lineHeight = Math.max(fontSize + 4, Math.round(tvBase.lineHeight * scale));
    const token: TvTypeToken = {
      fontSize,
      lineHeight,
      fontWeight: base.fontWeight,
      ...('letterSpacing' in base ? { letterSpacing: base.letterSpacing } : {}),
      ...('textTransform' in base ? { textTransform: base.textTransform } : {}),
    };
    return [variant, token] as const;
  });
  return Object.freeze(Object.fromEntries(entries) as Record<TypographyVariant, TvTypeToken>);
}

function assertValidDimensions(dimensions: { width: number; height: number }): void {
  if (
    !dimensions ||
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new RangeError(
      `Invalid viewport dimensions for TV metrics: width=${String(dimensions?.width)}, height=${String(dimensions?.height)}`,
    );
  }
}

/**
 * Pure computation of TV overscan margins, rail geometry, grid sizing, and 10-foot typography
 * from viewport dimensions and TV mode state.
 */
export function computeTvEnvironment(
  dimensions: { width: number; height: number },
  isTv: boolean,
): TvEnvironment {
  assertValidDimensions(dimensions);
  const { width, height } = dimensions;
  const aspectRatio = width / height;
  const isWidescreen = aspectRatio >= TV_WIDESCREEN_MIN_RATIO;

  if (!isTv) {
    return Object.freeze({
      isTv: false,
      width,
      height,
      aspectRatio,
      isWidescreen,
      scale: 1,
      overscan: ZERO_OVERSCAN,
      navRailWidth: 0,
      navRailTotalWidth: 0,
      contentWidth: width,
      contentPaddingHorizontal: layout.pagePadding,
      sectionGap: layout.sectionGap,
      headerGap: layout.headerGap,
      gridGap: layout.railGap,
      cardSize: layout.artwork.card,
      gridColumns: 2,
      splitPrimaryRatio: 0.5,
      minFocusTargetHeight: metrics.minimumTouchTarget,
      focusRingWidth: TV_BASE_FOCUS_RING_WIDTH,
      focusScale: 1,
      typography,
    });
  }

  const rawScale = Math.min(width / TV_REFERENCE_WIDTH, height / TV_REFERENCE_HEIGHT);
  const scale = Math.min(Math.max(rawScale, TV_MIN_SCALE), TV_MAX_SCALE);

  const overscan: TvOverscanInsets = Object.freeze({
    top: Math.round(height * TV_OVERSCAN_RATIO),
    right: Math.round(width * TV_OVERSCAN_RATIO),
    bottom: Math.round(height * TV_OVERSCAN_RATIO),
    left: Math.round(width * TV_OVERSCAN_RATIO),
  });

  const navRailWidth = Math.round(TV_BASE_NAV_RAIL_WIDTH * scale);
  const navRailTotalWidth = navRailWidth + overscan.left;
  const contentPaddingHorizontal = Math.round(TV_BASE_CONTENT_PADDING * scale);
  const contentWidth = Math.max(
    Math.round(width - navRailTotalWidth - overscan.right),
    Math.round(TV_REFERENCE_WIDTH * 0.5),
  );
  const gridGap = Math.round(spacing.md * scale);
  const innerStageWidth = Math.max(contentWidth - contentPaddingHorizontal * 2, 320);
  const targetCardSize = Math.round(148 * scale);
  const gridColumns = Math.max(
    3,
    Math.min(6, Math.floor((innerStageWidth + gridGap) / (targetCardSize + gridGap))),
  );
  const cardSize = Math.floor((innerStageWidth - gridGap * (gridColumns - 1)) / gridColumns);

  return Object.freeze({
    isTv: true,
    width,
    height,
    aspectRatio,
    isWidescreen,
    scale,
    overscan,
    navRailWidth,
    navRailTotalWidth,
    contentWidth,
    contentPaddingHorizontal,
    sectionGap: Math.round(layout.sectionGap * scale),
    headerGap: Math.round(spacing.md * scale),
    gridGap,
    cardSize,
    gridColumns,
    splitPrimaryRatio: TV_SPLIT_PRIMARY_RATIO,
    minFocusTargetHeight: Math.round(TV_BASE_MIN_FOCUS_HEIGHT * scale),
    focusRingWidth: TV_BASE_FOCUS_RING_WIDTH,
    focusScale: TV_BASE_FOCUS_SCALE,
    typography: buildTvTypography(true, scale),
  });
}

/** Synchronous snapshot of the TV environment using `Dimensions.get('window')`. */
export function getTvEnvironment(): TvEnvironment {
  if (Dimensions === undefined || typeof Dimensions.get !== 'function') {
    throw new Error('React Native Dimensions.get API is unavailable');
  }
  const { width, height } = Dimensions.get('window');
  return computeTvEnvironment({ width, height }, isTvMode());
}

/**
 * Reactive hook returning TV mode, 5% overscan insets, 16:9 rail/grid metrics,
 * and 10-foot legible typography. Recomputes on viewport resize or override changes.
 */
export function useTvEnvironment(): TvEnvironment {
  if (typeof useWindowDimensions !== 'function') {
    throw new Error('React Native useWindowDimensions hook is unavailable');
  }
  const isTv = useSyncExternalStore(subscribeTvModeOverride, isTvMode, isTvMode);
  const { width, height } = useWindowDimensions();
  return useMemo(() => computeTvEnvironment({ width, height }, isTv), [width, height, isTv]);
}

/** Test-only reset for isolating TV override state between cases. */
export function resetTvEnvironmentForTests(): void {
  tvModeOverride = null;
  overrideListeners.clear();
}
