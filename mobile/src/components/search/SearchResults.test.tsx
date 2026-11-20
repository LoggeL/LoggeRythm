import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { byTestId, byType, textContent } from '../../test/render';
import {
  SearchEntityCard,
  SearchResultRail,
  SearchTrackResultRow,
  searchTrackRadioOccurrence,
} from './SearchResults';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../track/StandardTrackRow', () => ({ default: 'StandardTrackRow' }));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
}));

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
  it('identifies a search row by the radio context its tap starts', () => {
    expect(searchTrackRadioOccurrence('12')).toEqual({
      queueContext: { type: 'radio', id: '12' },
      originalContextOrder: 0,
    });
    expect(() => searchTrackRadioOccurrence(' ')).toThrow('track id');
  });

  it('delegates duration, Search popularity, provider state, routes, and exact index', () => {
    const occurrence = searchTrackRadioOccurrence('12');
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

describe('Search entity cards and rails', () => {
  const card = (overrides: Partial<Parameters<typeof SearchEntityCard>[0]> = {}) =>
    SearchEntityCard({
      testID: 'search-album-4-0',
      accessibilityLabel: 'Open Autobahn by Kraftwerk',
      title: 'Autobahn',
      subtitle: 'Kraftwerk',
      imageUri: 'https://img.example/a.jpg',
      onPress: vi.fn(),
      ...overrides,
    });

  it('is one labelled button with truncating copy over shared artwork', () => {
    const onPress = vi.fn();
    const rendered = card({ onPress });
    const button = byTestId(rendered, 'search-album-4-0');

    expect(button.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Open Autobahn by Kraftwerk',
      accessibilityState: { disabled: false, busy: false },
      disabled: false,
    });
    expect(textContent(rendered)).toEqual(['Autobahn', 'Kraftwerk']);
    expect(byType(rendered, 'Text').map((text) => text.props.numberOfLines)).toEqual([2, 1]);
    expect(byType(rendered, 'Image')[0].props.source).toEqual({ uri: 'https://img.example/a.jpg' });
    expect(byType(rendered, 'ActivityIndicator')).toHaveLength(0);
    (button.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('shows a placeholder without artwork and reports a busy, locked card', () => {
    const rendered = card({ imageUri: null, disabled: true, busy: true });

    expect(byType(rendered, 'Image')).toHaveLength(0);
    expect(byTestId(rendered, 'search-album-4-0').props).toMatchObject({
      accessibilityState: { disabled: true, busy: true },
      disabled: true,
    });
    expect(byType(rendered, 'ActivityIndicator')).toHaveLength(1);
  });

  it('keeps rails keyboard-tappable and index-aware', () => {
    const renderItem = vi.fn((item: string, index: number) =>
      React.createElement('Card', { item, index }));
    const rendered = SearchResultRail({
      id: 'albums',
      data: ['a', 'b'],
      keyExtractor: (item, index) => `${item}:${index}`,
      renderItem,
    });

    expect(rendered.props).toMatchObject({
      testID: 'search-rail-albums',
      horizontal: true,
      keyboardShouldPersistTaps: 'handled',
      data: ['a', 'b'],
    });
    (rendered.props.renderItem as (info: { item: string; index: number }) => unknown)({
      item: 'b',
      index: 1,
    });
    expect(renderItem).toHaveBeenCalledWith('b', 1);
  });
});
