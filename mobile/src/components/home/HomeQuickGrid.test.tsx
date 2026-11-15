import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { RecentPlay } from '../../domain/listeningStats';
import { strings } from '../../localization';
import { colors } from '../../theme';
import { byTestId, byType, flatStyle, queryByTestId, type TestElement } from '../../test/render';
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
vi.mock('../track/TrackIdentityLinks', () => ({ default: 'TrackIdentityLinks' }));
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
    onOpenAlbum: vi.fn(),
    onOpenArtist: vi.fn(),
    ...overrides,
  });
}

describe('quickGridRows', () => {
  it('chunks items into rows of two and keeps their original index', () => {
    expect(quickGridRows(['a', 'b', 'c'])).toEqual([
      [{ item: 'a', index: 0 }, { item: 'b', index: 1 }],
      [{ item: 'c', index: 2 }],
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

  it('announces one loading group shaped like the grid', () => {
    const skeleton = HomeQuickGridSkeleton({
      testID: 'home-section-recently-heard-loading',
      accessibilityLabel: 'Loading',
    });
    const group = byTestId(skeleton, 'home-section-recently-heard-loading');

    expect(group.props.accessibilityRole).toBe('progressbar');
    expect(group.props.accessibilityLabel).toBe('Loading');
    expect(group.props.accessibilityLiveRegion).toBe('polite');
    expect(byType(skeleton, 'Skeleton')).toHaveLength(6);
  });
});

describe('HomeRecentCard', () => {
  it('keeps play and all route-safe identity credits as distinct controls', () => {
    presentation.current = { ...presentation.current, active: false, playback: 'inactive' };
    const onPlay = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const tree = card({ onPlay, onOpenAlbum, onOpenArtist });
    const play = byTestId(tree, 'home-track-recent-track-1-0');
    const identity = byTestId(tree, 'home-track-recent-track-1-0-identity');

    expect(play.type).toBe('Pressable');
    expect(play.props.accessibilityRole).toBe('button');
    expect(play.props.accessibilityLabel).toBe(strings.home.playTrack(recent.title, recent.artist));
    expect(play.props.accessibilityState).toEqual({ disabled: false, busy: false, selected: false });
    expect(queryByTestId(play, 'home-track-recent-track-1-0-identity')).toBeNull();
    expect(identity.type).toBe('TrackIdentityLinks');
    expect(identity.props.showAlbumLabel).toBe(false);
    expect(identity.props.showDuration).toBe(false);
    expect(identity.props.showPopularity).toBe(false);
    expect(identity.props.metadata).toMatchObject({
      albumRoute: { albumId: '9', title: 'Parity' },
      artists: [
        { name: 'LoggeRythm', route: { artistId: '7', name: 'LoggeRythm' } },
        { name: 'Guest Artist', route: { artistId: '8', name: 'Guest Artist' } },
      ],
    });
    expect(byTestId(tree, 'home-track-recent-track-1-0-state').type).toBe('TrackStateIndicator');

    (play.props.onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();
    expect(onOpenAlbum).not.toHaveBeenCalled();
    expect(onOpenArtist).not.toHaveBeenCalled();
    (identity.props.onOpenAlbum as (params: unknown) => void)({ albumId: '9' });
    (identity.props.onOpenArtist as (params: unknown) => void)({ artistId: '8' });
    expect(onOpenAlbum).toHaveBeenCalledOnce();
    expect(onOpenArtist).toHaveBeenCalledOnce();
    expect(onPlay).toHaveBeenCalledOnce();
  });

  it('keeps hydration busy state on the dedicated playback target', () => {
    presentation.current = { ...presentation.current, active: false, playback: 'inactive' };
    const tree = card({ busy: true, disabled: true });
    const play = byTestId(tree, 'home-track-recent-track-1-0');

    expect(play.props.disabled).toBe(true);
    expect(play.props.accessibilityState).toEqual({ disabled: true, busy: true, selected: false });
    expect(
      byType(byTestId(play, 'home-track-recent-track-1-0-transport'), 'ActivityIndicator'),
    ).toHaveLength(1);
  });

  it('shows no transport overlay on an idle tile and a touch target of at least 48dp', () => {
    presentation.current = { ...presentation.current, active: false, playback: 'inactive' };
    const play = byTestId(card(), 'home-track-recent-track-1-0');

    expect(queryByTestId(play, 'home-track-recent-track-1-0-transport')).toBeNull();
    expect(flatStyle(play.props.style).width).toBeGreaterThanOrEqual(48);
    expect(flatStyle(play.props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(flatStyle(play.props.style, { pressed: true }).opacity).toBeLessThan(1);
  });

  it('highlights the playing tile and shows its transport state', () => {
    presentation.current = { ...presentation.current, active: true, playback: 'playing' };
    const tree = card();
    const play = byTestId(tree, 'home-track-recent-track-1-0');

    expect(flatStyle(tree.props.style).backgroundColor).toBe(colors.accentSubtle);
    expect(play.props.accessibilityState).toEqual({ disabled: false, busy: false, selected: true });
    const transport = byTestId(play, 'home-track-recent-track-1-0-transport');
    expect(byType(transport, 'AppIcon').map((icon) => icon.props.name)).toEqual(['pause']);
  });
});
