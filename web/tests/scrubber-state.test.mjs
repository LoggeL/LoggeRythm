import assert from "node:assert/strict";
import test from "node:test";
import { heldPosition, scrubTrackKey } from "../src/components/player/scrubState.ts";

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
