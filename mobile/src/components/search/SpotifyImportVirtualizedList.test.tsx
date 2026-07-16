import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import {
  SpotifyImportVirtualizedList,
  spotifyImportContextId,
  spotifyImportTrackOccurrence,
} from './SpotifyImportVirtualizedList';
import type { SpotifyImportListRow } from './spotifyImportListModel';

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

describe('SpotifyImportVirtualizedList', () => {
  it('shares one exact collection context id and original row order with playback', () => {
    const result = { type: 'album' as const, name: 'Imported album' };
    const link = 'https://open.spotify.com/album/ABC123?si=ignored';

    expect(spotifyImportContextId(link, result)).toBe('spotify:album:ABC123');
    expect(spotifyImportTrackOccurrence(link, result, 4)).toEqual({
      queueContext: { type: 'collection', id: 'spotify:album:ABC123' },
      originalContextOrder: 4,
    });
    expect(() => spotifyImportTrackOccurrence(link, result, -1)).toThrow('non-negative');
  });

  it('owns chrome, form, and rows in one keyboard-aware list for short viewports', () => {
    const rows: SpotifyImportListRow[] = [
      { kind: 'matched-track', track: duplicate, index: 0 },
      { kind: 'matched-track', track: duplicate, index: 1 },
    ];
    const renderRow = vi.fn(({ item }: { item: SpotifyImportListRow }) =>
      React.createElement('ImportRow', { kind: item.kind }),
    );
    const header = React.createElement('ImportOwnerHeader', {
      includes: ['search-chrome', 'import-form'],
    });
    const rendered = SpotifyImportVirtualizedList({
      accessibilityLabel: 'Spotify import',
      rows,
      header,
      renderRow,
    });
    const props = propsOf(rendered);

    expect(rendered.type).toBe('FlatList');
    expect(props).toMatchObject({
      testID: 'spotify-import-results-list',
      accessibilityLabel: 'Spotify import',
      keyboardShouldPersistTaps: 'handled',
      keyboardDismissMode: 'on-drag',
      initialNumToRender: 12,
      maxToRenderPerBatch: 10,
      windowSize: 9,
      removeClippedSubviews: true,
    });
    expect(props.ListHeaderComponent).toBe(header);
    expect(props.style).toMatchObject({ flex: 1 });
    expect(props.contentContainerStyle).toMatchObject({ flexGrow: 1 });
    const keyExtractor = props.keyExtractor as (row: SpotifyImportListRow) => string;
    expect(rows.map(keyExtractor)).toEqual(['matched:7:0', 'matched:7:1']);

    const row = (props.renderItem as typeof renderRow)({ item: rows[1] });
    expect(propsOf(row).kind).toBe('matched-track');
    expect(renderRow).toHaveBeenCalledWith({ item: rows[1] });
  });
});
