"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { decodeTrackAudioMeta } from "@/lib/audioIntelligence";
import { useMe } from "@/hooks/useAuth";
import type { TrackAudioMeta } from "@/types";

export function trackAudioMetaQueryKey(trackId: string | number | null | undefined) {
  return ["track-audio-meta", trackId ? String(trackId) : ""] as const;
}

export async function fetchTrackAudioMeta(trackId: string): Promise<TrackAudioMeta | null> {
  try {
    const raw = await api.trackAudioMeta(trackId);
    return decodeTrackAudioMeta(raw);
  } catch (cause) {
    // 404 (not materialized yet) and 503 (ffmpeg unavailable on server) mean
    // waveform metadata is genuinely unavailable — never invent fake peaks.
    if (cause instanceof ApiError && (cause.status === 404 || cause.status === 503)) {
      return null;
    }
    throw cause;
  }
}

/**
 * Fetches server-computed waveform peaks, BPM, loudness, and intro/outro cues
 * for a track (`GET /api/tracks/{id}/audio-meta`).
 */
export function useTrackAudioMeta(
  trackId: string | number | null | undefined,
  enabled = true,
) {
  const { data: me } = useMe();
  const id = trackId ? String(trackId) : "";
  return useQuery<TrackAudioMeta | null>({
    queryKey: trackAudioMetaQueryKey(id),
    queryFn: () => fetchTrackAudioMeta(id),
    enabled: Boolean(enabled && id && me?.is_approved),
    staleTime: 60 * 60_000,
    retry: false,
  });
}
