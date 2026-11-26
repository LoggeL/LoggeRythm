import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTrackSwap,
  initialTrackSwapState,
  nextTrackSwapState,
  settleTrackSwap,
  settleTrackSwapArrival,
  trackSwapNeighbour,
  trackSwapSlot,
  trackSwapStyle,
} from "../src/lib/trackSwap.ts";

/** Entry `index` of a queue `${prefix}0…${prefix}${length - 1}`, optionally playing another id there. */
const slot = (index, length = 5, repeat = "off", id = `t${index}`, prefix = "t") => {
  const queue = Array.from({ length }, (_, i) => ({ id: i === index ? id : `${prefix}${i}` }));
  return trackSwapSlot(
    id,
    index,
    length,
    trackSwapNeighbour(queue, index, repeat, -1),
    trackSwapNeighbour(queue, index, repeat, 1),
  );
};

test("neighbours slide in their direction of travel, autoplay appends count as forward", () => {
  assert.equal(classifyTrackSwap(slot(2), slot(3)), "forward");
  assert.equal(classifyTrackSwap(slot(3), slot(2)), "backward");
  assert.equal(classifyTrackSwap(slot(4, 5), slot(5, 25)), "forward");
});

test("repeat-all wraps are steps; a two-track wrap reads as forward", () => {
  assert.equal(classifyTrackSwap(slot(4, 5, "all"), slot(0, 5, "all")), "forward");
  assert.equal(classifyTrackSwap(slot(0, 5, "all"), slot(4, 5, "all")), "backward");
  assert.equal(classifyTrackSwap(slot(1, 2, "all"), slot(0, 2, "all")), "forward");
  assert.equal(classifyTrackSwap(slot(4, 5), slot(0, 5)), "replace");
});

test("queue jumps and new queues settle in place; the same song elsewhere is no change", () => {
  assert.equal(classifyTrackSwap(slot(1), slot(4)), "replace");
  assert.equal(classifyTrackSwap(slot(3, 5), slot(0, 2, "off", "x")), "replace");
  assert.equal(classifyTrackSwap(slot(3), slot(2, 5, "off", "t3")), "none");
  assert.equal(classifyTrackSwap(slot(1), slot(1)), "none");
});

test("a new queue that merely starts one position away cross-fades instead of sliding", () => {
  // Playing t0 of one playlist, then starting another playlist at its second track.
  assert.equal(classifyTrackSwap(slot(0, 10), slot(1, 20, "off", "u1", "u")), "replace");
  // Radio started from index 0 while index 1 of an album played.
  assert.equal(classifyTrackSwap(slot(1, 10), slot(0, 30, "off", "r0", "r")), "replace");
});

test("a song queued twice around the new entry reads its direction from the position", () => {
  const queue = [{ id: "a" }, { id: "b" }, { id: "a" }];
  const at = (index) => trackSwapSlot(
    queue[index].id,
    index,
    queue.length,
    trackSwapNeighbour(queue, index, "off", -1),
    trackSwapNeighbour(queue, index, "off", 1),
  );
  assert.equal(classifyTrackSwap(at(2), at(1)), "backward");
  assert.equal(classifyTrackSwap(at(0), at(1)), "forward");
});

test("neighbours wrap only under repeat-all", () => {
  const queue = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.equal(trackSwapNeighbour(queue, 0, "off", -1), null);
  assert.equal(trackSwapNeighbour(queue, 0, "all", -1), "3");
  assert.equal(trackSwapNeighbour(queue, 2, "one", 1), null);
  assert.equal(trackSwapNeighbour(queue, 2, "all", 1), "1");
  assert.equal(trackSwapNeighbour(queue, -1, "all", 1), null);
  assert.throws(() => trackSwapNeighbour(queue, 3, "off", 1), /index 3 is outside a 3-track queue/);
});

