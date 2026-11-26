import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';
import {
  LANE_CHANNELS,
  LANE_REST,
  MINI_PLAYER_MOTION,
  classifyMiniPlayerTrackChange,
  dragOpacity,
  keepGhostThrough,
  lanePlan,
  sampleLane,
  type LaneChannel,
  type LanePlan,
  type LaneStart,
  type MiniPlayerSkipIntent,
  type MiniPlayerSlot,
} from './miniPlayerMotion';

/** What the lane shows; the ghost keeps the previous track's copy of it. */
export interface MiniPlayerLaneDisplay {
  readonly cover: string | null | undefined;
  readonly title: string;
  readonly artist: string;
}

export interface MiniPlayerGhost {
  readonly id: number;
  readonly display: MiniPlayerLaneDisplay;
}

type AnimatedStyle = Record<string, unknown>;

/**
 * Styles and commands, one stable object for the hook's whole lifetime so a
 * PanResponder built from it keeps its gesture state across re-renders.
 */
export interface MiniPlayerTrackControls {
  /** Style for the current lane (artwork + title/artist). */
  readonly laneStyle: AnimatedStyle;
  /** Extra style for the lane's title/artist block. */
  readonly laneTextStyle: AnimatedStyle;
  readonly ghostStyle: AnimatedStyle;
  readonly ghostTextStyle: AnimatedStyle;
  /** Finger-tracking horizontal offset of the lane (already damped by the caller). */
  dragTo(x: number): void;
  /** Swipe released without a skip: spring the lane back. */
  releaseDrag(): void;
  /** A button skip: remember the direction for a track change within `ttlMs`. Returns its token. */
  noteSkip(direction: 1 | -1, ttlMs: number): MiniPlayerSkipIntent | null;
  /**
   * A committed swipe: keep the lane where the finger left it until the skip
   * lands (remote and party skips are async), or spring back after `holdMs`
   * when nothing changed. Returns its token.
   */
  holdForSkip(direction: 1 | -1, holdMs: number): MiniPlayerSkipIntent | null;
  /**
   * That skip failed (it threw, or its remote command failed later): forget it
   * and spring back. A token that is no longer pending (the track already
   * changed, or a newer skip replaced it) is ignored.
   */
  cancelSkip(intent: MiniPlayerSkipIntent | null): void;
}

export interface MiniPlayerTrackTransition {
  /** Previous track while it animates out; decorative only. */
  readonly ghost: MiniPlayerGhost | null;
  readonly controls: MiniPlayerTrackControls;
}

function requirePositiveMs(label: string, ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) throw new RangeError(`Invalid mini player ${label} ${ms}`);
  return ms;
}

interface ActiveTransition {
  readonly id: number;
  readonly plan: LanePlan;
  startedAt: number | null;
  animation: Animated.CompositeAnimation | null;
}

interface Runtime {
  slot: MiniPlayerSlot | null;
  display: MiniPlayerLaneDisplay | null;
  intent: MiniPlayerSkipIntent | null;
  dragX: number;
  /** A finger is on the lane right now. */
  dragging: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
  holdIntent: MiniPlayerSkipIntent | null;
  ghostDisplay: MiniPlayerLaneDisplay | null;
  active: ActiveTransition | null;
  sequence: number;
  reducedMotion: boolean;
}

/**
 * Track-change choreography for the mini player: the previous track leaves
 * as a non-interactive ghost while the real current track slides (or fades)
 * in, both on the native driver. The lane always renders the real track, so
 * its label, like button and tap target never point at a stale song.
 */
