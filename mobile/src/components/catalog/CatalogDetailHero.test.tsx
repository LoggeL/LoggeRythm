import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { CatalogDetailHero } from './CatalogDetailHero';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('CatalogDetailHero', () => {
  it('stacks cover, eyebrow, header title and copy above one play action', () => {
    const onPress = vi.fn();
    const rendered = CatalogDetailHero({
      artwork: React.createElement('Cover', { testID: 'cover' }),
      eyebrow: 'ALBUM',
      eyebrowTestID: 'album-type',
      title: 'A very long album title that must not push the play button off screen',
      titleTestID: 'album-title',
      play: { testID: 'album-play-all', accessibilityLabel: 'Play all', onPress },
      children: React.createElement('Meta', { testID: 'meta' }),
    });

    expect(byTestId(rendered, 'cover')).toBeDefined();
    expect(byTestId(rendered, 'album-type').props.children).toBe('ALBUM');
    const title = byTestId(rendered, 'album-title');
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.numberOfLines).toBe(3);
    expect(byTestId(rendered, 'meta')).toBeDefined();

    const play = byTestId(rendered, 'album-play-all');
    expect(play.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Play all',
      accessibilityState: { disabled: false, busy: false },
    });
    (play.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
    // Exactly one loud control.
    expect(byType(rendered, 'Pressable')).toHaveLength(1);
  });

  it('disables play for an empty collection and centres an artist identity', () => {
    const rendered = CatalogDetailHero({
      artwork: React.createElement('Cover'),
      title: 'Artist',
      titleTestID: 'artist-title',
      centered: true,
      play: { testID: 'artist-play-all', accessibilityLabel: 'Play', disabled: true, onPress: vi.fn() },
      actions: React.createElement('Follow', { testID: 'follow' }),
    });

    expect(byTestId(rendered, 'artist-play-all').props.disabled).toBe(true);
    expect(flatStyle(byTestId(rendered, 'artist-title').props.style).textAlign).toBe('center');
    expect(byTestId(rendered, 'follow')).toBeDefined();
  });

  it('keeps the legacy row layout for callers that supply their own identity block', () => {
    const rendered = CatalogDetailHero({
      artwork: React.createElement('Cover', { testID: 'cover' }),
      actions: React.createElement('Action', { testID: 'action' }),
      children: React.createElement('Identity', { testID: 'identity' }),
    });

    expect(byTestId(rendered, 'cover')).toBeDefined();
    expect(byTestId(rendered, 'identity')).toBeDefined();
    expect(byTestId(rendered, 'action')).toBeDefined();
    expect(textContent(rendered)).toEqual([]);
    expect(queryByTestId(rendered, 'album-play-all')).toBeNull();
    expect(byType(rendered, 'Pressable')).toHaveLength(0);
  });
});
