import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_CLOCK_EXTRAPOLATION_SEC,
  heldPosition,
  progressRatio,
  resolveSmoothPosition,
  scrubTrackKey,
} from "../src/components/player/scrubState.ts";
import {
  readLivePlaybackClock,
  registerLivePlaybackClock,
} from "../src/lib/playbackClock.ts";

const queue = [{ id: "a" }, { id: 7 }, { id: "a" }];

test("the scrub key names the playing queue entry, not just its track", () => {
  assert.equal(scrubTrackKey({ index: -1, queue }), null);
  assert.equal(scrubTrackKey({ index: 1, queue }), "1:7");
  // The same song queued twice is still a different entry to seek in.
  assert.notEqual(scrubTrackKey({ index: 0, queue }), scrubTrackKey({ index: 2, queue }));
});

test("a held drag only applies to the track it was made on", () => {
  const drag = { value: 230, trackKey: scrubTrackKey({ index: 0, queue }) };
  assert.equal(heldPosition(drag, "0:a"), 230);
  // Track A ended while the thumb was held: its 230 s must not seek track B.
  assert.equal(heldPosition(drag, scrubTrackKey({ index: 1, queue })), null);
  assert.equal(heldPosition(drag, null), null);
  assert.equal(heldPosition(null, "0:a"), null);
  assert.equal(heldPosition({ value: 0, trackKey: "0:a" }, "0:a"), 0);
});

test("progressRatio clamps valid inputs into 0..1 and returns 0 when idle", () => {
  assert.equal(progressRatio(0, 0), 0);
  assert.equal(progressRatio(50, -10), 0);
  assert.equal(progressRatio(45, 180), 0.25);
  assert.equal(progressRatio(250, 180), 1);
  assert.equal(progressRatio(-5, 180), 0);
  assert.equal(progressRatio(Number.NaN, 180), 0);
});

test("resolveSmoothPosition prefers live audio clock, avoids seek flashback, and extrapolates remote smoothly", () => {
  const base = {
    trackKey: "0:a",
    trackId: "a",
    duration: 200,
    isPlaying: true,
    isBuffering: false,
    suppressLocalAudio: false,
    seekPending: false,
    dragPosition: null,
    anchor: { trackKey: "0:a", time: 10, capturedAtMs: 1000 },
    nowMs: 1200,
    liveClock: { trackId: "a", currentTime: 10.312, paused: false, seeking: false },
    lastRenderedTime: 10.29,
  };

  // 1. Live local audio clock drives sub-frame accuracy directly.
  assert.equal(resolveSmoothPosition(base), 10.312);

  // 2. Active drag always wins immediately.
  assert.equal(resolveSmoothPosition({ ...base, dragPosition: 99.5 }), 99.5);

  // 3. Pending seek or audio element seeking holds target anchor (no flashback to old audio time).
  assert.equal(
    resolveSmoothPosition({
      ...base,
      seekPending: true,
      anchor: { trackKey: "0:a", time: 120, capturedAtMs: 1200 },
    }),
    120,
  );
  assert.equal(
    resolveSmoothPosition({
      ...base,
      anchor: { trackKey: "0:a", time: 120, capturedAtMs: 1200 },
      liveClock: { trackId: "a", currentTime: 10.3, paused: false, seeking: true },
      nowMs: 1200,
      lastRenderedTime: null,
    }),
    120,
  );

  // 4. Paused or buffering holds exact anchor without drifting.
  assert.equal(resolveSmoothPosition({ ...base, isPlaying: false }), 10);
  assert.equal(resolveSmoothPosition({ ...base, isBuffering: true }), 10);

  // 5. Remote Connect / Jam control-only extrapolates smoothly and caps runaway extrapolation.
  assert.equal(
    resolveSmoothPosition({ ...base, suppressLocalAudio: true, nowMs: 1350, lastRenderedTime: 10.3 }),
    10.35,
  );
  assert.equal(
    resolveSmoothPosition({ ...base, suppressLocalAudio: true, nowMs: 10_000, lastRenderedTime: null }),
    10 + MAX_CLOCK_EXTRAPOLATION_SEC,
  );

  // 6. Tiny backward jitter on remote heartbeat holds lastRenderedTime; real backward seek snaps immediately.
  assert.equal(
    resolveSmoothPosition({ ...base, suppressLocalAudio: true, nowMs: 1000, lastRenderedTime: 10.08 }),
    10.08,
  );
  assert.equal(
    resolveSmoothPosition({ ...base, suppressLocalAudio: true, nowMs: 1000, lastRenderedTime: 40 }),
    10,
  );
});

test("playbackClock registry registers, reads, and safely unregisters without clobbering newer readers", () => {
  assert.equal(readLivePlaybackClock(), null);
  const firstSample = { trackId: "1", currentTime: 5.5, paused: false, seeking: false };
  const secondSample = { trackId: "2", currentTime: 9.25, paused: false, seeking: false };
  const disposeFirst = registerLivePlaybackClock(() => firstSample);
  assert.deepEqual(readLivePlaybackClock(), firstSample);

  const disposeSecond = registerLivePlaybackClock(() => secondSample);
  assert.deepEqual(readLivePlaybackClock(), secondSample);

  // Disposing the older reader must not remove the newer active reader.
  disposeFirst();
  assert.deepEqual(readLivePlaybackClock(), secondSample);

  disposeSecond();
  assert.equal(readLivePlaybackClock(), null);
});

test("scrubber knob travel CSS does not create full-width horizontal overflow", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  const ruleBody = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `Missing CSS rule for ${selector}`);
    return match[1];
  };

  for (const trackSelector of [".scrubber-knob-track", ".progress-line-knob-track"]) {
    const body = ruleBody(trackSelector);
    assert.match(body, /\bcontainer-type:\s*inline-size\b/, `${trackSelector} must set container-type: inline-size`);
    assert.match(body, /\bwidth:\s*calc\(100%\s*-\s*\d+px\)/, `${trackSelector} must have a definite calc(100% - Npx) width`);
  }

  for (const travelSelector of [".scrubber-knob-travel", ".progress-line-knob-travel"]) {
    const body = ruleBody(travelSelector);
    assert.match(body, /\bwidth:\s*0\b/, `${travelSelector} must set width: 0`);
    assert.match(body, /\* 100cqi\b/, `${travelSelector} must translate using 100cqi`);
    assert.doesNotMatch(body, /\bwidth:\s*100%/, `${travelSelector} must not use width: 100%`);
    assert.doesNotMatch(body, /\* 100%/, `${travelSelector} must not translate by percentage of its own box`);
  }

  const seekEdgeBody = ruleBody(".seek-edge");
  assert.match(seekEdgeBody, /\boverflow-x:\s*clip\b/, ".seek-edge must clip horizontal overhang with overflow-x: clip");
  assert.doesNotMatch(seekEdgeBody, /\boverflow(?:-x)?:\s*hidden\b/, ".seek-edge must not use overflow: hidden (clips hover pill)");
});
