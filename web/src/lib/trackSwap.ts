/**
 * Track-change motion for the player chrome (mini player and desktop deck).
 *
 * When the playing queue entry changes, the new cover and title arrive at
 * once — sliding in from the direction of travel — and cover the previous
 * copy, which then quietly morphs out (fade + slight shrink). This module is
 * framework-free: it decides which kind of change happened and keeps the
 * small state that `components/player/TrackSwap.tsx` renders.
 */

/** Where the playing track sits in the queue. */
export interface TrackSwapSlot {
  /** Unique per queue position and track. */
  readonly key: string;
  readonly trackId: string;
  readonly index: number;
  readonly length: number;
  /** The entry a "previous" step lands on (wrapping under repeat-all), or null at the start. */
  readonly prevId: string | null;
  /** The entry a "next" step lands on (wrapping under repeat-all), or null at the end. */
  readonly nextId: string | null;
}

/** `forward`/`backward` slide; `replace` (queue jump, new queue) settles in place. */
export type TrackSwapChange = "none" | "forward" | "backward" | "replace";

type TrackId = string | number;

/**
 * Track id of the entry a step of `direction` lands on from `index` (wrapping
 * under repeat-all), or null when there is none.
 */
export function trackSwapNeighbour(
  queue: readonly { readonly id: TrackId }[],
  index: number,
  repeat: string,
  direction: 1 | -1,
): string | null {
  if (index < 0) return null;
  const last = queue.length - 1;
  if (index > last) throw new Error(`Track swap: index ${index} is outside a ${queue.length}-track queue`);
  const wraps = repeat === "all";
  const target = index + direction;
  const at = target < 0 ? (wraps ? last : null) : target > last ? (wraps ? 0 : null) : target;
  return at === null ? null : String(queue[at].id);
}

/** Slot for the entry at `index` with its queue neighbours; null when nothing plays. */
export function trackSwapSlot(
  trackId: TrackId | null,
  index: number,
  length: number,
  prevId: string | null,
  nextId: string | null,
): TrackSwapSlot | null {
  if (trackId === null) return null;
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`Track swap: queue length must be a positive integer, got ${String(length)}`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new Error(`Track swap: index ${String(index)} is outside a ${length}-track queue`);
  }
  const id = String(trackId);
  return { key: `${index}:${id}`, trackId: id, index, length, prevId, nextId };
}

/**
 * A step slides only when the previous track really is the new entry's
 * neighbour in the queue now playing — next, previous, repeat-all wraps and
 * autoplay appends. A two-track wrap reads as forward because auto-advance is
 * the common case. The same song at a new position (queue reordered, carried
 * into another queue) is no change. Anything else, including a new queue that
 * merely starts one position away, cross-fades in place.
 */
export function classifyTrackSwap(prev: TrackSwapSlot, next: TrackSwapSlot): TrackSwapChange {
  if (prev.key === next.key || prev.trackId === next.trackId) return "none";
  const fromPrev = next.prevId === prev.trackId;
  const fromNext = next.nextId === prev.trackId;
  if (fromPrev && fromNext) {
    // The same song on both sides of the new entry: its queue position decides.
    // A two-track wrap stays forward (auto-advance is the common case).
    const last = next.length - 1;
    const steppedBack = next.length > 2
      && (next.index === prev.index - 1 || (prev.index === 0 && next.index === last));
    return steppedBack ? "backward" : "forward";
  }
  if (fromPrev) return "forward";
  if (fromNext) return "backward";
  return "replace";
}

export interface TrackSwapGhost<T> {
  readonly id: number;
  readonly item: T;
  readonly change: Exclude<TrackSwapChange, "none">;
}

export interface TrackSwapState<T> {
  readonly slot: TrackSwapSlot | null;
  readonly item: T;
  /** Bumped on every visible change; alternates the keyframe set so the incoming copy's animation restarts. */
  readonly sequence: number;
  /** The change the current copy arrived with, or null once it has landed (or should sit still). */
  readonly arrival: Exclude<TrackSwapChange, "none"> | null;
  /** The previous copy while it morphs out. */
  readonly ghost: TrackSwapGhost<T> | null;
}

export function initialTrackSwapState<T>(slot: TrackSwapSlot | null, item: T): TrackSwapState<T> {
  return { slot, item, sequence: 0, arrival: null, ghost: null };
}

function sameSlot(a: TrackSwapSlot | null, b: TrackSwapSlot | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.key === b.key && a.length === b.length && a.prevId === b.prevId && a.nextId === b.nextId;
}

/**
 * Advance the swap state for the slot and item being rendered now. Returns the
 * same object when nothing changed, so callers can compare by identity.
 */
export function nextTrackSwapState<T>(
  state: TrackSwapState<T>,
  slot: TrackSwapSlot | null,
  item: T,
): TrackSwapState<T> {
  if (slot?.key === state.slot?.key) {
    // Same entry; keep its neighbours current so the next change reads its direction right.
    return Object.is(item, state.item) && sameSlot(slot, state.slot) ? state : { ...state, slot, item };
  }
  // Appearing or disappearing is the player's own entrance, not a track change.
  const change = state.slot !== null && slot !== null ? classifyTrackSwap(state.slot, slot) : "none";
  if (change === "none") return { ...state, slot, item };
  const sequence = state.sequence + 1;
  return {
    slot,
    item,
    sequence,
    arrival: change,
    // Skipping again while the previous copy still morphs out: that copy keeps
    // leaving undisturbed, and only the incoming copy is replaced.
    ghost: state.ghost ?? { id: sequence, item: state.item, change },
  };
}

/** Drop the ghost once its morph-out finished (ignores a ghost already replaced). */
export function settleTrackSwap<T>(state: TrackSwapState<T>, ghostId: number): TrackSwapState<T> {
  return state.ghost?.id === ghostId ? { ...state, ghost: null } : state;
}

/**
 * The incoming copy landed: stop marking it, so it never replays (for example
 * when a hidden copy becomes visible). Ignores an arrival that was replaced.
 */
export function settleTrackSwapArrival<T>(state: TrackSwapState<T>, sequence: number): TrackSwapState<T> {
  return state.sequence === sequence && state.arrival !== null ? { ...state, arrival: null } : state;
}

/** CSS custom properties that steer the keyframes in `globals.css`. */
export function trackSwapStyle(change: Exclude<TrackSwapChange, "none">): Record<string, string> {
  const dir = change === "forward" ? "1" : change === "backward" ? "-1" : "0";
  return { "--swap-dir": dir, "--swap-scale": change === "replace" ? "0.96" : "1" };
}
