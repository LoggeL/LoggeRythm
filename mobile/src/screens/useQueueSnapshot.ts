import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../api/types';
import { getQueueSnapshot, isContextShuffleEnabled } from '../player/controller';
import { mediaItemToTrack } from '../player/mediaItem';
import Player, { Event } from '../player/player';
import {
  queueContextOf,
  queueOriginalContextOrderOf,
  queueOriginOf,
  queueStableIdOf,
  type QueueContextMetadata,
  type QueueOrigin,
} from '../player/queueContract';

export interface QueueSnapshotRow {
  stableId: string;
  origin: QueueOrigin;
  context: QueueContextMetadata | null;
  originalContextOrder: number | null;
  track: Track;
}

export interface QueueSnapshot {
  rows: QueueSnapshotRow[];
  activeIndex: number | null;
}

export interface QueueSnapshotStatus {
  /** At least one native read succeeded, including a known-empty queue. */
  hasSnapshot: boolean;
  refreshing: boolean;
  error: unknown;
}

export interface QueueSnapshotController {
  queue: QueueSnapshot;
  status: QueueSnapshotStatus;
  shuffle: boolean;
  setShuffle: (enabled: boolean) => void;
  refresh: () => void;
}

/**
 * Owns the validated copy of the native queue for one surface. It re-reads on
 * queue changes and item transitions, keeps the last-good rows when a later
 * read fails, and reports every malformed item as an error instead of
 * dropping or patching it.
 */
export function useQueueSnapshot(): QueueSnapshotController {
  const [queue, setQueue] = useState<QueueSnapshot>({ rows: [], activeIndex: null });
  const [status, setStatus] = useState<QueueSnapshotStatus>({
    hasSnapshot: false,
    refreshing: false,
    error: null,
  });
  const [shuffle, setShuffle] = useState(isContextShuffleEnabled);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    setStatus((current) => ({ ...current, refreshing: true, error: null }));
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      try {
        const snapshot = getQueueSnapshot();
        const stableIds = new Set<string>();
        const rows = snapshot.items.map((item, index) => {
          if (typeof item.mediaId !== 'string' || item.mediaId.length === 0) {
            throw new Error(`Queue item ${index} has no mediaId`);
          }
          const track = mediaItemToTrack(item);
          if (track === null) throw new Error(`Queue item ${index} has no Track metadata`);
          const stableId = queueStableIdOf(item);
          if (stableIds.has(stableId)) {
            throw new Error(`Queue item ${index} has duplicate stable id ${stableId}`);
          }
          stableIds.add(stableId);
          return {
            stableId,
            origin: queueOriginOf(item),
            context: queueContextOf(item),
            originalContextOrder: queueOriginalContextOrderOf(item),
            track,
          };
        });
        setQueue({ rows, activeIndex: snapshot.activeIndex });
        setShuffle(isContextShuffleEnabled());
        setStatus({ hasSnapshot: true, refreshing: false, error: null });
      } catch (cause) {
        setStatus((current) => ({ ...current, refreshing: false, error: cause }));
      }
    }, 0);
  }, []);

  useEffect(() => {
    refresh();
    const queueSubscription = Player.addEventListener(Event.QueueChanged, refresh);
    const transitionSubscription = Player.addEventListener(Event.MediaItemTransition, refresh);
    return () => {
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
      queueSubscription.remove();
      transitionSubscription.remove();
    };
  }, [refresh]);

  return { queue, status, shuffle, setShuffle, refresh };
}
