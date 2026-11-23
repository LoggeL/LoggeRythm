import { beforeEach, describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle } from '../../test/render';
import { colors, radii } from '../../theme';
import {
  Artwork,
  isArtworkFailed,
  isArtworkLoaded,
  resetArtworkCacheForTests,
} from './Artwork';

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

beforeEach(() => {
  resetArtworkCacheForTests();
});

describe('Artwork', () => {
  it('renders a calm loading surface without placeholder icon bleed-through and switches to fadeDuration=0 once seen', () => {
    const uri = 'https://example.test/cover.jpg';
    const initial = Artwork({ uri, size: 48, testID: 'cover' });
    expect(initial.props.testID).toBe('cover');
    expect(flatStyle(initial.props.style)).toMatchObject({
      width: 48,
      height: 48,
      borderRadius: radii.sm,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    });
    // Loading state must NOT bleed the missing-cover icon behind the image.
    expect(byType(initial, 'AppIcon')).toHaveLength(0);

    const [firstImage] = byType(initial, 'Image');
    expect(firstImage.props.source).toEqual({ uri });
    expect(firstImage.props.accessible).toBe(false);
    expect(firstImage.props.fadeDuration).toBeGreaterThan(0);
    expect(flatStyle(firstImage.props.style).position).toBe('absolute');

    // Simulate image load completion -> cached URL paints immediately without recycle flash.
    (firstImage.props.onLoad as () => void)();
    expect(isArtworkLoaded(uri)).toBe(true);

    const recycled = Artwork({ uri, size: 48, testID: 'cover' });
    const [recycledImage] = byType(recycled, 'Image');
    expect(recycledImage.props.fadeDuration).toBe(0);
  });

  it('distinguishes real image load failure from a missing cover and recovers if a reload succeeds', () => {
    const uri = 'https://example.test/broken.jpg';
    const initial = Artwork({
      uri,
      size: 64,
      testID: 'cover',
      accessibilityLabel: 'Cover von Parity',
    });
    const [image] = byType(initial, 'Image');

    (image.props.onError as () => void)();
    expect(isArtworkFailed(uri)).toBe(true);
    expect(isArtworkLoaded(uri)).toBe(false);

    const failed = Artwork({
      uri,
      size: 64,
      testID: 'cover',
      accessibilityLabel: 'Cover von Parity',
    });
    const errorSurface = byTestId(failed, 'cover-error');
    expect(flatStyle(errorSurface.props.style)).toMatchObject({
      backgroundColor: colors.dangerSubtle,
      borderColor: colors.danger,
    });
    expect(byType(failed, 'AppIcon')[0].props).toMatchObject({
      name: 'image-broken-variant',
      color: colors.danger,
    });
    expect(failed.props.accessibilityLabel).toContain('Cover von Parity');
    expect(failed.props.accessibilityLabel).not.toBe('Cover von Parity');

    // Recovery after reconnect / successful retry clears failed state.
    const [retryImage] = byType(failed, 'Image');
    (retryImage.props.onLoad as () => void)();
    expect(isArtworkFailed(uri)).toBe(false);
    expect(isArtworkLoaded(uri)).toBe(true);
  });

  it.each([null, undefined, '', '   '])('renders only the missing-cover placeholder for uri %j', (uri) => {
    const rendered = Artwork({ uri, size: 148, icon: 'album' });
    expect(byType(rendered, 'Image')).toHaveLength(0);
    expect(byType(rendered, 'AppIcon')[0].props.name).toBe('album');
    expect(flatStyle(rendered.props.style)).toMatchObject({
      borderRadius: radii.card,
      backgroundColor: colors.surfaceElevated,
    });
  });

  it('supports round avatars, explicit radii and fluid tiles', () => {
    expect(flatStyle(Artwork({ uri: null, size: 96, shape: 'round' }).props.style).borderRadius).toBe(radii.pill);
    expect(flatStyle(Artwork({ uri: null, size: 96, radius: 'panel' }).props.style).borderRadius).toBe(radii.panel);
    const fill = flatStyle(Artwork({ uri: null, size: 'fill' }).props.style);
    expect(fill).toMatchObject({ width: '100%', aspectRatio: 1 });
    expect(fill.height).toBeUndefined();
  });

  it('is decorative unless it is given an accessibility label', () => {
    const decorative = Artwork({ uri: null, size: 48 });
    expect(decorative.props.accessible).toBe(false);
    expect(decorative.props.importantForAccessibility).toBe('no-hide-descendants');
    const labelled = Artwork({ uri: null, size: 48, accessibilityLabel: 'Cover von Abbey Road' });
    expect(labelled.props.accessible).toBe(true);
    expect(labelled.props.accessibilityRole).toBe('image');
    expect(labelled.props.accessibilityLabel).toBe('Cover von Abbey Road');
  });
});
