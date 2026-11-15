import { describe, expect, it, vi } from 'vitest';
import { byType, flatStyle } from '../../test/render';
import { colors, radii } from '../../theme';
import { Artwork } from './Artwork';

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('Artwork', () => {
  it('layers the image over an always-present placeholder glyph', () => {
    const rendered = Artwork({ uri: 'https://example.test/cover.jpg', size: 48, testID: 'cover' });
    expect(rendered.props.testID).toBe('cover');
    expect(flatStyle(rendered.props.style)).toMatchObject({
      width: 48,
      height: 48,
      borderRadius: radii.sm,
      backgroundColor: colors.surfaceElevated,
      overflow: 'hidden',
    });
    expect(byType(rendered, 'AppIcon')[0].props.name).toBe('music-note');
    const [image] = byType(rendered, 'Image');
    expect(image.props.source).toEqual({ uri: 'https://example.test/cover.jpg' });
    expect(image.props.accessible).toBe(false);
    expect(flatStyle(image.props.style).position).toBe('absolute');
  });

  it.each([null, undefined, ''])('renders only the placeholder for uri %j', (uri) => {
    const rendered = Artwork({ uri, size: 148, icon: 'album' });
    expect(byType(rendered, 'Image')).toHaveLength(0);
    expect(byType(rendered, 'AppIcon')[0].props.name).toBe('album');
    expect(flatStyle(rendered.props.style).borderRadius).toBe(radii.card);
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
