"use client";

import { useRef, useState } from "react";
import { useDownloads } from "@/hooks/useDownloads";
import { toast } from "@/store/toast";
import type { Track } from "@/types";

/**
 * Offline download state of one playlist and the action that toggles it.
 * Only one download or removal runs at a time; failures are reported with
 * their cause.
 */
export function usePlaylistOffline(id: string, name: string, tracks: Track[]) {
  const { isDownloaded, downloadPlaylist, removeDownload, progress, supported } = useDownloads();
  const running = useRef(false);
  const [pending, setPending] = useState<"download" | "remove" | null>(null);
  const downloaded = isDownloaded(id);

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
        await downloadPlaylist(id, name, tracks);
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
    toggle,
  };
}
