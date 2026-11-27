import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";

const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    }
    if (specifier === "./queuePolicy" && context.parentURL?.endsWith("/store/player.ts")) {
      return nextResolve(new URL("../src/store/queuePolicy.ts", import.meta.url).href, context);
    }
    if (specifier === "./player" && context.parentURL?.endsWith("/store/playerSession.ts")) {
      return nextResolve(new URL("../src/store/player.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const saved = new Map();
globalThis.localStorage = {
  getItem: (key) => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
  removeItem: (key) => saved.delete(key),
};
globalThis.window = {
  localStorage: globalThis.localStorage,
  setTimeout: () => 0,
  dispatchEvent: () => true,
};

const { usePlayerStore, currentTrack } = await import("../src/store/player.ts");
const { restoredPlayerState, parsePlayerSession, capturePlayerSession } = await import(
  "../src/store/playerSession.ts"
);
const {
  readLiveTransitionClock,
  registerLiveTransitionClock,
  resolveTransitionProgress,
} = await import("../src/lib/playbackClock.ts");
const {
  classifyCrossfadePlan,
  computeCueAwareCrossfade,
  computeRescheduledCrossfadeTiming,
} = await import("../src/lib/audioIntelligence.ts");
resolver.deregister();

const track = (id, title = `Track ${id}`) => ({
  id: String(id),
  title,
  artist: `Artist ${id}`,
  album: `Album ${id}`,
  cover: `https://cdn.example/${id}.jpg`,
  duration_sec: 200,
});

const state = () => usePlayerStore.getState();

function startActiveTransition(overrides = {}) {
  const s = state();
  const outgoingIndex = overrides.outgoingIndex ?? s.index;
  const incomingIndex = overrides.incomingIndex ?? outgoingIndex + 1;
  return s._startTransition({
    kind: overrides.kind ?? "crossfade",
    outgoing: overrides.outgoing ?? s.queue[outgoingIndex],
    incoming: overrides.incoming ?? s.queue[incomingIndex],
    outgoingIndex,
    incomingIndex,
    startedAtMs: overrides.startedAtMs ?? performance.now(),
    durationMs: overrides.durationMs ?? 6000,
    ...(overrides.progress !== undefined ? { progress: overrides.progress } : {}),
  });
}

beforeEach(() => {
  saved.clear();
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
});

test("full crossfade lifecycle: start -> progress updates -> natural completion records completed end", () => {
  state().playQueue([track(1, "Alpha"), track(2, "Beta"), track(3, "Gamma")]);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd, null);

  const startedAtMs = performance.now();
  const id = startActiveTransition({ kind: "smart-crossfade", startedAtMs, durationMs: 6000 });
  assert.ok(Number.isInteger(id) && id > 0);
  assert.equal(currentTrack(state())?.id, "1");
  assert.equal(state().transition?.id, id);
  assert.equal(state().transition?.kind, "smart-crossfade");
  assert.equal(state().transition?.outgoing.id, "1");
  assert.equal(state().transition?.incoming.id, "2");
  assert.equal(state().transition?.outgoingIndex, 0);
  assert.equal(state().transition?.incomingIndex, 1);
  assert.equal(state().transition?.startedAtMs, startedAtMs);
  assert.equal(state().transition?.durationMs, 6000);
  assert.equal(state().transition?.progress, 0);
  assert.equal(state().lastTransitionEnd, null);

  state()._updateTransitionProgress(id, 0.35);
  assert.equal(state().transition?.progress, 0.35);

  // Stale ID updates are ignored cleanly without clobbering active state.
  state()._updateTransitionProgress(id + 99, 0.9);
  assert.equal(state().transition?.progress, 0.35);

  // Mid-transition playbackRate reschedule keeps ID and updates timing atomically.
  state()._rescheduleTransitionTiming(id, startedAtMs + 500, 3000, 0.5);
  assert.equal(state().transition?.startedAtMs, startedAtMs + 500);
  assert.equal(state().transition?.durationMs, 3000);
  assert.equal(state().transition?.progress, 0.5);

  // Natural handoff advances currentTrack to incoming, clears transition, and emits outcome="completed".
  const advanced = state()._crossfadeAdvance("1", "2", 6.1, 200, 1);
  assert.equal(advanced, true);
  assert.equal(currentTrack(state())?.id, "2");
  assert.equal(state().index, 1);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.id, id);
  assert.equal(state().lastTransitionEnd?.kind, "smart-crossfade");
  assert.equal(state().lastTransitionEnd?.outcome, "completed");
  assert.equal(state().lastTransitionEnd?.outgoing.id, "1");
  assert.equal(state().lastTransitionEnd?.incoming.id, "2");
  assert.ok(Number.isFinite(state().lastTransitionEnd?.endedAtMs));
});

test("repeat-all wraparound crossfade completes naturally from last track to index 0", () => {
  state().playQueue([track(1), track(2)], 1);
  state().cycleRepeat(); // off -> all
  const id = startActiveTransition({ outgoingIndex: 1, incomingIndex: 0 });
  assert.equal(state().transition?.outgoingIndex, 1);
  assert.equal(state().transition?.incomingIndex, 0);

  const ok = state()._crossfadeAdvance("2", "1", 4.0, 200, 0);
  assert.equal(ok, true);
  assert.equal(state().index, 0);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.id, id);
  assert.equal(state().lastTransitionEnd?.outcome, "completed");
});

