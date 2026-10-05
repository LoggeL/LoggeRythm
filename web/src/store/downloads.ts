"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";

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
  error: Error | null;
  /** Ids stored on the server. */
  serverIds: Set<string>;
  serverLoaded: boolean;
  serverError: Error | null;
  refresh: () => Promise<void>;
  refreshServer: () => Promise<void>;
}

let inflight: Promise<void> | null = null;
let serverInflight: Promise<void> | null = null;
const reportedFailures = new WeakSet<Error>();

/** Many visible track rows share each load; show its failure once. */
export function reportTrackCacheFailure(error: Error): void {
  if (reportedFailures.has(error)) return;
  reportedFailures.add(error);
  toast.error(error.message);
}

/**
 * Tracks which individual songs are cached, locally and on the server, so every
 * TrackRow can cheaply show an availability marker. Local downloads live in the
 * "sf-audio" Cache keyed by stream URL (see useDownloads); the server set comes
 * from the API. Both sets are read once and shared.
 */
export const useDownloadedTracks = create<DownloadedState>((set) => ({
  ids: new Set<string>(),
  loaded: false,
  error: null,
  serverIds: new Set<string>(),
  serverLoaded: false,
  serverError: null,
  refresh: () => {
    if (inflight) return inflight;
    set({ error: null });
    inflight = (async () => {
      if (typeof caches === "undefined") {
        set({ ids: new Set<string>(), loaded: true });
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
      } catch (cause) {
        const error = new Error(`Offline-Cache konnte nicht gelesen werden: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
        set({ error });
        throw error;
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  },
  refreshServer: () => {
    if (serverInflight) return serverInflight;
    set({ serverError: null });
    serverInflight = (async () => {
      try {
        const { ids } = await api.cachedTracks();
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || id.trim() === "")) {
          throw new Error("API /cached-tracks: Eine Liste gültiger Titel-IDs wurde erwartet.");
        }
        set({ serverIds: new Set(ids.map(String)), serverLoaded: true });
      } catch (cause) {
        const serverError = new Error(`Server-Cache konnte nicht geladen werden: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
        set({ serverError });
        throw serverError;
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
  const error = useDownloadedTracks((s) => s.error);
  const serverError = useDownloadedTracks((s) => s.serverError);
  const refresh = useDownloadedTracks((s) => s.refresh);
  const refreshServer = useDownloadedTracks((s) => s.refreshServer);
  const local = useDownloadedTracks((s) => s.ids.has(id));
  const onServer = useDownloadedTracks((s) => s.serverIds.has(id));
  useEffect(() => {
    // The store records a failed attempt, preventing render-driven retry loops.
    // Every marker can expose that state and trigger an explicit retry.
    if (!loaded && !error) void refresh().catch(reportTrackCacheFailure);
    if (!serverLoaded && !serverError) void refreshServer().catch(reportTrackCacheFailure);
  }, [loaded, serverLoaded, error, serverError, refresh, refreshServer]);
  return local ? "local" : onServer ? "server" : null;
}

export function useTrackCacheError(): string | null {
  const error = useDownloadedTracks((s) => s.error);
  const serverError = useDownloadedTracks((s) => s.serverError);
  const messages = [error, serverError].filter((cause): cause is Error => cause !== null).map((cause) => cause.message);
  return messages.length > 0 ? messages.join("; ") : null;
}

export async function retryTrackCacheStatus(): Promise<void> {
  const state = useDownloadedTracks.getState();
  await Promise.all([
    ...(state.error ? [state.refresh()] : []),
    ...(state.serverError ? [state.refreshServer()] : []),
  ]);
}

/** Whether a single track is available offline on this device. */
export function useTrackDownloaded(trackId: string | number): boolean {
  return useTrackCacheState(trackId) === "local";
}
