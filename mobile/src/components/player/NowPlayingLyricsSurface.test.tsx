import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import LyricsPanel from './LyricsPanel';
import { NowPlayingArtwork } from './NowPlayingArtwork';
import NowPlayingLyricsSurface from './NowPlayingLyricsSurface';
import NowPlayingMetadata from './NowPlayingMetadata';
import NowPlayingTransport from './NowPlayingTransport';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
    hairlineWidth: 1,
  },
  Text: 'Text',
  View: 'View',
}));

vi.mock('@react-native-community/slider', () => ({ default: 'Slider' }));
vi.mock('@tanstack/react-query', () => ({ useQuery: vi.fn() }));
vi.mock('../../data', () => ({ musicQueries: { lyrics: vi.fn() } }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byType(
  node: React.ReactNode,
  type: React.ElementType,
): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.type === type);
  if (found === undefined) throw new Error(`Missing component ${String(type)}`);
  return found;
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`Missing ${testID}`);
  return found;
}

const track: Track = {
  id: '3135556',
  title: 'Get Lucky',
  artist: 'Daft Punk',
  artist_id: 27,
  artists: [
    { id: 27, name: 'Daft Punk' },
    { id: 145, name: 'Pharrell Williams' },
    { id: 0, name: 'Legacy Credit' },
  ],
  album: 'Random Access Memories',
  album_id: 6575789,
  cover: 'https://example.test/cover.jpg',
  duration_sec: 369,
  preview_url: null,
  rank: 1,
  release_date: '2013-04-19',
};

describe('NowPlayingLyricsSurface', () => {
  it('composes compact artwork, validated full metadata, lyrics, and one supplied transport', () => {
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const onPositionChange = vi.fn();
    const onSeek = vi.fn();
    const onPrevious = vi.fn();
    const onTogglePlay = vi.fn();
    const onNext = vi.fn();
    const rendered = NowPlayingLyricsSurface({
      track,
      position: 37,
      sliderPosition: 42,
      duration: 369,
      playing: true,
      buffering: false,
      onOpenAlbum,
      onOpenArtist,
      onPositionChange,
      onSeek,
      onPrevious,
      onTogglePlay,
      onNext,
    });

    const artwork = byType(rendered, NowPlayingArtwork);
    expect(artwork.props).toEqual(expect.objectContaining({
      compact: true,
      coverUri: track.cover,
      testID: 'now-playing-lyrics-artwork',
    }));

    const metadataElement = byType(rendered, NowPlayingMetadata);
    expect(metadataElement.props).toEqual(expect.objectContaining({
      compact: true,
      track,
      onOpenAlbum,
      onOpenArtist,
    }));
    const metadata = NowPlayingMetadata(
      metadataElement.props as unknown as Parameters<typeof NowPlayingMetadata>[0],
    );
    expect(byTestId(metadata, 'now-playing-open-album')).toBeDefined();
    expect(byTestId(metadata, 'now-playing-open-artist-0')).toBeDefined();
    expect(byTestId(metadata, 'now-playing-open-artist-1')).toBeDefined();
    expect(byTestId(metadata, 'now-playing-artist-text-2')).toBeDefined();

    const lyrics = byType(rendered, LyricsPanel);
    expect(lyrics.props.position).toBe(37);
    expect(lyrics.props.onSeek).toBe(onSeek);

    const transport = byType(rendered, NowPlayingTransport);
    expect(transport.props).toEqual(expect.objectContaining({
      variant: 'compact',
      testIDPrefix: 'now-playing-lyrics',
      position: 42,
      duration: 369,
      playing: true,
      buffering: false,
      onPositionChange,
      onSeek,
      onPrevious,
      onTogglePlay,
      onNext,
    }));
  });

  it('keeps timed-line position independent from an in-progress slider preview', () => {
    const rendered = NowPlayingLyricsSurface({
      track,
      position: 18,
      sliderPosition: 96,
      duration: 369,
      playing: false,
      buffering: false,
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      onPositionChange: vi.fn(),
      onSeek: vi.fn(),
      onPrevious: vi.fn(),
      onTogglePlay: vi.fn(),
      onNext: vi.fn(),
    });

    expect(byType(rendered, LyricsPanel).props.position).toBe(18);
    expect(byType(rendered, NowPlayingTransport).props.position).toBe(96);
  });
});
