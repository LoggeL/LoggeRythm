import type { Track } from "@/types";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { toast } from "@/store/toast";

/**
 * Start an endless song-radio seeded by a single track: the seed plays first,
 * then a similar-tracks mix, and PlayerBar keeps topping the queue up while
 * `radioActive` is set. Surfaces a clear error toast on failure — never fails
 * silently.
 */
export async function startTrackRadio(track: Track): Promise<void> {
  try {
    const tracks = await api.radio(String(track.id));
    const store = usePlayerStore.getState();
    store.playQueue([track, ...tracks], 0, `Radio – ${track.title}`);
    store.setRadioActive(true);
    toast.info("Radio gestartet…");
  } catch {
    toast.error("Radio konnte nicht gestartet werden.");
  }
}

/**
 * Play an already-fetched track list as an endless radio station (mood/genre
 * stations). The list seeds the queue and `radioActive` keeps it flowing.
 */
export function startTrackListRadio(tracks: Track[], context: string): void {
  if (!tracks.length) {
    toast.error("Für dieses Radio wurden keine Titel gefunden.");
    return;
  }
  const store = usePlayerStore.getState();
  store.playQueue(tracks, 0, context);
  store.setRadioActive(true);
  toast.info(`${context} gestartet…`);
}