test("gapless _crossfadeAdvance without an active transition does not emit a fake transition end", () => {
  state().playQueue([track(1), track(2)]);
  assert.equal(state().transition, null);
  assert.equal(state()._crossfadeAdvance("1", "2", 0, 200, 1), true);
  assert.equal(state().index, 1);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd, null);
});

test("manual next mid-crossfade cancels cleanly instead of reporting natural completion", () => {
  state().playQueue([track(1), track(2), track(3)]);
  const id = startActiveTransition();
  state()._updateTransitionProgress(id, 0.4);

  // User hits Next while Track 1 -> Track 2 is blending. Even though currentTrack
  // becomes Track 2, outcome MUST be "cancelled" so the UI snaps without an exit ghost.
  state().next();
  assert.equal(currentTrack(state())?.id, "2");
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.id, id);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");
});

test("a subsequent playback action clears an earlier completed lastTransitionEnd so UI exit animations snap", () => {
  state().playQueue([track(1), track(2), track(3)]);
  startActiveTransition();
  assert.equal(state()._crossfadeAdvance("1", "2", 5.0, 200, 1), true);
  assert.equal(state().lastTransitionEnd?.outcome, "completed");

  // Non-disruptive UI/audio updates keep lastTransitionEnd intact while exit animation plays.
  state().setVolume(0.5);
  state().toggleMute();
  state().toggleQueue();
  state()._setCurrentTime(5.2);
  state()._setError(null);
  assert.equal(state().lastTransitionEnd?.outcome, "completed");

  // Disruptive actions (next/seek/pause/playTrack) clear it immediately.
  state().seek(20);
  assert.equal(state().lastTransitionEnd, null);
});

test("pause, toggle, seek, prev, jumpTo, playTrack, playQueue, error, and remote suppression cancel active transitions", () => {
  const cases = [
    ["pause", () => state().pause()],
    ["toggle to pause", () => state().toggle()],
    ["seek", () => state().seek(30)],
    ["prev (restart)", () => { state()._setCurrentTime(10); state().prev(); }],
    ["jumpTo", () => state().jumpTo(2)],
    ["playTrack", () => state().playTrack(track(99))],
    ["playQueue", () => state().playQueue([track(10), track(11)])],
    ["suppressLocalAudio(true)", () => state().setSuppressLocalAudio(true)],
    ["_setError(non-null)", () => state()._setError("Stream failed")],
    ["_onEnded", () => state()._onEnded()],
    ["_cancelTransition(id)", () => state()._cancelTransition(state().transition?.id)],
    [
      "applyRemotePlaybackState",
      () =>
        state().applyRemotePlaybackState({
          queue: [track(50)],
          origins: ["context"],
          queue_context: null,
          current_index: 0,
          is_playing: true,
          position_sec: 12,
          duration_sec: 200,
          shuffle: false,
          repeat: "off",
          volume: 0.8,
          muted: false,
          updated_at: null,
        }),
    ],
    [
      "activateConnectPlayback",
      () =>
        state().activateConnectPlayback({
          queue: [track(60)],
          origins: ["context"],
          queue_context: null,
          current_index: 0,
          is_playing: true,
          position_sec: 5,
          duration_sec: 200,
          shuffle: false,
          repeat: "off",
          volume: 0.8,
          muted: false,
          updated_at: null,
        }),
    ],
  ];

  for (const [label, action] of cases) {
    usePlayerStore.setState(usePlayerStore.getInitialState(), true);
    state().playQueue([track(1), track(2), track(3)]);
    const id = startActiveTransition();
    state()._updateTransitionProgress(id, 0.5);
    action();
    assert.equal(state().transition, null, `${label} should clear active transition`);
    assert.equal(state().lastTransitionEnd?.id, id, `${label} should reference cancelled transition id`);
    assert.equal(state().lastTransitionEnd?.outcome, "cancelled", `${label} should emit outcome="cancelled"`);
  }
});

