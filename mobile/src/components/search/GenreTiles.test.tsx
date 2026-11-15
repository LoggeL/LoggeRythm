import { describe, expect, it, vi } from 'vitest';
import type { Genre } from '../../api/types';
import { byTestId, byType, flatStyle, textContent } from '../../test/render';
import { colors, layout } from '../../theme';
import {
  GenreTile,
  GenreTileGrid,
  GenreTileGridSkeleton,
  genreTileRows,
  genreTileTint,
} from './GenreTiles';

vi.mock('react-native', () => ({
  Image: 'Image',
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

const genre = (id: string, name = `Genre ${id}`): Genre => ({
  id,
  name,
  picture: `https://img.example/${id}.jpg`,
});

describe('genre browse tiles', () => {
  it('cycles token tints so adjacent tiles differ and rejects invalid positions', () => {
    expect(genreTileTint(0)).toBe(colors.accentSubtle);
    expect(genreTileTint(1)).not.toBe(genreTileTint(0));
    expect(genreTileTint(5)).toBe(genreTileTint(0));
    expect(() => genreTileTint(-1)).toThrow('non-negative');
  });

  it('splits genres into two-column rows without dropping the odd last one', () => {
    expect(genreTileRows([1, 2, 3, 4, 5])).toEqual([[1, 2], [3, 4], [5]]);
    expect(genreTileRows([])).toEqual([]);
  });

  it('renders one labelled button per tile with a truncating name and decorative artwork', () => {
    const onPress = vi.fn();
    const rendered = GenreTile({
      genre: genre('132', 'Pop'),
      index: 1,
      testID: 'search-genre-132',
      accessibilityLabel: 'Open Pop genre',
      onPress,
    });
    const tile = byTestId(rendered, 'search-genre-132');

    expect(tile.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Open Pop genre',
    });
    expect(flatStyle(tile.props.style)).toMatchObject({
      backgroundColor: colors.successSubtle,
      minHeight: layout.artwork.lg,
      overflow: 'hidden',
    });
    expect(textContent(rendered)).toEqual(['Pop']);
    expect(byType(rendered, 'Text')[0].props.numberOfLines).toBe(2);
    expect(byType(rendered, 'Image')[0].props.source).toEqual({
      uri: 'https://img.example/132.jpg',
    });
    (tile.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('keeps caller-owned testIDs and labels and pads an odd row to full width', () => {
    const onOpenGenre = vi.fn();
    const genres = [genre('1'), genre('2'), genre('3')];
    const rendered = GenreTileGrid({
      genres,
      testID: 'grid',
      tileTestID: ({ id }) => `discover-genre-${id}`,
      tileAccessibilityLabel: ({ name }) => `Open ${name}`,
      onOpenGenre,
    });
    const rows = byTestId(rendered, 'grid').props.children as { props: { children: unknown[] } }[];

    expect(rows).toHaveLength(2);
    expect(rows[1].props.children[1]).not.toBeNull();
    expect(byTestId(rendered, 'discover-genre-3').props.accessibilityLabel).toBe('Open Genre 3');
    (byTestId(rendered, 'discover-genre-2').props.onPress as () => void)();
    expect(onOpenGenre).toHaveBeenCalledWith(genres[1]);
  });

  it('announces the placeholder as one polite progressbar shaped like the grid', () => {
    const rendered = GenreTileGridSkeleton({
      testID: 'search-genres-loading',
      accessibilityLabel: 'Loading genres',
    });

    expect(byTestId(rendered, 'search-genres-loading').props).toMatchObject({
      accessibilityRole: 'progressbar',
      accessibilityLabel: 'Loading genres',
      accessibilityLiveRegion: 'polite',
    });
    const blocks = byType(rendered, 'Skeleton');
    expect(blocks).toHaveLength(6);
    expect(blocks[0].props.height).toBe(layout.artwork.lg);
  });
});
