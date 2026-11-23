import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layout, metrics, typography } from '../theme';
import {
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
  useTvEnvironment,
} from './tvEnvironment';

const mocks = vi.hoisted(() => ({
  platform: {
    OS: 'android' as string,
    isTV: false as unknown,
    constants: { uiMode: 'normal' as unknown },
  },
  windowSize: { width: 390, height: 844 },
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useMemo: <T,>(factory: () => T) => factory(),
    useSyncExternalStore: <T,>(_sub: unknown, getSnapshot: () => T) => getSnapshot(),
  };
});

vi.mock('react-native', () => ({
  Platform: mocks.platform,
  Dimensions: {
    get: () => mocks.windowSize,
  },
  useWindowDimensions: () => mocks.windowSize,
}));

beforeEach(() => {
  resetTvEnvironmentForTests();
  mocks.platform.OS = 'android';
  mocks.platform.isTV = false;
  mocks.platform.constants = { uiMode: 'normal' };
  mocks.windowSize = { width: 390, height: 844 };
});

afterEach(() => {
  resetTvEnvironmentForTests();
});

describe('tvEnvironment', () => {
  it('detects Android TV via Platform.isTV and supports reactive overrides', () => {
    expect(isTvMode()).toBe(false);
    expect(getTvModeOverride()).toBeNull();

    mocks.platform.isTV = true;
    expect(isTvMode()).toBe(true);

    const listener = vi.fn();
    const unsubscribe = subscribeTvModeOverride(listener);
    setTvModeOverride(false);
    expect(isTvMode()).toBe(false);
    expect(getTvModeOverride()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    setTvModeOverride(true);
    expect(isTvMode()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    setTvModeOverride(null);
    expect(isTvMode()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(3);

    unsubscribe();
    setTvModeOverride(false);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('reads Android constants.uiMode when Platform.isTV is absent and fails loudly on invalid types', () => {
    mocks.platform.isTV = undefined;
    mocks.platform.constants = { uiMode: 'tv' };
    expect(isTvMode()).toBe(true);

    mocks.platform.constants = { uiMode: 'normal' };
    expect(isTvMode()).toBe(false);

    mocks.platform.isTV = 'yes';
    expect(() => isTvMode()).toThrow(TypeError);

    mocks.platform.isTV = false;
    expect(() => setTvModeOverride('tv' as unknown as boolean)).toThrow(TypeError);
  });

  it('preserves phone layout metrics and exact theme typography when not in TV mode', () => {
    const phone = computeTvEnvironment({ width: 390, height: 844 }, false);
    expect(phone.isTv).toBe(false);
    expect(phone.isWidescreen).toBe(false);
    expect(phone.scale).toBe(1);
    expect(phone.overscan).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(phone.navRailWidth).toBe(0);
    expect(phone.navRailTotalWidth).toBe(0);
    expect(phone.contentWidth).toBe(390);
    expect(phone.contentPaddingHorizontal).toBe(layout.pagePadding);
    expect(phone.minFocusTargetHeight).toBe(metrics.minimumTouchTarget);
    expect(phone.focusScale).toBe(1);
    expect(phone.typography).toBe(typography);
  });

  it('computes 5% overscan insets, widescreen rail/grid geometry, and 10-foot typography on 16:9 TVs', () => {
    const tv = computeTvEnvironment(
      { width: TV_REFERENCE_WIDTH, height: TV_REFERENCE_HEIGHT },
      true,
    );
    expect(tv.isTv).toBe(true);
    expect(tv.isWidescreen).toBe(true);
    expect(tv.aspectRatio).toBeCloseTo(16 / 9, 4);
    expect(tv.scale).toBe(1);
    expect(tv.overscan).toEqual({
      top: Math.round(TV_REFERENCE_HEIGHT * TV_OVERSCAN_RATIO),
      right: Math.round(TV_REFERENCE_WIDTH * TV_OVERSCAN_RATIO),
      bottom: Math.round(TV_REFERENCE_HEIGHT * TV_OVERSCAN_RATIO),
      left: Math.round(TV_REFERENCE_WIDTH * TV_OVERSCAN_RATIO),
    });
    expect(tv.overscan).toEqual({ top: 27, right: 48, bottom: 27, left: 48 });
    expect(tv.navRailTotalWidth).toBe(tv.navRailWidth + tv.overscan.left);
    expect(tv.contentWidth).toBe(TV_REFERENCE_WIDTH - tv.navRailTotalWidth - tv.overscan.right);
    expect(tv.gridColumns).toBeGreaterThanOrEqual(3);
    expect(tv.cardSize).toBeGreaterThan(120);
    expect(tv.minFocusTargetHeight).toBeGreaterThanOrEqual(52);
    expect(tv.focusScale).toBeGreaterThan(1);

    // 10-foot legible typography: larger than phone tokens and readable line heights.
    expect(tv.typography.body.fontSize).toBeGreaterThan(typography.body.fontSize);
    expect(tv.typography.caption.fontSize).toBeGreaterThanOrEqual(14);
    expect(tv.typography.micro.fontSize).toBeGreaterThanOrEqual(13);
    expect(tv.typography.overline.textTransform).toBe('uppercase');
    for (const token of Object.values(tv.typography)) {
      expect(token.lineHeight).toBeGreaterThan(token.fontSize);
    }
  });

  it('scales gracefully on wider 16:9 TV viewports and exposes hook & snapshot helpers', () => {
    mocks.platform.isTV = true;
    mocks.windowSize = { width: 1280, height: 720 };

    const snapshot = getTvEnvironment();
    const fromHook = useTvEnvironment();
    expect(fromHook).toEqual(snapshot);
    expect(snapshot.scale).toBeCloseTo(1280 / 960, 4);
    expect(snapshot.overscan).toEqual({ top: 36, right: 64, bottom: 36, left: 64 });
    expect(buildTvTypography(false, 1.3)).toBe(typography);
  });

  it('fails loudly on invalid viewport dimensions', () => {
    expect(() => computeTvEnvironment({ width: 0, height: 540 }, true)).toThrow(RangeError);
    expect(() => computeTvEnvironment({ width: 960, height: -10 }, true)).toThrow(RangeError);
    expect(() => computeTvEnvironment({ width: Number.NaN, height: 540 }, false)).toThrow(
      RangeError,
    );
  });
});