export function useMiniPlayerTrackTransition({
  slot,
  display,
  reducedMotion,
}: {
  slot: MiniPlayerSlot | null;
  display: MiniPlayerLaneDisplay | null;
  reducedMotion: boolean;
}): MiniPlayerTrackTransition {
  const [values] = useState(() => ({
    ghostX: new Animated.Value(0),
    ghostOpacity: new Animated.Value(0),
    ghostTextOpacity: new Animated.Value(1),
    ghostScale: new Animated.Value(1),
    laneX: new Animated.Value(0),
    laneOpacity: new Animated.Value(1),
    laneTextOpacity: new Animated.Value(1),
    laneScale: new Animated.Value(1),
    dragX: new Animated.Value(0),
  }));
  const [ghost, setGhost] = useState<MiniPlayerGhost | null>(null);
  const runtime = useRef<Runtime>({
    slot,
    display,
    intent: null,
    dragX: 0,
    dragging: false,
    holdTimer: null,
    holdIntent: null,
    ghostDisplay: null,
    active: null,
    sequence: 0,
    reducedMotion,
  });

  const settle = useMemo(() => {
    const setChannels = (channelValues: Readonly<Record<LaneChannel, number>>) => {
      for (const channel of LANE_CHANNELS) values[channel].setValue(channelValues[channel]);
    };
    const clearHold = () => {
      const rt = runtime.current;
      if (rt.holdTimer !== null) clearTimeout(rt.holdTimer);
      rt.holdTimer = null;
      rt.holdIntent = null;
    };
    /** Jump a running transition to its end state and drop the ghost. */
    const finishActive = () => {
      const rt = runtime.current;
      const active = rt.active;
      if (active === null) return;
      rt.active = null;
      active.animation?.stop();
      setChannels({
        ghostX: active.plan.ghostX.to,
        ghostOpacity: 0,
        ghostTextOpacity: 0,
        ghostScale: 1,
        laneX: 0,
        laneOpacity: 1,
        laneTextOpacity: 1,
        laneScale: 1,
      });
      rt.ghostDisplay = null;
      setGhost(null);
    };
    const springDragBack = () => {
      const rt = runtime.current;
      rt.dragX = 0;
      if (rt.reducedMotion) {
        values.dragX.setValue(0);
        return;
      }
      Animated.spring(values.dragX, {
        toValue: 0,
        useNativeDriver: true,
        speed: 24,
        bounciness: 6,
      }).start();
    };
    return { setChannels, clearHold, finishActive, springDragBack };
  }, [values]);

  useLayoutEffect(() => {
    runtime.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  // A new queue entry became active: plan the change before the frame paints.
  const slotKey = slot?.key ?? null;
  useLayoutEffect(() => {
    const rt = runtime.current;
    const previous = rt.slot;
    rt.slot = slot;
    const intent = rt.intent;
    rt.intent = null;
    if (previous === null || slot === null) {
      // Appearing or disappearing is the card's presence animation, not a lane change.
      settle.clearHold();
      settle.finishActive();
      rt.dragging = false;
      rt.dragX = 0;
      values.dragX.setValue(0);
      return;
    }
    const now = Date.now();
    const change = classifyMiniPlayerTrackChange(previous, slot, intent, now);
    if (change.kind === 'none') return;
    const outgoing = rt.display;
    if (outgoing === null) {
      throw new Error(`Mini player changed from ${previous.key} to ${slot.key} without a displayed track`);
    }

    let start: LaneStart = LANE_REST;
    let keptGhost: ReturnType<typeof keepGhostThrough> = null;
    const interrupted = rt.active;
    if (interrupted !== null) {
      interrupted.animation?.stop();
      const elapsed = interrupted.startedAt === null ? 0 : now - interrupted.startedAt;
      start = sampleLane(interrupted.plan, elapsed);
      keptGhost = rt.ghostDisplay === null ? null : keepGhostThrough(interrupted.plan, elapsed);
      rt.active = null;
    }
    // A change that lands mid-gesture (auto-advance under the finger) plays
    // normally while the lane keeps following the finger; a released swipe
    // carries its offset into the change.
    const dragged = rt.dragging ? 0 : rt.dragX;
    if (dragged !== 0) {
      start = { ...start, x: start.x + dragged, opacity: start.opacity * dragOpacity(dragged) };
    }
    settle.clearHold();
    if (!rt.dragging) {
      rt.dragX = 0;
      values.dragX.setValue(0);
    }

    const fresh = lanePlan(change, {
      reducedMotion: rt.reducedMotion,
      start,
      swiped: dragged !== 0,
    });
    const plan = keptGhost === null ? fresh : { ...fresh, ...keptGhost };
    settle.setChannels({
      ghostX: plan.ghostX.from,
      ghostOpacity: plan.ghostOpacity.from,
      ghostTextOpacity: plan.ghostTextOpacity.from,
      ghostScale: plan.ghostScale.from,
      laneX: plan.laneX.from,
      laneOpacity: plan.laneOpacity.from,
      laneTextOpacity: plan.laneTextOpacity.from,
      laneScale: plan.laneScale.from,
    });
    const ghostDisplay = keptGhost === null || rt.ghostDisplay === null ? outgoing : rt.ghostDisplay;
    rt.ghostDisplay = ghostDisplay;
    rt.sequence += 1;
    rt.active = { id: rt.sequence, plan, startedAt: null, animation: null };
    setGhost({ id: rt.sequence, display: ghostDisplay });
    // `slot` is read through the key: only a different queue entry is a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, settle, values]);

  // Remember what is on screen now, after the change above captured the old copy.
  // The slot refresh also keeps index/length current when the same entry moves
  // in the queue (reorder, clear upcoming) without a key change.
  useLayoutEffect(() => {
    runtime.current.display = display;
    runtime.current.slot = slot;
  });

  // Start the tweens once the ghost is mounted, so its native nodes exist.
  const ghostId = ghost?.id ?? null;
  useLayoutEffect(() => {
    const rt = runtime.current;
    const active = rt.active;
    if (ghostId === null || active === null || active.id !== ghostId || active.animation !== null) {
      return;
    }
    const animation = Animated.parallel(
      LANE_CHANNELS.map((channel) => {
        const tween = active.plan[channel];
        return Animated.timing(values[channel], {
          toValue: tween.to,
          duration: tween.duration,
          delay: tween.delay,
          easing: tween.easing,
          useNativeDriver: true,
        });
      }),
    );
    active.animation = animation;
    active.startedAt = Date.now();
    animation.start(({ finished }) => {
      if (!finished || rt.active?.id !== active.id) return;
      rt.active = null;
      rt.ghostDisplay = null;
      setGhost((current) => (current?.id === active.id ? null : current));
    });
  }, [ghostId, values]);

  useEffect(() => () => {
    const rt = runtime.current;
    if (rt.holdTimer !== null) clearTimeout(rt.holdTimer);
    rt.holdTimer = null;
    rt.active?.animation?.stop();
    rt.active = null;
  }, []);

  const laneStyle = useMemo(() => {
    const { dragFadeDistance, dragFadeMinOpacity } = MINI_PLAYER_MOTION;
    const dragFade = values.dragX.interpolate({
      inputRange: [-dragFadeDistance, 0, dragFadeDistance],
      outputRange: [dragFadeMinOpacity, 1, dragFadeMinOpacity],
      extrapolate: 'clamp',
    });
    return {
      opacity: Animated.multiply(values.laneOpacity, dragFade),
      transform: [
        { translateX: Animated.add(values.laneX, values.dragX) },
        { scale: values.laneScale },
      ],
    };
  }, [values]);

  const ghostStyle = useMemo(() => ({
    opacity: values.ghostOpacity,
    transform: [{ translateX: values.ghostX }, { scale: values.ghostScale }],
  }), [values]);

  const laneTextStyle = useMemo(() => ({ opacity: values.laneTextOpacity }), [values]);
  const ghostTextStyle = useMemo(() => ({ opacity: values.ghostTextOpacity }), [values]);

  const controls = useMemo<MiniPlayerTrackControls>(() => ({
    laneStyle,
    laneTextStyle,
    ghostStyle,
    ghostTextStyle,
    dragTo(x: number) {
      if (!Number.isFinite(x)) throw new RangeError(`Invalid mini player drag offset ${x}`);
      const rt = runtime.current;
      if (!rt.dragging) {
        // A new gesture takes over the lane: land any running change at once.
        rt.dragging = true;
        if (rt.active !== null) settle.finishActive();
      }
      settle.clearHold();
      rt.dragX = x;
      values.dragX.setValue(x);
    },
    releaseDrag() {
      runtime.current.dragging = false;
      settle.clearHold();
      settle.springDragBack();
    },
    noteSkip(direction: 1 | -1, ttlMs: number) {
      requirePositiveMs('skip intent TTL', ttlMs);
      const rt = runtime.current;
      if (rt.slot === null) return null;
      const intent = { fromKey: rt.slot.key, direction, expiresAtMs: Date.now() + ttlMs };
      rt.intent = intent;
      return intent;
    },
    holdForSkip(direction: 1 | -1, holdMs: number) {
      requirePositiveMs('skip hold', holdMs);
      const rt = runtime.current;
      rt.dragging = false;
      if (rt.slot === null) return null;
      const intent = { fromKey: rt.slot.key, direction, expiresAtMs: Date.now() + holdMs };
      rt.intent = intent;
      settle.clearHold();
      rt.holdIntent = intent;
      rt.holdTimer = setTimeout(() => {
        rt.holdTimer = null;
        rt.holdIntent = null;
        // Nothing changed in time: this skip will not land any more.
        if (rt.intent === intent) rt.intent = null;
        settle.springDragBack();
      }, holdMs);
      return intent;
    },
    cancelSkip(intent: MiniPlayerSkipIntent | null) {
      const rt = runtime.current;
      if (intent === null) return;
      const pending = rt.intent === intent;
      const holding = rt.holdIntent === intent;
      if (!pending && !holding) return;
      if (pending) rt.intent = null;
      if (holding) {
        settle.clearHold();
        settle.springDragBack();
      }
    },
  }), [ghostStyle, ghostTextStyle, laneStyle, laneTextStyle, settle, values]);

  return { ghost, controls };
}
