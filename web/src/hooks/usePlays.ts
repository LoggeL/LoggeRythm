"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Track } from "@/types";

export type TrackPlays = { plays: number; listeners: number };

/**
 * Batched Last.fm play counts for the given (rendered) tracks. One request per
 * distinct set of track ids; results are cached by React Query and on the
 * server, so repeated searches and shared tracks don't re-hit Last.fm.
 */
export function useTrackPlays(tracks: Track[]): Record<string, TrackPlays> {
  const items = tracks.map((t) => ({
    id: String(t.id),
    artist: t.artist,
    title: t.title,
  }));
  const ids = items.map((i) => i.id).join(",");

  const { data } = useQuery({
    queryKey: ["track-plays", ids],
    queryFn: () => api.trackPlays(items),
    enabled: items.length > 0,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  return data ?? {};
}
