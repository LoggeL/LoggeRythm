import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { byTestId, flatStyle } from '../../test/render';
import { colors, metrics, opacity, radii, spacing } from '../../theme';
import { Card, Surface } from './Surface';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));

const child = React.createElement('Child');

describe('Surface', () => {
  it('renders a hairline card surface with the panel radius by default', () => {
    const rendered = Surface({ testID: 'panel', children: child });
    expect(rendered.type).toBe('View');
    expect(flatStyle(rendered.props.style)).toMatchObject({
      backgroundColor: colors.surface,
      borderColor: colors.hairline,
      borderRadius: radii.panel,
    });
    expect(flatStyle(rendered.props.style).padding).toBeUndefined();
  });

  it('elevates raised surfaces and pads on request', () => {
    const style = flatStyle(Surface({ level: 'raised', radius: 'card', padded: true }).props.style);
    expect(style).toMatchObject({
      backgroundColor: colors.surfaceElevated,
      borderRadius: radii.card,
      padding: spacing.md,
    });
    expect(style.elevation).toBeGreaterThan(0);
  });
});

describe('Card', () => {
  it('is a static padded surface without a press handler', () => {
    const rendered = Card({ testID: 'card', children: child });
    const host = byTestId(rendered, 'card');
    expect(host.type).toBe('View');
    expect(flatStyle(host.props.style).padding).toBe(spacing.md);
  });

  it('becomes one labelled 48dp button with pressed and disabled feedback', () => {
    const onPress = vi.fn();
    const rendered = Card({
      testID: 'card',
      onPress,
      accessibilityLabel: 'Album öffnen',
      children: child,
    });
    const host = byTestId(rendered, 'card');
    expect(host.type).toBe('Pressable');
    expect(host.props.accessibilityRole).toBe('button');
    expect(host.props.accessibilityLabel).toBe('Album öffnen');
    expect(host.props.accessibilityState).toEqual({ disabled: false });
    expect(flatStyle(host.props.style).minHeight).toBe(metrics.minimumTouchTarget);
    expect(flatStyle(host.props.style, { pressed: true }).opacity).toBe(opacity.pressed);
    (host.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();

    const disabled = byTestId(Card({ testID: 'card', onPress, disabled: true, children: child }), 'card');
    expect(disabled.props.disabled).toBe(true);
    expect(flatStyle(disabled.props.style).opacity).toBe(opacity.disabled);
  });
});
