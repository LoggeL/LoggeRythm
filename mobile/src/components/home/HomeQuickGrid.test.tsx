import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RecentPlay } from '../../domain/listeningStats';
import { strings } from '../../localization';
import { colors } from '../../theme';
import { byTestId, byType, flatStyle, queryByTestId, textContent, type TestElement } from '../../test/render';
import {
  HomeQuickGrid,
  HomeQuickGridSkeleton,
  HomeRecentCard,
  quickGridRows,
} from './HomeQuickGrid';

const presentation = vi.hoisted(() => ({
  current: {
    active: false,
    playback: 'inactive',
    serverCache: 'not-cached',
    rollingDeviceCache: null,
    explicitDownload: { kind: 'unknown' },
  },
}));

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T,>(initial: T | (() => T)): [T, (next: T) => void] => [
    typeof initial === 'function' ? (initial as () => T)() : initial,
    vi.fn(),
  ],
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../player/TrackPresentationProvider', () => ({
  useTrackPresentation: () => presentation.current,
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../TrackStateIndicator', () => ({ default: 'TrackStateIndicator' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Skeleton: 'Skeleton',
}));

const recent: RecentPlay = {
  id: 'track-1',
  title: 'Midnight Signal',
  artist: 'LoggeRythm',
  artist_id: '7',
  artists: [
    { id: '7', name: 'LoggeRythm' },
    { id: '8', name: 'Guest Artist' },
  ],
  album: 'Parity',
  album_id: '9',
  cover: 'https://example.test/cover.jpg',
  duration_sec: 180,
};

const occurrence = {
  queueContext: { type: 'recent' as const, id: '7' },
  originalContextOrder: 0,
};

function card(overrides: Partial<Parameters<typeof HomeRecentCard>[0]> = {}) {
  return HomeRecentCard({
    play: recent,
    testID: 'home-track-recent-track-1-0',
    occurrence,
    busy: false,
    disabled: false,
    onPlay: vi.fn(),
    ...overrides,
  });
}

describe('quickGridRows', () => {
  it('chunks items into rows of two (or custom TV column count) and keeps their original index', () => {
    expect(quickGridRows(['a', 'b', 'c'])).toEqual([
      [{ item: 'a', index: 0 }, { item: 'b', index: 1 }],
      [{ item: 'c', index: 2 }],
    ]);
    expect(quickGridRows(['a', 'b', 'c', 'd'], 3)).toEqual([
      [{ item: 'a', index: 0 }, { item: 'b', index: 1 }, { item: 'c', index: 2 }],
      [{ item: 'd', index: 3 }],
    ]);
    expect(quickGridRows([])).toEqual([]);
    expect(() => quickGridRows(['a'], 0)).toThrow('positive column count');
  });
});

describe('HomeQuickGrid', () => {
  it('lays items out in equal cells and pads a short last row', () => {
    const grid = HomeQuickGrid({
      id: 'recently-heard',
      data: ['a', 'b', 'c'],
      keyExtractor: (item) => item,
      renderItem: (item, index) => React.createElement('Tile', { testID: `tile-${item}-${index}` }),
    });
    const root = byTestId(grid, 'home-shelf-recently-heard');
    const rows = root.props.children as TestElement[];

    expect(rows).toHaveLength(2);
    for (const id of ['tile-a-0', 'tile-b-1', 'tile-c-2']) {
      expect(queryByTestId(grid, id)).not.toBeNull();
    }
    const lastRowCells = byType(rows[1], 'View').filter(
      (element) => flatStyle(element.props.style).flex === 1,
    );
    expect(lastRowCells).toHaveLength(2);
  });

  it('supports 3-column 16:9 Android TV layout with padding fillers', () => {
    const grid = HomeQuickGrid({
      id: 'recently-heard',
      columns: 3,
      data: ['a', 'b', 'c', 'd'],
      keyExtractor: (item) => item,
      renderItem: (item, index) => React.createElement('Tile', { testID: `tile-${item}-${index}` }),
    });
    const rows = byTestId(grid, 'home-shelf-recently-heard').props.children as TestElement[];

    expect(rows).toHaveLength(2);
    const lastRowCells = byType(rows[1], 'View').filter(
      (element) => flatStyle(element.props.style).flex === 1,
    );
    expect(lastRowCells).toHaveLength(3);
  });

  it('announces one loading group shaped like the grid (phone & TV)', () => {
    const skeleton = HomeQuickGridSkeleton({
      testID: 'home-section-recently-heard-loading',
      accessibilityLabel: 'Loading',
    });
    const group = byTestId(skeleton, 'home-section-recently-heard-loading');

    expect(group.props.accessibilityRole).toBe('progressbar');
    expect(group.props.accessibilityLabel).toBe('Loading');
    expect(group.props.accessibilityLiveRegion).toBe('polite');
    expect(byType(skeleton, 'Skeleton')).toHaveLength(6);

    const tvSkeleton = HomeQuickGridSkeleton({
      testID: 'tv-loading',
      accessibilityLabel: 'Loading',
      columns: 3,
      tileHeight: 72,
    });
    const tvRows = byTestId(tvSkeleton, 'tv-loading').props.children as TestElement[];
    expect(tvRows).toHaveLength(2);
    expect(byType(tvSkeleton, 'Skeleton')[0].props.height).toBe(72);
  });
});

