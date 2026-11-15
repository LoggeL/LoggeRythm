import { beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, flatStyle, queryByTestId } from '../../test/render';
import { PlaylistFormSheet, type PlaylistFormSheetProps } from './PlaylistFormSheet';

const mocks = vi.hoisted(() => ({ keyboardInset: 0 }));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  BottomSheet: 'BottomSheet',
}));
vi.mock('./useKeyboardInset', () => ({ useKeyboardInset: () => mocks.keyboardInset }));

function render(overrides: Partial<PlaylistFormSheetProps> = {}) {
  const props: PlaylistFormSheetProps = {
    visible: true,
    testIDPrefix: 'library-create',
    title: libraryStrings.library.createTitle,
    name: 'Night Drive',
    description: '',
    error: null,
    busy: false,
    submitLabel: libraryStrings.library.createPlaylist,
    busyLabel: libraryStrings.library.creating,
    submitIcon: 'plus',
    onNameChange: vi.fn(),
    onDescriptionChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { props, tree: PlaylistFormSheet(props) };
}

describe('PlaylistFormSheet', () => {
  beforeEach(() => {
    mocks.keyboardInset = 0;
  });

  it('is a titled bottom sheet whose dismissal is the form close', () => {
    const { props, tree } = render();
    const sheet = byTestId(tree, 'library-create-modal');

    expect(sheet.type).toBe('BottomSheet');
    expect(sheet.props).toMatchObject({
      visible: true,
      title: libraryStrings.library.createTitle,
      closeLabel: libraryStrings.common.dismiss,
      onClose: props.onClose,
    });
    expect(byTestId(tree, 'library-create-form-scroll').props.keyboardShouldPersistTaps)
      .toBe('handled');
  });

  it('labels both fields, bounds their length and forwards edits', () => {
    const { props, tree } = render();
    const name = byTestId(tree, 'library-create-name');
    const description = byTestId(tree, 'library-create-description');

    expect(name.props).toMatchObject({
      accessibilityLabel: libraryStrings.library.name,
      value: 'Night Drive',
      editable: true,
      autoFocus: true,
      maxLength: 120,
    });
    expect(description.props).toMatchObject({
      accessibilityLabel: libraryStrings.library.description,
      multiline: true,
      maxLength: 500,
    });
    (name.props.onChangeText as (value: string) => void)('Morning');
    (description.props.onChangeText as (value: string) => void)('Coffee');
    expect(props.onNameChange).toHaveBeenCalledExactlyOnceWith('Morning');
    expect(props.onDescriptionChange).toHaveBeenCalledExactlyOnceWith('Coffee');
  });

  it('submits and cancels through its two buttons', () => {
    const { props, tree } = render({ testIDPrefix: 'playlist-edit' });
    const submit = byTestId(tree, 'playlist-edit-submit');

    expect(submit.props.accessibilityLabel).toBe(libraryStrings.library.createPlaylist);
    (submit.props.onPress as () => void)();
    (byTestId(tree, 'playlist-edit-cancel').props.onPress as () => void)();
    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('locks the form and names the running request while busy', () => {
    const { tree } = render({ busy: true });

    expect(byTestId(tree, 'library-create-name').props.editable).toBe(false);
    expect(byTestId(tree, 'library-create-description').props.editable).toBe(false);
    expect(byTestId(tree, 'library-create-cancel').props.disabled).toBe(true);
    expect(byTestId(tree, 'library-create-submit').props).toMatchObject({
      accessibilityLabel: libraryStrings.library.creating,
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
  });

  it('announces a failure assertively and only when there is one', () => {
    expect(queryByTestId(render().tree, 'library-create-error')).toBeNull();

    const { tree } = render({ error: libraryStrings.playlist.nameRequired });
    const error = byTestId(tree, 'library-create-error');
    expect(error.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
      children: libraryStrings.playlist.nameRequired,
    });
  });

  it('lifts its content above the keyboard by the keyboard height', () => {
    expect(flatStyle(byTestId(render().tree, 'library-create-keyboard-spacer').props.style).height)
      .toBe(0);

    mocks.keyboardInset = 280;
    expect(flatStyle(byTestId(render().tree, 'library-create-keyboard-spacer').props.style).height)
      .toBe(280);
  });
});
