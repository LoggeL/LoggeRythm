import type { QueueOrigin } from '../player/queueContract';

/** Finger travel on the handle before a touch counts as a drag instead of a tap. */
export const DRAG_START_DISTANCE = 6;
/** Height of the band at either list edge that scrolls the list while dragging. */
export const AUTO_SCROLL_EDGE = 72;
/** Fastest auto-scroll, in dp per frame, reached at the very edge. */
export const AUTO_SCROLL_MAX_STEP = 14;

/** Inclusive native-queue indices a row may occupy. */
export interface QueueDragRange {
  min: number;
  max: number;
}

/** A mounted row's vertical extent, in the same coordinates as the dragged row. */
export interface QueueRowFrame {
  /** Index in the canonical native queue. */
  index: number;
  top: number;
  height: number;
}

/**
 * Where a queue row may move. The loaded item never moves and nothing crosses
 * it; upcoming rows stay inside their own origin run so manually queued
 * tracks keep their priority. This mirrors what `moveQueueItem` accepts.
 */
export function queueDragRange(
  origins: readonly QueueOrigin[],
  activeIndex: number | null,
  fromIndex: number,
): QueueDragRange | null {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= origins.length) {
    throw new Error(`Queue drag index ${String(fromIndex)} is outside ${origins.length} rows`);
  }
  if (
    activeIndex !== null &&
    (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= origins.length)
  ) {
    throw new Error(
      `Queue drag active index ${String(activeIndex)} is outside ${origins.length} rows`,
    );
  }
  if (activeIndex === null) return { min: 0, max: origins.length - 1 };
  if (fromIndex === activeIndex) return null;
  if (fromIndex < activeIndex) return { min: 0, max: activeIndex - 1 };

  const origin = origins[fromIndex];
  let min = fromIndex;
  while (min - 1 > activeIndex && origins[min - 1] === origin) min -= 1;
  let max = fromIndex;
  while (max + 1 < origins.length && origins[max + 1] === origin) max += 1;
  return { min, max };
}

function assertInRange(range: QueueDragRange, index: number, label: string): void {
  if (!Number.isInteger(index) || index < range.min || index > range.max) {
    throw new Error(
      `Queue drag ${label} ${String(index)} is outside its range ${range.min}..${range.max}`,
    );
  }
}

/**
 * The native index the dragged row lands on: it ends up below every other
 * row whose centre is above the dragged row's centre. Rows that are not
 * mounted have no frame; those before the first measured row are above the
 * viewport and those after the last are below it. Without any frame the row
 * stays where it is.
 */
export function resolveDropIndex(
  range: QueueDragRange,
  fromIndex: number,
  frames: readonly QueueRowFrame[],
  draggedCenter: number,
): number {
  assertInRange(range, fromIndex, 'source');
  const measured = frames.filter(
    (frame) => frame.index !== fromIndex && frame.index >= range.min && frame.index <= range.max,
  );
  if (measured.length === 0) return fromIndex;

  const above = measured.filter((frame) => frame.top + frame.height / 2 < draggedCenter);
  // Rows are ordered top to bottom, so the rows above the dragged centre are a
  // prefix of the range: it ends at the lowest measured row that is above.
  const boundary =
    above.length > 0
      ? Math.max(...above.map((frame) => frame.index)) + 1
      : Math.min(...measured.map((frame) => frame.index));
  const othersAbove = boundary - range.min - (fromIndex < boundary ? 1 : 0);
  return range.min + othersAbove;
}

/**
 * Top edge of the insertion line for a drop index, or `null` when the row
 * would not move or the neighbouring row is not measured.
 */
export function dropIndicatorTop(
  range: QueueDragRange,
  fromIndex: number,
  targetIndex: number,
  frames: readonly QueueRowFrame[],
): number | null {
  assertInRange(range, fromIndex, 'source');
  assertInRange(range, targetIndex, 'target');
  if (targetIndex === fromIndex) return null;
  // Moving down lands after the row currently at the target, moving up before it.
  const neighbour = frames.find((frame) => frame.index === targetIndex);
  if (neighbour === undefined) return null;
  return targetIndex > fromIndex ? neighbour.top + neighbour.height : neighbour.top;
}

/**
 * Signed scroll distance for one frame while the dragged row's centre sits in
 * an edge band of the list viewport; 0 in between. The speed grows linearly
 * with the depth into the band.
 */
export function autoScrollStep(
  draggedCenter: number,
  viewportTop: number,
  viewportBottom: number,
): number {
  if (viewportBottom - viewportTop <= AUTO_SCROLL_EDGE * 2) return 0;
  const intoTop = viewportTop + AUTO_SCROLL_EDGE - draggedCenter;
  if (intoTop > 0) {
    return -Math.ceil(AUTO_SCROLL_MAX_STEP * Math.min(1, intoTop / AUTO_SCROLL_EDGE));
  }
  const intoBottom = draggedCenter - (viewportBottom - AUTO_SCROLL_EDGE);
  if (intoBottom > 0) {
    return Math.ceil(AUTO_SCROLL_MAX_STEP * Math.min(1, intoBottom / AUTO_SCROLL_EDGE));
  }
  return 0;
}

/** The order shown while a confirmed drop is still being applied natively. */
export function moveRow<T>(rows: readonly T[], fromIndex: number, toIndex: number): T[] {
  for (const [label, index] of [['source', fromIndex], ['target', toIndex]] as const) {
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
      throw new Error(`Queue move ${label} ${String(index)} is outside ${rows.length} rows`);
    }
  }
  const moved = [...rows];
  const [row] = moved.splice(fromIndex, 1);
  moved.splice(toIndex, 0, row);
  return moved;
}
