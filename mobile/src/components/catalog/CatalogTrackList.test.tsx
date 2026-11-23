import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import {
  CatalogTrackList,
  catalogTrackOccurrenceKey,
  catalogTrackOccurrences,
} from './CatalogTrackList';

const hookMocks = vi.hoisted(() => ({
  memoSlot: 0,
  memoCache: new Map<number, { deps: readonly unknown[]; value: unknown }>(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useMemo: <T,>(factory: () => T, deps: readonly unknown[]) => {
      const slot = hookMocks.memoSlot++;
      const prev = hookMocks.memoCache.get(slot);
      if (
        prev !== undefined
        && prev.deps.length === deps.length
        && prev.deps.every((dep, idx) => Object.is(dep, deps[idx]))
      ) {
        return prev.value as T;
      }
      const value = factory();
      hookMocks.memoCache.set(slot, { deps, value });
      return value;
    },
    useCallback: <T,>(fn: T) => fn,
  };
});

beforeEach(() => {
  hookMocks.memoSlot = 0;
  hookMocks.memoCache.clear();
});

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  RefreshControl: 'RefreshControl',
  StyleSheet: { create: <T,>(styles: T): T => styles },
}));

vi.mock('../../hooks/useBottomInset', () => ({ useBottomInset: () => 96 }));
vi.mock('../../theme', () => ({
  colors: { accent: '#7c5cff', surfaceElevated: '#181824' },
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function propsOf(node: React.ReactNode): ElementProps {
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    throw new Error('Expected a React element');
  }
  return (node as React.ReactElement<ElementProps>).props;
}

function track(id: string, title = `Track ${id}`): Track {
  return {
    id,
    title,
    artist: 'Artist',
    artist_id: 'artist-1',
    artists: [{ id: 'artist-1', name: 'Artist' }],
    album: 'Album',
    album_id: 'album-1',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 1,
    release_date: '',
  };
}

describe('CatalogTrackList', () => {
  it('preserves exact source references and occurrence indices with duplicate-safe keys', () => {
    const duplicate = track('7');
    const tracks = [duplicate, track('8'), duplicate];
    const rows = catalogTrackOccurrences(tracks);

    expect(rows.map(catalogTrackOccurrenceKey)).toEqual(['7:0', '8:1', '7:2']);
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(rows[0]?.track).toBe(duplicate);
    expect(rows[2]?.track).toBe(duplicate);
    expect(tracks).toEqual([duplicate, expect.objectContaining({ id: '8' }), duplicate]);
  });

  it('renders one bounded FlatList owner with header, footer, empty and refresh contracts', () => {
    const onRefresh = vi.fn();
    const renderTrack = vi.fn((item: Track, index: number) =>
      React.createElement('CatalogRow', { id: item.id, index }),
    );
    const duplicate = track('42');
    const rendered = CatalogTrackList({
      id: 'album',
      tracks: [duplicate, duplicate],
      header: React.createElement('CatalogHeader'),
      footer: React.createElement('CatalogFooter'),
      empty: React.createElement('CatalogEmpty'),
      refreshing: true,
      refreshAccessibilityLabel: 'Refresh album',
      onRefresh,
      renderTrack,
    });
    const props = propsOf(rendered);

    expect(rendered.type).toBe('FlatList');
    expect(props).toMatchObject({
      testID: 'album-scroll',
      initialNumToRender: 12,
      maxToRenderPerBatch: 10,
      windowSize: 9,
      removeClippedSubviews: false,
    });
    // The last row clears the floating mini player instead of a hardcoded 144dp.
    expect(props.contentContainerStyle).toEqual({ paddingBottom: 96 });
    expect(props.ListHeaderComponent).toEqual(expect.objectContaining({ type: 'CatalogHeader' }));
    expect(props.ListFooterComponent).toEqual(expect.objectContaining({ type: 'CatalogFooter' }));
    expect(props.ListEmptyComponent).toEqual(expect.objectContaining({ type: 'CatalogEmpty' }));

    const rows = props.data as ReturnType<typeof catalogTrackOccurrences>;
    const keyExtractor = props.keyExtractor as typeof catalogTrackOccurrenceKey;
    expect(rows.map(keyExtractor)).toEqual(['42:0', '42:1']);

    const row = (props.renderItem as (
      info: { item: ReturnType<typeof catalogTrackOccurrences>[number] },
    ) => React.ReactElement)({ item: rows[1]! });
    expect(propsOf(row)).toMatchObject({ id: '42', index: 1 });
    expect(renderTrack).toHaveBeenCalledWith(duplicate, 1);

    const refresh = propsOf(props.refreshControl as React.ReactNode);
    expect(refresh).toMatchObject({
      testID: 'album-refresh',
      refreshing: true,
      accessibilityLabel: 'Refresh album',
    });
    (refresh.onRefresh as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('memoizes occurrence array identity across re-renders with the same tracks ref', () => {
    const tracks = [track('1'), track('2')];
    const baseProps = {
      id: 'album',
      tracks,
      header: React.createElement('CatalogHeader'),
      refreshing: false,
      refreshAccessibilityLabel: 'Refresh',
      onRefresh: vi.fn(),
      renderTrack: (item: Track) => React.createElement('Row', { id: item.id }),
    };
    hookMocks.memoSlot = 0;
    const first = CatalogTrackList(baseProps);
    hookMocks.memoSlot = 0;
    const second = CatalogTrackList(baseProps);

    expect(propsOf(first).data).toBe(propsOf(second).data);
    expect(propsOf(first).contentContainerStyle).toBe(propsOf(second).contentContainerStyle);
  });
});
