import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId, flatStyle, textContent } from '../../test/render';
import { colors, metrics, opacity } from '../../theme';
import { PlayerErrorBanner } from './PlayerErrorBanner';
import { PlayerToggleButton } from './PlayerToggleButton';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('PlayerToggleButton', () => {
  it('reports the mode as checked on a 48dp target and forwards presses', () => {
    const onPress = vi.fn();
    const rendered = PlayerToggleButton({
      testID: 'toggle',
      icon: 'repeat',
      checked: true,
      accessibilityLabel: 'Repeat all',
      accessibilityHint: 'Changes repeat',
      onPress,
    });
    const button = byTestId(rendered, 'toggle');

    expect(button.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Repeat all',
      accessibilityHint: 'Changes repeat',
      accessibilityState: { checked: true },
      disabled: false,
    });
    expect(flatStyle(button.props.style)).toMatchObject({
      minWidth: metrics.minimumTouchTarget,
      minHeight: metrics.minimumTouchTarget,
    });
    expect(flatStyle(button.props.style, { pressed: true }).opacity).toBe(opacity.pressed);
    (button.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('blocks presses and reports busy while its own command runs', () => {
    const rendered = PlayerToggleButton({
      testID: 'toggle',
      icon: 'shuffle-variant',
      checked: false,
      busy: true,
      accessibilityLabel: 'Shuffle',
      onPress: vi.fn(),
    });
    const button = byTestId(rendered, 'toggle');

    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState).toEqual({ checked: false, busy: true, disabled: true });
  });
});

describe('PlayerErrorBanner', () => {
  it('announces the given message assertively and dismisses through one labelled control', () => {
    const onDismiss = vi.fn();
    const rendered = PlayerErrorBanner({ testID: 'error', message: 'Safe error', onDismiss });
    const banner = byTestId(rendered, 'error');
    const dismiss = byTestId(rendered, 'error-dismiss');

    expect(banner.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(flatStyle(banner.props.style).borderColor).toBe(colors.danger);
    expect(textContent(rendered)).toEqual(['Safe error']);
    expect(dismiss.props.accessibilityLabel).toBe(strings.player.playerErrorDismiss);
    (dismiss.props.onPress as () => void)();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
