"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Track } from "@/types";

const TRACK_DETAIL_STALE_TIME = 60 * 60 * 1000;
const POSITIVE_NUMERIC_ID = /^[1-9][0-9]*$/;

/** Surface lazy credit-hydration errors loudly in logs without blocking audio playback. */
export function reportTrackHydrationError(trackId: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[track-hydration] Failed to hydrate full credits for track ${trackId}: ${detail}`, error);
}

/**
 * Fast catalog search returns the primary performer immediately without
 * per-track `/track/{id}` fan-out. Once a user plays such a track, hydrate its
 * full performer credits on demand via `GET /api/tracks/{id}`.
 */
export function needsTrackCreditsHydration(track: Track | null): boolean {
  if (!track) return false;
  if (!POSITIVE_NUMERIC_ID.test(String(track.id))) return false;
  return !track.artists || track.artists.length <= 1;
}

/** Merge authoritative detail metadata onto a playing track without clobbering identity. */
export function mergeHydratedTrack(track: Track, detail: Track | undefined): Track {
  if (!detail || String(detail.id) !== String(track.id)) return track;
  const hasFullCredits = Array.isArray(detail.artists) && detail.artists.length > 0;
  const needsIsrc = !track.isrc && Boolean(detail.isrc);
  const needsGain = track.loudness_gain_db == null && detail.loudness_gain_db != null;
  if (!hasFullCredits && !needsIsrc && !needsGain) return track;
  return {
    ...track,
    ...(hasFullCredits ? { artists: detail.artists } : {}),
    ...(needsIsrc ? { isrc: detail.isrc } : {}),
    ...(needsGain ? { loudness_gain_db: detail.loudness_gain_db } : {}),
  };
}

/**
 * Non-blocking lazy full-credits hydration for the currently playing track.
 * Shares one 1h cached `["track", id]` query between `PlayerBar` and `NowPlaying`,
 * fires 0 requests during search, and aborts via `signal` on rapid skips.
 */
export function useHydratedTrack(track: Track | null, enabled = true): Track | null {
  const trackId = track ? String(track.id) : "";
  const shouldFetch = enabled && needsTrackCreditsHydration(track);
  const detailQuery = useQuery<Track>({
    queryKey: ["track", shouldFetch ? trackId : ""],
    queryFn: ({ signal }) => api.track(trackId, signal),
    enabled: shouldFetch,
    staleTime: TRACK_DETAIL_STALE_TIME,
    retry: false,
  });
  const reportedErrorKey = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldFetch || !detailQuery.isError || !detailQuery.error) return;
    const key = `${trackId}:${detailQuery.errorUpdatedAt}`;
    if (reportedErrorKey.current === key) return;
    reportedErrorKey.current = key;
    reportTrackHydrationError(trackId, detailQuery.error);
  }, [shouldFetch, trackId, detailQuery.isError, detailQuery.error, detailQuery.errorUpdatedAt]);
  const detail = shouldFetch ? detailQuery.data : undefined;
  return useMemo(
    () => (track ? mergeHydratedTrack(track, detail) : null),
    [track, detail],
  );
}
