import { describe, expect, it, vi } from 'vitest';
import { byType, flatStyle, textContent } from '../../test/render';
import { colors, metrics, opacity, radii } from '../../theme';
import { FilterChip } from './FilterChip';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('FilterChip', () => {
  it('renders an unselected translucent pill inside a 48dp target', () => {
    const onPress = vi.fn();
    const rendered = FilterChip({ label: 'Alben', onPress, testID: 'chip-albums' });
    expect(rendered.props.testID).toBe('chip-albums');
    expect(rendered.props.accessibilityRole).toBe('button');
    expect(rendered.props.accessibilityLabel).toBe('Alben');
    expect(rendered.props.accessibilityState).toEqual({ selected: false, disabled: false });
    expect(flatStyle(rendered.props.style).minHeight).toBe(metrics.minimumTouchTarget);
    const [pill] = byType(rendered, 'View');
    expect(flatStyle(pill.props.style)).toMatchObject({
      backgroundColor: colors.fill,
      borderRadius: radii.pill,
    });
    expect(textContent(rendered)).toEqual(['Alben']);
    expect(flatStyle(byType(rendered, 'Text')[0].props.style).color).toBe(colors.textPrimary);
    rendered.props.onPress();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('inverts to a light pill with dark ink when selected', () => {
    const rendered = FilterChip({ label: 'Alben', onPress: vi.fn(), selected: true, icon: 'album' });
    expect(rendered.props.accessibilityState).toEqual({ selected: true, disabled: false });
    expect(flatStyle(byType(rendered, 'View')[0].props.style).backgroundColor).toBe(colors.textPrimary);
    expect(flatStyle(byType(rendered, 'Text')[0].props.style).color).toBe(colors.onLight);
    expect(byType(rendered, 'AppIcon')[0].props).toMatchObject({ name: 'album', color: colors.onLight });
  });

  it('reports checked state for radio chips and selected state for tabs', () => {
    const radio = FilterChip({ label: 'Deutsch', onPress: vi.fn(), selected: true, accessibilityRole: 'radio' });
    expect(radio.props.accessibilityState).toEqual({ checked: true, disabled: false });
    const tab = FilterChip({ label: 'Titel', onPress: vi.fn(), accessibilityRole: 'tab' });
    expect(tab.props.accessibilityRole).toBe('tab');
    expect(tab.props.accessibilityState).toEqual({ selected: false, disabled: false });
  });

  it('gives press feedback only while enabled', () => {
    const enabled = FilterChip({ label: 'A', onPress: vi.fn() });
    expect(flatStyle(enabled.props.style, { pressed: true }).opacity).toBe(opacity.pressed);
    const disabled = FilterChip({ label: 'A', onPress: vi.fn(), disabled: true });
    expect(disabled.props.disabled).toBe(true);
    expect(flatStyle(disabled.props.style, { pressed: true }).opacity).toBe(opacity.disabled);
  });
});