test("slots fail loudly on impossible queue positions", () => {
  assert.equal(trackSwapSlot(null, -1, 0, null, null), null);
  assert.throws(() => trackSwapSlot("a", 5, 5, null, null), /index 5 is outside a 5-track queue/);
  assert.throws(() => trackSwapSlot("a", 0, 0, null, null), /queue length/);
});

test("state keeps the previous copy as a ghost until its own morph-out ends", () => {
  const first = { id: "t0", title: "Zero" };
  const second = { id: "t1", title: "One" };
  const third = { id: "t2", title: "Two" };
  let state = initialTrackSwapState(slot(0), first);
  assert.equal(state.ghost, null);
  assert.equal(state.arrival, null);
  assert.equal(nextTrackSwapState(state, slot(0), first), state, "unchanged renders keep identity");

  state = nextTrackSwapState(state, slot(1), second);
  assert.equal(state.arrival, "forward");
  assert.deepEqual(state.ghost, { id: 1, item: first, change: "forward" });

  // A quick second skip keeps the leaving copy undisturbed; only the incoming copy changes.
  state = nextTrackSwapState(state, slot(2), third);
  assert.deepEqual(state.ghost, { id: 1, item: first, change: "forward" });
  assert.equal(state.item, third);
  assert.equal(state.sequence, 2);
  assert.equal(settleTrackSwap(state, 2), state, "an unknown ghost id is ignored");
  state = settleTrackSwap(state, 1);
  assert.equal(state.ghost, null);
  assert.equal(state.arrival, "forward", "the newer arrival keeps running");

  // The first arrival's late end is ignored; the current one clears the mark.
  assert.equal(settleTrackSwapArrival(state, 1), state);
  state = settleTrackSwapArrival(state, 2);
  assert.equal(state.arrival, null);
  assert.equal(settleTrackSwapArrival(state, 2), state, "settling twice keeps identity");

  // The next change starts a fresh ghost from what is showing now.
  state = nextTrackSwapState(state, slot(1), second);
  assert.deepEqual(state.ghost, { id: 3, item: third, change: "backward" });
});

test("a reordered queue keeps the same entry still and slides to its new neighbour", () => {
  const at = (ids, index) => trackSwapSlot(
    ids[index].id,
    index,
    ids.length,
    trackSwapNeighbour(ids, index, "off", -1),
    trackSwapNeighbour(ids, index, "off", 1),
  );
  const before = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const after = [{ id: "a" }, { id: "b" }, { id: "d" }, { id: "c" }]; // d moved up next to b
  const track = { id: "b" };
  let state = initialTrackSwapState(at(before, 1), track);
  const reordered = at(after, 1);
  state = nextTrackSwapState(state, reordered, track);
  assert.equal(state.slot, reordered);
  assert.equal(state.ghost, null);
  assert.equal(nextTrackSwapState(state, at(after, 1), track), state, "an equal slot keeps identity");
  state = nextTrackSwapState(state, at(after, 2), { id: "d" });
  assert.equal(state.arrival, "forward");
});

test("appearing, disappearing and metadata updates never animate", () => {
  const track = { id: "t0" };
  let state = initialTrackSwapState(null, null);
  state = nextTrackSwapState(state, slot(0), track);
  assert.equal(state.ghost, null);
  const renamed = { id: "t0", title: "Renamed" };
  state = nextTrackSwapState(state, slot(0), renamed);
  assert.equal(state.item, renamed);
  assert.equal(state.ghost, null);
  state = nextTrackSwapState(state, null, null);
  assert.equal(state.ghost, null);
});

test("style variables point the slide and only replacements scale", () => {
  assert.deepEqual(trackSwapStyle("forward"), { "--swap-dir": "1", "--swap-scale": "1" });
  assert.deepEqual(trackSwapStyle("backward"), { "--swap-dir": "-1", "--swap-scale": "1" });
  assert.deepEqual(trackSwapStyle("replace"), { "--swap-dir": "0", "--swap-scale": "0.96" });
});
