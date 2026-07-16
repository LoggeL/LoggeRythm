"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/api";

const AUDIO_CACHE = "sf-audio";
// Stream URLs look like `.../tracks/{id}/stream` — pull the id back out.
const TRACK_ID_RE = /\/tracks\/([^/]+)\/stream/;

/**
 * Two levels of availability for a track:
 * - "local"  → cached in the browser's "sf-audio" Cache, plays fully offline.
 * - "server" → stored on the server, streams without re-fetching from Deezer.
 */
export type TrackCacheState = "local" | "server" | null;

interface DownloadedState {
  /** Ids cached on this device (offline-capable). */
  ids: Set<string>;
  loaded: boolean;
  /** Ids stored on the server. */
  serverIds: Set<string>;
  serverLoaded: boolean;
  refresh: () => Promise<void>;
  refreshServer: () => Promise<void>;
}

let inflight: Promise<void> | null = null;
let serverInflight: Promise<void> | null = null;

/**
 * Tracks which individual songs are cached, locally and on the server, so every
 * TrackRow can cheaply show an availability marker. Local downloads live in the
 * "sf-audio" Cache keyed by stream URL (see useDownloads); the server set comes
 * from the API. Both sets are read once and shared.
 */
export const useDownloadedTracks = create<DownloadedState>((set) => ({
  ids: new Set<string>(),
  loaded: false,
  serverIds: new Set<string>(),
  serverLoaded: false,
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
  refreshServer: () => {
    if (serverInflight) return serverInflight;
    serverInflight = (async () => {
      try {
        const { ids } = await api.cachedTracks();
        set({ serverIds: new Set(ids.map(String)), serverLoaded: true });
      } catch {
        set({ serverLoaded: true });
      }
    })().finally(() => {
      serverInflight = null;
    });
    return serverInflight;
  },
}));

/** Re-read the local cached-track set; call after a download or removal. */
export function refreshDownloadedTracks() {
  return useDownloadedTracks.getState().refresh();
}

/** Re-read the server cached-track set; call after a track is first streamed. */
export function refreshServerCachedTracks() {
  return useDownloadedTracks.getState().refreshServer();
}

/**
 * Availability of a single track: "local" (offline on this device) takes
 * precedence over "server" (stored server-side). Lazily loads both sets once.
 */
export function useTrackCacheState(trackId: string | number): TrackCacheState {
  const id = String(trackId);
  const loaded = useDownloadedTracks((s) => s.loaded);
  const serverLoaded = useDownloadedTracks((s) => s.serverLoaded);
  const refresh = useDownloadedTracks((s) => s.refresh);
  const refreshServer = useDownloadedTracks((s) => s.refreshServer);
  const local = useDownloadedTracks((s) => s.ids.has(id));
  const onServer = useDownloadedTracks((s) => s.serverIds.has(id));
  useEffect(() => {
    if (!loaded) void refresh();
    if (!serverLoaded) void refreshServer();
  }, [loaded, serverLoaded, refresh, refreshServer]);
  return local ? "local" : onServer ? "server" : null;
}

/** Whether a single track is available offline on this device. */
export function useTrackDownloaded(trackId: string | number): boolean {
  return useTrackCacheState(trackId) === "local";
}
