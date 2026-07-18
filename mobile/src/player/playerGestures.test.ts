import { describe, expect, it } from 'vitest';
import {
  resolveMiniPlayerSwipe,
  shouldCaptureFullscreenMinimize,
  shouldCaptureMiniPlayerSwipe,
  shouldMinimizeFullscreenPlayer,
} from './playerGestures';

describe('mobile player swipe gestures', () => {
  it('uses the common left-next and right-previous convention', () => {
    expect(resolveMiniPlayerSwipe({ dx: -72, dy: 8 })).toBe('next');
    expect(resolveMiniPlayerSwipe({ dx: 72, dy: -8 })).toBe('previous');
  });

  it('expands only for a committed upward mini-player swipe', () => {
    expect(resolveMiniPlayerSwipe({ dx: 5, dy: -64 })).toBe('expand');
    expect(resolveMiniPlayerSwipe({ dx: 2, dy: -25, vy: -0.7 })).toBe('expand');
    expect(resolveMiniPlayerSwipe({ dx: 2, dy: -25, vy: -0.2 })).toBeNull();
    expect(resolveMiniPlayerSwipe({ dx: 2, dy: 80 })).toBeNull();
  });

  it('does not claim taps, jitter, or ambiguous diagonal movement', () => {
    expect(shouldCaptureMiniPlayerSwipe({ dx: 5, dy: 3 })).toBe(false);
    expect(shouldCaptureMiniPlayerSwipe({ dx: 20, dy: 18 })).toBe(false);
    expect(resolveMiniPlayerSwipe({ dx: 40, dy: 34, vx: 1 })).toBeNull();
  });

  it('minimizes fullscreen only for a dominant committed downward pull', () => {
    expect(shouldCaptureFullscreenMinimize({ dx: 3, dy: 18 })).toBe(true);
    expect(shouldMinimizeFullscreenPlayer({ dx: 8, dy: 68 })).toBe(true);
    expect(shouldMinimizeFullscreenPlayer({ dx: 2, dy: 25, vy: 0.65 })).toBe(true);
    expect(shouldMinimizeFullscreenPlayer({ dx: 3, dy: -80 })).toBe(false);
    expect(shouldMinimizeFullscreenPlayer({ dx: 30, dy: 35, vy: 1 })).toBe(false);
  });
});
