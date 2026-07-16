import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { colors } from '../../theme';
import {
  NOW_PLAYING_BACKDROP_BLUR,
  NOW_PLAYING_BACKDROP_COVER_SIZE,
  NOW_PLAYING_COVER_SIZE,
  NowPlayingArtwork,
  NowPlayingBackdrop,
} from './NowPlayingArtwork';

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: {
    create: <T,>(styles: T): T => styles,
    hairlineWidth: 1,
  },
  View: 'View',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => element.props.testID === testID) ?? null;
}

const deezerCover =
  'https://cdn-images.dzcdn.net/images/cover/hash/250x250-000000-80-0-0.jpg';
const hiResCover =
  `https://cdn-images.dzcdn.net/images/cover/hash/${NOW_PLAYING_COVER_SIZE}x${NOW_PLAYING_COVER_SIZE}-000000-80-0-0.jpg`;
const backdropCover =
  `https://cdn-images.dzcdn.net/images/cover/hash/${NOW_PLAYING_BACKDROP_COVER_SIZE}x${NOW_PLAYING_BACKDROP_COVER_SIZE}-000000-80-0-0.jpg`;

describe('Now Playing artwork primitives', () => {
  it('renders a static high-resolution blurred backdrop hidden from touch and accessibility', () => {
    const rendered = NowPlayingBackdrop({ coverUri: deezerCover });
    const root = byTestId(rendered, 'now-playing-backdrop');
    const image = byTestId(rendered, 'now-playing-backdrop-image');

    expect(root?.props).toMatchObject({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
      pointerEvents: 'none',
    });
    expect(image?.props).toMatchObject({
      accessible: false,
      accessibilityIgnoresInvertColors: true,
      source: { uri: backdropCover },
      resizeMode: 'cover',
      resizeMethod: 'resize',
      blurRadius: NOW_PLAYING_BACKDROP_BLUR,
      fadeDuration: 0,
    });
  });

  it('keeps a static brand fallback but does not create an Image without a cover', () => {
    const rendered = NowPlayingBackdrop({ coverUri: '   ' });

    expect(byTestId(rendered, 'now-playing-backdrop')).not.toBeNull();
    expect(byTestId(rendered, 'now-playing-backdrop-image')).toBeNull();
    expect(byTestId(rendered, 'now-playing-backdrop-brand-wash')).not.toBeNull();
  });

  it('renders framed high-resolution artwork with nonduplicated accessibility semantics', () => {
    const rendered = NowPlayingArtwork({ coverUri: deezerCover });
    const frame = byTestId(rendered, 'now-playing-artwork');
    const image = byTestId(rendered, 'now-playing-artwork-image');
    const frameStyles = frame?.props.style as unknown[];

    expect(frame?.props).toMatchObject({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
      pointerEvents: 'none',
    });
    expect(frameStyles[0]).toMatchObject({
      aspectRatio: 1,
      backgroundColor: colors.accent,
      shadowColor: colors.accent,
      elevation: 14,
    });
    expect(image?.props).toMatchObject({
      accessible: false,
      accessibilityIgnoresInvertColors: true,
      source: { uri: hiResCover },
      resizeMode: 'cover',
      resizeMethod: 'resize',
      fadeDuration: 0,
    });
    expect(byTestId(rendered, 'now-playing-artwork-placeholder')).toBeNull();
  });

  it('renders the framed brand placeholder and no remote Image for a missing cover', () => {
    const rendered = NowPlayingArtwork({ coverUri: null, testID: 'cover' });

    expect(byTestId(rendered, 'cover')).not.toBeNull();
    expect(byTestId(rendered, 'cover-image')).toBeNull();
    expect(byTestId(rendered, 'cover-placeholder')?.props.accessible).toBe(false);
    expect(byTestId(rendered, 'cover-placeholder-equalizer')).not.toBeNull();
  });
});
