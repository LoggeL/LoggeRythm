"use client";

import { useRef, useState } from "react";
import { readLocalJsonSnapshot, useLocalJson } from "@/hooks/useLocalJson";
import {
  DOWNLOADS_STORAGE_KEY,
  assertDownloadEntries,
  cachePlaylistTracks,
  clearOfflineCaches,
  removePlaylistAudio,
  resolveLegacyDownloadEntries,
  type DownloadEntry,
  type DownloadKind,
} from "@/lib/offlineDownloads";
import { cacheOfflineLyricsMap } from "@/lib/offlineLyrics";
import { api } from "@/lib/api";
import { refreshDownloadedTracks } from "@/store/downloads";
import { toast } from "@/store/toast";
import type { Track } from "@/types";

const NUMERIC_ID_RE = /^\d+$/;

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

function compactTrackSnapshot(track: Track): Track {
  return {
    id: String(track.id),
    title: track.title,
    artist: track.artist,
    ...(track.artist_id !== undefined ? { artist_id: track.artist_id } : {}),
    ...(track.artists ? { artists: track.artists } : {}),
    album: track.album,
    ...(track.album_id !== undefined ? { album_id: track.album_id } : {}),
    cover: track.cover,
    duration_sec: track.duration_sec,
    ...(track.loudness_gain_db !== undefined ? { loudness_gain_db: track.loudness_gain_db } : {}),
    ...(track.loudness_lufs !== undefined ? { loudness_lufs: track.loudness_lufs } : {}),
    ...(track.loudness_peak !== undefined ? { loudness_peak: track.loudness_peak } : {}),
  };
}

/**
 * Offline downloads: caches a collection's track audio (+ covers) into Cache
 * Storage and stores a full `Track[]` snapshot in localStorage so downloaded
 * playlists, liked songs, and albums play cleanly in full Airplane Mode.
 */
export function useDownloads() {
  const [downloads, setDownloads] = useLocalJson<Record<string, DownloadEntry>>(
    DOWNLOADS_STORAGE_KEY,
    EMPTY,
  );
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const activeOperation = useRef(false);
  assertDownloadEntries(downloads);

  const supported = typeof caches !== "undefined";

  async function downloadCollection(
    id: string,
    name: string,
    tracks: Track[],
    options: { kind?: DownloadKind; cover?: string } = {},
  ) {
    if (activeOperation.current) throw new Error("Ein Offline-Download wird bereits verarbeitet.");
    activeOperation.current = true;
    setProgress({ id, done: 0, total: tracks.length });
    try {
      const kind = options.kind ?? "playlist";
      let revision: number | undefined;
      let lyricsCount = 0;

      // For server playlists, fetch the sync manifest (including offline lyrics)
      // so unchanged revisions skip redundant work and cached lyrics work offline.
      if (kind === "playlist" && NUMERIC_ID_RE.test(id)) {
        const manifest = await api.playlistSyncManifest(id, {
          include_lyrics: true,
          preload: true,
        });
        revision = manifest.revision;
        if (manifest.lyrics) {
          lyricsCount = await cacheOfflineLyricsMap(manifest.lyrics);
        }
        const existing = readLocalJsonSnapshot(DOWNLOADS_STORAGE_KEY, EMPTY)[id];
        if (
          existing &&
          existing.revision !== undefined &&
          existing.revision === manifest.revision &&
          existing.tracks &&
          existing.tracks.length === tracks.length
        ) {
          await refreshDownloadedTracks();
          toast.info(`„${name}“ ist bereits offline aktuell.`);
          return;
        }
      }

      const trackIds = await cachePlaylistTracks(tracks, (done) => setProgress({ id, done, total: tracks.length }));
      const cover = options.cover ?? tracks.find((t) => t.cover)?.cover ?? "";
      setDownloads((current) => ({
        ...current,
        [id]: {
          name,
          total: tracks.length,
          kind,
          cover,
          ...(revision !== undefined ? { revision } : {}),
          trackIds,
          tracks: tracks.map(compactTrackSnapshot),
        },
      }));
      await refreshDownloadedTracks();
      toast.success(
        lyricsCount > 0
          ? `„${name}“ inkl. ${lyricsCount} Songtexten ist jetzt offline verfügbar.`
          : `„${name}“ ist jetzt offline verfügbar.`,
      );
    } catch (cause) {
      await refreshAfterFailure(cause);
    } finally {
      activeOperation.current = false;
      setProgress(null);
    }
  }

  async function downloadPlaylist(id: string, name: string, tracks: Track[]) {
    return downloadCollection(id, name, tracks, { kind: "playlist" });
  }

  async function removeDownload(id: string, tracks?: Track[]) {
    if (activeOperation.current) throw new Error("Ein Offline-Download wird bereits verarbeitet.");
    activeOperation.current = true;
    try {
      const current = readLocalJsonSnapshot(DOWNLOADS_STORAGE_KEY, EMPTY);
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
      await removePlaylistAudio(id, readLocalJsonSnapshot(DOWNLOADS_STORAGE_KEY, EMPTY));
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
    downloadCollection,
    downloadPlaylist,
    removeDownload,
    clearAllDownloads,
    progress,
  };
}
