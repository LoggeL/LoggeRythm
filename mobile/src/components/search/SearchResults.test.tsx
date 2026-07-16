import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import {
  SearchTrackResultRow,
  searchTrackOccurrence,
} from './SearchResults';

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../track/StandardTrackRow', () => ({ default: 'StandardTrackRow' }));

const track: Track = {
  id: '12',
  title: 'Midnight Signal',
  artist: 'LoggeRythm',
  artist_id: '7',
  artists: [{ id: '7', name: 'LoggeRythm' }],
  album: 'Parity',
  album_id: '9',
  cover: '',
  duration_sec: 185,
  preview_url: null,
  rank: 750_000,
  release_date: '',
};

describe('Search track rows', () => {
  it('derives exact semantic occurrence identity from rendered search order', () => {
    expect(searchTrackOccurrence('  Kraftwerk  ', 3)).toEqual({
      queueContext: { type: 'search', id: 'Kraftwerk' },
      originalContextOrder: 3,
    });
    expect(() => searchTrackOccurrence(' ', 0)).toThrow('query identity');
    expect(() => searchTrackOccurrence('Kraftwerk', -1)).toThrow('non-negative');
    expect(() => searchTrackOccurrence('Kraftwerk', 1.5)).toThrow('non-negative');
  });

  it('delegates duration, Search popularity, provider state, routes, and exact index', () => {
    const occurrence = searchTrackOccurrence('Kraftwerk', 2);
    const onPlay = vi.fn();
    const onActions = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const rendered = SearchTrackResultRow({
      track,
      testID: 'search-track-12-2',
      occurrence,
      position: 3,
      plays: { plays: 0, listeners: 4 },
      rollingDeviceCacheSeconds: 90,
      onPlay,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });

    expect(rendered.type).toBe('StandardTrackRow');
    expect(rendered.props).toMatchObject({
      track,
      testID: 'search-track-12-2',
      occurrence,
      position: 3,
      popularity: 'search',
      plays: { plays: 0, listeners: 4 },
      rollingDeviceCacheSeconds: 90,
      onPlay,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });
  });

  it('lets Import explicitly suppress rank while retaining duration and provider state', () => {
    const rendered = SearchTrackResultRow({
      track,
      testID: 'spotify-import-track-12-0',
      occurrence: {
        queueContext: { type: 'collection', id: 'spotify:album:abc' },
        originalContextOrder: 0,
      },
      position: 1,
      popularity: 'none',
      rollingDeviceCacheSeconds: 45,
      onPlay: vi.fn(),
      onActions: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    expect(rendered.props).toMatchObject({
      popularity: 'none',
      rollingDeviceCacheSeconds: 45,
    });
    expect(rendered.props.showDuration).not.toBe(false);
  });
});
