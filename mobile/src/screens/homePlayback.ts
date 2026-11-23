import type { DeezerId, Track } from '../api/types';
import type { RecentPlay } from '../domain/listeningStats';
import type { PlayTracksOptions } from '../player/controller';

export interface RecentlyHeardPlaybackRequest {
  recent: readonly RecentPlay[];
  startIndex: number;
  contextId: string | number;
  contextLabel: string;
  resolveTrack: (id: DeezerId) => Promise<Track>;
  startPlayback: (
    tracks: Track[],
    startIndex: number,
    options: PlayTracksOptions,
  ) => Promise<unknown>;
  /** Optional synchronous cache lookup so a warm history starts the full context in 0ms. */
  getCachedTrack?: (id: DeezerId) => Track | undefined;
  /** Optional fast path to toggle play/pause when the tapped track is already active. */
  toggleActiveTrack?: (trackId: DeezerId) => boolean;
  /**
   * Optional non-blocking background hook invoked with remaining unique history IDs
   * after playback of the tapped track has already started.
   */
  hydrateRemaining?: (
    remainingIds: readonly DeezerId[],
    tappedTrack: Track,
  ) => Promise<void> | void;
  /** Loud reporter for failures thrown by `hydrateRemaining` (never swallowed). */
  onHydrationError?: (error: unknown) => void;
}

export type RecentlyHeardPlaybackOutcome =
  | 'toggled-current'
  | 'started-cached-context'
  | 'started-immediate';

function nonEmpty(value: string | number, label: string): string {
  const normalized = String(value).trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

function uniqueRemainingIds(ids: readonly DeezerId[], startIndex: number): DeezerId[] {
  const seen = new Set<DeezerId>([ids[startIndex]]);
  const remaining: DeezerId[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (seen.has(id)) continue;
    seen.add(id);
    remaining.push(id);
  }
  return remaining;
}

/**
 * Start Recently Heard playback without blocking on a full-history waterfall.
 *
 * - If the tapped track is already active and `toggleActiveTrack` handles it,
 *   play/pause toggles synchronously with zero network requests.
 * - If every history entry is already in the synchronous catalog cache, the
 *   complete duplicate-preserving context starts immediately with zero requests.
 * - Otherwise, only the tapped track is resolved before playback starts (failing
 *   loudly if that lookup fails), and remaining unique IDs are handed to the
 *   non-blocking `hydrateRemaining` hook so subsequent taps are instant.
 */
export async function startRecentlyHeardPlayback({
  recent,
  startIndex,
  contextId,
  contextLabel,
  resolveTrack,
  startPlayback,
  getCachedTrack,
  toggleActiveTrack,
  hydrateRemaining,
  onHydrationError,
}: RecentlyHeardPlaybackRequest): Promise<RecentlyHeardPlaybackOutcome> {
  if (recent.length === 0) {
    throw new Error('Recently Heard playback requires at least one history entry');
  }
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= recent.length) {
    throw new Error(
      `Recently Heard start index ${String(startIndex)} is outside a ${recent.length}-track context`,
    );
  }
  const accountContextId = nonEmpty(contextId, 'Recently Heard context id');
  const label = nonEmpty(contextLabel, 'Recently Heard context label');
  const ids = recent.map((play, index) =>
    nonEmpty(play.id, `Recently Heard track id at index ${index}`),
  );
  const tappedId = ids[startIndex];

  if (toggleActiveTrack?.(tappedId) === true) {
    return 'toggled-current';
  }

  const context = { type: 'recent' as const, id: accountContextId, label };

  if (getCachedTrack !== undefined) {
    const cachedTracks: Track[] = [];
    let allCached = true;
    for (const id of ids) {
      const cached = getCachedTrack(id);
      if (cached === undefined) {
        allCached = false;
        break;
      }
      cachedTracks.push(cached);
    }
    if (allCached) {
      await startPlayback(cachedTracks, startIndex, { context });
      return 'started-cached-context';
    }
  }

  const tappedTrack = await resolveTrack(tappedId);
  await startPlayback([tappedTrack], 0, { context });

  if (hydrateRemaining !== undefined) {
    const remainingIds = uniqueRemainingIds(ids, startIndex);
    if (remainingIds.length > 0) {
      void Promise.resolve()
        .then(() => hydrateRemaining(remainingIds, tappedTrack))
        .catch((error: unknown) => {
          console.error('Recently Heard background hydration failed', error);
          onHydrationError?.(error);
        });
    }
  }

  return 'started-immediate';
}
