"use client";

import { useEffect, useState } from "react";
import { usePlayerStore } from "@/store/player";
import { clearQueueForUndo, isClearedQueueRestorable, restoreClearedQueue, type ClearedQueue } from "./clearedQueue";

const UNDO_WINDOW_MS = 8000;

/**
 * Clears the upcoming queue and keeps the removed entries for a few seconds so
 * the listener can take it back. Undo is only offered while the same track is
 * still playing and nothing new was queued; otherwise restoring would clobber
 * newer changes.
 */
export function useClearQueueWithUndo() {
  const [cleared, setCleared] = useState<ClearedQueue | null>(null);
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const partyActive = usePlayerStore((s) => s.partyBridge !== null);

  const stillRestorable = cleared !== null && isClearedQueueRestorable(cleared, { queue, index });

  useEffect(() => {
    if (!cleared) return;
    const timer = window.setTimeout(() => setCleared(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [cleared]);

  const clear = () => setCleared(clearQueueForUndo());

  const undo = () => {
    if (!cleared || !stillRestorable) return;
    restoreClearedQueue(cleared);
    setCleared(null);
  };

  return {
    /** Shared party queues are host-managed and cannot be cleared here. */
    canClear: !partyActive,
    clear,
    undo: stillRestorable ? undo : null,
    clearedCount: stillRestorable && cleared ? cleared.state.queue.length - cleared.index - 1 : 0,
  };
}
