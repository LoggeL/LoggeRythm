import { useMemo } from 'react';
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
  const context = item === null ? null : queueContextOf(item);
  const radioId = context !== null && context.type === 'radio' ? context.id : null;
  const radioLabel = context !== null && context.type === 'radio' ? context.label : null;
  return useMemo(
    () => (radioId === null ? null : { id: radioId, label: radioLabel, playing }),
    [radioId, radioLabel, playing],
  );
}
