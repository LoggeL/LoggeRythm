import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MINI_PLAYER_MOTION, type MiniPlayerSlot } from './miniPlayerMotion';
import type { MiniPlayerLaneDisplay } from './useMiniPlayerTrackTransition';

/**
 * Minimal single-component hook runtime: state, refs, memos and (layout)
 * effects persist across `render()` calls, effects run after each render in
 * declaration order, and a state update during effects re-renders before
 * `render()` returns — the same ordering React gives layout effects.
 */
const hooks = vi.hoisted(() => {
  type Effect = { deps: unknown[] | undefined; cleanup: (() => void) | void };
  const store = {
    slots: [] as unknown[],
    cursor: 0,
    effects: new Map<number, Effect>(),
    pending: [] as (() => void)[],
    dirty: false,
  };
  const depsChanged = (previous: unknown[] | undefined, next: unknown[] | undefined) =>
    previous === undefined || next === undefined
    || previous.length !== next.length
    || previous.some((value, index) => !Object.is(value, next[index]));
  const useState = <T,>(initial: T | (() => T)) => {
    const index = store.cursor++;
    if (!(index in store.slots)) {
      store.slots[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    const set = (next: T | ((current: T) => T)) => {
      const current = store.slots[index] as T;
      const value = typeof next === 'function' ? (next as (c: T) => T)(current) : next;
      if (!Object.is(value, current)) {
        store.slots[index] = value;
        store.dirty = true;
      }
    };
    return [store.slots[index] as T, set] as const;
  };
  const useRef = <T,>(initial: T) => useState(() => ({ current: initial }))[0];
  const useMemo = <T,>(factory: () => T, deps: unknown[]) => {
    const index = store.cursor++;
    const previous = store.slots[index] as { deps: unknown[]; value: T } | undefined;
    if (previous === undefined || depsChanged(previous.deps, deps)) {
      store.slots[index] = { deps, value: factory() };
    }
    return (store.slots[index] as { value: T }).value;
  };
  const useEffect = (effect: () => (() => void) | void, deps?: unknown[]) => {
    const index = store.cursor++;
    const previous = store.effects.get(index);
    if (previous !== undefined && !depsChanged(previous.deps, deps)) return;
    store.pending.push(() => {
      if (typeof previous?.cleanup === 'function') previous.cleanup();
      store.effects.set(index, { deps, cleanup: effect() });
    });
  };
  const unmount = () => {
    for (const effect of store.effects.values()) {
      if (typeof effect.cleanup === 'function') effect.cleanup();
    }
  };
  const reset = () => {
    store.slots = [];
    store.cursor = 0;
    store.effects = new Map();
    store.pending = [];
    store.dirty = false;
  };
  return { store, useState, useRef, useMemo, useEffect, unmount, reset };
});

const animated = vi.hoisted(() => {
  type Callback = (result: { finished: boolean }) => void;
  class Value {
    constructor(public value: number) {}
    setValue(value: number) {
      this.value = value;
    }
    interpolate(config: unknown) {
      return { interpolate: config, of: this };
    }
  }
  const runs: { kind: string; configs: unknown[]; callback?: Callback; stopped: boolean }[] = [];
  const timing = (value: Value, config: { toValue: number }) => ({ value, config });
  const parallel = (animations: { value: Value; config: Record<string, unknown> }[]) => {
    const run = { kind: 'parallel', configs: animations.map((a) => a.config), stopped: false } as (typeof runs)[number];
    return {
      start(callback?: Callback) {
        run.callback = (result) => {
          if (result.finished) animations.forEach((a) => a.value.setValue(a.config.toValue as number));
          callback?.(result);
        };
        runs.push(run);
      },
      stop() {
        run.stopped = true;
      },
    };
  };
  const spring = (value: Value, config: Record<string, unknown>) => ({
    start() {
      runs.push({ kind: 'spring', configs: [config], stopped: false });
      value.setValue(config.toValue as number);
    },
  });
  return { Value, runs, timing, parallel, spring };
});

vi.mock('react', () => ({
  useState: hooks.useState,
  useRef: hooks.useRef,
  useMemo: hooks.useMemo,
  useEffect: hooks.useEffect,
  useLayoutEffect: hooks.useEffect,
}));

vi.mock('react-native', () => ({
  Animated: {
    Value: animated.Value,
    timing: animated.timing,
    parallel: animated.parallel,
    spring: animated.spring,
    add: (left: unknown, right: unknown) => ({ add: [left, right] }),
    multiply: (left: unknown, right: unknown) => ({ multiply: [left, right] }),
  },
}));

const { useMiniPlayerTrackTransition } = await import('./useMiniPlayerTrackTransition');

type Props = Parameters<typeof useMiniPlayerTrackTransition>[0];
type Result = ReturnType<typeof useMiniPlayerTrackTransition>;

function render(props: Props): Result {
  let result: Result | undefined;
  for (let pass = 0; pass < 10; pass += 1) {
    hooks.store.cursor = 0;
    hooks.store.dirty = false;
    hooks.store.pending = [];
    // The harness above stands in for React: one component, re-rendered in a loop.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    result = useMiniPlayerTrackTransition(props);
    const effects = hooks.store.pending;
    hooks.store.pending = [];
    effects.forEach((run) => run());
    if (!hooks.store.dirty) return result;
  }
  throw new Error('render did not settle');
}

function slot(index: number, length = 5): MiniPlayerSlot {
  return { key: `local:q:${index}`, trackId: `t${index}`, index, length, repeatAll: false };
}

function display(index: number): MiniPlayerLaneDisplay {
  return { cover: `https://example.test/${index}.jpg`, title: `Song ${index}`, artist: `Artist ${index}` };
}

/** Animated.Value instances in hook order (see useMiniPlayerTrackTransition). */
function values(result: Result) {
  const { laneStyle, ghostStyle } = result.controls;
  const laneTransform = laneStyle.transform as Record<string, { add?: unknown[] }>[];
  const [laneX, dragX] = laneTransform[0].translateX.add as InstanceType<typeof animated.Value>[];
  const ghostTransform = ghostStyle.transform as Record<string, InstanceType<typeof animated.Value>>[];
  return {
    laneX,
    dragX,
    laneScale: laneTransform[1].scale as unknown as InstanceType<typeof animated.Value>,
    laneOpacity: (laneStyle.opacity as { multiply: unknown[] }).multiply[0] as InstanceType<typeof animated.Value>,
    ghostX: ghostTransform[0].translateX,
    ghostOpacity: ghostStyle.opacity as InstanceType<typeof animated.Value>,
  };
}

function lastRun() {
  const run = animated.runs.at(-1);
  if (run === undefined) throw new Error('no animation started');
  return run;
}

describe('useMiniPlayerTrackTransition', () => {
  beforeEach(() => {
    hooks.reset();
    animated.runs.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });
  afterEach(() => {
    hooks.unmount();
    vi.useRealTimers();
  });

  it('mounts at rest without a ghost or animation', () => {
    const result = render({ slot: slot(0), display: display(0), reducedMotion: false });
    expect(result.ghost).toBeNull();
    expect(animated.runs).toHaveLength(0);
    expect(values(result).laneOpacity.value).toBe(1);
  });

  it('brings the next track in from the right over the previous one, which morphs out last', () => {
    render({ slot: slot(0), display: display(0), reducedMotion: false });
    const result = render({ slot: slot(1), display: display(1), reducedMotion: false });
    expect(result.ghost?.display).toEqual(display(0));
    const v = values(result);
    // Start values are set before the frame paints.
    expect(v.laneX.value).toBe(MINI_PLAYER_MOTION.laneInDistance);
    expect(v.laneOpacity.value).toBe(0);
    expect(v.ghostOpacity.value).toBe(1);
    const run = lastRun();
    expect(run.kind).toBe('parallel');
    expect(run.configs.every((config) => (config as { useNativeDriver: boolean }).useNativeDriver)).toBe(true);

    run.callback?.({ finished: true });
    const settled = render({ slot: slot(1), display: display(1), reducedMotion: false });
    expect(settled.ghost).toBeNull();
    expect(values(settled).laneX.value).toBe(0);
    expect(values(settled).ghostX.value).toBe(-MINI_PLAYER_MOTION.ghostDrift);
  });

  it('honours a noted skip direction over the queue order', () => {
    const all = (index: number): MiniPlayerSlot => ({ ...slot(index, 2), repeatAll: true });
    const first = render({ slot: all(0), display: display(0), reducedMotion: false });
    first.controls.noteSkip(-1, 450);
    const result = render({ slot: all(1), display: display(1), reducedMotion: false });
    expect(values(result).laneX.value).toBe(-MINI_PLAYER_MOTION.laneInDistance);
  });

  it('continues a committed swipe from the finger position once the skip lands', () => {
    const first = render({ slot: slot(2), display: display(2), reducedMotion: false });
    first.controls.dragTo(-60);
    expect(values(first).dragX.value).toBe(-60);
    first.controls.holdForSkip(1, 450);
    const result = render({ slot: slot(3), display: display(3), reducedMotion: false });
    const v = values(result);
    expect(v.dragX.value).toBe(0);
    expect(v.ghostX.value).toBe(-60);
    expect(v.ghostOpacity.value).toBeCloseTo(1 - (60 / 96) * 0.6);
    expect(v.laneX.value).toBe(MINI_PLAYER_MOTION.swipeInDistance);
    // The hold timer was cleared: nothing springs back later.
    vi.advanceTimersByTime(1000);
    expect(animated.runs.filter((run) => run.kind === 'spring')).toHaveLength(0);
  });

  it('springs the lane back when a committed swipe changed nothing', () => {
    const first = render({ slot: slot(0), display: display(0), reducedMotion: false });
    first.controls.dragTo(70);
    first.controls.holdForSkip(-1, 450);
    vi.advanceTimersByTime(449);
    expect(animated.runs).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(lastRun().kind).toBe('spring');
    expect(values(first).dragX.value).toBe(0);
  });

  it('hands a mid-flight lane to the next ghost from where it was drawn', () => {
    render({ slot: slot(0), display: display(0), reducedMotion: false });
    render({ slot: slot(1), display: display(1), reducedMotion: false });
    const firstRun = lastRun();
    vi.advanceTimersByTime(MINI_PLAYER_MOTION.laneInMs / 2);
    const result = render({ slot: slot(2), display: display(2), reducedMotion: false });
    expect(firstRun.stopped).toBe(true);
    expect(result.ghost?.display).toEqual(display(1));
    const ghostX = values(result).ghostX.value;
    expect(ghostX).toBeGreaterThan(0);
    expect(ghostX).toBeLessThan(MINI_PLAYER_MOTION.laneInDistance);
    expect(values(result).ghostOpacity.value).toBeGreaterThan(0);
    // The stale run finishing late must not drop the new ghost.
    firstRun.callback?.({ finished: true });
    expect(render({ slot: slot(2), display: display(2), reducedMotion: false }).ghost).not.toBeNull();
  });

  it('cross-fades only under reduced motion', () => {
    render({ slot: slot(0), display: display(0), reducedMotion: true });
    const result = render({ slot: slot(1), display: display(1), reducedMotion: true });
    const v = values(result);
    expect(v.laneX.value).toBe(0);
    expect(v.laneOpacity.value).toBe(0);
    expect(lastRun().configs).toContainEqual(expect.objectContaining({
      toValue: 1,
      duration: MINI_PLAYER_MOTION.crossfadeMs,
    }));
  });

  it('leaves appearing and disappearing to the card presence animation', () => {
    render({ slot: null, display: null, reducedMotion: false });
    const shown = render({ slot: slot(0), display: display(0), reducedMotion: false });
    expect(shown.ghost).toBeNull();
    const hidden = render({ slot: null, display: null, reducedMotion: false });
    expect(hidden.ghost).toBeNull();
    expect(animated.runs).toHaveLength(0);
  });

  it('does not animate when the same entry re-renders with new metadata', () => {
    render({ slot: slot(0), display: display(0), reducedMotion: false });
    const result = render({ slot: { ...slot(0) }, display: { ...display(0), title: 'Renamed' }, reducedMotion: false });
    expect(result.ghost).toBeNull();
    expect(animated.runs).toHaveLength(0);
  });

  it('keeps one controls object across ghost changes so a running gesture is never rebuilt', () => {
    const first = render({ slot: slot(0), display: display(0), reducedMotion: false });
    const during = render({ slot: slot(1), display: display(1), reducedMotion: false });
    expect(during.ghost).not.toBeNull();
    during.controls.dragTo(-20); // finishes the running transition, dropping the ghost
    const after = render({ slot: slot(1), display: display(1), reducedMotion: false });
    expect(after.ghost).toBeNull();
    expect(after.controls).toBe(first.controls);
  });

  it('forgets a swipe intent that did not land in time', () => {
    const first = render({ slot: slot(2), display: display(2), reducedMotion: false });
    first.controls.dragTo(60);
    first.controls.holdForSkip(-1, 450); // e.g. "previous" only restarted the song
    vi.advanceTimersByTime(450);
    // A later forward change (notification, queue tap) must not slide backward.
    const result = render({ slot: slot(3), display: display(3), reducedMotion: false });
    expect(values(result).laneX.value).toBe(MINI_PLAYER_MOTION.laneInDistance);
  });

  it('cancels a failed skip at once and forgets its direction', () => {
    const first = render({ slot: slot(2), display: display(2), reducedMotion: false });
    first.controls.dragTo(-70);
    const intent = first.controls.holdForSkip(1, 2500);
    // Well within the 2.5 s hold: only cancelSkip can spring back or clear the +1 intent.
    vi.advanceTimersByTime(100);
    first.controls.cancelSkip(intent);
    expect(lastRun().kind).toBe('spring');
    expect(values(first).dragX.value).toBe(0);
    const result = render({ slot: slot(1), display: display(1), reducedMotion: false });
    expect(values(result).laneX.value).toBe(-MINI_PLAYER_MOTION.laneInDistance);
    // The hold timer is gone too: no second spring later.
    vi.advanceTimersByTime(3000);
    expect(animated.runs.filter((run) => run.kind === 'spring')).toHaveLength(1);
  });

  it('ignores a late failure of a skip that already landed or was replaced', () => {
    const first = render({ slot: slot(2), display: display(2), reducedMotion: false });
    const landed = first.controls.noteSkip(1, 2500);
    const moved = render({ slot: slot(3), display: display(3), reducedMotion: false });
    moved.controls.dragTo(50);
    const newer = moved.controls.holdForSkip(-1, 2500);
    moved.controls.cancelSkip(landed); // the earlier remote command failed late
    expect(animated.runs.filter((run) => run.kind === 'spring')).toHaveLength(0);
    expect(values(moved).dragX.value).toBe(50);
    moved.controls.cancelSkip(newer);
    expect(animated.runs.filter((run) => run.kind === 'spring')).toHaveLength(1);
  });

  it('lets a change that lands mid-gesture play while the lane keeps following the finger', () => {
    const first = render({ slot: slot(2), display: display(2), reducedMotion: false });
    first.controls.dragTo(30);
    // Auto-advance under the finger.
    const result = render({ slot: slot(3), display: display(3), reducedMotion: false });
    const run = lastRun();
    expect(run.kind).toBe('parallel');
    expect(values(result).dragX.value).toBe(30);
    expect(values(result).ghostX.value).toBe(0);
    expect(values(result).laneX.value).toBe(MINI_PLAYER_MOTION.laneInDistance);
    // Further moves of the same gesture must not cut the change short.
    result.controls.dragTo(40);
    expect(run.stopped).toBe(false);
    expect(render({ slot: slot(3), display: display(3), reducedMotion: false }).ghost).not.toBeNull();
    // A new gesture after release does land it at once.
    result.controls.releaseDrag();
    result.controls.dragTo(5);
    expect(run.stopped).toBe(true);
  });

  it('keeps the leaving title through a quick second change instead of blinking it out', () => {
    render({ slot: slot(0), display: display(0), reducedMotion: false });
    render({ slot: slot(1), display: display(1), reducedMotion: false });
    const firstRun = lastRun();
    vi.advanceTimersByTime(50); // old title half faded, new title not yet in
    const result = render({ slot: slot(2), display: display(2), reducedMotion: false });
    expect(firstRun.stopped).toBe(true);
    expect(result.ghost?.display).toEqual(display(0));
    const ghostText = (result.controls.ghostTextStyle.opacity as InstanceType<typeof animated.Value>).value;
    expect(ghostText).toBeGreaterThan(0);
    expect(ghostText).toBeLessThan(1);
    // It keeps fading toward 0 over what was left of its 120 ms.
    const textConfig = lastRun().configs[2] as { toValue: number; duration: number };
    expect(textConfig.toValue).toBe(0);
    expect(textConfig.duration).toBe(MINI_PLAYER_MOTION.ghostTextOutMs - 50);
  });

  it('tracks index changes of the same entry, so a reordered queue still slides the right way', () => {
    render({ slot: slot(2), display: display(2), reducedMotion: false });
    // The playing entry moved to the front (same key, new index).
    render({ slot: { ...slot(2), index: 0 }, display: display(2), reducedMotion: false });
    const result = render({
      slot: { key: 'local:q:next', trackId: 'tn', index: 1, length: 5, repeatAll: false },
      display: display(9),
      reducedMotion: false,
    });
    expect(values(result).laneX.value).toBe(MINI_PLAYER_MOTION.laneInDistance);
  });

  it('rejects invalid drag offsets and hold times', () => {
    const result = render({ slot: slot(0), display: display(0), reducedMotion: false });
    expect(() => result.controls.dragTo(Number.NaN)).toThrow(RangeError);
    expect(() => result.controls.holdForSkip(1, 0)).toThrow(RangeError);
    expect(() => result.controls.noteSkip(1, Number.NaN)).toThrow(RangeError);
  });
});
