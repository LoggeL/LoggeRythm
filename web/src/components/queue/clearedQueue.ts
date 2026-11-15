import { usePlayerStore } from "@/store/player";

type PlayerSnapshot = ReturnType<typeof usePlayerStore.getState>;

/** Everything `clearQueue()` changes, as it was just before the queue was cleared. */
export interface ClearedQueue {
  trackId: string;
  index: number;
  state: Pick<PlayerSnapshot, "queue" | "origins" | "originalQueue" | "originalOrigins" | "queueContext" | "shuffle">;
  radioActive: boolean;
}

/**
 * Clears the upcoming queue and returns what was removed, or null when there
 * was nothing after the playing track to bring back.
 */
export function clearQueueForUndo(): ClearedQueue | null {
  const before = usePlayerStore.getState();
  const playing = before.queue[before.index];
  before.clearQueue();
  if (!playing || before.queue.length <= before.index + 1) return null;
  return {
    trackId: String(playing.id),
    index: before.index,
    state: {
      queue: before.queue,
      origins: before.origins,
      originalQueue: before.originalQueue,
      originalOrigins: before.originalOrigins,
      queueContext: before.queueContext,
      shuffle: before.shuffle,
    },
    radioActive: before.radioActive,
  };
}

/** True while the cleared queue can be put back without clobbering newer changes. */
export function isClearedQueueRestorable(cleared: ClearedQueue, state: Pick<PlayerSnapshot, "queue" | "index">): boolean {
  return state.index === cleared.index && state.queue.length === state.index + 1 && String(state.queue[state.index]?.id) === cleared.trackId;
}

/**
 * Puts a cleared queue back, including the shuffle mode its order belongs to
 * and a running radio station, which gets a fresh session so it keeps filling
 * the queue.
 */
export function restoreClearedQueue(cleared: ClearedQueue): void {
  const current = usePlayerStore.getState();
  if (!isClearedQueueRestorable(cleared, current)) {
    throw new Error("Die geleerte Warteschlange passt nicht mehr zur laufenden Wiedergabe und kann nicht wiederhergestellt werden.");
  }
  usePlayerStore.setState(cleared.state);
  if (cleared.radioActive) usePlayerStore.getState().setRadioActive(true);
}
