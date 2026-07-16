/**
 * Product queue contract v1.
 *
 * The normative rules and cross-client golden cases live in
 * `contracts/product-queue.v1.json`. This module is the browser engine used by
 * the player store for every product queue mutation covered by that contract.
 */
export const PRODUCT_QUEUE_CONTRACT_ID = "loggerythm.product-queue.v1";
export type QueueOrigin = "manual" | "context";

export interface ProductQueueState<T> {
  queue: T[];
  origins: QueueOrigin[];
  originalQueue: T[];
  originalOrigins: QueueOrigin[];
  index: number;
  shuffle: boolean;
}

function assertParallel<T>(
  queue: readonly T[],
  origins: readonly QueueOrigin[],
  label: string,
): void {
  if (queue.length !== origins.length) {
    throw new Error(
      `${label} has ${queue.length} items but ${origins.length} origin values`,
    );
  }
  origins.forEach((origin, index) => {
    if (origin !== "manual" && origin !== "context") {
      throw new Error(`${label} item ${index} has invalid queue origin ${String(origin)}`);
    }
  });
}

function requireActiveIndex<T>(state: ProductQueueState<T>): number {
  assertParallel(state.queue, state.origins, "Queue");
  assertParallel(state.originalQueue, state.originalOrigins, "Original queue");
  if (
    !Number.isInteger(state.index) ||
    state.index < 0 ||
    state.index >= state.queue.length
  ) {
    throw new Error(
      `Queue active index ${state.index} is outside a ${state.queue.length}-item queue`,
    );
  }
  return state.index;
}

/** Upcoming manual items must form one section before upcoming context items. */
export function assertManualQueuePriority<T>(
  queue: readonly T[],
  origins: readonly QueueOrigin[],
  activeIndex: number,
): void {
  assertParallel(queue, origins, "Queue");
  let contextIndex: number | null = null;
  for (let index = activeIndex + 1; index < queue.length; index += 1) {
    if (origins[index] === "context") {
      contextIndex ??= index;
    } else if (contextIndex !== null) {
      throw new Error(
        `Manual queue priority is invalid: manual item ${index} follows context item ${contextIndex}`,
      );
    }
  }
}

function manualTailIndex<T>(
  queue: readonly T[],
  origins: readonly QueueOrigin[],
  activeIndex: number,
): number {
  assertManualQueuePriority(queue, origins, activeIndex);
  for (let index = activeIndex + 1; index < queue.length; index += 1) {
    if (origins[index] === "context") return index;
  }
  return queue.length;
}

function insertManualInto<T>(
  queue: readonly T[],
  origins: readonly QueueOrigin[],
  activeIndex: number,
  item: T,
  placement: "next" | "tail",
): { queue: T[]; origins: QueueOrigin[] } {
  const at =
    placement === "next"
      ? activeIndex + 1
      : manualTailIndex(queue, origins, activeIndex);
  const nextQueue = [...queue];
  const nextOrigins = [...origins];
  nextQueue.splice(at, 0, item);
  nextOrigins.splice(at, 0, "manual");
  return { queue: nextQueue, origins: nextOrigins };
}

/** Apply Play next or Add to queue to both live and canonical queue state. */
export function insertManualItem<T>(
  state: ProductQueueState<T>,
  item: T,
  placement: "next" | "tail",
): ProductQueueState<T> {
  const activeIndex = requireActiveIndex(state);
  assertManualQueuePriority(state.queue, state.origins, activeIndex);
  const activeItem = state.queue[activeIndex];
  const originalActiveIndex = state.originalQueue.indexOf(activeItem);
  if (originalActiveIndex < 0) {
    throw new Error("Original queue does not contain the active queue item");
  }

  const live = insertManualInto(
    state.queue,
    state.origins,
    activeIndex,
    item,
    placement,
  );
  const original = insertManualInto(
    state.originalQueue,
    state.originalOrigins,
    originalActiveIndex,
    item,
    placement,
  );
  return {
    ...state,
    queue: live.queue,
    origins: live.origins,
    originalQueue: original.queue,
    originalOrigins: original.origins,
  };
}

function requireIndex<T>(queue: readonly T[], index: number, operation: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
    throw new Error(
      `${operation} index ${index} is outside a ${queue.length}-item queue`,
    );
  }
}

/** Remove a non-active item while retaining the exact active object. */
export function removeQueueItem<T>(
  state: ProductQueueState<T>,
  removeIndex: number,
): ProductQueueState<T> {
  const activeIndex = requireActiveIndex(state);
  requireIndex(state.queue, removeIndex, "Remove");
  if (removeIndex === activeIndex) {
    throw new Error("The active queue item cannot be removed");
  }
  const activeItem = state.queue[activeIndex];
  const removedItem = state.queue[removeIndex];
  const originalRemoveIndex = state.originalQueue.indexOf(removedItem);
  if (originalRemoveIndex < 0) {
    throw new Error("Original queue does not contain the removed queue item");
  }

  const queue = state.queue.filter((_item, index) => index !== removeIndex);
  const origins = state.origins.filter((_origin, index) => index !== removeIndex);
  const originalQueue = state.originalQueue.filter(
    (_item, index) => index !== originalRemoveIndex,
  );
  const originalOrigins = state.originalOrigins.filter(
    (_origin, index) => index !== originalRemoveIndex,
  );
  const index = queue.indexOf(activeItem);
  if (index < 0) throw new Error("Queue removal lost the active queue item");
  assertManualQueuePriority(queue, origins, index);
  return {
    ...state,
    queue,
    origins,
    originalQueue,
    originalOrigins,
    index,
  };
}

