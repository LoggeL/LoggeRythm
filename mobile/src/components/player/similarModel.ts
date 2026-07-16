import type { Track } from '../../api/types';
import type { PlayTracksOptions } from '../../player/controller';

export interface SimilarPlaybackSelection {
  /** Defensive copy of the complete ordered result owned by this seed. */
  tracks: Track[];
  startIndex: number;
  options: PlayTracksOptions;
}

function nonEmpty(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (normalized.length === 0) throw new Error(`${label} must not be empty`);
  return normalized;
}

/**
 * Build the finite queue used by the web Similar surface.
 *
 * The `radio` context describes where the recommendations came from, while
 * `radio: false` is deliberate: opening Similar plays exactly the returned
 * ordered result and must not silently turn it into endless song radio.
 */
export function similarPlaybackSelection(
  seed: Pick<Track, 'id'>,
  tracks: readonly Track[],
  startIndex: number,
  contextLabel: string,
): SimilarPlaybackSelection {
  const seedId = nonEmpty(seed.id, 'similar seed id');
  const label = nonEmpty(contextLabel, 'similar context label');
  if (tracks.length === 0) {
    throw new Error('Similar playback requires at least one track');
  }
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= tracks.length) {
    throw new Error(
      `Similar playback index ${startIndex} is outside a ${tracks.length}-track result`,
    );
  }

  return {
    tracks: [...tracks],
    startIndex,
    options: {
      radio: false,
      context: {
        type: 'radio',
        id: `similar:${seedId}`,
        label,
      },
    },
  };
}

/** Old rendered rows must never act after the Now Playing seed changes. */
export function ownsSimilarSeed(renderedSeedId: string, currentSeedId: string): boolean {
  return renderedSeedId === currentSeedId;
}
