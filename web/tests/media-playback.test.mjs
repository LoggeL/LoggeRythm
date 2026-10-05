import assert from "node:assert/strict";
import test from "node:test";

import { playWithMediaRecovery } from "../src/lib/mediaPlayback.ts";

function audioDeck({ failed = false, currentTime = 48, paused = true } = {}) {
  const calls = [];
  return {
    calls,
    error: failed ? { code: 4, message: "Source unavailable" } : null,
    dataset: { trackId: "same-track" },
    src: "/api/stream/same-track",
    currentTime,
    paused,
    load() {
      calls.push("load");
      this.error = null;
      this.currentTime = 0;
      this.paused = true;
    },
    play() {
      calls.push("play");
      if (this.error) return Promise.reject(new DOMException("Source unavailable", "NotSupportedError"));
      this.paused = false;
      return Promise.resolve();
    },
  };
}

test("explicit Play recovers an exhausted same-track MediaError by reloading before play", async () => {
  const deck = audioDeck({ failed: true });
  await assert.rejects(deck.play(), { name: "NotSupportedError" });
  let retries = 2;
  await playWithMediaRecovery(deck, () => {
    deck.calls.push("reset retry readiness");
    retries = 0;
  });
  assert.deepEqual(deck.calls, ["play", "reset retry readiness", "load", "play"]);
  assert.equal(retries, 0);
  assert.equal(deck.paused, false);
  assert.equal(deck.dataset.trackId, "same-track");
  assert.equal(deck.src, "/api/stream/same-track");
});

test("explicit same-ID replay reloads a failed physical deck even when already marked playing", async () => {
  const deck = audioDeck({ failed: true, paused: false });
  await playWithMediaRecovery(deck, () => deck.calls.push("reset retry readiness"));
  assert.deepEqual(deck.calls, ["reset retry readiness", "load", "play"]);
  assert.equal(deck.currentTime, 0);
  assert.equal(deck.paused, false);
});

for (const [scenario, currentTime, paused] of [
  ["healthy pause/resume", 48, true],
  ["healthy same-ID duplicate replay after its requested seek", 0, true],
  ["promoted crossfade incoming deck", 4.5, false],
]) {
  test(`${scenario} preserves the physical source and clock without a recovery reload`, async () => {
    const deck = audioDeck({ currentTime, paused });
    await playWithMediaRecovery(deck, () => assert.fail("Healthy decks must not reset retry readiness"));
    assert.deepEqual(deck.calls, ["play"]);
    assert.equal(deck.currentTime, currentTime);
    assert.equal(deck.src, "/api/stream/same-track");
  });
}

test("a failed retry still rejects with its cause instead of reporting recovery", async () => {
  const deck = audioDeck({ failed: true });
  deck.load = () => deck.calls.push("load");
  await assert.rejects(playWithMediaRecovery(deck, () => {}), { name: "NotSupportedError" });
  assert.deepEqual(deck.calls, ["load", "play"]);
  assert.equal(deck.paused, true);
});
