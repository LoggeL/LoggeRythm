import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { strings } from '../../localization';
import { byTestId, flatStyle, queryByTestId } from '../../test/render';
import { colors, metrics, opacity } from '../../theme';
import { QueueRow, type QueueRowProps } from './QueueRow';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../TrackStateIndicator', () => ({ default: 'TrackStateIndicator' }));
vi.mock('../track/TrackIdentityLinks', () => ({ default: 'TrackIdentityLinks' }));

const track: Track = {
  id: '7',
  title: 'Digital Love',
  artist: 'Daft Punk',
  artist_id: 27,
  artists: [{ id: 27, name: 'Daft Punk' }],
  album: 'Discovery',
  album_id: 302127,
  cover: 'https://example.test/cover.jpg',
  duration_sec: 301,
  preview_url: null,
  rank: 1,
  release_date: '2001-03-07',
};

function row(overrides: Partial<QueueRowProps> = {}) {
  return QueueRow({
    track,
    testID: 'queue-row-a',
    active: false,
    presentation: { playback: 'inactive' } as QueueRowProps['presentation'],
    disabled: false,
    canMoveUp: true,
    canMoveDown: false,
    onSkip: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    onRemove: vi.fn(),
    onOpenAlbum: vi.fn(),
    onOpenArtist: vi.fn(),
    ...overrides,
  });
}

