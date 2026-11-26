/**
 * Pure motion model for the floating mini player: which kind of track change
 * happened (and in which direction), and the exact tweens that animate the
 * outgoing "ghost" and the incoming lane. Kept free of React Native imports so
 * it is unit-testable and the same curves drive every native-driver timing.
 */

/** Where the active track sits in the queue the mini player is showing. */
export interface MiniPlayerSlot {
  /** Unique per queue entry (local `mediaId`, or remote index + track id). */
  readonly key: string;
  /** Catalog track id; equal across queue copies of the same song. */
  readonly trackId: string;
  readonly index: number;
  readonly length: number;
  /** Repeat-all wraps the last entry to the first and back. */
  readonly repeatAll: boolean;
}

/** A skip the user just asked for, so async remote/party skips keep their direction. */
export interface MiniPlayerSkipIntent {
  readonly fromKey: string;
  readonly direction: 1 | -1;
  /** Local skips land within a frame, remote ones within a round trip; then the intent is void. */
  readonly expiresAtMs: number;
}

export type MiniPlayerTrackChange =
  | { readonly kind: 'none' }
  | { readonly kind: 'step'; readonly direction: 1 | -1 }
  | { readonly kind: 'replace' };

const NONE: MiniPlayerTrackChange = { kind: 'none' };
const REPLACE: MiniPlayerTrackChange = { kind: 'replace' };
const FORWARD: MiniPlayerTrackChange = { kind: 'step', direction: 1 };
const BACKWARD: MiniPlayerTrackChange = { kind: 'step', direction: -1 };

export function requireValidSlot(slot: MiniPlayerSlot): MiniPlayerSlot {
  if (!Number.isInteger(slot.length) || slot.length < 1) {
    throw new Error(`Mini player slot ${slot.key} has invalid queue length ${String(slot.length)}`);
  }
  if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= slot.length) {
    throw new Error(
      `Mini player slot ${slot.key} has index ${String(slot.index)} outside a ${slot.length}-item queue`,
    );
  }
  return slot;
}

function adjacentDirection(prev: MiniPlayerSlot, next: MiniPlayerSlot): 1 | -1 | null {
  // Same queue, or the same queue with tracks appended (autoplay radio).
  if (next.length < prev.length) return null;
  const last = next.length - 1;
  const wraps = next.repeatAll && next.length === prev.length;
  // Checked first: with two entries the wrap equals a step back, and
  // auto-advance (forward) is far more common than an un-noted "previous".
  if (wraps && prev.index === last && next.index === 0) return 1;
  const delta = next.index - prev.index;
  if (delta === 1) return 1;
  if (delta === -1) return -1;
  if (wraps && prev.index === 0 && next.index === last) return -1;
  return null;
}

/**
 * Classify a change of the active queue entry. A fresh user skip intent wins
 * (it disambiguates two-entry repeat-all queues and slow remote skips); then
 * neighbours in the queue slide; the same song carried into another queue
 * (joining a party with the host's current track) is not a change at all;
 * everything else — a jump in the queue or a brand-new queue — cross-fades.
 */
export function classifyMiniPlayerTrackChange(
  prev: MiniPlayerSlot,
  next: MiniPlayerSlot,
  intent: MiniPlayerSkipIntent | null,
  nowMs: number,
): MiniPlayerTrackChange {
  requireValidSlot(prev);
  requireValidSlot(next);
  if (prev.key === next.key) return NONE;
  if (intent !== null && intent.fromKey === prev.key && nowMs <= intent.expiresAtMs) {
    return intent.direction === 1 ? FORWARD : BACKWARD;
  }
  const direction = adjacentDirection(prev, next);
  if (prev.trackId === next.trackId && direction === null) return NONE;
  if (direction === 1) return FORWARD;
  if (direction === -1) return BACKWARD;
  return REPLACE;
}

export type EasingFn = (t: number) => number;

/**
 * CSS-style cubic-bezier easing (x1, y1, x2, y2), solved in JS. Native-driver
 * `Animated.timing` samples the easing into frames up front, so a plain JS
 * function is all the native side ever needs.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  for (const value of [x1, y1, x2, y2]) {
    if (!Number.isFinite(value)) throw new RangeError(`Invalid cubic-bezier control point ${value}`);
  }
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new RangeError(`cubic-bezier x control points must be within [0, 1], got ${x1}, ${x2}`);
  }
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  const solveS = (x: number) => {
    let s = x;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(s) - x;
      if (Math.abs(error) < 1e-6) return s;
      const slope = slopeX(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let low = 0;
    let high = 1;
    s = x;
    for (let i = 0; i < 32; i += 1) {
      const value = sampleX(s);
      if (Math.abs(value - x) < 1e-6) return s;
      if (value < x) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return s;
  };
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveS(t));
  };
}

/** Material 3 motion curves. */
export const easing = {
  standard: cubicBezier(0.2, 0, 0, 1),
  decelerate: cubicBezier(0.05, 0.7, 0.1, 1),
  accelerate: cubicBezier(0.3, 0, 0.8, 0.15),
  linear: (t: number) => t,
} as const;

