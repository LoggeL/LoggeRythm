"use client";

import { useLocalJson } from "@/hooks/useLocalJson";
import type { Track } from "@/types";

const RECENT_TRACKS_KEY = "sf_recent_tracks";
const EMPTY_TRACKS: Track[] = [];

/** Label of the queue that plays the local listening history. */
export const RECENT_QUEUE_CONTEXT = "Zuletzt gehört";

/**
 * The listening history the player keeps on this device, newest first.
 * A stored value that is not a list is a corrupted history and fails loudly.
 */
export function useRecentTracks(): Track[] {
  const [recent] = useLocalJson<Track[]>(RECENT_TRACKS_KEY, EMPTY_TRACKS);
  if (!Array.isArray(recent)) {
    throw new Error(`Der gespeicherte Hörverlauf in localStorage "${RECENT_TRACKS_KEY}" enthält keine gültige Titelliste.`);
  }
  return recent;
}
