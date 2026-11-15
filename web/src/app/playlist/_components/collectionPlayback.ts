import type { Track } from "@/types";
import type { QueueOrigin } from "@/store/player";

interface QueueSlice {
  index: number;
  queue: readonly Track[];
  origins: readonly QueueOrigin[];
  queueContext: string | null;
}

/**
 * Whether the player's queue was started from this collection. The queue label
 * is only a display name — an album, its artist and a playlist can share one —
 * so the queue's own tracks (manually queued extras aside) must also all
 * belong to the collection.
 */
export function isCollectionQueue(player: QueueSlice, context: string, tracks: readonly Track[]): boolean {
  if (player.index < 0 || player.queueContext !== context) return false;
  const members = new Set(tracks.map((track) => String(track.id)));
  const fromContext = player.queue.filter((_, position) => player.origins[position] === "context");
  return fromContext.length > 0 && fromContext.every((track) => members.has(String(track.id)));
}