describe('HomeRecentCard', () => {
  it('makes the entire tile one D-Pad focusable play target containing artwork, copy, and state', () => {
    presentation.current = { ...presentation.current, active: false, playback: 'inactive' };
    const onPlay = vi.fn();
    const onFocus = vi.fn();
    const tree = card({ onPlay, onFocus });
    const tile = byTestId(tree, 'home-track-recent-track-1-0');

    expect(tile.type).toBe('Pressable');
    expect(tile.props.accessibilityRole).toBe('button');
    expect(tile.props.accessibilityLabel).toBe(
      strings.home.playTrack(recent.title, 'LoggeRythm, Guest Artist'),
    );
    expect(tile.props.accessibilityState).toEqual({ disabled: false, busy: false, selected: false });
    expect(tile.props.focusable).toBe(true);
    // Identity copy and cache indicator sit inside the full-tile pressable target.
    expect(queryByTestId(tile, 'home-track-recent-track-1-0-identity')).not.toBeNull();
    expect(textContent(tile)).toEqual(['Midnight Signal', 'LoggeRythm, Guest Artist']);
    expect(byTestId(tile, 'home-track-recent-track-1-0-state').type).toBe('TrackStateIndicator');

    (tile.props.onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();
    (tile.props.onFocus as (event: unknown) => void)({});
    expect(onFocus).toHaveBeenCalledOnce();
  });

  it('keeps hydration busy state on the tile and disables focus while disabled', () => {
    presentation.current = { ...presentation.current, active: false, playback: 'inactive' };
    const tree = card({ busy: true, disabled: true });
    const tile = byTestId(tree, 'home-track-recent-track-1-0');

    expect(tile.props.disabled).toBe(true);
    expect(tile.props.focusable).toBe(false);
    expect(tile.props.accessibilityState).toEqual({ disabled: true, busy: true, selected: false });
    expect(
      byType(byTestId(tile, 'home-track-recent-track-1-0-transport'), 'ActivityIndicator'),
    ).toHaveLength(1);
  });

  it('shows no transport overlay on an idle tile and preserves >=48dp height with press feedback', () => {
    presentation.current = { ...presentation.current, active: false, playback: 'inactive' };
    const tile = byTestId(card(), 'home-track-recent-track-1-0');

    expect(queryByTestId(tile, 'home-track-recent-track-1-0-transport')).toBeNull();
    expect(flatStyle(tile.props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(flatStyle(tile.props.style, { pressed: true }).opacity).toBeLessThan(1);
  });

  it('highlights the playing tile and shows its transport state', () => {
    presentation.current = { ...presentation.current, active: true, playback: 'playing' };
    const tree = card();
    const tile = byTestId(tree, 'home-track-recent-track-1-0');

    expect(flatStyle(tile.props.style).backgroundColor).toBe(colors.accentSubtle);
    expect(tile.props.accessibilityState).toEqual({ disabled: false, busy: false, selected: true });
    const transport = byTestId(tile, 'home-track-recent-track-1-0-transport');
    expect(byType(transport, 'AppIcon').map((icon) => icon.props.name)).toEqual(['pause']);
  });
});