describe('QueueRow', () => {
  it('exposes skip, reorder and remove as separate labelled controls', () => {
    const onSkip = vi.fn();
    const onMoveUp = vi.fn();
    const onRemove = vi.fn();
    const rendered = row({ onSkip, onMoveUp, onRemove, moveControlsOpen: true });
    const skip = byTestId(rendered, 'queue-row-a-track');
    const up = byTestId(rendered, 'queue-row-a-move-up');
    const down = byTestId(rendered, 'queue-row-a-move-down');
    const remove = byTestId(rendered, 'queue-row-a-remove');

    expect(skip.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: strings.queue.skipLabel(track.title, track.artist, false),
      accessibilityHint: strings.queue.skipHint,
      accessibilityState: { selected: false, busy: false, disabled: false },
    });
    expect(up.props.accessibilityLabel).toBe(strings.queue.moveUp(track.title));
    expect(up.props.disabled).toBe(false);
    expect(down.props.accessibilityLabel).toBe(strings.queue.moveDown(track.title));
    expect(down.props.disabled).toBe(true);
    expect(remove.props.accessibilityLabel).toBe(strings.queue.remove(track.title));

    (skip.props.onPress as () => void)();
    (up.props.onPress as () => void)();
    (remove.props.onPress as () => void)();
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onMoveUp).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('lays every control out as a full, non-overlapping 48dp target', () => {
    const rendered = row({ dragHandlers: {}, moveControlsOpen: true });

    for (const suffix of ['remove', 'drag-handle', 'move-up', 'move-down']) {
      const style = flatStyle(byTestId(rendered, `queue-row-a-${suffix}`).props.style);
      expect(style.minWidth ?? style.width).toBe(metrics.minimumTouchTarget);
      expect(style.minHeight ?? style.height).toBe(metrics.minimumTouchTarget);
      // No negative margin may pull a control under its neighbour: the later
      // sibling (ultimately the destructive remove) would win the overlap.
      for (const margin of ['margin', 'marginLeft', 'marginRight', 'marginHorizontal'] as const) {
        expect(Number(style[margin] ?? 0)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('highlights the loaded item and offers no reorder/remove controls for it', () => {
    const rendered = row({
      active: true,
      presentation: { playback: 'buffering' } as QueueRowProps['presentation'],
    });
    const skip = byTestId(rendered, 'queue-row-a-track');

    expect(flatStyle(byTestId(rendered, 'queue-row-a').props.style).backgroundColor)
      .toBe(colors.accentSubtle);
    expect(skip.props.accessibilityLabel)
      .toBe(strings.queue.skipLabel(track.title, track.artist, true));
    expect(skip.props.accessibilityHint).toBeUndefined();
    expect(skip.props.accessibilityState).toEqual({ selected: true, busy: true, disabled: false });
    expect(queryByTestId(rendered, 'queue-row-a-move-up')).toBeNull();
    expect(queryByTestId(rendered, 'queue-row-a-move-down')).toBeNull();
    expect(queryByTestId(rendered, 'queue-row-a-remove')).toBeNull();
    expect(queryByTestId(rendered, 'queue-row-a-drag-handle')).toBeNull();
    expect(
      queryByTestId(row({ active: true, moveControlsOpen: true }), 'queue-row-a-move-controls'),
    ).toBeNull();
  });

  it('offers a drag handle that carries the gesture and a non-drag way to the move buttons', () => {
    const dragHandlers = {
      onStartShouldSetResponder: vi.fn(() => true),
      onResponderMove: vi.fn(),
      onResponderRelease: vi.fn(),
    };
    const onToggleMoveControls = vi.fn();
    const rendered = row({ dragHandlers, onToggleMoveControls });
    const handle = byTestId(rendered, 'queue-row-a-drag-handle');

    expect(handle.props).toMatchObject({
      accessible: true,
      accessibilityRole: 'button',
      accessibilityLabel: strings.queue.reorder(track.title),
      accessibilityHint: strings.queue.reorderHint,
      accessibilityState: { disabled: false, expanded: false },
      accessibilityActions: [{ name: 'activate' }],
      ...dragHandlers,
    });
    // The move buttons stay out of the row until the handle is tapped.
    expect(queryByTestId(rendered, 'queue-row-a-move-up')).toBeNull();
    expect(queryByTestId(rendered, 'queue-row-a-move-down')).toBeNull();

    const activate = handle.props.onAccessibilityAction as (event: unknown) => void;
    activate({ nativeEvent: { actionName: 'longpress' } });
    expect(onToggleMoveControls).not.toHaveBeenCalled();
    activate({ nativeEvent: { actionName: 'activate' } });
    expect(onToggleMoveControls).toHaveBeenCalledOnce();

    const open = row({ dragHandlers, moveControlsOpen: true });
    expect(byTestId(open, 'queue-row-a-drag-handle').props.accessibilityState)
      .toEqual({ disabled: false, expanded: true });
    expect(byTestId(open, 'queue-row-a-move-controls')).not.toBeNull();
  });

  it('disables the handle of a row that has nowhere to move', () => {
    const onToggleMoveControls = vi.fn();
    const handle = byTestId(row({ onToggleMoveControls }), 'queue-row-a-drag-handle');

    expect(handle.props.accessibilityState).toEqual({ disabled: true, expanded: false });
    expect(handle.props.onStartShouldSetResponder).toBeUndefined();
    expect(flatStyle(handle.props.style).opacity).toBe(opacity.disabled);
    (handle.props.onAccessibilityAction as (event: unknown) => void)({
      nativeEvent: { actionName: 'activate' },
    });
    expect(onToggleMoveControls).not.toHaveBeenCalled();
  });

  it('dims the row in the list while its floating copy is being dragged', () => {
    expect(flatStyle(byTestId(row(), 'queue-row-a').props.style).opacity).toBeUndefined();
    const dragging = byTestId(row({ dragging: true }), 'queue-row-a');
    expect(flatStyle(dragging.props.style).opacity).toBe(opacity.disabled);
    // Measured for drag-and-drop, so Android must keep the view.
    expect(dragging.props.collapsable).toBe(false);
  });

  it('blocks every control while a queue mutation is running', () => {
    const dragHandlers = { onStartShouldSetResponder: vi.fn(() => true) };
    const rendered = row({
      disabled: true,
      canMoveDown: true,
      dragHandlers,
      moveControlsOpen: true,
    });

    for (const suffix of ['track', 'move-up', 'move-down', 'remove']) {
      expect(byTestId(rendered, `queue-row-a-${suffix}`).props.disabled).toBe(true);
    }
    const handle = byTestId(rendered, 'queue-row-a-drag-handle');
    expect(handle.props.accessibilityState).toEqual({ disabled: true, expanded: true });
    expect(handle.props.onStartShouldSetResponder).toBeUndefined();
  });
});
