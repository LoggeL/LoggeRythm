import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { CatalogTrackCard, CatalogTrackRow } from './CatalogCards';

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
  },
  Text: 'Text',
  View: 'View',
}));

vi.mock('../track/StandardTrackRow', () => ({ default: 'StandardTrackRow' }));
vi.mock('../track/TrackShelfCard', () => ({ default: 'TrackShelfCard' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function findByTestID(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const match = elements(node).find((element) => element.props.testID === testID);
  if (match === undefined) throw new Error(`No element has testID ${testID}`);
  return match;
}

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

describe('CatalogTrackRow', () => {
  const occurrence = {
    queueContext: { type: 'artist' as const, id: '7' },
    originalContextOrder: 0,
  };

  it('delegates identity, duration, state, and exact occurrence to the shared row', () => {
    const metadata = '12.345 Wiedergaben · 6.789 Hörer:innen (Last.fm)';
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const row = CatalogTrackRow({
      track,
      index: 0,
      testID: 'artist-track-12-0',
      occurrence,
      metadata,
      popularity: 'artist-popular',
      plays: { plays: 12_345, listeners: 6_789 },
      onPress: vi.fn(),
      onLongPress: vi.fn(),
      onOpenAlbum,
      onOpenArtist,
    });

    const shared = elements(row).find((element) => element.type === 'StandardTrackRow');
    expect(shared?.props).toMatchObject({
      track,
      testID: 'artist-track-12-0',
      occurrence,
      position: 1,
      popularity: 'artist-popular',
      plays: { plays: 12_345, listeners: 6_789 },
      onOpenAlbum,
      onOpenArtist,
    });
    expect(findByTestID(row, 'artist-track-12-0-metadata').props.children).toBe(metadata);
    expect(findByTestID(row, 'artist-track-12-0-metadata').props.accessibilityLabel)
      .toBe(metadata);
  });

  it('does not manufacture a metadata line when no count is available', () => {
    const row = CatalogTrackRow({
      track,
      index: 0,
      testID: 'artist-track-12-0',
      occurrence,
      onPress: vi.fn(),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });

    expect(elements(row).some((element) => element.props.testID === 'artist-track-12-0-metadata'))
      .toBe(false);
  });
});

describe('CatalogTrackCard', () => {
  it('delegates cards to the shared non-overlapping shelf composition', () => {
    const occurrence = {
      queueContext: { type: 'chart' as const, id: 'discover' },
      originalContextOrder: 3,
    };
    const onPlay = vi.fn();
    const onActions = vi.fn();
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const card = CatalogTrackCard({
      track,
      testID: 'discover-chart-12-3',
      occurrence,
      rank: 4,
      onPress: onPlay,
      onLongPress: onActions,
      onOpenAlbum,
      onOpenArtist,
    });

    expect(card.type).toBe('TrackShelfCard');
    expect(card.props).toMatchObject({
      track,
      testID: 'discover-chart-12-3',
      occurrence,
      rank: 4,
      onPlay,
      onActions,
      onOpenAlbum,
      onOpenArtist,
    });
  });
});