function moveInParallel<T>(
  queue: readonly T[],
  origins: readonly QueueOrigin[],
  fromIndex: number,
  toIndex: number,
): { queue: T[]; origins: QueueOrigin[] } {
  const nextQueue = [...queue];
  const nextOrigins = [...origins];
  const [movedItem] = nextQueue.splice(fromIndex, 1);
  const [movedOrigin] = nextOrigins.splice(fromIndex, 1);
  nextQueue.splice(toIndex, 0, movedItem);
  nextOrigins.splice(toIndex, 0, movedOrigin);
  return { queue: nextQueue, origins: nextOrigins };
}

/** Move only inside one side of current and one upcoming origin section. */
export function moveQueueItem<T>(
  state: ProductQueueState<T>,
  fromIndex: number,
  toIndex: number,
): ProductQueueState<T> {
  const activeIndex = requireActiveIndex(state);
  requireIndex(state.queue, fromIndex, "Move");
  requireIndex(state.queue, toIndex, "Move destination");
  if (fromIndex === toIndex) return state;
  if (fromIndex === activeIndex || toIndex === activeIndex) {
    throw new Error("The active queue item cannot be moved");
  }
  if ((fromIndex < activeIndex) !== (toIndex < activeIndex)) {
    throw new Error("Queue items cannot be moved across the active queue item");
  }
  if (
    fromIndex > activeIndex &&
    toIndex > activeIndex &&
    state.origins[fromIndex] !== state.origins[toIndex]
  ) {
    throw new Error("Queue items cannot be moved across the manual/context boundary");
  }

  const live = moveInParallel(
    state.queue,
    state.origins,
    fromIndex,
    toIndex,
  );
  assertManualQueuePriority(live.queue, live.origins, activeIndex);
  return { ...state, queue: live.queue, origins: live.origins };
}

/** Clear future items only; history and the active item remain addressable. */
export function clearUpcomingItems<T>(
  state: ProductQueueState<T>,
): ProductQueueState<T> {
  const activeIndex = requireActiveIndex(state);
  const queue = state.queue.slice(0, activeIndex + 1);
  const origins = state.origins.slice(0, activeIndex + 1);
  return {
    ...state,
    queue,
    origins,
    originalQueue: [...queue],
    originalOrigins: [...origins],
    shuffle: false,
  };
}

function upcomingContextIndexes<T>(state: ProductQueueState<T>): number[] {
  const activeIndex = requireActiveIndex(state);
  assertManualQueuePriority(state.queue, state.origins, activeIndex);
  const indexes: number[] = [];
  for (let index = activeIndex + 1; index < state.queue.length; index += 1) {
    if (state.origins[index] === "context") indexes.push(index);
  }
  return indexes;
}

function shuffleUpcomingContext<T>(
  state: ProductQueueState<T>,
  random: () => number,
): T[] {
  const indexes = upcomingContextIndexes(state);
  const context = indexes.map((index) => state.queue[index]);
  for (let index = context.length - 1; index > 0; index -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error(`Queue shuffle random source returned ${String(sample)}`);
    }
    const swapIndex = Math.floor(sample * (index + 1));
    [context[index], context[swapIndex]] = [context[swapIndex], context[index]];
  }
  const queue = [...state.queue];
  indexes.forEach((queueIndex, index) => {
    queue[queueIndex] = context[index];
  });
  return queue;
}

function restoreUpcomingContext<T>(state: ProductQueueState<T>): T[] {
  const indexes = upcomingContextIndexes(state);
  const canonicalRank = new Map<T, number>();
  state.originalQueue.forEach((item, index) => {
    if (state.originalOrigins[index] !== "context") return;
    if (canonicalRank.has(item)) {
      throw new Error("Original queue contains the same context item more than once");
    }
    canonicalRank.set(item, index);
  });
  const ranked = indexes.map((queueIndex, currentIndex) => ({
    item: state.queue[queueIndex],
    currentIndex,
  }));
  ranked.sort((left, right) => {
    const leftRank = canonicalRank.get(left.item);
    const rightRank = canonicalRank.get(right.item);
    if (leftRank === undefined) {
      throw new Error("Original queue does not contain an upcoming context item");
    }
    if (rightRank === undefined) {
      throw new Error("Original queue does not contain an upcoming context item");
    }
    return leftRank - rightRank || left.currentIndex - right.currentIndex;
  });
  const queue = [...state.queue];
  indexes.forEach((queueIndex, index) => {
    queue[queueIndex] = ranked[index].item;
  });
  return queue;
}

/** Toggle context-only shuffle without moving history, current, or manual items. */
export function toggleQueueShuffle<T>(
  state: ProductQueueState<T>,
  random: () => number = Math.random,
): ProductQueueState<T> {
  if (state.queue.length === 0) return { ...state, shuffle: !state.shuffle };
  requireActiveIndex(state);
  const queue = state.shuffle
    ? restoreUpcomingContext(state)
    : shuffleUpcomingContext(state, random);
  const activeItem = state.queue[state.index];
  const index = queue.indexOf(activeItem);
  if (index !== state.index) {
    throw new Error("Queue shuffle moved the active queue item");
  }
  return { ...state, queue, shuffle: !state.shuffle };
}
