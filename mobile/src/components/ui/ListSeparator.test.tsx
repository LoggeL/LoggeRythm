import { describe, expect, it, vi } from 'vitest';
import { flatStyle } from '../../test/render';
import { colors } from '../../theme';
import { ListSeparator } from './ListSeparator';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));

describe('ListSeparator', () => {
  it('draws an inaccessible 1dp hairline with an optional inset', () => {
    const plain = ListSeparator({});
    expect(plain.props.accessible).toBe(false);
    expect(plain.props.importantForAccessibility).toBe('no');
    expect(flatStyle(plain.props.style)).toEqual({
      height: 1,
      backgroundColor: colors.hairline,
      marginLeft: 0,
    });
    expect(flatStyle(ListSeparator({ inset: 76 }).props.style).marginLeft).toBe(76);
  });
});
