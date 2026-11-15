"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "@/store/toast";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Switches a playlist between public and private. */
export function usePlaylistVisibility(id: string, isPublic: boolean) {
  const queryClient = useQueryClient();
  const running = useRef(false);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    const next = !isPublic;
    try {
      await api.setPlaylistVisibility(id, next);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["playlist", id] }),
        queryClient.invalidateQueries({ queryKey: ["playlists"] }),
      ]);
      toast.success(next ? "Playlist ist jetzt öffentlich." : "Playlist ist jetzt privat.");
    } catch (error) {
      toast.error(`Sichtbarkeit konnte nicht geändert werden: ${message(error)}`);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return { pending, toggle };
}

/** Uploads a new cover image for a playlist. */
export function usePlaylistCoverUpload(id: string) {
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      await api.uploadPlaylistCover(id, file);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["playlist", id] }),
        queryClient.invalidateQueries({ queryKey: ["playlists"] }),
      ]);
      toast.success("Cover aktualisiert.");
    } catch (error) {
      toast.error(`Cover-Upload fehlgeschlagen: ${message(error)}`);
    } finally {
      setUploading(false);
    }
  }

  return { uploading, upload };
}
