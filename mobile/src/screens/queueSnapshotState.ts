export interface QueueSnapshotQueryState {
  /** At least one native snapshot has completed successfully, including empty. */
  hasSnapshot: boolean;
  empty: boolean;
  refreshing: boolean;
  error: unknown;
}

export type QueueSnapshotBody = 'loading' | 'hard-error' | 'empty' | 'content';
export type QueueSnapshotNotice = 'refreshing' | 'cached-refresh-error' | null;

export interface QueueSnapshotVisualState {
  body: QueueSnapshotBody;
  notice: QueueSnapshotNotice;
}

/**
 * Native queue reads are synchronous, but the bridge/service can still fail.
 * A first-read failure is blocking; later failures must retain the last-good
 * queue (including a known-empty queue) and appear only as a retryable notice.
 */
export function resolveQueueSnapshotVisualState(
  state: QueueSnapshotQueryState,
): QueueSnapshotVisualState {
  if (!state.hasSnapshot) {
    if (state.error !== null && state.error !== undefined) {
      return { body: 'hard-error', notice: null };
    }
    return { body: 'loading', notice: null };
  }

  const body: QueueSnapshotBody = state.empty ? 'empty' : 'content';
  if (state.error !== null && state.error !== undefined) {
    return { body, notice: 'cached-refresh-error' };
  }
  if (state.refreshing) return { body, notice: 'refreshing' };
  return { body, notice: null };
}
