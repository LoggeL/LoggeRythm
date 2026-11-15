import { beforeEach, describe, expect, it, vi } from 'vitest';
import { layout } from '../theme';
import { bottomInset, useBottomInset } from './useBottomInset';

const mocks = vi.hoisted(() => ({
  item: null as unknown,
  insets: { top: 0, right: 0, bottom: 34, left: 0 },
}));

vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mocks.insets }));
vi.mock('../player/player', () => ({ useActiveMediaItem: () => mocks.item }));
vi.mock('../player/mediaItem', () => ({
  mediaItemToTrack: (item: unknown) => (item == null ? null : { id: 'track' }),
}));

beforeEach(() => {
  mocks.item = null;
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
});

describe('useBottomInset', () => {
  it('follows the active media item and the tab-bar option', () => {
    expect(useBottomInset()).toBe(layout.scrollEndGap);
    expect(useBottomInset({ hasTabBar: false })).toBe(34 + layout.scrollEndGap);
    mocks.item = { mediaId: '1' };
    expect(useBottomInset()).toBe(layout.miniPlayerHeight + layout.scrollEndGap);
    expect(useBottomInset({ hasTabBar: false, extra: 8 }))
      .toBe(34 + layout.miniPlayerHeight + layout.scrollEndGap + 8);
  });
});
