import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PRODUCT_QUEUE_CONTRACT_ID,
  clearUpcomingItems,
  insertManualItem,
  moveQueueItem,
  removeQueueItem,
  toggleQueueShuffle,
} from "../src/store/queuePolicy.ts";

const contractUrl = new URL(
  "../../contracts/product-queue.v1.json",
  import.meta.url,
);
const contract = JSON.parse(await readFile(contractUrl, "utf8"));

function stateFrom(initial) {
  const queue = initial.items.map((item) => ({ ...item }));
  const index = queue.findIndex((item) => item.id === initial.active);
  assert.notEqual(index, -1, `fixture active item ${initial.active} is missing`);
  const origins = queue.map((item) => item.origin);
  return {
    queue,
    origins,
    originalQueue: [...queue],
    originalOrigins: [...origins],
    index,
    shuffle: false,
  };
}

function itemIndex(state, id) {
  const matches = state.queue
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.id === id);
  assert.equal(matches.length, 1, `fixture item ${id} must be unique`);
  return matches[0].index;
}

function randomSource(samples = []) {
  let index = 0;
  const random = () => {
    assert.ok(index < samples.length, "fixture shuffle exhausted its random samples");
    return samples[index++];
  };
  random.assertConsumed = () => {
    assert.equal(index, samples.length, "fixture shuffle left unused random samples");
  };
  return random;
}

function applyStep(state, step) {
  if (step.operation === "add" || step.operation === "play-next") {
    assert.equal(step.item.origin, "manual");
    return insertManualItem(
      state,
      { ...step.item },
      step.operation === "play-next" ? "next" : "tail",
    );
  }
  if (step.operation === "toggle-shuffle") {
    const random = randomSource(step.random);
    const next = toggleQueueShuffle(state, random);
    random.assertConsumed();
    return next;
  }
  if (step.operation === "move") {
    return moveQueueItem(
      state,
      itemIndex(state, step.from),
      itemIndex(state, step.to),
    );
  }
  if (step.operation === "remove") {
    return removeQueueItem(state, itemIndex(state, step.itemId));
  }
  if (step.operation === "clear-upcoming") return clearUpcomingItems(state);
  throw new Error(`Unsupported golden queue operation ${step.operation}`);
}

function errorCode(error) {
  assert.ok(error instanceof Error);
  if (error.message.includes("manual/context boundary")) {
    return "manual-context-boundary";
  }
  if (error.message.includes("active queue item")) return "active-item";
  throw error;
}

function snapshot(state) {
  return {
    items: state.queue.map((item) => item.id),
    origins: [...state.origins],
    active: state.queue[state.index]?.id,
    shuffle: state.shuffle,
  };
}

function assertActiveExactlyOnce(state, expectedActive) {
  assert.equal(state.queue[state.index]?.id, expectedActive);
  assert.equal(
    state.queue.filter((item) => item.id === expectedActive).length,
    1,
    `active item ${expectedActive} was duplicated or lost`,
  );
}

test("browser engine passes every shared product queue v1 golden case", () => {
  assert.equal(contract.$id, PRODUCT_QUEUE_CONTRACT_ID);
  assert.equal(contract.version, 1);
  assert.deepEqual(contract.origins, ["manual", "context"]);
  assert.deepEqual(contract.rules.sections, ["history", "current", "manual", "context"]);
  assert.deepEqual(contract.rules.upcomingOrder, ["manual", "context"]);
  assert.ok(contract.cases.length > 0);

  for (const goldenCase of contract.cases) {
    let state = stateFrom(goldenCase.initial);
    assertActiveExactlyOnce(state, goldenCase.initial.active);
    for (const step of goldenCase.steps) {
      if (step.expectedError) {
        const before = snapshot(state);
        assert.throws(
          () => applyStep(state, step),
          (error) => errorCode(error) === step.expectedError,
          `${goldenCase.id}: ${step.operation}`,
        );
        assert.deepEqual(snapshot(state), before, `${goldenCase.id}: failed mutation changed state`);
      } else {
        state = applyStep(state, step);
        assert.deepEqual(
          snapshot(state),
          step.expected,
          `${goldenCase.id}: ${step.operation}`,
        );
      }
      assertActiveExactlyOnce(state, goldenCase.initial.active);
    }
  }
});
