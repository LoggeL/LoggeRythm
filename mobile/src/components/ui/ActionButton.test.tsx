import { describe, expect, it, vi } from 'vitest';
import { byType, flatStyle, textContent } from '../../test/render';
import { colors, metrics, opacity, radii } from '../../theme';
import { ActionButton } from './ActionButton';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('ActionButton', () => {
  it('renders the primary action as a light pill with dark ink', () => {
    const onPress = vi.fn();
    const rendered = ActionButton({ label: 'Speichern', onPress, icon: 'check', testID: 'save' });
    expect(rendered.props.testID).toBe('save');
    expect(rendered.props.accessibilityRole).toBe('button');
    expect(rendered.props.accessibilityLabel).toBe('Speichern');
    expect(rendered.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(flatStyle(rendered.props.style)).toMatchObject({
      backgroundColor: colors.textPrimary,
      borderRadius: radii.pill,
      minHeight: metrics.minimumTouchTarget,
    });
    expect(byType(rendered, 'AppIcon')[0].props).toMatchObject({ name: 'check', color: colors.onLight });
    expect(textContent(rendered)).toEqual(['Speichern']);
    expect(flatStyle(byType(rendered, 'Text')[0].props.style).color).toBe(colors.onLight);
    rendered.props.onPress();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it.each([
    ['accent', colors.accent, colors.onAccent],
    ['secondary', colors.fill, colors.textPrimary],
    ['ghost', 'transparent', colors.textPrimary],
    ['danger', colors.dangerSubtle, colors.danger],
  ] as const)('styles the %s variant from tokens', (variant, background, ink) => {
    const rendered = ActionButton({ label: 'Aktion', onPress: vi.fn(), variant });
    expect(flatStyle(rendered.props.style).backgroundColor).toBe(background);
    expect(flatStyle(byType(rendered, 'Text')[0].props.style).color).toBe(ink);
  });

  it('dims while pressed, and blocks and announces busy/disabled', () => {
    const idle = ActionButton({ label: 'Aktion', onPress: vi.fn() });
    expect(flatStyle(idle.props.style, { pressed: true }).opacity).toBe(opacity.pressed);

    const busy = ActionButton({ label: 'Aktion', onPress: vi.fn(), icon: 'check', busy: true });
    expect(busy.props.disabled).toBe(true);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(byType(busy, 'ActivityIndicator')).toHaveLength(1);
    expect(byType(busy, 'AppIcon')).toHaveLength(0);
    expect(flatStyle(busy.props.style).opacity).toBe(opacity.disabled);

    const disabled = ActionButton({ label: 'Aktion', onPress: vi.fn(), disabled: true });
    expect(disabled.props.accessibilityState).toEqual({ disabled: true, busy: false });
  });

  it('prefers an explicit accessibility label and can stretch', () => {
    const rendered = ActionButton({
      label: 'Alle',
      accessibilityLabel: 'Alle Titel abspielen',
      onPress: vi.fn(),
      fullWidth: true,
    });
    expect(rendered.props.accessibilityLabel).toBe('Alle Titel abspielen');
    expect(flatStyle(rendered.props.style).alignSelf).toBe('stretch');
  });
});
