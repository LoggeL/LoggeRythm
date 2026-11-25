"use client";

import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/lib/api";
import { readOfflineLyrics } from "@/lib/offlineLyrics";
import { useMe } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";
import { findLyricsSuspicion } from "@/lib/lyricsQuality";
import type { LyricsLine, LyricsResponse } from "@/types";

export type LyricsVariant = "normal" | "ai";

interface LyricsVariantOverrideState {
  trackId: string | null;
  variant: LyricsVariant | null;
  setOverride: (trackId: string, variant: LyricsVariant) => void;
}

// A manual toggle wins over the auto heuristic. Keyed to a single track so it
// resets on track change; shared module-wide so the karaoke dock and both
// fullscreen lyric views stay in sync.
const useLyricsVariantOverride = create<LyricsVariantOverrideState>((set) => ({
  trackId: null,
  variant: null,
  setOverride: (trackId, variant) => set({ trackId, variant }),
}));

export interface LyricsData {
  lines: LyricsLine[];
  /** Index of the active line (last whose timestamp passed), or -1. */
  active: number;
  hasTimedLines: boolean;
  /** True when any line carries word-by-word karaoke timestamps. */
  hasWordTimings: boolean;
  /** True when lrclib explicitly identified this track as instrumental. */
  instrumental: boolean;
  /** Provider source label (e.g. "lrclib", "lrclib-plain", "groq-word-v3"). */
  source: string | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  retry: () => void;
  isAiGenerated: boolean;
  /** Which lyrics are currently displayed. */
  variant: LyricsVariant;
  /** True when a separate AI transcription can be toggled to/from. */
  canToggle: boolean;
  /** True when the heuristic (not the user) picked the AI variant. */
  autoAi: boolean;
  /** Why the provider lyrics look wrong, when they do. */
  suspicion: string | null;
  /** The AI variant is wanted but still transcribing/loading. */
  aiLoading: boolean;
  /** The AI variant is wanted but the request failed. */
  aiFailed: boolean;
  toggleVariant: () => void;
}

/**
 * Fetch a track's lyrics (passing `album` and `duration_sec` for higher lrclib
 * accuracy) and compute the currently active line. In Offline Mode (when
 * unauthenticated or offline), reads cached lyrics from `sf-lyrics` Cache Storage.
 */
export function useLyrics(
  artist: string,
  title: string,
  trackId: number | string,
  currentTime: number,
  options?: { album?: string; duration_sec?: number },
): LyricsData {
  const duration = usePlayerStore((s) => s.duration);
  const { data: me } = useMe();
  const override = useLyricsVariantOverride();
  const offlineMode = !me?.is_approved || (typeof navigator !== "undefined" && !navigator.onLine);
  const effectiveDuration =
    options?.duration_sec && options.duration_sec > 0
      ? options.duration_sec
      : duration > 0
        ? duration
        : undefined;

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<LyricsResponse | null>({
    queryKey: ["lyrics", String(trackId), offlineMode ? "offline" : "online"],
    queryFn: async () => {
      if (offlineMode) {
        return await readOfflineLyrics(String(trackId));
      }
      return await api.lyrics(artist, title, String(trackId), undefined, {
        album: options?.album,
        duration_sec: effectiveDuration,
      });
    },
    enabled: !!trackId,
    staleTime: 3600_000,
    retry: false,
  });

  const instrumental = Boolean(data?.instrumental);
  const normalLines = instrumental ? [] : (data?.lines ?? []);
  const normalIsAi = !!data?.ai_generated;
  const suspicion =
    !offlineMode && !instrumental && !normalIsAi && normalLines.length > 0 && data?.synced !== false
      ? findLyricsSuspicion(normalLines, duration)
      : null;

  // The toggle only exists when online, non-instrumental, and a distinct AI
  // transcription can be fetched.
  const canToggle = !offlineMode && !instrumental && !!trackId && normalLines.length > 0 && !normalIsAi;
  const overrideVariant =
    override.trackId === String(trackId) ? override.variant : null;
  const wantAi =
    canToggle && (overrideVariant ?? (suspicion ? "ai" : "normal")) === "ai";

  const aiQuery = useQuery({
    queryKey: ["lyrics", String(trackId), "ai"],
    queryFn: () =>
      api.lyrics(artist, title, String(trackId), "ai", {
        album: options?.album,
        duration_sec: effectiveDuration,
      }),
    enabled: wantAi,
    staleTime: 3600_000,
    retry: false,
  });

  const aiLines = aiQuery.data?.lines ?? [];
  const aiReady = wantAi && aiLines.length > 0;
  const activePayload = aiReady ? aiQuery.data : data;
  const lines = aiReady ? aiLines : normalLines;
  const variant: LyricsVariant = aiReady || normalIsAi ? "ai" : "normal";

  const syncedFlag = activePayload?.synced;
  const hasTimedLines =
    syncedFlag !== false && lines.some((line) => typeof line.t === "number");
  const hasWordTimings =
    hasTimedLines && lines.some((line) => Array.isArray(line.words) && line.words.length > 0);

  let active = -1;
  if (hasTimedLines) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= currentTime + 0.15) active = i;
      else break;
    }
  }

  return {
    lines,
    active,
    hasTimedLines,
    hasWordTimings,
    instrumental,
    source: activePayload?.source ?? null,
    isLoading,
    isFetching,
    isError,
    error,
    retry: () => { void refetch(); },
    isAiGenerated: variant === "ai",
    variant,
    canToggle,
    autoAi: wantAi && overrideVariant === null,
    suspicion,
    aiLoading: wantAi && aiQuery.isLoading,
    aiFailed: wantAi && aiQuery.isError,
    toggleVariant: () => {
      if (!canToggle) return;
      useLyricsVariantOverride
        .getState()
        .setOverride(String(trackId), wantAi ? "normal" : "ai");
    },
  };
}
