export const SWIPE_CAPTURE_DISTANCE = 14;
export const SWIPE_COMMIT_DISTANCE = 56;
export const SWIPE_FLING_MIN_DISTANCE = 24;
export const SWIPE_COMMIT_VELOCITY = 0.55;
export const SWIPE_AXIS_DOMINANCE = 1.35;

export type MiniPlayerSwipeAction = 'previous' | 'next' | 'expand';

interface SwipeMotion {
  dx: number;
  dy: number;
  vx?: number;
  vy?: number;
}

function horizontalDominates({ dx, dy }: SwipeMotion): boolean {
  return Math.abs(dx) >= Math.abs(dy) * SWIPE_AXIS_DOMINANCE;
}

function verticalDominates({ dx, dy }: SwipeMotion): boolean {
  return Math.abs(dy) >= Math.abs(dx) * SWIPE_AXIS_DOMINANCE;
}

function committed(distance: number, velocity: number | undefined): boolean {
  return Math.abs(distance) >= SWIPE_COMMIT_DISTANCE || (
    Math.abs(distance) >= SWIPE_FLING_MIN_DISTANCE
    && Math.abs(velocity ?? 0) >= SWIPE_COMMIT_VELOCITY
  );
}

/** Claim only directional movement, leaving ordinary taps to child controls. */
export function shouldCaptureMiniPlayerSwipe(motion: SwipeMotion): boolean {
  if (horizontalDominates(motion)) return Math.abs(motion.dx) >= SWIPE_CAPTURE_DISTANCE;
  return verticalDominates(motion)
    && motion.dy <= -SWIPE_CAPTURE_DISTANCE;
}

/** Music-player convention: content moves left to advance and right to go back. */
export function resolveMiniPlayerSwipe(motion: SwipeMotion): MiniPlayerSwipeAction | null {
  if (horizontalDominates(motion) && committed(motion.dx, motion.vx)) {
    return motion.dx < 0 ? 'next' : 'previous';
  }
  if (verticalDominates(motion) && motion.dy < 0 && committed(motion.dy, motion.vy)) {
    return 'expand';
  }
  return null;
}

export function shouldCaptureFullscreenMinimize(motion: SwipeMotion): boolean {
  return verticalDominates(motion) && motion.dy >= SWIPE_CAPTURE_DISTANCE;
}

export function shouldMinimizeFullscreenPlayer(motion: SwipeMotion): boolean {
  return verticalDominates(motion)
    && motion.dy > 0
    && committed(motion.dy, motion.vy);
}
