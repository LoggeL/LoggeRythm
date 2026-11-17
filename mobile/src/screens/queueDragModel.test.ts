import { describe, expect, it } from 'vitest';
import type { QueueOrigin } from '../player/queueContract';
import {
  AUTO_SCROLL_EDGE,
  AUTO_SCROLL_MAX_STEP,
  autoScrollStep,
  dropIndicatorTop,
  moveRow,
  queueDragRange,
  resolveDropIndex,
  type QueueRowFrame,
} from './queueDragModel';

// history, history, ACTIVE, manual, manual, context, context, context
const origins: QueueOrigin[] = [
  'context', 'context', 'context', 'manual', 'manual', 'context', 'context', 'context',
];
const ROW = 64;
/** Equal rows stacked from `top`, one per index in `first..last`. */
function stacked(first: number, last: number, top = 0): QueueRowFrame[] {
  return Array.from({ length: last - first + 1 }, (_, offset) => ({
    index: first + offset,
    top: top + offset * ROW,
    height: ROW,
  }));
}

describe('queueDragRange', () => {
  it('keeps the loaded item fixed and never lets a row cross it', () => {
    expect(queueDragRange(origins, 2, 2)).toBeNull();
    expect(queueDragRange(origins, 2, 0)).toEqual({ min: 0, max: 1 });
    expect(queueDragRange(origins, 2, 1)).toEqual({ min: 0, max: 1 });
  });

  it('keeps upcoming rows inside their own origin run', () => {
    expect(queueDragRange(origins, 2, 3)).toEqual({ min: 3, max: 4 });
    expect(queueDragRange(origins, 2, 4)).toEqual({ min: 3, max: 4 });
    expect(queueDragRange(origins, 2, 6)).toEqual({ min: 5, max: 7 });
    // A context row directly after the loaded item starts its run there.
    expect(queueDragRange(['context', 'context', 'context'], 0, 2)).toEqual({ min: 1, max: 2 });
  });

  it('spans the whole queue when nothing is loaded', () => {
    expect(queueDragRange(origins, null, 4)).toEqual({ min: 0, max: 7 });
  });

  it('rejects indices outside the queue instead of clamping them', () => {
    expect(() => queueDragRange(origins, 2, 8)).toThrow(/drag index 8 is outside 8 rows/);
    expect(() => queueDragRange(origins, 9, 1)).toThrow(/active index 9 is outside 8 rows/);
  });
});

describe('resolveDropIndex', () => {
  const range = { min: 5, max: 7 };
  const frames = stacked(5, 7, 400); // 400..464, 464..528, 528..592

  it('leaves the row in place until its centre passes a neighbour centre', () => {
    // Row 5 starts with its centre at 432; row 6's centre is 496.
    expect(resolveDropIndex(range, 5, frames, 432)).toBe(5);
    expect(resolveDropIndex(range, 5, frames, 495)).toBe(5);
    expect(resolveDropIndex(range, 5, frames, 497)).toBe(6);
    expect(resolveDropIndex(range, 5, frames, 561)).toBe(7);
  });

  it('moves a row up symmetrically and stops at the range edges', () => {
    expect(resolveDropIndex(range, 7, frames, 497)).toBe(7);
    expect(resolveDropIndex(range, 7, frames, 495)).toBe(6);
    expect(resolveDropIndex(range, 7, frames, 431)).toBe(5);
    expect(resolveDropIndex(range, 7, frames, -500)).toBe(5);
    expect(resolveDropIndex(range, 5, frames, 5000)).toBe(7);
  });

  it('ignores rows outside the range, so a drag cannot leave its section', () => {
    const withNeighbours = [...stacked(3, 4, 272), ...frames];
    expect(resolveDropIndex(range, 6, withNeighbours, 280)).toBe(5);
  });

  it('counts unmounted rows before the first measured row as above the viewport', () => {
    const long = { min: 10, max: 40 };
    const mounted = stacked(20, 24, 100); // centres 132, 196, 260, 324, 388
    // Dragged row 22 hovering between rows 20 and 21.
    expect(resolveDropIndex(long, 22, mounted, 180)).toBe(21);
    // Above every mounted row: lands on the first mounted one, not at index 10.
    expect(resolveDropIndex(long, 22, mounted, 90)).toBe(20);
    // Below every mounted row: lands on the last mounted one, not at index 40.
    expect(resolveDropIndex(long, 22, mounted, 900)).toBe(24);
  });

  it('keeps the row where it is while nothing is measured, and rejects a foreign source', () => {
    expect(resolveDropIndex(range, 6, [], 0)).toBe(6);
    expect(() => resolveDropIndex(range, 4, frames, 0)).toThrow(/source 4 is outside its range 5\.\.7/);
  });
});

describe('dropIndicatorTop', () => {
  const range = { min: 5, max: 7 };
  const frames = stacked(5, 7, 400);

  it('draws the line below the target when moving down and above it when moving up', () => {
    expect(dropIndicatorTop(range, 5, 6, frames)).toBe(528);
    expect(dropIndicatorTop(range, 5, 7, frames)).toBe(592);
    expect(dropIndicatorTop(range, 7, 5, frames)).toBe(400);
    expect(dropIndicatorTop(range, 7, 6, frames)).toBe(464);
  });

  it('shows no line for an unchanged position or an unmeasured neighbour', () => {
    expect(dropIndicatorTop(range, 6, 6, frames)).toBeNull();
    expect(dropIndicatorTop(range, 5, 7, stacked(5, 6, 400))).toBeNull();
    expect(() => dropIndicatorTop(range, 5, 8, frames)).toThrow(/target 8 is outside/);
  });
});

describe('autoScrollStep', () => {
  it('scrolls only inside the edge bands, faster the deeper the row is', () => {
    expect(autoScrollStep(400, 100, 700)).toBe(0);
    expect(autoScrollStep(100 + AUTO_SCROLL_EDGE, 100, 700)).toBe(0);
    expect(autoScrollStep(100, 100, 700)).toBe(-AUTO_SCROLL_MAX_STEP);
    expect(autoScrollStep(700, 100, 700)).toBe(AUTO_SCROLL_MAX_STEP);
    const shallow = autoScrollStep(700 - AUTO_SCROLL_EDGE + 9, 100, 700);
    expect(shallow).toBeGreaterThan(0);
    expect(shallow).toBeLessThan(AUTO_SCROLL_MAX_STEP);
  });

  it('never scrolls a viewport that is only edge bands', () => {
    expect(autoScrollStep(10, 0, AUTO_SCROLL_EDGE * 2)).toBe(0);
  });
});

describe('moveRow', () => {
  it('moves one row and keeps every other row in order', () => {
    expect(moveRow(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveRow(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(() => moveRow(['a'], 0, 1)).toThrow(/target 1 is outside 1 rows/);
  });
});
