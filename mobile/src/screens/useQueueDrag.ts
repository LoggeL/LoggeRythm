import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type View,
} from 'react-native';
import { useHaptics } from '../hooks/useHaptics';
import type { QueueOrigin } from '../player/queueContract';
import {
  DRAG_START_DISTANCE,
  autoScrollStep,
  dropIndicatorTop,
  queueDragRange,
  resolveDropIndex,
  type QueueDragRange,
  type QueueRowFrame,
} from './queueDragModel';

const FRAME_INTERVAL_MS = 16;

/** The part of a list ref the drag needs; `SectionList` and `FlatList` both provide it. */
export interface ScrollableList {
  getScrollResponder: () =>
    | { scrollTo: (options: { y: number; animated: boolean }) => void }
    | null
    | undefined;
}

export interface QueueDragRow {
  stableId: string;
  origin: QueueOrigin;
}

/** Responder props for a row's drag handle. */
export interface QueueDragHandlers {
  onStartShouldSetResponder: () => boolean;
  onResponderGrant: (event: GestureResponderEvent) => boolean;
  onResponderMove: (event: GestureResponderEvent) => void;
  onResponderRelease: () => void;
  onResponderTerminate: () => void;
  onResponderTerminationRequest: () => boolean;
}

interface DragSession {
  stableId: string;
  fromIndex: number;
  range: QueueDragRange;
  startPageY: number;
  dy: number;
  /** The finger moved far enough: this is a drag, no longer a tap. */
  started: boolean;
  /** Window geometry of the dragged row and the list viewport, once measured. */
  geometry: { rowTop: number; rowHeight: number; viewportTop: number; viewportBottom: number } | null;
  /** Row extents by stable id; `top` is the window top plus the scroll offset when measured. */
  frames: Map<string, { top: number; height: number }>;
  targetIndex: number;
  scrollTimer: ReturnType<typeof setInterval> | null;
  /** The list auto-scrolled since the rows were last measured. */
  framesStale: boolean;
}

/** Window top of the floating copy: it follows the finger but stays inside the list. */
function ghostWindowTop(current: DragSession & { geometry: NonNullable<DragSession['geometry']> }): number {
  const { rowTop, rowHeight, viewportTop, viewportBottom } = current.geometry;
  return Math.min(
    Math.max(rowTop + current.dy, viewportTop),
    Math.max(viewportTop, viewportBottom - rowHeight),
  );
}

export interface QueueDragController {
  /** Stable id of the row being dragged; its floating copy is shown. */
  draggingId: string | null;
  /** Top of the floating copy inside the list frame. */
  ghostTop: Animated.Value;
  /** Top of the insertion line inside the list frame. */
  indicatorTop: Animated.Value;
  /** 1 while the insertion line marks a changed position, else 0. */
  indicatorOpacity: Animated.Value;
  canDrag: (nativeIndex: number) => boolean;
  handlersFor: (stableId: string) => QueueDragHandlers;
  /** Ref callbacks: every row, the view framing the list, and the list itself. */
  attachRow: (stableId: string) => (node: View | null) => void;
  attachFrame: (frame: View | null) => void;
  attachList: (list: ScrollableList | null) => void;
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: (width: number, height: number) => void;
  onFrameLayout: (event: LayoutChangeEvent) => void;
}

/**
 * Drag-to-reorder for the queue list, built on the core responder system. A
 * touch on a row's handle takes the responder at once and blocks the native
 * scroll view; past a small distance it becomes a drag that floats a copy of
 * the row, marks the insertion point and scrolls the list at its edges. The
 * drop is reported as native indices; nothing is reordered here.
 */
