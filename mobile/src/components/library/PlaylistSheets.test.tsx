import { describe, expect, it, vi } from 'vitest';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import {
  PlaylistActionsSheet,
  type PlaylistActionsCollaborator,
  type PlaylistActionsOwner,
  type PlaylistActionsSheetProps,
} from './PlaylistActionsSheet';
import { PlaylistDeleteSheet } from './PlaylistDeleteSheet';
import { PlaylistLeaveSheet } from './PlaylistLeaveSheet';
import { SheetActionRow } from './SheetActionRow';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Switch: 'Switch',
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../offline/OfflinePlaylistControl', () => ({ default: 'OfflinePlaylistControl' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  BottomSheet: 'BottomSheet',
}));

function owner(overrides: Partial<PlaylistActionsOwner> = {}): PlaylistActionsOwner {
  return {
    isPublic: false,
    busy: false,
    canReorder: true,
    reordering: false,
    onVisibilityChange: vi.fn(),
    onEdit: vi.fn(),
    onToggleReorder: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function actions(overrides: Partial<PlaylistActionsSheetProps> = {}) {
  return PlaylistActionsSheet({
    visible: true,
    onClose: vi.fn(),
    offline: null,
    owner: null,
    showViewerNotice: false,
    ...overrides,
  });
}

describe('SheetActionRow', () => {
  it('is one labelled button whose description is the hint', () => {
    const onPress = vi.fn();
    const row = SheetActionRow({
      testID: 'row',
      icon: 'pencil-outline',
      label: 'Edit',
      description: 'Change name',
      onPress,
    });
    const button = byTestId(row, 'row');

    expect(button.type).toBe('Pressable');
    expect(button.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Edit',
      accessibilityHint: 'Change name',
      accessibilityState: { disabled: false },
    });
    (button.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('is a static label row when its trailing control owns the interaction', () => {
    const row = SheetActionRow({ testID: 'row', icon: 'earth', label: 'Public' });

    expect(byTestId(row, 'row').type).toBe('View');
    expect(byTestId(row, 'row').props.accessibilityRole).toBeUndefined();
  });
});

describe('PlaylistActionsSheet', () => {
  it('is a dismissible bottom sheet with an explicit close button', () => {
    const onClose = vi.fn();
    const sheet = actions({ onClose });

    expect(byTestId(sheet, 'playlist-actions-modal').type).toBe('BottomSheet');
    expect(byTestId(sheet, 'playlist-actions-modal').props).toMatchObject({
      visible: true,
      onClose,
      closeLabel: libraryStrings.playlist.closeMenu,
    });
    const close = byTestId(sheet, 'playlist-actions-close');
    expect(close.props.accessibilityLabel).toBe(libraryStrings.playlist.closeMenu);
    (close.props.onPress as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('hands the offline state and actions to the shared control', () => {
    const offline = {
      state: { kind: 'idle' as const },
      copy: {} as never,
      disabled: true,
      onDownload: vi.fn(),
      onRetry: vi.fn(),
      onRemove: vi.fn(),
    };
    const control = byTestId(actions({ offline }), 'playlist-offline-menu-control');

    expect(control.props).toMatchObject(offline);
    expect(queryByTestId(actions(), 'playlist-offline-menu-control')).toBeNull();
  });

  it('gives the owner visibility, edit, reorder and delete', () => {
    const config = owner({ isPublic: true });
    const sheet = actions({ owner: config });
    const visibility = byTestId(sheet, 'playlist-visibility');

    expect(queryByTestId(sheet, 'playlist-owner-controls')).not.toBeNull();
    expect(visibility.props).toMatchObject({
      value: true,
      disabled: false,
      accessibilityLabel: libraryStrings.playlist.makePrivate,
    });
    (visibility.props.onValueChange as (value: boolean) => void)(false);
    (byTestId(sheet, 'playlist-edit').props.onPress as () => void)();
    (byTestId(sheet, 'playlist-reorder').props.onPress as () => void)();
    (byTestId(sheet, 'playlist-delete').props.onPress as () => void)();
    expect(config.onVisibilityChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(config.onEdit).toHaveBeenCalledOnce();
    expect(config.onToggleReorder).toHaveBeenCalledOnce();
    expect(config.onDelete).toHaveBeenCalledOnce();
    expect(textContent(sheet)).toContain(libraryStrings.playlist.publicHint);
  });

  it('blocks every write while a mutation is pending and hides reorder for an empty list', () => {
    const sheet = actions({ owner: owner({ busy: true, canReorder: false }) });

    expect(byTestId(sheet, 'playlist-visibility').props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true },
      accessibilityLabel: libraryStrings.playlist.makePublic,
    });
    expect(byTestId(sheet, 'playlist-edit').props.disabled).toBe(true);
    expect(byTestId(sheet, 'playlist-delete').props.disabled).toBe(true);
    expect(queryByTestId(sheet, 'playlist-reorder')).toBeNull();
  });

  it('names the way out of reorder mode while it is active', () => {
    const sheet = actions({ owner: owner({ reordering: true }) });

    expect(byTestId(sheet, 'playlist-reorder').props.accessibilityLabel)
      .toBe(libraryStrings.playlist.reorderDone);
  });

  it('tells a viewer why there are no edit actions', () => {
    const viewer = actions({ showViewerNotice: true });

    expect(queryByTestId(viewer, 'playlist-owner-controls')).toBeNull();
    expect(queryByTestId(viewer, 'playlist-delete')).toBeNull();
    expect(textContent(byTestId(viewer, 'playlist-viewer-permissions')))
      .toEqual([libraryStrings.playlist.ownerOnly]);
    expect(queryByTestId(actions({ owner: owner() }), 'playlist-viewer-permissions')).toBeNull();
  });

  it('wires owner collaboration switch and collaborators sheet entry', () => {
    const onCollaborativeChange = vi.fn();
    const onOpenCollaborators = vi.fn();
    const sheet = actions({
      owner: owner({
        isCollaborative: true,
        collaboratorCount: 2,
        onCollaborativeChange,
        onOpenCollaborators,
      }),
    });

    const collabSwitch = byTestId(sheet, 'playlist-collaborative');
    expect(collabSwitch.props).toMatchObject({
      value: true,
      disabled: false,
      accessibilityLabel: libraryStrings.playlist.disableCollaborative,
    });
    (collabSwitch.props.onValueChange as (value: boolean) => void)(false);
    expect(onCollaborativeChange).toHaveBeenCalledExactlyOnceWith(false);

    (byTestId(sheet, 'playlist-collaborators').props.onPress as () => void)();
    expect(onOpenCollaborators).toHaveBeenCalledOnce();
  });

  it('shows collaborator actions for active and paused collaborators without owner controls', () => {
    const activeCollab: PlaylistActionsCollaborator = {
      isCollaborative: true,
      canEditTracks: true,
      collaboratorCount: 3,
      busy: false,
      canReorder: true,
      reordering: false,
      onOpenCollaborators: vi.fn(),
      onToggleReorder: vi.fn(),
      onLeave: vi.fn(),
    };
    const activeSheet = actions({ collaborator: activeCollab });

    expect(queryByTestId(activeSheet, 'playlist-owner-controls')).toBeNull();
    expect(queryByTestId(activeSheet, 'playlist-collaborator-controls')).not.toBeNull();
    expect(queryByTestId(activeSheet, 'playlist-frozen-notice')).toBeNull();
    (byTestId(activeSheet, 'playlist-collaborators').props.onPress as () => void)();
    (byTestId(activeSheet, 'playlist-reorder').props.onPress as () => void)();
    (byTestId(activeSheet, 'playlist-leave').props.onPress as () => void)();
    expect(activeCollab.onOpenCollaborators).toHaveBeenCalledOnce();
    expect(activeCollab.onToggleReorder).toHaveBeenCalledOnce();
    expect(activeCollab.onLeave).toHaveBeenCalledOnce();

    const pausedSheet = actions({
      collaborator: { ...activeCollab, isCollaborative: false, canEditTracks: false },
    });
    expect(queryByTestId(pausedSheet, 'playlist-reorder')).toBeNull();
    expect(textContent(byTestId(pausedSheet, 'playlist-frozen-notice'))).toEqual([
      libraryStrings.playlist.frozenNotice,
    ]);
    expect(byTestId(pausedSheet, 'playlist-leave')).toBeDefined();
  });
});

describe('PlaylistDeleteSheet', () => {
  function render(overrides: Partial<Parameters<typeof PlaylistDeleteSheet>[0]> = {}) {
    const props = {
      visible: true,
      name: 'Night Drive',
      busy: false,
      error: null,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
    return { props, tree: PlaylistDeleteSheet(props) };
  }

  it('names the playlist and treats every dismissal as cancel', () => {
    const { props, tree } = render();
    const sheet = byTestId(tree, 'playlist-delete-sheet');

    expect(sheet.props).toMatchObject({
      visible: true,
      title: libraryStrings.playlist.deleteTitle,
      onClose: props.onCancel,
    });
    expect(textContent(byTestId(tree, 'playlist-delete-message')))
      .toEqual([libraryStrings.playlist.deleteMessage('Night Drive')]);
    (byTestId(tree, 'playlist-delete-cancel').props.onPress as () => void)();
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('deletes only through the explicit destructive button', () => {
    const { props, tree } = render();
    const confirm = byTestId(tree, 'playlist-delete-confirm');

    expect(confirm.props.accessibilityLabel).toBe(libraryStrings.playlist.deleteConfirm);
    (confirm.props.onPress as () => void)();
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it('blocks both buttons while deleting and announces a failure', () => {
    const { tree } = render({ busy: true, error: libraryStrings.playlist.mutationFailed });

    expect(byTestId(tree, 'playlist-delete-cancel').props.disabled).toBe(true);
    expect(byTestId(tree, 'playlist-delete-confirm').props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(byTestId(tree, 'playlist-delete-error').props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(queryByTestId(render().tree, 'playlist-delete-error')).toBeNull();
  });
});

describe('PlaylistLeaveSheet', () => {
  function render(overrides: Partial<Parameters<typeof PlaylistLeaveSheet>[0]> = {}) {
    const props = {
      visible: true,
      name: 'WG-Küche',
      busy: false,
      error: null,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      ...overrides,
    };
    return { props, tree: PlaylistLeaveSheet(props) };
  }

  it('names the shared playlist and requires explicit destructive confirmation', () => {
    const { props, tree } = render();
    const sheet = byTestId(tree, 'playlist-leave-sheet');

    expect(sheet.props).toMatchObject({
      visible: true,
      title: libraryStrings.playlist.leaveTitle,
      onClose: props.onCancel,
    });
    expect(textContent(byTestId(tree, 'playlist-leave-message')))
      .toEqual([libraryStrings.playlist.leaveMessage('WG-Küche')]);
    (byTestId(tree, 'playlist-leave-cancel').props.onPress as () => void)();
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onConfirm).not.toHaveBeenCalled();

    (byTestId(tree, 'playlist-leave-confirm').props.onPress as () => void)();
    expect(props.onConfirm).toHaveBeenCalledOnce();
  });

  it('disables actions while leaving and renders an assertive error alert', () => {
    const { tree } = render({ busy: true, error: libraryStrings.playlist.leaveFailed });

    expect(byTestId(tree, 'playlist-leave-cancel').props.disabled).toBe(true);
    expect(byTestId(tree, 'playlist-leave-confirm').props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(byTestId(tree, 'playlist-leave-error').props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(queryByTestId(render().tree, 'playlist-leave-error')).toBeNull();
  });
});
