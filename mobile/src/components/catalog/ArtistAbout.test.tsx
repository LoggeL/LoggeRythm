import { describe, expect, it, vi } from 'vitest';
import type { ArtistAbout as ArtistAboutData } from '../../api/types';
import { byTestId } from '../../test/render';
import { ArtistAbout } from './ArtistAbout';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', () => ({
  ActionButton: 'ActionButton',
  AppText: 'AppText',
}));
vi.mock('../../hooks/useHaptics', () => ({ triggerHaptic: vi.fn() }));

const about: ArtistAboutData = {
  bio: 'Electronic music duo from Paris.',
  listeners: 4_200_000,
  playcount: 300_000_000,
  tags: ['electronic', 'french house'],
};

describe('ArtistAbout', () => {
  it('renders interactive genre tag pills that trigger mood radio when onTagPress is provided', () => {
    const onTagPress = vi.fn();
    const tree = ArtistAbout({ about, onTagPress, busyTag: null });
    const firstTag = byTestId(tree, 'artist-tag-0');
    const secondTag = byTestId(tree, 'artist-tag-1');

    expect(firstTag.props.accessibilityRole).toBe('button');
    (firstTag.props.onPress as () => void)();
    (secondTag.props.onPress as () => void)();
    expect(onTagPress).toHaveBeenNthCalledWith(1, 'electronic');
    expect(onTagPress).toHaveBeenNthCalledWith(2, 'french house');
  });

  it('marks the active tag busy and disables concurrent tag launches', () => {
    const tree = ArtistAbout({ about, onTagPress: vi.fn(), busyTag: 'electronic' });
    expect(byTestId(tree, 'artist-tag-0').props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
    expect(byTestId(tree, 'artist-tag-1').props.accessibilityState).toEqual({
      busy: false,
      disabled: true,
    });
  });
});
