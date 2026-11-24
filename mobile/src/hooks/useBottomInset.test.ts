import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_CONNECT_SNAPSHOT } from '../connect/connectModel';
import { IDLE_PARTY_SNAPSHOT } from '../party/activeParty';
import { layout } from '../theme';
import {
  bottomInset,
  MINI_PLAYER_OUTPUT_STRIP_HEIGHT,
  TV_MINI_PLAYER_HEIGHT,
  useBottomInset,
} from './useBottomInset';

const mocks = vi.hoisted(() => ({
  hasActiveTrack: false,
  isTv: false,
  controllingRemote: false,
  partyActive: false,
  insets: { top: 0, right: 0, bottom: 34, left: 0 },
}));

vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mocks.insets }));
vi.mock('../player/player', () => ({ useHasActiveTrack: () => mocks.hasActiveTrack }));
vi.mock('../connect/activeConnect', () => ({
  useActiveConnectSnapshot: () => ({
    ...IDLE_CONNECT_SNAPSHOT,
    isControllingRemote: mocks.controllingRemote,
  }),
}));
vi.mock('../party/activeParty', async (importOriginal) => ({
  ...await importOriginal<typeof import('../party/activeParty')>(),
  useActivePartySnapshot: () => ({
    ...IDLE_PARTY_SNAPSHOT,
    party: mocks.partyActive ? ({ code: 'JAM123' } as never) : null,
  }),
}));
vi.mock('../tv/tvEnvironment', () => ({
  useTvEnvironment: () => ({ isTv: mocks.isTv }),
}));

beforeEach(() => {
  mocks.hasActiveTrack = false;
  mocks.isTv = false;
  mocks.controllingRemote = false;
  mocks.partyActive = false;
  mocks.insets = { top: 0, right: 0, bottom: 34, left: 0 };
});

describe('bottomInset', () => {
  it('adds only the end gap inside the tabs while nothing is playing', () => {
    expect(bottomInset({ safeAreaBottom: 34, hasTabBar: true, miniPlayerVisible: false }))
      .toBe(layout.scrollEndGap);
  });

  it('clears the floating mini player while a track is loaded', () => {
    expect(bottomInset({ safeAreaBottom: 34, hasTabBar: true, miniPlayerVisible: true }))
      .toBe(layout.miniPlayerHeight + layout.scrollEndGap);
  });

  it('adds the safe area outside the tabs, plus any extra space', () => {
    expect(bottomInset({ safeAreaBottom: 34, hasTabBar: false, miniPlayerVisible: true, extra: 10 }))
      .toBe(34 + layout.miniPlayerHeight + layout.scrollEndGap + 10);
  });

  it('clears the taller 92dp Android TV MiniPlayer when isTv is true', () => {
    expect(TV_MINI_PLAYER_HEIGHT).toBe(92);
    expect(bottomInset({ safeAreaBottom: 0, hasTabBar: true, miniPlayerVisible: false, isTv: true }))
      .toBe(layout.scrollEndGap);
    expect(bottomInset({ safeAreaBottom: 0, hasTabBar: true, miniPlayerVisible: true, isTv: true }))
      .toBe(92 + layout.scrollEndGap);
    expect(bottomInset({ safeAreaBottom: 0, hasTabBar: false, miniPlayerVisible: true, isTv: true, extra: 12 }))
      .toBe(92 + layout.scrollEndGap + 12);
  });
});

describe('useBottomInset', () => {
  it('follows useHasActiveTrack, useTvEnvironment, and the tab-bar option', () => {
    expect(useBottomInset()).toBe(layout.scrollEndGap);
    expect(useBottomInset({ hasTabBar: false })).toBe(34 + layout.scrollEndGap);
    mocks.hasActiveTrack = true;
    expect(useBottomInset()).toBe(layout.miniPlayerHeight + layout.scrollEndGap);
    expect(useBottomInset({ hasTabBar: false, extra: 8 }))
      .toBe(34 + layout.miniPlayerHeight + layout.scrollEndGap + 8);

    mocks.isTv = true;
    mocks.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(useBottomInset()).toBe(92 + layout.scrollEndGap);
    mocks.hasActiveTrack = false;
    expect(useBottomInset()).toBe(layout.scrollEndGap);

    // Output strip (active Jam or remote Connect) adds clearance only while MiniPlayer is visible.
    mocks.isTv = false;
    mocks.hasActiveTrack = true;
    mocks.partyActive = true;
    expect(useBottomInset()).toBe(
      layout.miniPlayerHeight + layout.scrollEndGap + MINI_PLAYER_OUTPUT_STRIP_HEIGHT,
    );
  });
});
