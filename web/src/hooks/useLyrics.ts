"use client";

import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/lib/api";
import { usePlayerStore } from "@/store/player";
import { findLyricsSuspicion } from "@/lib/lyricsQuality";

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
  lines: { t: number; text: string }[];
  /** Index of the active line (last whose timestamp passed), or -1. */
  active: number;
  hasTimedLines: boolean;
  isLoading: boolean;
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
 * Fetch a track's lyrics and compute the currently active line. Shared by the
 * desktop lyrics pane, the compact mobile lyrics view and the karaoke dock;
 * react-query dedupes the request by trackId so all can mount at once.
 *
 * When the provider lyrics look wrong (big timestamp skips, times past the
 * song end, clumped timings) the hook automatically prefers the Whisper
 * transcription (`variant=ai`); `toggleVariant` lets the user override either
 * way. While the transcription is still running, the provider lyrics stay
 * visible (`aiLoading` marks the pending switch).
 */
export function useLyrics(
  artist: string,
  title: string,
  trackId: number | string,
  currentTime: number,
): LyricsData {
  const duration = usePlayerStore((s) => s.duration);
  const override = useLyricsVariantOverride();

  const { data, isLoading } = useQuery({
    queryKey: ["lyrics", trackId],
    queryFn: () => api.lyrics(artist, title, String(trackId)),
    enabled: !!trackId,
    staleTime: 3600_000,
    retry: false,
  });

  const normalLines = data?.lines ?? [];
  const normalIsAi = !!data?.ai_generated;
  const suspicion =
    !normalIsAi && normalLines.length > 0
      ? findLyricsSuspicion(normalLines, duration)
      : null;

  // The toggle only exists when a distinct AI transcription can be fetched:
  // provider lyrics present and not already AI-generated.
  const canToggle = !!trackId && normalLines.length > 0 && !normalIsAi;
  const overrideVariant =
    override.trackId === String(trackId) ? override.variant : null;
  const wantAi =
    canToggle && (overrideVariant ?? (suspicion ? "ai" : "normal")) === "ai";

  const aiQuery = useQuery({
    queryKey: ["lyrics", trackId, "ai"],
    queryFn: () => api.lyrics(artist, title, String(trackId), "ai"),
    enabled: wantAi,
    staleTime: 3600_000,
    retry: false,
  });

  const aiLines = aiQuery.data?.lines ?? [];
  const aiReady = wantAi && aiLines.length > 0;
  const lines = aiReady ? aiLines : normalLines;
  const variant: LyricsVariant = aiReady || normalIsAi ? "ai" : "normal";

  const hasTimedLines = lines.some((line) => typeof line.t === "number");

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
    isLoading,
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
