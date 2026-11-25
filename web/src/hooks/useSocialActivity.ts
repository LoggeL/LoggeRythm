"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, socialActivityEventsUrl } from "@/lib/api";
import { useMe } from "@/hooks/useAuth";
import type { SocialActivityResponse } from "@/types";

export const SOCIAL_ACTIVITY_QUERY_KEY = ["social-activity"] as const;

/**
 * Live "Friends Listening Now" feed: fetches initial snapshot via
 * `GET /api/social/activity` and subscribes to `GET /api/social/activity/events`
 * SSE for real-time track & Jam updates.
 */
export function useSocialActivity(enabled = true) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const active = Boolean(enabled && me?.is_approved);
  const [streamError, setStreamError] = useState<string | null>(null);

  const query = useQuery<SocialActivityResponse>({
    queryKey: SOCIAL_ACTIVITY_QUERY_KEY,
    queryFn: () => api.socialActivity(),
    enabled: active,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!active || typeof EventSource === "undefined") return;
    const es = new EventSource(socialActivityEventsUrl(), { withCredentials: true });
    es.onmessage = (event) => {
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          !Array.isArray((parsed as { items?: unknown }).items)
        ) {
          throw new Error("Feld \"items\" fehlt oder ist kein Array.");
        }
        qc.setQueryData<SocialActivityResponse>(
          SOCIAL_ACTIVITY_QUERY_KEY,
          parsed as SocialActivityResponse,
        );
        setStreamError(null);
      } catch (cause) {
        setStreamError(
          `Ungültiges Aktivitäts-Event: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setStreamError("Live-Verbindung für Freunde-Aktivität wurde geschlossen.");
      }
    };
    return () => {
      es.close();
    };
  }, [active, qc]);

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    streamError,
    refetch: query.refetch,
  };
}
