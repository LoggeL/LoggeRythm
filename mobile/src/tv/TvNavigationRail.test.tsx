import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../test/render';
import { computeTvEnvironment, type TvEnvironment } from './tvEnvironment';
import {
  TV_NAV_FOCUS_KEYS,
  TvNavigationRail,
  TvShellLayout,
} from './TvNavigationRail';

const mocks = vi.hoisted(() => ({
  tvEnv: null as TvEnvironment | null,
}));

vi.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
  },
}));

vi.mock('../components/AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../components/BrandLockup', () => ({ default: 'BrandLockup' }));
vi.mock('./tvEnvironment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tvEnvironment')>();
  return {
    ...actual,
    useTvEnvironment: () => {
      if (!mocks.tvEnv) throw new Error('tvEnv test fixture not initialized');
      return mocks.tvEnv;
    },
  };
});
vi.mock('./TvFocusRegistry', () => ({
  TvFocusScope: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./TvFocusable', () => ({
  TvFocusable: ({ children: rawChildren, ...rest }: Record<string, unknown>) => {
    const children =
      typeof rawChildren === 'function'
        ? (rawChildren as (state: { pressed: boolean; focused: boolean }) => React.ReactNode)({
            pressed: false,
            focused: false,
          })
        : rawChildren;
    return React.createElement('TvFocusable', rest, children as React.ReactNode);
  },
}));

beforeEach(() => {
  mocks.tvEnv = computeTvEnvironment({ width: 960, height: 540 }, true);
});

describe('TvNavigationRail', () => {
  it('renders 10-foot primary destinations, playback shortcuts, profile, and overscan padding', () => {
    const onSelectTab = vi.fn();
    const onOpenNowPlaying = vi.fn();
    const onOpenQueue = vi.fn();
    const onOpenProfile = vi.fn();

    const rendered = TvNavigationRail({
      activeRoute: 'HomeTab',
      onSelectTab,
      onOpenNowPlaying,
      onOpenQueue,
      onOpenProfile,
      nowPlaying: {
        title: 'Midnight Groove',
        artist: 'Neon Pulse',
        isPlaying: true,
        queueCount: 14,
      },
      profileAttention: true,
      contentEntryFocusKey: 'home-first-card',
      preferredFocus: true,
    });

    const tvEnv = mocks.tvEnv!;
    const rail = byTestId(rendered, 'tv-navigation-rail');
    const railStyle = flatStyle(rail.props.style);
    expect(railStyle.width).toBe(tvEnv.navRailTotalWidth);
    expect(railStyle.paddingLeft).toBeGreaterThanOrEqual(tvEnv.overscan.left);
    expect(railStyle.paddingTop).toBeGreaterThanOrEqual(tvEnv.overscan.top);
    expect(railStyle.paddingBottom).toBeGreaterThanOrEqual(tvEnv.overscan.bottom);

    // Decorative masthead must never capture Android TV D-Pad focus.
    const brandLockups = byType(rendered, 'BrandLockup');
    expect(brandLockups).toHaveLength(1);
    expect(brandLockups[0].props.accessible).toBe(false);
    expect(brandLockups[0].props.focusable).toBe(false);
    expect(brandLockups[0].props.importantForAccessibility).toBe('no-hide-descendants');

    // Compact row heights keep all 8 rail items (including Profile) within 540dp TV height + 5% overscan.
    const homeStyle = flatStyle(byTestId(rendered, 'tv-nav-home').props.style);
    const nowPlayingStyle = flatStyle(byTestId(rendered, 'tv-nav-now-playing').props.style);
    expect(homeStyle.minHeight).toBeLessThanOrEqual(42);
    expect(nowPlayingStyle.minHeight).toBeLessThanOrEqual(50);

    const home = byTestId(rendered, 'tv-nav-home');
    expect(home.props.focusKey).toBe(TV_NAV_FOCUS_KEYS.HomeTab);
    expect(home.props.preferredFocus).toBe(true);
    expect(home.props.nextFocusRightKey).toBe('home-first-card');
    expect(home.props.accessibilityState).toEqual({ selected: true });
    expect(byTestId(rendered, 'tv-nav-home-active-marker')).toBeTruthy();

    const search = byTestId(rendered, 'tv-nav-search');
    expect(search.props.preferredFocus).toBe(false);
    expect(search.props.accessibilityLabel).toBe(strings.navigation.search);
    (search.props.onPress as () => void)();
    expect(onSelectTab).toHaveBeenCalledWith('SearchTab');

    expect(byTestId(rendered, 'tv-nav-library')).toBeTruthy();
    expect(byTestId(rendered, 'tv-nav-discover')).toBeTruthy();
    expect(byTestId(rendered, 'tv-nav-radio')).toBeTruthy();

    const nowPlaying = byTestId(rendered, 'tv-nav-now-playing');
    expect(textContent(nowPlaying)).toContain('Midnight Groove');
    expect(textContent(nowPlaying)).toContain('Neon Pulse');
    (nowPlaying.props.onPress as () => void)();
    expect(onOpenNowPlaying).toHaveBeenCalledTimes(1);

    const queue = byTestId(rendered, 'tv-nav-queue');
    expect(textContent(queue)).toContain(strings.queue.title);
    expect(textContent(queue)).toContain('14');
    (queue.props.onPress as () => void)();
    expect(onOpenQueue).toHaveBeenCalledTimes(1);

    const profile = byTestId(rendered, 'tv-nav-profile');
    expect(byTestId(rendered, 'tv-nav-profile-attention-dot')).toBeTruthy();
    (profile.props.onPress as () => void)();
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it('omits optional radio and playback shortcuts cleanly when not requested', () => {
    const rendered = TvNavigationRail({
      activeRoute: 'LibraryTab',
      onSelectTab: vi.fn(),
      onOpenProfile: vi.fn(),
      showRadio: false,
    });

    expect(queryByTestId(rendered, 'tv-nav-radio')).toBeNull();
    expect(queryByTestId(rendered, 'tv-nav-now-playing')).toBeNull();
    expect(queryByTestId(rendered, 'tv-nav-queue')).toBeNull();
    expect(byTestId(rendered, 'tv-nav-library').props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('TvShellLayout renders side-by-side rail + overscan content on TV and leaves phones untouched', () => {
    const tvRendered = TvShellLayout({
      activeRoute: 'HomeTab',
      onSelectTab: vi.fn(),
      onOpenProfile: vi.fn(),
      children: React.createElement('MainApp', { testID: 'main-app' }),
    });
    expect(byTestId(tvRendered, 'tv-shell-layout')).toBeTruthy();
    expect(byTestId(tvRendered, 'tv-navigation-rail')).toBeTruthy();
    const content = byTestId(tvRendered, 'tv-shell-content');
    const tvEnv = mocks.tvEnv!;
    expect(flatStyle(content.props.style)).toMatchObject({
      paddingTop: tvEnv.overscan.top,
      paddingRight: tvEnv.overscan.right,
      paddingBottom: tvEnv.overscan.bottom,
    });

    mocks.tvEnv = computeTvEnvironment({ width: 390, height: 844 }, false);
    const phoneRendered = TvShellLayout({
      activeRoute: 'HomeTab',
      onSelectTab: vi.fn(),
      onOpenProfile: vi.fn(),
      children: React.createElement('MainApp', { testID: 'main-app' }),
    });
    expect(queryByTestId(phoneRendered, 'tv-shell-layout')).toBeNull();
    expect(queryByTestId(phoneRendered, 'tv-navigation-rail')).toBeNull();
    expect(byTestId(phoneRendered, 'main-app')).toBeTruthy();
  });
});
