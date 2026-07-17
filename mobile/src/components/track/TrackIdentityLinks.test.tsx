import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import TrackIdentityLinks, { type TrackIdentityCopy } from './TrackIdentityLinks';
import { buildTrackMetadata } from './trackMetadata';

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

function expectNoNestedPressable(node: React.ReactNode, insidePressable = false): void {
  if (Array.isArray(node)) {
    node.forEach((child) => expectNoNestedPressable(child, insidePressable));
    return;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return;
  const element = node as React.ReactElement<ElementProps>;
  const pressable = element.type === 'Pressable';
  if (pressable && insidePressable) throw new Error('Nested Pressable');
  expectNoNestedPressable(element.props.children, insidePressable || pressable);
}

const copy: TrackIdentityCopy = {
  openAlbum: (album) => `Open album ${album}`,
  openArtist: (artist) => `Open artist ${artist}`,
  duration: (value) => `Duration ${value}`,
  playCount: (plays, listeners) => `${plays} plays, ${listeners} listeners`,
  popularity: (percent) => `Popularity ${percent}%`,
};

const track: Track = {
  id: '12',
  title: 'Midnight Signal',
  artist: 'Primary Artist',
  artist_id: '7',
  artists: [
    { id: '7', name: 'Primary Artist' },
    { id: 0, name: 'Legacy Guest' },
    { id: '42', name: 'Featured Artist' },
  ],
  album: 'Parity',
  album_id: '9',
  cover: '',
  duration_sec: 185,
  preview_url: null,
  rank: 750_000,
  release_date: '',
};

describe('TrackIdentityLinks', () => {
  it('keeps exact album and artist routes inside two bounded text lines', () => {
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const rendered = TrackIdentityLinks({
      metadata: buildTrackMetadata(track, {
        popularity: 'search',
        plays: { plays: 12_345, listeners: 6_789 },
      }),
      testID: 'track-identity',
      copy,
      onOpenAlbum,
      onOpenArtist,
    });

    expectNoNestedPressable(rendered);
    const title = byTestId(rendered, 'track-identity-album-link');
    const album = byTestId(rendered, 'track-identity-album-label-link');
    const primary = byTestId(rendered, 'track-identity-artist-link-0');
    const invalid = byTestId(rendered, 'track-identity-artist-text-1');
    const featured = byTestId(rendered, 'track-identity-artist-link-2');

    expect(title.props.accessibilityRole).toBe('link');
    expect(title.props.accessibilityLabel).toBe('Open album Parity');
    expect(primary.props.accessibilityLabel).toBe('Open artist Primary Artist');
    expect(invalid.props.accessibilityRole).toBeUndefined();
    expect(invalid.props.onPress).toBeUndefined();
    expect(invalid.props.children).toBe('Legacy Guest');
    expect(title.props.numberOfLines).toBe(1);
    expect(title.props.ellipsizeMode).toBe('tail');
    expect(byTestId(rendered, 'track-identity-details').props).toMatchObject({
      numberOfLines: 1,
      ellipsizeMode: 'tail',
    });
    expect(elements(rendered).some((element) => element.type === 'Pressable')).toBe(false);

    (title.props.onPress as () => void)();
    (album.props.onPress as () => void)();
    (primary.props.onPress as () => void)();
    (featured.props.onPress as () => void)();
    expect(onOpenAlbum).toHaveBeenNthCalledWith(1, { albumId: '9', title: 'Parity' });
    expect(onOpenAlbum).toHaveBeenNthCalledWith(2, { albumId: '9', title: 'Parity' });
    expect(onOpenArtist.mock.calls.map(([params]) => params)).toEqual([
      { artistId: '7', name: 'Primary Artist' },
      { artistId: '42', name: 'Featured Artist' },
    ]);

    expect(byTestId(rendered, 'track-identity-duration').props.children).toBe('Duration 3:05');
    expect(byTestId(rendered, 'track-identity-popularity').props.children)
      .toBe('12345 plays, 6789 listeners');
  });

  it('keeps invalid legacy identities readable and entirely inert', () => {
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const rendered = TrackIdentityLinks({
      metadata: buildTrackMetadata({
        ...track,
        album_id: 'album-legacy',
        artist_id: 0,
        artists: [],
        duration_sec: 0,
      }),
      testID: 'legacy-track',
      copy,
      onOpenAlbum,
      onOpenArtist,
    });

    expect(byTestId(rendered, 'legacy-track-title-text').props.accessibilityRole).toBeUndefined();
    expect(byTestId(rendered, 'legacy-track-artist-text-0').props.children)
      .toBe('Primary Artist');
    expect(byTestId(rendered, 'legacy-track-album-label-text').props.children).toBe('Parity');
    expect(elements(rendered).some((element) => element.props.accessibilityRole === 'link'))
      .toBe(false);
    expect(elements(rendered).some((element) => element.props.testID === 'legacy-track-duration'))
      .toBe(false);
    expect(onOpenAlbum).not.toHaveBeenCalled();
    expect(onOpenArtist).not.toHaveBeenCalled();
  });

  it('keeps deterministic occurrence test ids and hides Import popularity by policy', () => {
    const rendered = TrackIdentityLinks({
      metadata: buildTrackMetadata({
        ...track,
        artists: [
          { id: '7', name: 'Primary Artist' },
          { id: '7', name: 'Primary Artist' },
        ],
      }, { popularity: 'none' }),
      testID: 'import-track',
      copy,
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      showAlbumLabel: false,
    });

    expect(byTestId(rendered, 'import-track-artist-link-0')).toBeDefined();
    expect(byTestId(rendered, 'import-track-artist-link-1')).toBeDefined();
    expect(elements(rendered).some((element) => element.props.testID === 'import-track-popularity'))
      .toBe(false);
    expect(elements(rendered).some((element) => element.props.testID === 'import-track-album-label-link'))
      .toBe(false);
  });
});
