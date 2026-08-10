"use client";

import { useState } from "react";
import { useLocalJson } from "@/hooks/useLocalJson";
import { streamUrl } from "@/lib/api";
import { refreshDownloadedTracks } from "@/store/downloads";
import { toast } from "@/store/toast";
import type { Track } from "@/types";

const AUDIO_CACHE = "sf-audio";
const IMG_CACHE = "sf-img";

interface DownloadEntry {
  name: string;
  total: number;
  // Cached track ids, so removal can keep tracks shared with other downloaded
  // playlists. Entries from before this field existed may lack it.
  trackIds?: string[];
}

const EMPTY: Record<string, DownloadEntry> = {};

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
    "sf_downloads",
    EMPTY,
  );
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  const supported = typeof caches !== "undefined";

  async function downloadPlaylist(id: string, name: string, tracks: Track[]) {
    if (!supported || !tracks.length) return;
    const audio = await caches.open(AUDIO_CACHE);
    const img = await caches.open(IMG_CACHE);
    setProgress({ id, done: 0, total: tracks.length });
    let done = 0;
    // Collect failures instead of skipping silently — a playlist is only
    // marked "offline" when every track really made it into the cache.
    const failed: string[] = [];
    for (const t of tracks) {
      try {
        const u = streamUrl(String(t.id));
        if (!(await audio.match(u))) {
          const r = await fetch(u, { credentials: "include" });
          if (!r.ok) {
            throw new Error(`Server ${r.status}`);
          }
          await audio.put(u, r);
        }
        if (t.cover && !(await img.match(t.cover))) {
          try {
            const cr = await fetch(t.cover, { mode: "no-cors" });
            await img.put(t.cover, cr);
          } catch {
            /* cover optional */
          }
        }
      } catch {
        failed.push(t.title);
      }
      done += 1;
      setProgress({ id, done, total: tracks.length });
    }
    if (failed.length === 0) {
      // Functional update: the download ran for minutes — merge into the
      // *current* stored value, not the snapshot from when it started.
      setDownloads((current) => ({
        ...current,
        [id]: {
          name,
          total: tracks.length,
          trackIds: tracks.map((t) => String(t.id)),
        },
      }));
      toast.success(`„${name}“ ist jetzt offline verfügbar.`);
    } else {
      toast.error(
        `${failed.length} von ${tracks.length} Titeln konnten nicht heruntergeladen werden` +
          ` (z. B. „${failed[0]}“). „${name}“ ist nicht vollständig offline.`,
      );
    }
    setProgress(null);
    void refreshDownloadedTracks();
  }

  async function removeDownload(id: string, tracks: Track[]) {
    if (supported) {
      // Keep audio that another downloaded playlist still references.
      const keep = new Set<string>();
      for (const [otherId, entry] of Object.entries(downloads)) {
        if (otherId === id) continue;
        for (const tid of entry.trackIds ?? []) keep.add(tid);
      }
      const audio = await caches.open(AUDIO_CACHE);
      for (const t of tracks) {
        if (keep.has(String(t.id))) continue;
        try {
          await audio.delete(streamUrl(String(t.id)));
        } catch {
          /* ignore */
        }
      }
    }
    setDownloads((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    void refreshDownloadedTracks();
  }

  return {
    supported,
    downloads,
    isDownloaded: (id: string) => !!downloads[id],
    downloadPlaylist,
    removeDownload,
    progress,
  };
}
