import { useActiveMediaItem, useIsPlaying } from '../../player/player';
import { queueContextOf } from '../../player/queueContract';

export interface OnAirStation {
  /** Queue-context id: `mood:<tag>`, `genre:<id>` or the seed track id. */
  id: string;
  label: string | null;
  playing: boolean;
}

/** The radio station the loaded queue was started from, or null when the queue is not a radio. */
export function useOnAirStation(): OnAirStation | null {
  const item = useActiveMediaItem();
  const playing = useIsPlaying();
  if (item === null) return null;
  const context = queueContextOf(item);
  if (context === null || context.type !== 'radio') return null;
  return { id: context.id, label: context.label, playing };
}
