import { describe, expect, it, vi } from 'vitest';
import type { HomeShelf } from '../../api/types';
import { strings } from '../../localization';
import { colors } from '../../theme';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { HomeRadarCard, HomeRadarCardSkeleton } from './HomeRadarCard';

vi.mock('react-native', () => ({
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
  Skeleton: 'Skeleton',
}));

const shelf: HomeShelf = {
  key: 'release-radar',
  title: 'Your Release Radar',
  subtitle: 'New from artists you follow',
  cover: '',
  tracks: [
    {
      id: 'track-1',
      title: 'Midnight Signal',
      artist: 'LoggeRythm',
      artist_id: '7',
      artists: [{ id: '7', name: 'LoggeRythm' }],
      album: 'Parity',
      album_id: '9',
      cover: 'https://example.test/cover.jpg',
      duration_sec: 180,
      preview_url: 'https://example.test/preview.mp3',
      rank: 1,
      release_date: '2026-07-16',
    },
  ],
};

describe('HomeRadarCard', () => {
  it('is one link into the radar and falls back to the first track cover', () => {
    const onPress = vi.fn();
    const tree = HomeRadarCard({ shelf, testID: 'home-shelf-card-release-radar', onPress });
    const card = byTestId(tree, 'home-shelf-card-release-radar');

    expect(card.type).toBe('PressableScale');
    expect(card.props.accessibilityRole).toBe('link');
    expect(card.props.accessibilityLabel).toBe(strings.home.openShelf(shelf.title, 1));
    expect(byType(tree, 'Image')[0].props.source).toEqual({ uri: 'https://example.test/cover.jpg' });
    expect(textContent(tree)).toEqual([shelf.subtitle, strings.common.trackCount(1)]);
    expect(queryByTestId(tree, 'home-shelf-card-release-radar-status')).toBeNull();
    expect(flatStyle(card.props.style).backgroundColor).toBe(colors.surface);
    (card.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('renders and announces the unseen badge without changing open semantics', () => {
    const tree = HomeRadarCard({
      shelf,
      testID: 'home-shelf-radar',
      statusBadge: '3 neu',
      onPress: vi.fn(),
    });
    const card = byTestId(tree, 'home-shelf-radar');
    const badge = byTestId(tree, 'home-shelf-radar-status');

    expect(card.props.accessibilityRole).toBe('link');
    expect(card.props.accessibilityLabel).toBe(
      `${strings.home.openShelf(shelf.title, shelf.tracks.length)}. 3 neu`,
    );
    expect(flatStyle(card.props.style).backgroundColor).toBe(colors.accentSubtle);
    expect(badge.props.children).toBe('3 neu');
    // Dark ink only ever sits on the accent fill.
    expect(flatStyle(badge.props.style).color).toBe(colors.onAccent);
  });

  it('announces one loading group', () => {
    const skeleton = HomeRadarCardSkeleton({ testID: 'radar-loading', accessibilityLabel: 'Loading' });
    const group = byTestId(skeleton, 'radar-loading');

    expect(group.props.accessibilityRole).toBe('progressbar');
    expect(group.props.accessibilityLabel).toBe('Loading');
    expect(byType(skeleton, 'Skeleton')).toHaveLength(1);
  });
});
