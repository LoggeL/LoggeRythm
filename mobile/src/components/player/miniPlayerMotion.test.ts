import { describe, expect, it } from 'vitest';
import {
  LANE_REST,
  MINI_PLAYER_MOTION,
  classifyMiniPlayerTrackChange,
  continueTween,
  cubicBezier,
  dragOpacity,
  easing,
  keepGhostThrough,
  lanePlan,
  planDurationMs,
  presenceTween,
  sampleLane,
  sampleTween,
  type MiniPlayerSlot,
} from './miniPlayerMotion';

function slot(index: number, length: number, overrides: Partial<MiniPlayerSlot> = {}): MiniPlayerSlot {
  return {
    key: `local:queue:1:${index}:t${index}`,
    trackId: `t${index}`,
    index,
    length,
    repeatAll: false,
    ...overrides,
  };
}

const NOW = 10_000;

describe('classifyMiniPlayerTrackChange', () => {
  it('slides neighbours forward and backward', () => {
    expect(classifyMiniPlayerTrackChange(slot(2, 5), slot(3, 5), null, NOW))
      .toEqual({ kind: 'step', direction: 1 });
    expect(classifyMiniPlayerTrackChange(slot(3, 5), slot(2, 5), null, NOW))
      .toEqual({ kind: 'step', direction: -1 });
  });

  it('treats autoplay appending radio tracks as a forward step', () => {
    expect(classifyMiniPlayerTrackChange(slot(4, 5), slot(5, 25), null, NOW))
      .toEqual({ kind: 'step', direction: 1 });
  });

  it('wraps with repeat-all in both directions', () => {
    const all = { repeatAll: true };
    expect(classifyMiniPlayerTrackChange(slot(4, 5, all), slot(0, 5, all), null, NOW))
      .toEqual({ kind: 'step', direction: 1 });
    expect(classifyMiniPlayerTrackChange(slot(0, 5, all), slot(4, 5, all), null, NOW))
      .toEqual({ kind: 'step', direction: -1 });
    // Without repeat-all the same jump is a queue jump, not a wrap.
    expect(classifyMiniPlayerTrackChange(slot(4, 5), slot(0, 5), null, NOW)).toEqual({ kind: 'replace' });
  });

  it('defaults a two-entry repeat-all swap to forward and lets a skip intent disambiguate', () => {
    const all = { repeatAll: true };
    expect(classifyMiniPlayerTrackChange(slot(1, 2, all), slot(0, 2, all), null, NOW))
      .toEqual({ kind: 'step', direction: 1 });
    expect(classifyMiniPlayerTrackChange(slot(0, 2, all), slot(1, 2, all), null, NOW))
      .toEqual({ kind: 'step', direction: 1 });
    const from = slot(0, 2, all);
    expect(classifyMiniPlayerTrackChange(
      from,
      slot(1, 2, all),
      { fromKey: from.key, direction: -1, expiresAtMs: NOW + 400 },
      NOW,
    )).toEqual({ kind: 'step', direction: -1 });
  });

  it('ignores intents from another entry or past their expiry', () => {
    const from = slot(2, 5);
    const to = slot(3, 5);
    expect(classifyMiniPlayerTrackChange(from, to, { fromKey: 'other', direction: -1, expiresAtMs: NOW + 1 }, NOW))
      .toEqual({ kind: 'step', direction: 1 });
    expect(classifyMiniPlayerTrackChange(
      from,
      to,
      { fromKey: from.key, direction: -1, expiresAtMs: NOW - 1 },
      NOW,
    )).toEqual({ kind: 'step', direction: 1 });
  });

  it('uses the intent for slow remote skips even when the server lands elsewhere', () => {
    const from = slot(2, 5);
    expect(classifyMiniPlayerTrackChange(
      from,
      slot(4, 9, { key: 'remote:4:x', trackId: 'x' }),
      { fromKey: from.key, direction: 1, expiresAtMs: NOW + 1300 },
      NOW,
    )).toEqual({ kind: 'step', direction: 1 });
  });

  it('cross-fades queue jumps and brand-new queues', () => {
    expect(classifyMiniPlayerTrackChange(slot(1, 5), slot(4, 5), null, NOW)).toEqual({ kind: 'replace' });
    expect(classifyMiniPlayerTrackChange(slot(3, 5), slot(0, 12, { key: 'local:queue:2:0:a', trackId: 'a' }), null, NOW))
      .toEqual({ kind: 'replace' });
  });

  it('keeps the lane still when the same entry or the same song carries into another queue', () => {
    expect(classifyMiniPlayerTrackChange(slot(1, 5), slot(1, 5), null, NOW)).toEqual({ kind: 'none' });
    // Joining a party with the host's current song keeps the playhead.
    expect(classifyMiniPlayerTrackChange(
      slot(3, 5),
      slot(0, 8, { key: 'local:party:ABC:9:t3', trackId: 't3' }),
      null,
      NOW,
    )).toEqual({ kind: 'none' });
    // The same song queued twice back-to-back still slides.
    expect(classifyMiniPlayerTrackChange(slot(1, 5), slot(2, 5, { trackId: 't1' }), null, NOW))
      .toEqual({ kind: 'step', direction: 1 });
  });

  it('fails loudly on impossible slots', () => {
    expect(() => classifyMiniPlayerTrackChange(slot(5, 5), slot(0, 5), null, NOW)).toThrow(/outside a 5-item queue/);
    expect(() => classifyMiniPlayerTrackChange(slot(0, 0), slot(0, 5), null, NOW)).toThrow(/invalid queue length/);
  });
});