test("pause cancels active transition and resuming allows a fresh transition with a higher ID", () => {
  state().playQueue([track(1), track(2)]);
  const firstId = startActiveTransition({ durationMs: 6000 });
  state()._updateTransitionProgress(firstId, 0.5);

  state().pause();
  assert.equal(state().isPlaying, false);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");

  state().play();
  assert.equal(state().isPlaying, true);
  const secondId = startActiveTransition({ durationMs: 3000 });
  assert.ok(secondId > firstId);
  assert.equal(state().transition?.id, secondId);
  assert.equal(state().transition?.durationMs, 3000);
  assert.equal(state().lastTransitionEnd, null);
});

test("queue mutations preserve transitions when outgoing/incoming pair is unchanged and cancel when invalidated", () => {
  // Appending to the tail (or adding a second manual item behind an existing manual incoming item) preserves transition.
  state().playQueue([track(1), track(2), track(3)]);
  state().playNext(track(9)); // queue: [1, 9(manual), 2, 3]
  const id = startActiveTransition(); // 0 (1) -> 1 (9)
  state().addToQueue(track(10)); // inserts manual tail at index 2; 0->1 pair untouched
  assert.equal(state().transition?.id, id);
  state().appendToQueue([track(11)]);
  assert.equal(state().transition?.id, id);
  state().setVolume(0.4);
  assert.equal(state().transition?.id, id);

  // playNext replaces index 1 -> cancels transition immediately.
  state().playNext(track(12));
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");

  // addToQueue when incoming is a context item inserts manual before it -> cancels.
  state().playQueue([track(1), track(2), track(3)]);
  startActiveTransition(); // 0 (1) -> 1 (2, context)
  state().addToQueue(track(20)); // becomes index 1!
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");

  // removeFromQueue removing incoming -> cancels.
  state().playQueue([track(1), track(2), track(3)]);
  startActiveTransition();
  state().removeFromQueue(1);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");

  // reorderQueue swapping incoming -> cancels.
  state().playQueue([track(1), track(2), track(3)]);
  startActiveTransition();
  state().reorderQueue(2, 1);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");

  // clearQueue dropping upcoming -> cancels.
  state().playQueue([track(1), track(2), track(3)]);
  startActiveTransition();
  state().clearQueue();
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");

  // repeat -> "one" cancels.
  state().playQueue([track(1), track(2)]);
  startActiveTransition();
  state().cycleRepeat(); // off -> all (still valid)
  assert.ok(state().transition !== null);
  state().cycleRepeat(); // all -> one (cancels!)
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");

  // sleepAfterTrack -> true cancels.
  usePlayerStore.setState(usePlayerStore.getInitialState(), true);
  state().playQueue([track(1), track(2)]);
  startActiveTransition();
  state().setSleepAfterTrack(true);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");
});

test("party queue updates preserve transition when same outgoing/incoming pair remains and cancel otherwise", () => {
  state().setPartyQueue([track(1), track(2)], 0, [100, 101]);
  state().play();
  const id = startActiveTransition();

  // Appending track 3 keeps indices 0 (100) and 1 (101) identical -> transition stays active.
  state().setPartyQueue([track(1), track(2), track(3)], 0, [100, 101, 102]);
  assert.equal(state().transition?.id, id);

  // Reordering upcoming changes index 1 -> transition cancels.
  state().setPartyQueue([track(1), track(3), track(2)], 0, [100, 102, 101]);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");

  // Host pause / seek via followHostPlayback cancels transition.
  const id2 = startActiveTransition();
  state().followHostPlayback(false, null);
  assert.equal(state().transition, null);
  assert.equal(state().lastTransitionEnd?.id, id2);
  assert.equal(state().lastTransitionEnd?.outcome, "cancelled");
});