export const MINI_PLAYER_MOTION = {
  /**
   * Overlap choreography: the incoming track arrives first and covers the
   * outgoing one, which then quietly morphs out (fade + slight shrink) once
   * the new copy has landed. Small distances keep it subtle.
   */
  laneInMs: 260,
  laneFadeInMs: 180,
  /**
   * Two titles cannot overlap legibly, so text is sequenced: the old title
   * morphs out first, the new one fades in right behind it.
   */
  ghostTextOutMs: 120,
  laneTextInDelayMs: 100,
  laneTextInMs: 200,
  laneInDistance: 20,
  /** Incoming distance after a swipe, which already moved the old copy aside. */
  swipeInDistance: 28,
  /** Outgoing copy: drifts a little against the direction of travel… */
  ghostDriftMs: 300,
  ghostDrift: 8,
  swipeDrift: 16,
  /** …and morphs out after the incoming copy is mostly in. */
  ghostOutDelayMs: 100,
  ghostOutMs: 200,
  ghostOutScale: 0.96,
  /** Queue jumps / new queues: the new copy settles in from a slight shrink. */
  replaceFromScale: 0.96,
  /** Reduced motion: opacity only. */
  crossfadeMs: 150,
  /** Card entering / leaving when playback starts or the queue empties. */
  presenceInMs: 300,
  presenceOutMs: 180,
  presenceDistance: 24,
  /** Play ⇄ pause glyph morph. */
  toggleMs: 180,
  /** Skips flash Buffering briefly; only longer stalls swap in the spinner. */
  spinnerDelayMs: 300,
  /** Horizontal drag range that dims the lane (matches the damped drag clamp). */
  dragFadeDistance: 96,
  dragFadeMinOpacity: 0.4,
} as const;

/** Opacity the lane shows at a given horizontal drag offset. */
export function dragOpacity(dragX: number): number {
  if (!Number.isFinite(dragX)) throw new RangeError(`Invalid mini player drag offset ${dragX}`);
  const { dragFadeDistance, dragFadeMinOpacity } = MINI_PLAYER_MOTION;
  const t = Math.min(1, Math.abs(dragX) / dragFadeDistance);
  return 1 - t * (1 - dragFadeMinOpacity);
}

export interface Tween {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly delay: number;
  readonly easing: EasingFn;
}

export const LANE_CHANNELS = [
  'ghostX',
  'ghostOpacity',
  'ghostTextOpacity',
  'ghostScale',
  'laneX',
  'laneOpacity',
  'laneTextOpacity',
  'laneScale',
] as const;
export type LaneChannel = (typeof LANE_CHANNELS)[number];
export type LanePlan = Readonly<Record<LaneChannel, Tween>>;

/** Visual state of the lane when a change interrupts it. */
export interface LaneStart {
  readonly x: number;
  readonly opacity: number;
  /** Title/artist opacity on top of `opacity`. */
  readonly textOpacity: number;
  readonly scale: number;
}

export const LANE_REST: LaneStart = { x: 0, opacity: 1, textOpacity: 1, scale: 1 };

function hold(value: number): Tween {
  return { from: value, to: value, duration: 0, delay: 0, easing: easing.linear };
}

/**
 * Tweens for one visible track change. The incoming cover arrives at once and
 * is drawn above the ghost (previous track), which starts from wherever the
 * lane was — mid-transition or pulled aside by a swipe — and morphs out only
 * after the new copy has mostly landed. Titles are sequenced instead (old out,
 * then new in), since overlapping text turns into a smudge.
 */
export function lanePlan(
  change: Exclude<MiniPlayerTrackChange, { kind: 'none' }>,
  options: { reducedMotion: boolean; start: LaneStart; swiped: boolean },
): LanePlan {
  const { reducedMotion, start, swiped } = options;
  const m = MINI_PLAYER_MOTION;
  if (reducedMotion) {
    const fade = (from: number, to: number): Tween => ({
      from,
      to,
      duration: m.crossfadeMs,
      delay: 0,
      easing: easing.linear,
    });
    return {
      ghostX: hold(start.x),
      ghostOpacity: fade(start.opacity, 0),
      ghostTextOpacity: hold(start.textOpacity),
      ghostScale: hold(start.scale),
      laneX: hold(0),
      laneOpacity: fade(0, 1),
      laneTextOpacity: hold(1),
      laneScale: hold(1),
    };
  }
  const morphOut = {
    ghostOpacity: {
      from: start.opacity, to: 0, duration: m.ghostOutMs, delay: m.ghostOutDelayMs,
      easing: easing.accelerate,
    },
    ghostScale: {
      from: start.scale, to: start.scale * m.ghostOutScale, duration: m.ghostOutMs,
      delay: m.ghostOutDelayMs, easing: easing.accelerate,
    },
  };
  const fadeIn: Tween = {
    from: 0, to: 1, duration: m.laneFadeInMs, delay: 0, easing: easing.decelerate,
  };
  const text = {
    ghostTextOpacity: {
      from: start.textOpacity, to: 0, duration: m.ghostTextOutMs, delay: 0, easing: easing.accelerate,
    },
    laneTextOpacity: {
      from: 0, to: 1, duration: m.laneTextInMs, delay: m.laneTextInDelayMs, easing: easing.decelerate,
    },
  };
  if (change.kind === 'replace') {
    return {
      ghostX: hold(start.x),
      ...morphOut,
      ...text,
      laneX: hold(0),
      laneOpacity: fadeIn,
      laneScale: {
        from: m.replaceFromScale, to: 1, duration: m.laneInMs, delay: 0, easing: easing.decelerate,
      },
    };
  }
  const dir = change.direction;
  // Content moves left to advance (dir +1) and right to go back.
  return {
    ghostX: {
      from: start.x,
      to: start.x - dir * (swiped ? m.swipeDrift : m.ghostDrift),
      duration: m.ghostDriftMs,
      delay: 0,
      easing: easing.standard,
    },
    ...morphOut,
    ...text,
    laneX: {
      from: dir * (swiped ? m.swipeInDistance : m.laneInDistance),
      to: 0,
      duration: m.laneInMs,
      delay: 0,
      easing: easing.decelerate,
    },
    laneOpacity: fadeIn,
    laneScale: hold(1),
  };
}

