"use client";

import { useEffect } from "react";
import { create } from "zustand";

const AUDIO_CACHE = "sf-audio";
// Stream URLs look like `.../tracks/{id}/stream` — pull the id back out.
const TRACK_ID_RE = /\/tracks\/([^/]+)\/stream/;

interface DownloadedState {
  ids: Set<string>;
  loaded: boolean;
  refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

/**
 * Tracks which individual songs are cached for offline playback. Downloads are
 * stored in the "sf-audio" Cache keyed by stream URL (see useDownloads); this
 * store reads those cache keys once and shares the resulting id set so every
 * TrackRow can cheaply show a "downloaded" marker.
 */
export const useDownloadedTracks = create<DownloadedState>((set) => ({
  ids: new Set<string>(),
  loaded: false,
  refresh: () => {
    if (inflight) return inflight;
    inflight = (async () => {
      if (typeof caches === "undefined") {
        set({ loaded: true });
        return;
      }
      try {
        const cache = await caches.open(AUDIO_CACHE);
        const reqs = await cache.keys();
        const ids = new Set<string>();
        for (const req of reqs) {
          const m = req.url.match(TRACK_ID_RE);
          if (m) ids.add(decodeURIComponent(m[1]));
        }
        set({ ids, loaded: true });
      } catch {
        set({ loaded: true });
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  },
}));

/** Re-read the cached-track set; call after a download or removal completes. */
export function refreshDownloadedTracks() {
  return useDownloadedTracks.getState().refresh();
}

/** Whether a single track is available offline. Lazily loads the set once. */
export function useTrackDownloaded(trackId: string | number): boolean {
  const id = String(trackId);
  const loaded = useDownloadedTracks((s) => s.loaded);
  const refresh = useDownloadedTracks((s) => s.refresh);
  const downloaded = useDownloadedTracks((s) => s.ids.has(id));
  useEffect(() => {
    if (!loaded) void refresh();
  }, [loaded, refresh]);
  return downloaded;
}
