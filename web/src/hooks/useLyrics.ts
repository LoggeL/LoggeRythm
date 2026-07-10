"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { splitAiLyrics } from "@/lib/lyrics";

export interface LyricsData {
  lines: { t: number; text: string }[];
  /** Index of the active line (last whose timestamp passed), or -1. */
  active: number;
  hasTimedLines: boolean;
  isLoading: boolean;
  isAiGenerated: boolean;
}

/**
 * Fetch a track's lyrics and compute the currently active line. Shared by the
 * desktop lyrics pane and the compact mobile lyrics view; react-query dedupes
 * the request by trackId so both can mount at once.
 */
export function useLyrics(
  artist: string,
  title: string,
  trackId: number | string,
  currentTime: number,
): LyricsData {
  const { data, isLoading } = useQuery({
    queryKey: ["lyrics", trackId],
    queryFn: () => api.lyrics(artist, title, String(trackId)),
    enabled: !!trackId,
    staleTime: 3600_000,
    retry: false,
  });

  const lines = useMemo(() => {
    const sourceLines = data?.lines ?? [];
    return data?.ai_generated ? splitAiLyrics(sourceLines) : sourceLines;
  }, [data]);
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
    isAiGenerated: !!data?.ai_generated,
  };
}
