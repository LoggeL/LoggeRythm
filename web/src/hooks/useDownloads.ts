"use client";

import { useState } from "react";
import { useLocalJson } from "@/hooks/useLocalJson";
import { streamUrl } from "@/lib/api";
import type { Track } from "@/types";

const AUDIO_CACHE = "sf-audio";
const IMG_CACHE = "sf-img";
const EMPTY: Record<string, { name: string; total: number }> = {};

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
  const [downloads, setDownloads] =
    useLocalJson<Record<string, { name: string; total: number }>>(
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
    for (const t of tracks) {
      try {
        const u = streamUrl(String(t.id));
        if (!(await audio.match(u))) {
          const r = await fetch(u, { credentials: "include" });
          if (r.ok) await audio.put(u, r);
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
        /* skip a failed track, keep going */
      }
      done += 1;
      setProgress({ id, done, total: tracks.length });
    }
    setDownloads({ ...downloads, [id]: { name, total: tracks.length } });
    setProgress(null);
  }

  async function removeDownload(id: string, tracks: Track[]) {
    if (supported) {
      const audio = await caches.open(AUDIO_CACHE);
      for (const t of tracks) {
        try {
          await audio.delete(streamUrl(String(t.id)));
        } catch {
          /* ignore */
        }
      }
    }
    const next = { ...downloads };
    delete next[id];
    setDownloads(next);
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
