import { describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import { byTestId, flatStyle, queryByTestId, textContent } from '../test/render';
import { colors, opacity } from '../theme';
import {
  TrackActionRow,
  TrackActionsCreateForm,
  TrackActionsHeader,
  TrackActionsPlaylistRow,
} from './TrackActionSheetParts';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Keyboard: { addListener: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('./AppIcon', () => ({ default: 'AppIcon' }));

describe('track action sheet parts', () => {
  it('renders an action as one labelled button that reports busy and disabled', () => {
    const onPress = vi.fn();
    const idle = TrackActionRow({
      testID: 'action',
      label: 'Play next',
      icon: 'playlist-play',
      disabled: false,
      onPress,
    });
    const button = byTestId(idle, 'action');

    expect(button.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Play next',
      accessibilityState: { disabled: false, busy: false },
    });
    expect(textContent(idle)).toEqual(['Play next']);
    expect(flatStyle(button.props.style, { pressed: true }).opacity).toBe(opacity.pressed);
    (button.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();

    const busy = byTestId(
      TrackActionRow({
        testID: 'action',
        label: 'Remove',
        icon: 'delete-outline',
        destructive: true,
        disabled: true,
        busy: true,
        onPress,
      }),
      'action',
    );
    expect(busy.props.disabled).toBe(true);
    expect(busy.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(
      byTestId(
        TrackActionRow({
          testID: 'action',
          label: 'Remove',
          icon: 'delete-outline',
          destructive: true,
          disabled: false,
          onPress,
        }),
        'action',
      ).props.children,
    ).toContainEqual(expect.objectContaining({
      props: expect.objectContaining({ color: colors.danger }),
    }));
  });

  it('names the track, keeps close explicit and swaps the artwork for a back control', () => {
    const onClose = vi.fn();
    const onBack = vi.fn();
    const root = TrackActionsHeader({
      title: 'Get Lucky',
      subtitle: 'Daft Punk',
      coverUri: 'https://example.test/cover.jpg',
      closeDisabled: false,
      onClose,
    });
    const close = byTestId(root, 'track-actions-close');

    expect(textContent(root)).toEqual(['Get Lucky', 'Daft Punk']);
    expect(close.props.accessibilityLabel).toBe(strings.trackActions.close);
    (close.props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
    expect(queryByTestId(root, 'back')).toBeNull();

    const nested = TrackActionsHeader({
      title: 'Add to playlist',
      subtitle: 'Get Lucky',
      coverUri: null,
      back: { testID: 'back', label: 'Back', onPress: onBack },
      closeDisabled: true,
      onClose,
    });
    const back = byTestId(nested, 'back');
    expect(back.props.accessibilityLabel).toBe('Back');
    expect(back.props.disabled).toBe(true);
    expect(byTestId(nested, 'track-actions-close').props.disabled).toBe(true);
  });

  it('adds to a playlist through one row button with the full spoken destination', () => {
    const onPress = vi.fn();
    const rendered = TrackActionsPlaylistRow({
      testID: 'playlist',
      name: 'Roadtrip',
      detail: '12 tracks',
      accessibilityLabel: 'Add Get Lucky to Roadtrip',
      disabled: false,
      busy: false,
      onPress,
    });
    const rowButton = byTestId(rendered, 'playlist');

    expect(rowButton.props.accessibilityLabel).toBe('Add Get Lucky to Roadtrip');
    expect(textContent(rendered)).toEqual(['Roadtrip', '12 tracks']);
    (rowButton.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('only submits a non-blank playlist name and reports the running request', () => {
    const onSubmit = vi.fn();
    const onChangeName = vi.fn();
    const blank = TrackActionsCreateForm({
      name: '   ',
      onChangeName,
      disabled: false,
      submitting: false,
      onSubmit,
    });
    expect(byTestId(blank, 'track-action-create-submit').props.disabled).toBe(true);
    const input = byTestId(blank, 'track-action-new-playlist-name');
    expect(input.props.accessibilityLabel).toBe(strings.trackActions.newPlaylistName);
    (input.props.onChangeText as (value: string) => void)('Mix');
    expect(onChangeName).toHaveBeenCalledWith('Mix');

    const ready = TrackActionsCreateForm({
      name: 'Mix',
      onChangeName,
      disabled: false,
      submitting: false,
      onSubmit,
    });
    const submit = byTestId(ready, 'track-action-create-submit');
    expect(submit.props.accessibilityLabel).toBe(strings.trackActions.createAndAdd);
    (submit.props.onPress as () => void)();
    expect(onSubmit).toHaveBeenCalledOnce();

    const running = TrackActionsCreateForm({
      name: 'Mix',
      onChangeName,
      disabled: true,
      submitting: true,
      onSubmit,
    });
    expect(byTestId(running, 'track-action-create-submit').props.accessibilityState)
      .toEqual({ disabled: true, busy: true });
    expect(byTestId(running, 'track-action-new-playlist-name').props.editable).toBe(false);
  });
});
