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
  ) => Promise<void>;
}

function nonEmpty(value: string | number, label: string): string {
  const normalized = String(value).trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

/**
 * Materialize the complete persisted history before replacing the queue.
 * Mapping each occurrence independently keeps newest-first order and duplicate
 * plays intact even when the catalog cache shares the resolved Track object.
 */
export async function startRecentlyHeardPlayback({
  recent,
  startIndex,
  contextId,
  contextLabel,
  resolveTrack,
  startPlayback,
}: RecentlyHeardPlaybackRequest): Promise<void> {
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
  const tracks = await Promise.all(ids.map((id) => resolveTrack(id)));

  await startPlayback(tracks, startIndex, {
    context: { type: 'recent', id: accountContextId, label },
  });
}
