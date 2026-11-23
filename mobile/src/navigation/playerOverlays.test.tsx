import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, flatStyle } from '../test/render';
import { spacing } from '../theme';
import { computeTvEnvironment, type TvEnvironment } from '../tv/tvEnvironment';
import {
  PlayerErrorBanner,
  PlayerNoticeWithoutMiniPlayer,
  playerOverlayBottomOffset,
} from './playerOverlays';

const mocks = vi.hoisted(() => ({
  error: null as string | null,
  hasActiveTrack: false,
  bottomInset: 0,
  tvEnv: null as unknown as TvEnvironment,
  clearPlayerError: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useState: <T,>(initial: T | (() => T)) => [
      typeof initial === 'function' ? (initial as () => T)() : initial,
      vi.fn(),
    ],
  };
});

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: mocks.bottomInset, left: 0 }),
}));
vi.mock('../components/MiniPlayer', () => ({
  MINI_PLAYER_HEIGHT: 72,
  TAB_BAR_HEIGHT: 64,
}));
vi.mock('../components/PlayerNoticeBanner', () => ({ default: 'PlayerNoticeBanner' }));
vi.mock('../player/errors', () => ({
  usePlayerError: () => mocks.error,
  clearPlayerError: mocks.clearPlayerError,
}));
vi.mock('../player/player', () => ({
  useHasActiveTrack: () => mocks.hasActiveTrack,
}));
vi.mock('../tv', () => ({
  useTvEnvironment: () => mocks.tvEnv,
}));

describe('playerOverlays TV & phone clearance', () => {
  beforeEach(() => {
    mocks.error = null;
    mocks.hasActiveTrack = false;
    mocks.bottomInset = 0;
    mocks.tvEnv = computeTvEnvironment({ width: 390, height: 844 }, false);
    mocks.clearPlayerError.mockClear();
  });

  it('computes phone offsets with/without tab bar and TV offsets with 92dp MiniPlayer clearance and zero phone tab bar', () => {
    // Phone with tab bar: 64 + 12 + 72 + 8 = 156
    expect(
      playerOverlayBottomOffset({
        hasTabBar: true,
        bottomInset: 12,
        isTv: false,
        aboveMiniPlayer: true,
      }),
    ).toBe(64 + 12 + 72 + spacing.xs);

    // Phone without tab bar & without MiniPlayer: 12 + 8 = 20
    expect(
      playerOverlayBottomOffset({
        hasTabBar: false,
        bottomInset: 12,
        isTv: false,
        aboveMiniPlayer: false,
      }),
    ).toBe(12 + spacing.xs);

    // Android TV above MiniPlayer: never reserves 64dp phone tab bar; clears 92dp TV MiniPlayer + spacing.xs
    expect(
      playerOverlayBottomOffset({
        hasTabBar: true,
        bottomInset: 0,
        isTv: true,
        aboveMiniPlayer: true,
      }),
    ).toBe(92 + spacing.xs);

    // Android TV without MiniPlayer: sits cleanly at bottom edge (16dp), never floating 64dp up
    expect(
      playerOverlayBottomOffset({
        hasTabBar: true,
        bottomInset: 0,
        isTv: true,
        aboveMiniPlayer: false,
      }),
    ).toBe(spacing.md);
  });

  it('positions PlayerErrorBanner and PlayerNoticeWithoutMiniPlayer cleanly on Android TV', () => {
    mocks.tvEnv = computeTvEnvironment({ width: 960, height: 540 }, true);
    mocks.error = 'Playback failed';

    const banner = PlayerErrorBanner({ hasTabBar: true });
    expect(flatStyle(byTestId(banner, 'player-error-banner').props.style).bottom).toBe(
      92 + spacing.xs,
    );
    const dismiss = byTestId(banner, 'player-error-dismiss');
    expect(dismiss.props.focusable).toBe(true);
    (dismiss.props.onPress as () => void)();
    expect(mocks.clearPlayerError).toHaveBeenCalledOnce();

    mocks.hasActiveTrack = false;
    const notice = PlayerNoticeWithoutMiniPlayer({ hasTabBar: true });
    expect(notice?.props.bottom).toBe(spacing.md);

    mocks.hasActiveTrack = true;
    expect(PlayerNoticeWithoutMiniPlayer({ hasTabBar: false })).toBeNull();
  });
});
