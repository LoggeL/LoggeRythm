import { describe, expect, it, vi } from 'vitest';
import { byType, flatStyle } from '../../test/render';
import { colors, metrics, opacity } from '../../theme';
import { PlayButton } from './PlayButton';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('PlayButton', () => {
  it('is a round accent button that toggles between play and pause glyphs', () => {
    const onPress = vi.fn();
    const paused = PlayButton({ onPress, accessibilityLabel: 'Wiedergabe starten', testID: 'play' });
    expect(paused.props.accessibilityRole).toBe('button');
    expect(paused.props.accessibilityLabel).toBe('Wiedergabe starten');
    expect(flatStyle(paused.props.style)).toMatchObject({
      backgroundColor: colors.accent,
      width: 56,
      height: 56,
    });
    expect(byType(paused, 'AppIcon')[0].props).toMatchObject({ name: 'play', color: colors.onAccent });
    paused.props.onPress();
    expect(onPress).toHaveBeenCalledOnce();

    const playing = PlayButton({ onPress, accessibilityLabel: 'Pause', playing: true });
    expect(byType(playing, 'AppIcon')[0].props.name).toBe('pause');
    const shuffle = PlayButton({ onPress, accessibilityLabel: 'Zufall', playing: true, icon: 'shuffle' });
    expect(byType(shuffle, 'AppIcon')[0].props.name).toBe('shuffle');
  });

  it.each([['sm', 48], ['md', 56], ['lg', 64]] as const)(
    'never drops below the touch target at size %s',
    (size, diameter) => {
      const style = flatStyle(PlayButton({ onPress: vi.fn(), accessibilityLabel: 'Play', size }).props.style);
      expect(style.width).toBe(diameter);
      expect(style.height).toBe(diameter);
      expect(diameter).toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
    },
  );

  it('announces buffering as busy and blocks presses', () => {
    const busy = PlayButton({ onPress: vi.fn(), accessibilityLabel: 'Play', busy: true });
    expect(busy.props.disabled).toBe(true);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(byType(busy, 'ActivityIndicator')).toHaveLength(1);
    expect(flatStyle(busy.props.style).opacity).toBeUndefined();

    const disabled = PlayButton({ onPress: vi.fn(), accessibilityLabel: 'Play', disabled: true });
    expect(flatStyle(disabled.props.style).opacity).toBe(opacity.disabled);
  });
});