/** Value of a tween `elapsedMs` after it started (delay included). */
export function sampleTween(tween: Tween, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) throw new RangeError(`Invalid elapsed time ${elapsedMs}`);
  const running = elapsedMs - tween.delay;
  if (running <= 0) return tween.from;
  if (tween.duration <= 0 || running >= tween.duration) return tween.to;
  return tween.from + (tween.to - tween.from) * tween.easing(running / tween.duration);
}

/** Where the incoming lane is drawn `elapsedMs` into a plan. */
export function sampleLane(plan: LanePlan, elapsedMs: number): LaneStart {
  return {
    x: sampleTween(plan.laneX, elapsedMs),
    opacity: sampleTween(plan.laneOpacity, elapsedMs),
    textOpacity: sampleTween(plan.laneTextOpacity, elapsedMs),
    scale: sampleTween(plan.laneScale, elapsedMs),
  };
}

/** The rest of `tween` from `elapsedMs` on, starting where it is drawn now. */
export function continueTween(tween: Tween, elapsedMs: number): Tween {
  const from = sampleTween(tween, elapsedMs);
  const running = Math.max(0, elapsedMs - tween.delay);
  return {
    from,
    to: tween.to,
    delay: Math.max(0, tween.delay - elapsedMs),
    duration: Math.max(0, tween.duration - running),
    easing: tween.easing,
  };
}

type GhostChannel = 'ghostX' | 'ghostOpacity' | 'ghostTextOpacity' | 'ghostScale';

/**
 * A second change while the previous ghost's title is still the one being read
 * (the new title has not faded in yet): keep that ghost leaving undisturbed and
 * only replace the incoming lane, so text never blinks out mid-fade. Returns
 * the ghost's remaining tweens, or null when the lane is what is read and
 * should become the ghost instead.
 */
export function keepGhostThrough(
  plan: LanePlan,
  elapsedMs: number,
): Pick<LanePlan, GhostChannel> | null {
  // How legible each title is right now: the copy's opacity times its text's.
  const ghostRead = sampleTween(plan.ghostOpacity, elapsedMs) * sampleTween(plan.ghostTextOpacity, elapsedMs);
  const laneRead = sampleTween(plan.laneOpacity, elapsedMs) * sampleTween(plan.laneTextOpacity, elapsedMs);
  if (ghostRead < laneRead) return null;
  return {
    ghostX: continueTween(plan.ghostX, elapsedMs),
    ghostOpacity: continueTween(plan.ghostOpacity, elapsedMs),
    ghostTextOpacity: continueTween(plan.ghostTextOpacity, elapsedMs),
    ghostScale: continueTween(plan.ghostScale, elapsedMs),
  };
}

/** Longest channel, i.e. when the ghost can be dropped. */
export function planDurationMs(plan: LanePlan): number {
  return Math.max(...LANE_CHANNELS.map((channel) => plan[channel].delay + plan[channel].duration));
}

export type PresencePhase = 'shown' | 'exiting' | 'hidden';

/** Tween for the whole card when playback starts (`enter`) or the queue empties. */
export function presenceTween(
  kind: 'enter' | 'exit',
  from: number,
  reducedMotion: boolean,
): Tween {
  if (!Number.isFinite(from) || from < 0 || from > 1) {
    throw new RangeError(`Invalid mini player presence progress ${from}`);
  }
  const m = MINI_PLAYER_MOTION;
  if (reducedMotion) {
    return {
      from, to: kind === 'enter' ? 1 : 0, duration: m.crossfadeMs, delay: 0, easing: easing.linear,
    };
  }
  return kind === 'enter'
    ? { from, to: 1, duration: m.presenceInMs, delay: 0, easing: easing.decelerate }
    : { from, to: 0, duration: m.presenceOutMs, delay: 0, easing: easing.accelerate };
}