test("transition state is ephemeral: never persisted to localStorage and cleared on session restore", () => {
  state().playQueue([track(1), track(2)]);
  startActiveTransition();
  const rawPersisted = saved.get("sf_player");
  assert.ok(rawPersisted);
  const parsed = JSON.parse(rawPersisted);
  assert.equal("transition" in parsed.state, false);
  assert.equal("lastTransitionEnd" in parsed.state, false);

  const snapshot = parsePlayerSession(JSON.parse(JSON.stringify(capturePlayerSession(state(), "u1"))));
  const restored = restoredPlayerState(snapshot);
  assert.equal(restored.transition, null);
  assert.equal(restored.lastTransitionEnd, null);
});

test("store transition mutators fail loudly on invalid inputs (no silent fallbacks)", () => {
  state().playQueue([track(1), track(2)]);

  assert.throws(
    () =>
      state()._startTransition({
        kind: "bogus",
        outgoing: track(1),
        incoming: track(2),
        outgoingIndex: 0,
        incomingIndex: 1,
        startedAtMs: 100,
        durationMs: 5000,
      }),
    RangeError,
  );
  assert.throws(() => startActiveTransition({ durationMs: 0 }), RangeError);
  assert.throws(() => startActiveTransition({ durationMs: -100 }), RangeError);
  assert.throws(() => startActiveTransition({ startedAtMs: Number.NaN }), RangeError);
  assert.throws(() => startActiveTransition({ progress: 1.2 }), RangeError);
  assert.throws(() => startActiveTransition({ outgoingIndex: 5 }), RangeError);
  assert.throws(() => startActiveTransition({ incomingIndex: 5 }), RangeError);
  assert.throws(
    () => startActiveTransition({ outgoing: track(999) }),
    /does not match active queue entry/,
  );
  assert.throws(
    () => startActiveTransition({ incoming: track(999) }),
    /does not match queue entry/,
  );

  const id = startActiveTransition();
  assert.throws(() => state()._updateTransitionProgress(0, 0.5), RangeError);
  assert.throws(() => state()._updateTransitionProgress(id, -0.1), RangeError);
  assert.throws(() => state()._updateTransitionProgress(id, Number.NaN), RangeError);
  assert.throws(() => state()._rescheduleTransitionTiming(id, 0, 0, 0.5), RangeError);
  assert.throws(() => state()._cancelTransition(-1), RangeError);
});

test("live transition clock bridge and resolveTransitionProgress handle live 60fps, frozen snapshots, and errors", () => {
  const tr = { id: 7, progress: 0.42 };

  // Without an active audio engine clock (e.g. unit test or frozen Playwright snapshot):
  // returns transition.progress verbatim without drifting.
  assert.equal(readLiveTransitionClock(), null);
  assert.equal(resolveTransitionProgress(tr), 0.42);

  // With a matching live audio clock registered by PlaybackEngine:
  const unregister = registerLiveTransitionClock(() => ({
    id: 7,
    progress: 0.73,
    remainingMs: 1620,
  }));
  try {
    assert.deepEqual(readLiveTransitionClock(), { id: 7, progress: 0.73, remainingMs: 1620 });
    assert.equal(resolveTransitionProgress(tr), 0.73);
    // Non-matching transition ID falls back to that transition's own progress snapshot.
    assert.equal(resolveTransitionProgress({ id: 8, progress: 0.25 }), 0.25);

    // Registering a newer reader means unregistering the older one leaves the newer one intact.
    const unregisterNewer = registerLiveTransitionClock(() => ({
      id: 7,
      progress: 0.88,
      remainingMs: 720,
    }));
    unregister();
    assert.equal(resolveTransitionProgress(tr), 0.88);
    unregisterNewer();
    assert.equal(readLiveTransitionClock(), null);
  } finally {
    unregister();
  }

  // Fail loud on invalid progress values.
  assert.throws(() => resolveTransitionProgress({ id: 7, progress: -0.01 }, null), RangeError);
  assert.throws(() => resolveTransitionProgress({ id: 7, progress: Number.NaN }, null), RangeError);
  assert.throws(
    () => resolveTransitionProgress(tr, { id: 7, progress: 1.5, remainingMs: 0 }),
    RangeError,
  );
});

