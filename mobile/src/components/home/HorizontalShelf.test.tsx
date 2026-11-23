import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { byTestId, flatStyle } from '../../test/render';
import { HorizontalShelf } from './HorizontalShelf';

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  StyleSheet: { create: <T,>(styles: T): T => styles },
}));

describe('HorizontalShelf', () => {
  it('passes the caller data array directly to FlatList without cloning every render', () => {
    const items = ['a', 'b', 'c'] as const;
    const rendered = HorizontalShelf({
      id: 'new-releases',
      data: items,
      keyExtractor: (item) => item,
      renderItem: (item) => React.createElement('Card', { item }),
    });
    const list = byTestId(rendered, 'home-shelf-new-releases');

    expect(list.type).toBe('FlatList');
    expect(list.props.horizontal).toBe(true);
    expect(list.props.data).toBe(items);
    expect(list.props.removeClippedSubviews).toBe(false);
  });

  it('supports TV horizontal padding and gap overrides', () => {
    const rendered = HorizontalShelf({
      id: 'genres',
      data: ['rock'],
      paddingHorizontal: 32,
      gap: 20,
      keyExtractor: (item) => item,
      renderItem: (item) => React.createElement('Card', { item }),
    });
    const style = flatStyle(byTestId(rendered, 'home-shelf-genres').props.contentContainerStyle);

    expect(style.paddingHorizontal).toBe(32);
    expect(style.gap).toBe(20);
  });
});
