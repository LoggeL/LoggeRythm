import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { SearchVirtualizedResults } from './SearchVirtualizedResults';
import type { SearchListRow } from './searchListModel';

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function propsOf(node: React.ReactNode): ElementProps {
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    throw new Error('Expected a React element');
  }
  return (node as React.ReactElement<ElementProps>).props;
}

const duplicate: Track = {
  id: '7',
  title: 'Duplicate',
  artist: 'Artist',
  artist_id: 'artist-1',
  artists: [{ id: 'artist-1', name: 'Artist' }],
  album: 'Album',
  album_id: 'album-1',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

describe('SearchVirtualizedResults', () => {
  it('owns one bounded vertical FlatList with duplicate-safe row keys', () => {
    const rows: SearchListRow[] = [
      { kind: 'track-header' },
      { kind: 'track', track: duplicate, index: 0 },
      { kind: 'track', track: duplicate, index: 1 },
    ];
    const renderRow = vi.fn((row: SearchListRow) =>
      React.createElement('SearchRow', { kind: row.kind }),
    );
    const rendered = SearchVirtualizedResults({
      accessibilityLabel: 'Search',
      rows,
      header: React.createElement('SearchChrome'),
      renderRow,
    });
    const props = propsOf(rendered);

    expect(rendered.type).toBe('FlatList');
    expect(props).toMatchObject({
      testID: 'search-results-list',
      accessibilityLabel: 'Search',
      keyboardShouldPersistTaps: 'handled',
      initialNumToRender: 12,
      maxToRenderPerBatch: 10,
      windowSize: 9,
      removeClippedSubviews: true,
    });
    const keyExtractor = props.keyExtractor as (row: SearchListRow) => string;
    expect(rows.map(keyExtractor)).toEqual([
      'section:tracks',
      'track:7:0',
      'track:7:1',
    ]);

    const row = (props.renderItem as (info: { item: SearchListRow }) => React.ReactElement)({
      item: rows[1],
    });
    expect(propsOf(row).kind).toBe('track');
    expect(renderRow).toHaveBeenCalledWith(rows[1]);
  });
});
