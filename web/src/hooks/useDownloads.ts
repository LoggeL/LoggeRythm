"use client";

import { useState } from "react";
import { useLocalJson } from "@/hooks/useLocalJson";
import { streamUrl } from "@/lib/api";
import { refreshDownloadedTracks } from "@/store/downloads";
import { toast } from "@/store/toast";
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
      setDownloads({ ...downloads, [id]: { name, total: tracks.length } });
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
