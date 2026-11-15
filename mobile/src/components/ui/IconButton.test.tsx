import { describe, expect, it, vi } from 'vitest';
import { byType, flatStyle } from '../../test/render';
import { colors, metrics, opacity } from '../../theme';
import { IconButton } from './IconButton';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('IconButton', () => {
  it('is a labelled 48dp round button regardless of glyph size', () => {
    const onPress = vi.fn();
    const rendered = IconButton({
      icon: 'dots-vertical',
      onPress,
      accessibilityLabel: 'Weitere Aktionen',
      size: 'sm',
      testID: 'more',
    });
    expect(rendered.type).toBe('Pressable');
    expect(rendered.props.accessibilityRole).toBe('button');
    expect(rendered.props.accessibilityLabel).toBe('Weitere Aktionen');
    expect(rendered.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(flatStyle(rendered.props.style)).toMatchObject({
      width: metrics.minimumTouchTarget,
      height: metrics.minimumTouchTarget,
    });
    const [icon] = byType(rendered, 'AppIcon');
    expect(icon.props).toMatchObject({ name: 'dots-vertical', size: 20, color: colors.textSecondary });
    rendered.props.onPress();
    expect(onPress).toHaveBeenCalledOnce();
    expect(flatStyle(rendered.props.style, { pressed: true }).opacity).toBe(opacity.pressed);
  });

  it('reports toggle state and tints the selected glyph', () => {
    const rendered = IconButton({
      icon: 'shuffle',
      onPress: vi.fn(),
      accessibilityLabel: 'Zufall',
      selected: true,
    });
    expect(rendered.props.accessibilityState).toEqual({ disabled: false, busy: false, selected: true });
    expect(byType(rendered, 'AppIcon')[0].props.color).toBe(colors.accentSoft);
  });

  it('uses dark ink on the filled variant and honours a colour override', () => {
    const filled = IconButton({ icon: 'play', onPress: vi.fn(), accessibilityLabel: 'Play', variant: 'filled' });
    expect(flatStyle(filled.props.style).backgroundColor).toBe(colors.textPrimary);
    expect(byType(filled, 'AppIcon')[0].props.color).toBe(colors.onLight);
    const danger = IconButton({ icon: 'delete', onPress: vi.fn(), accessibilityLabel: 'Löschen', color: colors.danger });
    expect(byType(danger, 'AppIcon')[0].props.color).toBe(colors.danger);
  });

  it('blocks presses and shows a spinner while busy', () => {
    const rendered = IconButton({ icon: 'download', onPress: vi.fn(), accessibilityLabel: 'Laden', busy: true });
    expect(rendered.props.disabled).toBe(true);
    expect(rendered.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(byType(rendered, 'ActivityIndicator')).toHaveLength(1);
    expect(byType(rendered, 'AppIcon')).toHaveLength(0);
    expect(flatStyle(rendered.props.style).opacity).toBe(opacity.disabled);
  });
});
