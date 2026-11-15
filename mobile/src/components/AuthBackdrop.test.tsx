import { describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle } from '../test/render';
import { colors } from '../theme';
import AuthBackdrop from './AuthBackdrop';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));

describe('AuthBackdrop', () => {
  it('is a decorative, touch-transparent layer behind the content', () => {
    const root = byTestId(AuthBackdrop(), 'auth-backdrop');

    expect(root.props.accessible).toBe(false);
    expect(root.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(root.props.pointerEvents).toBe('none');
    expect(flatStyle(root.props.style)).toMatchObject({ position: 'absolute', overflow: 'hidden' });
  });

  it('builds the glow from three shrinking accent-tinted discs', () => {
    const discs = byType(AuthBackdrop(), 'View').slice(1).map((disc) => flatStyle(disc.props.style));

    expect(discs).toHaveLength(3);
    expect(discs.every((disc) => disc.backgroundColor === colors.accentSubtle)).toBe(true);
    const widths = discs.map((disc) => disc.width as number);
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    // Each disc is centred on the top edge so only its lower half shows.
    expect(discs.every((disc) => disc.top === -(disc.height as number) / 2)).toBe(true);
  });
});