describe('easing', () => {
  it('solves cubic-bezier curves with fixed end points and monotonic output', () => {
    for (const curve of [easing.standard, easing.decelerate, easing.accelerate]) {
      expect(curve(0)).toBe(0);
      expect(curve(1)).toBe(1);
      let previous = 0;
      for (let t = 0.05; t < 1; t += 0.05) {
        const value = curve(t);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
    // Decelerate covers most of the distance early; accelerate starts slowly.
    expect(easing.decelerate(0.3)).toBeGreaterThan(0.7);
    expect(easing.accelerate(0.3)).toBeLessThan(0.15);
    expect(cubicBezier(0, 0, 1, 1)(0.37)).toBeCloseTo(0.37, 5);
  });

  it('rejects invalid control points', () => {
    expect(() => cubicBezier(1.2, 0, 0, 1)).toThrow(RangeError);
    expect(() => cubicBezier(Number.NaN, 0, 0, 1)).toThrow(RangeError);
  });
});

describe('lanePlan', () => {
  const m = MINI_PLAYER_MOTION;

  it('brings the new track in at once and morphs the old one out after it landed', () => {
    const forward = lanePlan({ kind: 'step', direction: 1 }, {
      reducedMotion: false, start: LANE_REST, swiped: false,
    });
    expect(forward.laneX).toMatchObject({ from: m.laneInDistance, to: 0, delay: 0 });
    expect(forward.laneOpacity).toMatchObject({ from: 0, to: 1, delay: 0 });
    expect(forward.ghostX).toMatchObject({ from: 0, to: -m.ghostDrift });
    expect(forward.ghostOpacity).toMatchObject({ from: 1, to: 0, delay: m.ghostOutDelayMs });
    expect(forward.ghostScale).toMatchObject({ from: 1, to: m.ghostOutScale, delay: m.ghostOutDelayMs });
    // The old copy is still fully there while the new one fades in…
    expect(sampleTween(forward.ghostOpacity, m.ghostOutDelayMs)).toBe(1);
    expect(sampleTween(forward.laneOpacity, m.ghostOutDelayMs)).toBeGreaterThan(0.6);
    // …and leaves last.
    expect(m.ghostOutDelayMs + m.ghostOutMs).toBeGreaterThanOrEqual(m.laneInMs);

    const backward = lanePlan({ kind: 'step', direction: -1 }, {
      reducedMotion: false, start: LANE_REST, swiped: false,
    });
    expect(backward.ghostX.to).toBe(m.ghostDrift);
    expect(backward.laneX.from).toBe(-m.laneInDistance);
  });

  it('sequences titles so old and new text never smudge into each other', () => {
    const plan = lanePlan({ kind: 'step', direction: 1 }, {
      reducedMotion: false, start: LANE_REST, swiped: false,
    });
    // At every moment at most one title is clearly visible.
    for (let t = 0; t <= planDurationMs(plan); t += 10) {
      const oldText = sampleTween(plan.ghostOpacity, t) * sampleTween(plan.ghostTextOpacity, t);
      const newText = sampleTween(plan.laneOpacity, t) * sampleTween(plan.laneTextOpacity, t);
      expect(Math.min(oldText, newText)).toBeLessThan(0.35);
    }
    expect(plan.ghostTextOpacity).toMatchObject({ from: 1, to: 0, delay: 0, duration: m.ghostTextOutMs });
    expect(plan.laneTextOpacity).toMatchObject({ from: 0, to: 1, delay: m.laneTextInDelayMs });
    // Covers, by contrast, overlap: the old one is still fully there as the new one lands.
    expect(sampleTween(plan.ghostOpacity, m.laneFadeInMs)).toBeGreaterThan(0.6);
    expect(sampleTween(plan.laneOpacity, m.laneFadeInMs)).toBe(1);
  });

  it('keeps the distances subtle', () => {
    expect(m.laneInDistance).toBeLessThanOrEqual(24);
    expect(m.ghostDrift).toBeLessThanOrEqual(12);
    expect(m.ghostOutScale).toBeGreaterThanOrEqual(0.95);
    expect(planDurationMs(lanePlan({ kind: 'step', direction: 1 }, {
      reducedMotion: false, start: LANE_REST, swiped: false,
    }))).toBeLessThanOrEqual(320);
  });

  it('continues a swipe from where the finger let go', () => {
    const plan = lanePlan({ kind: 'step', direction: 1 }, {
      reducedMotion: false,
      start: { x: -60, opacity: 0.6, textOpacity: 1, scale: 1 },
      swiped: true,
    });
    expect(plan.ghostX).toMatchObject({ from: -60, to: -60 - m.swipeDrift });
    expect(plan.ghostOpacity).toMatchObject({ from: 0.6, to: 0 });
    expect(plan.laneX).toMatchObject({ from: m.swipeInDistance, to: 0 });
  });

  it('settles replacements in from a slight shrink while the old copy morphs out in place', () => {
    const plan = lanePlan({ kind: 'replace' }, { reducedMotion: false, start: LANE_REST, swiped: false });
    expect(plan.ghostX).toMatchObject({ from: 0, to: 0 });
    expect(plan.ghostScale).toMatchObject({ to: m.ghostOutScale });
    expect(plan.laneX).toMatchObject({ from: 0, to: 0 });
    expect(plan.laneScale).toMatchObject({ from: m.replaceFromScale, to: 1 });
  });

  it('reduces every change to a short opacity cross-fade under reduced motion', () => {
    for (const change of [{ kind: 'step', direction: 1 }, { kind: 'replace' }] as const) {
      const plan = lanePlan(change, { reducedMotion: true, start: LANE_REST, swiped: false });
      expect(plan.laneX).toMatchObject({ from: 0, to: 0 });
      expect(plan.laneScale).toMatchObject({ from: 1, to: 1 });
      expect(plan.ghostX).toMatchObject({ from: 0, to: 0 });
      expect(plan.ghostScale).toMatchObject({ from: 1, to: 1 });
      expect(plan.laneTextOpacity).toMatchObject({ from: 1, to: 1 });
      expect(plan.laneOpacity).toMatchObject({ from: 0, to: 1, duration: m.crossfadeMs });
      expect(planDurationMs(plan)).toBe(m.crossfadeMs);
    }
  });
});

describe('sampling', () => {
  it('samples tweens across delay, run and end', () => {
    const tween = { from: 10, to: 20, duration: 100, delay: 50, easing: easing.linear };
    expect(sampleTween(tween, 0)).toBe(10);
    expect(sampleTween(tween, 50)).toBe(10);
    expect(sampleTween(tween, 100)).toBe(15);
    expect(sampleTween(tween, 500)).toBe(20);
    expect(() => sampleTween(tween, Number.NaN)).toThrow(RangeError);
  });

  it('samples where an interrupted lane was drawn', () => {
    const plan = lanePlan({ kind: 'step', direction: 1 }, {
      reducedMotion: false, start: LANE_REST, swiped: false,
    });
    expect(sampleLane(plan, 0)).toEqual({
      x: MINI_PLAYER_MOTION.laneInDistance, opacity: 0, textOpacity: 0, scale: 1,
    });
    const middle = sampleLane(plan, MINI_PLAYER_MOTION.laneInMs / 2);
    expect(middle.x).toBeGreaterThan(0);
    expect(middle.x).toBeLessThan(MINI_PLAYER_MOTION.laneInDistance);
    expect(sampleLane(plan, planDurationMs(plan))).toEqual(LANE_REST);
  });

  it('dims the lane with the drag offset and clamps at the drag range', () => {
    expect(dragOpacity(0)).toBe(1);
    expect(dragOpacity(-48)).toBeCloseTo(0.7);
    expect(dragOpacity(500)).toBeCloseTo(MINI_PLAYER_MOTION.dragFadeMinOpacity);
    expect(() => dragOpacity(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('presenceTween', () => {
  it('enters with deceleration and exits faster with acceleration', () => {
    expect(presenceTween('enter', 0, false)).toMatchObject({
      from: 0, to: 1, duration: MINI_PLAYER_MOTION.presenceInMs, easing: easing.decelerate,
    });
    expect(presenceTween('exit', 1, false)).toMatchObject({
      from: 1, to: 0, duration: MINI_PLAYER_MOTION.presenceOutMs, easing: easing.accelerate,
    });
  });

  it('resumes from an interrupted value and fades only under reduced motion', () => {
    expect(presenceTween('enter', 0.4, false).from).toBe(0.4);
    expect(presenceTween('exit', 1, true)).toMatchObject({
      to: 0, duration: MINI_PLAYER_MOTION.crossfadeMs, easing: easing.linear,
    });
    expect(() => presenceTween('enter', 1.5, false)).toThrow(RangeError);
  });
});

describe('continuing an interrupted ghost', () => {
  it('resumes a tween from where it is drawn with the time it had left', () => {
    const tween = { from: 1, to: 0, duration: 200, delay: 100, easing: easing.linear };
    expect(continueTween(tween, 40)).toEqual({ from: 1, to: 0, duration: 200, delay: 60, easing: easing.linear });
    expect(continueTween(tween, 150)).toEqual({ from: 0.75, to: 0, duration: 150, delay: 0, easing: easing.linear });
    expect(continueTween(tween, 400)).toEqual({ from: 0, to: 0, duration: 0, delay: 0, easing: easing.linear });
  });

  it('keeps the ghost only while its title is still the one being read', () => {
    const plan = lanePlan({ kind: 'step', direction: 1 }, { reducedMotion: false, start: LANE_REST, swiped: false });
    const kept = keepGhostThrough(plan, 50);
    expect(kept).not.toBeNull();
    expect(kept?.ghostTextOpacity.from).toBe(sampleTween(plan.ghostTextOpacity, 50));
    expect(kept?.ghostOpacity).toEqual(continueTween(plan.ghostOpacity, 50));
    // Past the crossing point the incoming title is what is read: it becomes the ghost.
    expect(keepGhostThrough(plan, MINI_PLAYER_MOTION.ghostTextOutMs + 20)).toBeNull();
  });

  it('under reduced motion hands over to whichever copy is more visible', () => {
    const plan = lanePlan({ kind: 'step', direction: 1 }, { reducedMotion: true, start: LANE_REST, swiped: false });
    expect(keepGhostThrough(plan, 30)).not.toBeNull();
    expect(keepGhostThrough(plan, 140)).toBeNull();
  });
});
