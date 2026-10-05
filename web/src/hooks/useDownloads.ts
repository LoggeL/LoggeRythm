"use client";

import { useRef, useState } from "react";
import { readLocalJsonSnapshot, useLocalJson } from "@/hooks/useLocalJson";
import { assertDownloadEntries, cachePlaylistTracks, clearOfflineCaches, removePlaylistAudio, resolveLegacyDownloadEntries, type DownloadEntry } from "@/lib/offlineDownloads";
import { api } from "@/lib/api";
import { refreshDownloadedTracks } from "@/store/downloads";
import { toast } from "@/store/toast";
import type { Track } from "@/types";

const STORAGE_KEY = "sf_downloads";
const EMPTY: Record<string, DownloadEntry> = {};

async function refreshAfterFailure(cause: unknown): Promise<never> {
  try {
    await refreshDownloadedTracks();
  } catch (refreshError) {
    throw new AggregateError([cause, refreshError], `${cause instanceof Error ? cause.message : String(cause)}; ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
  }
  throw cause;
}

export interface DownloadProgress {
  id: string;
  done: number;
  total: number;
}

/**
 * Offline downloads: caches a playlist's track audio (+ covers) into Cache
 * Storage so the service worker can serve them offline. Downloaded playlist
 * ids are remembered in localStorage.
 */
export function useDownloads() {
  const [downloads, setDownloads] = useLocalJson<Record<string, DownloadEntry>>(
    STORAGE_KEY,
    EMPTY,
  );
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const activeOperation = useRef(false);
  assertDownloadEntries(downloads);

  const supported = typeof caches !== "undefined";

  async function downloadPlaylist(id: string, name: string, tracks: Track[]) {
    if (activeOperation.current) throw new Error("Ein Offline-Download wird bereits verarbeitet.");
    activeOperation.current = true;
    setProgress({ id, done: 0, total: tracks.length });
    try {
      const trackIds = await cachePlaylistTracks(tracks, (done) => setProgress({ id, done, total: tracks.length }));
      setDownloads((current) => ({
        ...current,
        [id]: { name, total: tracks.length, trackIds },
      }));
      await refreshDownloadedTracks();
      toast.success(`„${name}“ ist jetzt offline verfügbar.`);
    } catch (cause) {
      await refreshAfterFailure(cause);
    } finally {
      activeOperation.current = false;
      setProgress(null);
    }
  }

  async function removeDownload(id: string, tracks?: Track[]) {
    if (activeOperation.current) throw new Error("Ein Offline-Download wird bereits verarbeitet.");
    activeOperation.current = true;
    try {
      const current = readLocalJsonSnapshot(STORAGE_KEY, EMPTY);
      const indexed = await resolveLegacyDownloadEntries(current, async (legacyId) => {
        if (legacyId === id && tracks) return tracks;
        const playlist = await api.playlist(legacyId);
        return playlist.tracks;
      });
      if (indexed !== current) {
        setDownloads((latest) => {
          const next = { ...latest };
          for (const [legacyId, entry] of Object.entries(indexed)) {
            if (next[legacyId] && !next[legacyId].trackIds) next[legacyId] = { ...next[legacyId], trackIds: entry.trackIds };
          }
          return next;
        });
      }
      await removePlaylistAudio(id, readLocalJsonSnapshot(STORAGE_KEY, EMPTY));
      setDownloads((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      await refreshDownloadedTracks();
    } catch (cause) {
      await refreshAfterFailure(cause);
    } finally {
      activeOperation.current = false;
    }
  }

  async function clearAllDownloads() {
    if (activeOperation.current) throw new Error("Ein Offline-Download wird bereits verarbeitet.");
    if (!supported) throw new Error("Dieser Browser unterstützt keine Offline-Downloads.");
    activeOperation.current = true;
    try {
      await clearOfflineCaches(() => setDownloads({}));
      await refreshDownloadedTracks();
    } catch (cause) {
      await refreshAfterFailure(cause);
    } finally {
      activeOperation.current = false;
    }
  }

  return {
    supported,
    downloads,
    isDownloaded: (id: string) => !!downloads[id],
    downloadPlaylist,
    removeDownload,
    clearAllDownloads,
    progress,
  };
}