export function useQueueDrag({
  rows,
  activeIndex,
  disabled,
  onDrop,
  onTap,
}: {
  rows: readonly QueueDragRow[];
  activeIndex: number | null;
  /** A queue mutation is running: no drag may start. */
  disabled: boolean;
  onDrop: (fromIndex: number, toIndex: number) => void;
  /** The handle was tapped without dragging. */
  onTap: (stableId: string) => void;
}): QueueDragController {
  const haptics = useHaptics();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [ghostTop] = useState(() => new Animated.Value(0));
  const [indicatorTop] = useState(() => new Animated.Value(0));
  const [indicatorOpacity] = useState(() => new Animated.Value(0));
  const frameRef = useRef<View | null>(null);
  const listRef = useRef<ScrollableList | null>(null);
  const rowNodes = useRef(new Map<string, View>());
  const session = useRef<DragSession | null>(null);
  const scroll = useRef({ offset: 0, contentHeight: 0, viewportHeight: 0 });
  // Responder callbacks outlive the render that created them.
  const latest = useRef({ rows, activeIndex, disabled, onDrop, onTap });
  useEffect(() => {
    latest.current = { rows, activeIndex, disabled, onDrop, onTap };
  });

  const origins = useMemo(() => rows.map((row) => row.origin), [rows]);
  const canDrag = useCallback(
    (nativeIndex: number) => {
      const range = queueDragRange(origins, activeIndex, nativeIndex);
      return range !== null && range.min < range.max;
    },
    [activeIndex, origins],
  );

  /** Position the floating copy and the insertion line for the current finger position. */
  const update = useCallback(() => {
    const current = session.current;
    if (current === null || current.geometry === null) return;
    const { rowHeight, viewportTop } = current.geometry;
    const top = ghostWindowTop({ ...current, geometry: current.geometry });
    ghostTop.setValue(top - viewportTop);

    const indexOf = new Map(latest.current.rows.map((row, index) => [row.stableId, index]));
    const frames: QueueRowFrame[] = [];
    current.frames.forEach((frame, stableId) => {
      const index = indexOf.get(stableId);
      if (index !== undefined) {
        frames.push({ index, top: frame.top - scroll.current.offset, height: frame.height });
      }
    });
    current.targetIndex = resolveDropIndex(
      current.range,
      current.fromIndex,
      frames,
      top + rowHeight / 2,
    );
    const line = dropIndicatorTop(current.range, current.fromIndex, current.targetIndex, frames);
    if (line === null) {
      indicatorOpacity.setValue(0);
    } else {
      indicatorTop.setValue(line - viewportTop);
      indicatorOpacity.setValue(1);
    }
  }, [ghostTop, indicatorOpacity, indicatorTop]);

  const measureRow = useCallback(
    (stableId: string) => {
      const node = rowNodes.current.get(stableId);
      if (node === undefined) return;
      node.measureInWindow((_x, y, _width, height) => {
        const current = session.current;
        if (current === null || !current.started) return;
        current.frames.set(stableId, { top: y + scroll.current.offset, height });
        update();
      });
    },
    [update],
  );

  const end = useCallback(
    (commit: boolean) => {
      const current = session.current;
      if (current === null) return;
      session.current = null;
      if (current.scrollTimer !== null) clearInterval(current.scrollTimer);
      indicatorOpacity.setValue(0);
      if (!current.started) {
        if (commit) {
          haptics.trigger('tap');
          latest.current.onTap(current.stableId);
        }
        return;
      }
      setDraggingId(null);
      if (commit && current.targetIndex !== current.fromIndex) {
        haptics.trigger('commit');
        latest.current.onDrop(current.fromIndex, current.targetIndex);
      }
    },
    [haptics, indicatorOpacity],
  );

  const begin = useCallback(
    (current: DragSession) => {
      current.started = true;
      haptics.trigger('drag');
      const frame = frameRef.current;
      const row = rowNodes.current.get(current.stableId);
      if (frame === null || row === undefined) {
        throw new Error(`Queue drag cannot measure row ${current.stableId}: it is not mounted`);
      }
      frame.measureInWindow((_x, viewportTop, _width, viewportHeight) => {
        row.measureInWindow((_rowX, rowTop, _rowWidth, rowHeight) => {
          if (session.current !== current) return;
          scroll.current.viewportHeight = viewportHeight;
          current.geometry = {
            rowTop,
            rowHeight,
            viewportTop,
            viewportBottom: viewportTop + viewportHeight,
          };
          current.frames.set(current.stableId, { top: rowTop + scroll.current.offset, height: rowHeight });
          setDraggingId(current.stableId);
          update();
        });
      });
      rowNodes.current.forEach((_node, stableId) => measureRow(stableId));

      current.scrollTimer = setInterval(() => {
        if (session.current !== current || current.geometry === null) return;
        const { rowHeight, viewportTop, viewportBottom } = current.geometry;
        const center = ghostWindowTop({ ...current, geometry: current.geometry }) + rowHeight / 2;
        const { offset, contentHeight, viewportHeight } = scroll.current;
        const next = Math.min(
          Math.max(offset + autoScrollStep(center, viewportTop, viewportBottom), 0),
          Math.max(0, contentHeight - viewportHeight),
        );
        if (next === offset) {
          // Measurements taken while the list was moving are a frame or two
          // behind; take them again once it rests.
          if (current.framesStale) {
            current.framesStale = false;
            rowNodes.current.forEach((_node, stableId) => measureRow(stableId));
          }
          return;
        }
        const list = listRef.current?.getScrollResponder();
        if (list === null || list === undefined) {
          throw new Error('Queue drag cannot scroll: the queue list is not mounted');
        }
        scroll.current.offset = next;
        current.framesStale = true;
        list.scrollTo({ y: next, animated: false });
        update();
      }, FRAME_INTERVAL_MS);
    },
    [haptics, measureRow, update],
  );

  // A drag is defined against one queue order; a transition or an outside
  // change invalidates its indices, so the gesture is dropped without a move.
  const orderKey = `${String(activeIndex)}|${rows.map((row) => row.stableId).join('\u0000')}`;
  useEffect(() => () => end(false), [orderKey, end]);
  useEffect(() => {
    if (disabled) end(false);
  }, [disabled, end]);

  const handlersFor = useCallback((stableId: string): QueueDragHandlers => ({
    onStartShouldSetResponder: () => !latest.current.disabled && session.current === null,
    onResponderGrant: (event) => {
      const { rows: currentRows, activeIndex: currentActive } = latest.current;
      const fromIndex = currentRows.findIndex((row) => row.stableId === stableId);
      if (fromIndex < 0) throw new Error(`Queue drag row ${stableId} is not in the queue`);
      const range = queueDragRange(
        currentRows.map((row) => row.origin),
        currentActive,
        fromIndex,
      );
      if (range === null) throw new Error(`Queue drag row ${stableId} is the loaded item`);
      session.current = {
        stableId,
        fromIndex,
        range,
        startPageY: event.nativeEvent.pageY,
        dy: 0,
        started: false,
        geometry: null,
        frames: new Map(),
        targetIndex: fromIndex,
        scrollTimer: null,
        framesStale: false,
      };
      // Android: keep the native scroll view from intercepting this touch.
      return true;
    },
    onResponderMove: (event) => {
      const current = session.current;
      if (current === null || current.stableId !== stableId) return;
      current.dy = event.nativeEvent.pageY - current.startPageY;
      if (!current.started) {
        if (Math.abs(current.dy) < DRAG_START_DISTANCE || current.range.min === current.range.max) {
          return;
        }
        begin(current);
        return;
      }
      update();
    },
    onResponderRelease: () => end(true),
    onResponderTerminate: () => end(false),
    onResponderTerminationRequest: () => false,
  }), [begin, end, update]);

  const attachRow = useCallback((stableId: string) => (node: View | null) => {
    if (node === null) {
      rowNodes.current.delete(stableId);
      return;
    }
    const known = rowNodes.current.get(stableId) === node;
    rowNodes.current.set(stableId, node);
    // Rows scrolled into view during a drag are measured once they are laid out.
    if (!known && session.current?.started === true) setTimeout(() => measureRow(stableId), 0);
  }, [measureRow]);

  return {
    draggingId,
    ghostTop,
    indicatorTop,
    indicatorOpacity,
    canDrag,
    handlersFor,
    attachRow,
    attachFrame: (frame) => {
      frameRef.current = frame;
    },
    attachList: (list) => {
      listRef.current = list;
    },
    onScroll: (event) => {
      scroll.current.offset = event.nativeEvent.contentOffset.y;
    },
    onContentSizeChange: (_width, height) => {
      scroll.current.contentHeight = height;
    },
    onFrameLayout: (event) => {
      scroll.current.viewportHeight = event.nativeEvent.layout.height;
    },
  };
}
