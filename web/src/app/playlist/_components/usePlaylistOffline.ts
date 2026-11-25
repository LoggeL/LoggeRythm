"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMe } from "@/hooks/useAuth";
import { useDownloads } from "@/hooks/useDownloads";
import { api } from "@/lib/api";
import type { DownloadKind } from "@/lib/offlineDownloads";
import { toast } from "@/store/toast";
import type { Track } from "@/types";

const NUMERIC_ID_RE = /^\d+$/;

/**
 * Offline download state of one collection (playlist, liked songs, or album)
 * and the action that toggles it. For server playlists, fetches a lightweight
 * sync-manifest preview so the button can display estimated size before download.
 */
export function usePlaylistOffline(
  id: string,
  name: string,
  tracks: Track[],
  options: { kind?: DownloadKind; cover?: string } = {},
) {
  const { data: me } = useMe();
  const { isDownloaded, downloadCollection, downloadPlaylist, removeDownload, progress, supported } = useDownloads();
  const running = useRef(false);
  const [pending, setPending] = useState<"download" | "remove" | null>(null);
  const downloaded = isDownloaded(id);
  const kind = options.kind ?? "playlist";

  const previewQuery = useQuery({
    queryKey: ["playlist-sync-preview", id],
    queryFn: () => api.playlistSyncManifest(id, { include_lyrics: false, preload: false }),
    enabled: Boolean(
      me?.is_approved &&
        supported &&
        !downloaded &&
        kind === "playlist" &&
        NUMERIC_ID_RE.test(id) &&
        tracks.length > 0,
    ),
    staleTime: 60_000,
    retry: false,
  });

  async function toggle() {
    if (running.current) return;
    const removing = downloaded;
    running.current = true;
    setPending(removing ? "remove" : "download");
    try {
      if (removing) {
        await removeDownload(id, tracks);
        toast.info("Offline-Download entfernt.");
      } else {
        toast.info("Download gestartet…");
        if (downloadCollection) {
          await downloadCollection(id, name, tracks, options);
        } else {
          await downloadPlaylist(id, name, tracks);
        }
      }
    } catch (error) {
      toast.error(
        `Offline-Download konnte nicht ${removing ? "entfernt" : "gespeichert"} werden: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running.current = false;
      setPending(null);
    }
  }

  return {
    /** False when the browser has no Cache Storage. */
    supported,
    downloaded,
    pending,
    progress: progress && progress.id === id ? progress : null,
    sizePreviewBytes: previewQuery.data?.total_known_bytes ?? null,
    toggle,
  };
}
