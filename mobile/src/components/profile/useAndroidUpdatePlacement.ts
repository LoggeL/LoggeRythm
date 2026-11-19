import { useState } from 'react';
import {
  androidUpdateNeedsAttention,
  androidUpdateStore,
  type AndroidUpdateSnapshot,
} from '../../update/androidUpdateStore';

/** Where the profile shows its one update card. */
export type AndroidUpdateCardPlacement = 'top' | 'bottom';

/**
 * `top` (directly below the profile header) while something waits for the
 * user: an installable update, or a final failure of this process not yet
 * acknowledged. `bottom` (above the danger zone) in every other state.
 */
export function androidUpdateCardPlacement(snapshot: AndroidUpdateSnapshot): AndroidUpdateCardPlacement {
  return androidUpdateNeedsAttention(snapshot) ? 'top' : 'bottom';
}

/**
 * The update card's slot for one profile visit: decided from the store's
 * state when the profile mounts and kept until it unmounts, whatever the
 * state turns into meanwhile. A card that moved while the user works with it
 * (a re-check, an install that starts or fails) would unmount under the
 * finger and lose TalkBack focus. The header dot follows the live state; the
 * next visit picks the slot again.
 */
export function useAndroidUpdatePlacement(): AndroidUpdateCardPlacement {
  const [placement] = useState(() => androidUpdateCardPlacement(androidUpdateStore.getSnapshot()));
  return placement;
}