test("classifyCrossfadePlan distinguishes plain crossfade from cue-aware smart-crossfade and fails loud on invalid bounds", () => {
  const plain = computeCueAwareCrossfade({
    configuredCrossfadeSec: 6,
    outgoingDurationSec: 200,
  });
  assert.equal(
    classifyCrossfadePlan({ configuredCrossfadeSec: 6, outgoingDurationSec: 200, plan: plain }),
    "crossfade",
  );

  const outroSmart = computeCueAwareCrossfade({
    configuredCrossfadeSec: 6,
    outgoingDurationSec: 200,
    outgoingOutroStartSec: 192,
  });
  assert.equal(
    classifyCrossfadePlan({ configuredCrossfadeSec: 6, outgoingDurationSec: 200, plan: outroSmart }),
    "smart-crossfade",
  );

  const introSmart = computeCueAwareCrossfade({
    configuredCrossfadeSec: 6,
    outgoingDurationSec: 200,
    incomingIntroEndSec: 1.8,
  });
  assert.equal(
    classifyCrossfadePlan({ configuredCrossfadeSec: 6, outgoingDurationSec: 200, plan: introSmart }),
    "smart-crossfade",
  );

  assert.throws(
    () => classifyCrossfadePlan({ configuredCrossfadeSec: 0, outgoingDurationSec: 200, plan: plain }),
    RangeError,
  );
  assert.throws(
    () => classifyCrossfadePlan({ configuredCrossfadeSec: 6, outgoingDurationSec: 0, plan: plain }),
    RangeError,
  );
});

test("computeRescheduledCrossfadeTiming keeps progress continuous when playbackRate changes mid-crossfade", () => {
  // 6s crossfade at 1x, halfway through at t=13000 (started at 10000). Switch to 2x speed:
  // remaining 3 media sec take 1.5 wall sec; progress stays 0.5 at nowMs and reaches 1.0 at nowMs + 1500ms.
  const spedUp = computeRescheduledCrossfadeTiming({
    fadeMediaSec: 6,
    remainingMediaSec: 3,
    playbackRate: 2,
    startedAtMs: 10_000,
    durationSec: 6,
    nowMs: 13_000,
  });
  assert.equal(spedUp.completed, false);
  assert.ok(Math.abs(spedUp.progress - 0.5) < 1e-9);
  assert.ok(Math.abs(spedUp.remainingWallSec - 1.5) < 1e-9);
  assert.ok(Math.abs(spedUp.durationSec - 3.0) < 1e-9);
  assert.ok(Math.abs((13_000 - spedUp.startedAtMs) / (spedUp.durationSec * 1000) - 0.5) < 1e-9);
  assert.ok(Math.abs((14_500 - spedUp.startedAtMs) / (spedUp.durationSec * 1000) - 1.0) < 1e-9);

  // Slowing down to 0.75x extends remaining 3 media sec to 4 wall sec with zero jump at nowMs.
  const slowedDown = computeRescheduledCrossfadeTiming({
    fadeMediaSec: 6,
    remainingMediaSec: 3,
    playbackRate: 0.75,
    startedAtMs: 10_000,
    durationSec: 6,
    nowMs: 13_000,
  });
  assert.equal(slowedDown.completed, false);
  assert.ok(Math.abs(slowedDown.remainingWallSec - 4.0) < 1e-9);
  assert.ok(
    Math.abs((13_000 - slowedDown.startedAtMs) / (slowedDown.durationSec * 1000) - 0.5) < 1e-9,
  );
  assert.ok(
    Math.abs((17_000 - slowedDown.startedAtMs) / (slowedDown.durationSec * 1000) - 1.0) < 1e-9,
  );

  // Already past completion marks completed=true.
  const done = computeRescheduledCrossfadeTiming({
    fadeMediaSec: 6,
    remainingMediaSec: 0.05,
    playbackRate: 2,
    startedAtMs: 10_000,
    durationSec: 6,
    nowMs: 16_000,
  });
  assert.equal(done.completed, true);
  assert.equal(done.progress, 1);

  assert.throws(
    () =>
      computeRescheduledCrossfadeTiming({
        fadeMediaSec: 0,
        remainingMediaSec: 3,
        playbackRate: 1,
        startedAtMs: 0,
        durationSec: 6,
        nowMs: 1000,
      }),
    RangeError,
  );
});
