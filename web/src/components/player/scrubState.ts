/** A thumb position the listener is holding, tied to the track it was made on. */
export interface ScrubDrag {
  value: number;
  trackKey: string;
}

/** Identifies the playing queue entry; null while nothing is loaded. */
export function scrubTrackKey(state: { index: number; queue: readonly { id: string | number }[] }): string | null {
  const track = state.queue[state.index];
  return track ? `${state.index}:${String(track.id)}` : null;
}

/**
 * The position a held drag applies to the playing track, or null when there is
 * nothing to apply. A drag made on another track is void: its seconds belong to
 * the track that has since ended, not to the one playing now.
 */
export function heldPosition(drag: ScrubDrag | null, trackKey: string | null): number | null {
  return drag !== null && drag.trackKey === trackKey ? drag.value : null;
}
