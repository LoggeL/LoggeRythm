import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { strings } from '../../localization';
import { metrics } from '../../theme';
import NowPlayingMetadata from './NowPlayingMetadata';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`Missing ${testID}`);
  return found;
}

const track: Track = {
  id: '3135556',
  title: 'Harder Better Faster Stronger',
  artist: 'Daft Punk',
  artist_id: 27,
  artists: [{ id: 27, name: 'Daft Punk' }],
  album: 'Discovery',
  album_id: 302127,
  cover: 'https://example.test/cover.jpg',
  duration_sec: 224,
  preview_url: null,
  rank: 1,
  release_date: '2001-03-07',
};

describe('NowPlayingMetadata', () => {
  it('keeps the title as a validated album link with a minimum touch target', () => {
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const rendered = NowPlayingMetadata({ track, onOpenAlbum, onOpenArtist });
    const album = byTestId(rendered, 'now-playing-open-album');

    expect(album.props.accessibilityRole).toBe('link');
    expect(album.props.accessibilityLabel).toBe(strings.trackActions.openAlbum(track.album));
    const style = album.props.style as (state: { pressed: boolean }) => unknown[];
    expect(style({ pressed: false })).toContainEqual(expect.objectContaining({
      minHeight: metrics.minimumTouchTarget,
      minWidth: metrics.minimumTouchTarget,
    }));

    (album.props.onPress as () => void)();
    expect(onOpenAlbum).toHaveBeenCalledOnce();
    expect(onOpenArtist).not.toHaveBeenCalled();
  });

  it('renders every credited artist in order and keeps mixed-validity credits readable', () => {
    const artists = [
      { id: 27, name: 'Daft Punk' },
      { id: 0, name: 'Legacy Guest' },
      { id: '00042', name: 'Pharrell Williams' },
    ];
    const onOpenArtist = vi.fn();
    const rendered = NowPlayingMetadata({
      track: { ...track, artists },
      onOpenAlbum: vi.fn(),
      onOpenArtist,
    });
    const first = byTestId(rendered, 'now-playing-open-artist-0');
    const invalid = byTestId(rendered, 'now-playing-artist-text-1');
    const third = byTestId(rendered, 'now-playing-open-artist-2');

    expect(first.props.accessibilityLabel).toBe(strings.trackActions.openArtist('Daft Punk'));
    expect(first.props.accessibilityRole).toBe('link');
    expect(invalid.props.accessibilityRole).toBeUndefined();
    expect(invalid.props.onPress).toBeUndefined();
    expect(invalid.props.children).toBe('Legacy Guest');
    expect(third.props.accessibilityLabel)
      .toBe(strings.trackActions.openArtist('Pharrell Williams'));

    const orderedCredits = elements(byTestId(rendered, 'now-playing-artist-credits'))
      .map((element) => element.props.testID)
      .filter((testID) => typeof testID === 'string' && testID !== 'now-playing-artist-credits');
    expect(orderedCredits).toEqual([
      'now-playing-open-artist-0',
      'now-playing-artist-separator-1',
      'now-playing-artist-text-1',
      'now-playing-artist-separator-2',
      'now-playing-open-artist-2',
    ]);
    expect(byTestId(rendered, 'now-playing-artist-separator-1').props.children).toBe(', ');
    expect(byTestId(rendered, 'now-playing-artist-separator-2').props.children).toBe(', ');

    for (const link of [first, third]) {
      const style = link.props.style as (state: { pressed: boolean }) => unknown[];
      expect(style({ pressed: false })).toContainEqual(expect.objectContaining({
        minHeight: metrics.minimumTouchTarget,
        minWidth: metrics.minimumTouchTarget,
      }));
    }

    (first.props.onPress as () => void)();
    (third.props.onPress as () => void)();
    expect(onOpenArtist.mock.calls.map(([artist]) => artist)).toEqual([artists[0], artists[2]]);
    expect(onOpenArtist.mock.calls[0][0]).toBe(artists[0]);
    expect(onOpenArtist.mock.calls[1][0]).toBe(artists[2]);
  });

  it('falls back to primary artist metadata when the credit list is empty', () => {
    const onOpenArtist = vi.fn();
    const rendered = NowPlayingMetadata({
      track: { ...track, artists: [] },
      onOpenAlbum: vi.fn(),
      onOpenArtist,
    });
    const artist = byTestId(rendered, 'now-playing-open-artist-0');

    expect(artist.props.accessibilityLabel).toBe(strings.trackActions.openArtist(track.artist));
    (artist.props.onPress as () => void)();
    expect(onOpenArtist).toHaveBeenCalledExactlyOnceWith({
      id: track.artist_id,
      name: track.artist,
    });
  });

  it('renders invalid album and fallback artist metadata without broken actions', () => {
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const rendered = NowPlayingMetadata({
      track: { ...track, album_id: '', artist_id: 0, artists: [] },
      onOpenAlbum,
      onOpenArtist,
    });

    const title = byTestId(rendered, 'now-playing-title-text');
    const artist = byTestId(rendered, 'now-playing-artist-text-0');
    expect(title.props.accessibilityRole).toBeUndefined();
    expect(title.props.onPress).toBeUndefined();
    expect(artist.props.accessibilityRole).toBeUndefined();
    expect(artist.props.onPress).toBeUndefined();
    expect(elements(rendered).some((element) => element.props.accessibilityRole === 'link')).toBe(false);
    expect(onOpenAlbum).not.toHaveBeenCalled();
    expect(onOpenArtist).not.toHaveBeenCalled();
  });
});
