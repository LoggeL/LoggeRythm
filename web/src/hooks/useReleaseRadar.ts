"use client";

import {
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  countUnseenRadarTracks,
  mergeSeenRadarTrackIds,
  radarTrackIds,
} from "@/lib/releaseRadar";
import type { Track, User } from "@/types";

export const RADAR_TITLE = "Dein Release Radar";

const RADAR_STALE_TIME = 60 * 60 * 1000;
const EMPTY_SEEN_IDS: readonly string[] = Object.freeze([]);
const seenSnapshotCache = new Map<
  string,
  { raw: string | null; value: readonly string[] }
>();

function seenStorageKey(userId: User["id"] | undefined): string | null {
  return userId === undefined
    ? null
    : `loggerhythm:release-radar:seen:${encodeURIComponent(String(userId))}`;
}

function storageFailure(action: string, key: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(
    `Release-Radar-Status konnte in localStorage["${key}"] nicht ${action} werden: ${detail}`,
    { cause },
  );
}

function readSeenTrackIds(key: string): readonly string[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch (cause) {
    throw storageFailure("gelesen", key, cause);
  }

  const cached = seenSnapshotCache.get(key);
  if (cached?.raw === raw) return cached.value;
  if (raw === null) {
    seenSnapshotCache.set(key, { raw, value: EMPTY_SEEN_IDS });
    return EMPTY_SEEN_IDS;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw storageFailure("geparst", key, cause);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    throw new Error(
      `Ungültiger Release-Radar-Status in localStorage["${key}"]: erwartet wurde eine Liste von Track-IDs.`,
    );
  }

  const value = Object.freeze([...new Set(parsed)]);
  seenSnapshotCache.set(key, { raw, value });
  return value;
}

function writeSeenTrackIds(key: string, ids: readonly string[]) {
  const raw = JSON.stringify(ids);
  try {
    window.localStorage.setItem(key, raw);
  } catch (cause) {
    throw storageFailure("gespeichert", key, cause);
  }
  seenSnapshotCache.set(key, { raw, value: Object.freeze([...ids]) });
  window.dispatchEvent(new Event(`release-radar-seen:${key}`));
}

export function releaseRadarQueryKey(userId: User["id"] | undefined) {
  return ["release-radar", userId === undefined ? null : String(userId)] as const;
}

export function useReleaseRadar(user: User | null | undefined) {
  return useQuery<Track[]>({
    queryKey: releaseRadarQueryKey(user?.id),
    queryFn: () => api.releaseRadar(),
    enabled: user !== null && user !== undefined,
    staleTime: RADAR_STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export function useRefreshReleaseRadar(user: User | null | undefined) {
  const queryClient = useQueryClient();

  return useMutation<Track[], Error>({
    mutationFn: () => {
      if (user === null || user === undefined) {
        throw new Error(
          "Release Radar kann nur mit einem angemeldeten Konto aktualisiert werden.",
        );
      }
      return api.releaseRadar(true);
    },
    onSuccess: (tracks) => {
      if (user === null || user === undefined) {
        throw new Error(
          "Release Radar wurde ohne angemeldetes Konto aktualisiert.",
        );
      }
      queryClient.setQueryData(releaseRadarQueryKey(user.id), tracks);
    },
  });
}

export function useReleaseRadarSeen(
  userId: User["id"] | undefined,
  tracks: readonly Track[],
) {
  const key = seenStorageKey(userId);
  const currentTrackIds = useMemo(() => radarTrackIds(tracks), [tracks]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!key) return () => undefined;
      const localEvent = `release-radar-seen:${key}`;
      const handleLocalChange = () => onStoreChange();
      const handleStorageChange = (event: StorageEvent) => {
        if (event.key === key) onStoreChange();
      };
      window.addEventListener(localEvent, handleLocalChange);
      window.addEventListener("storage", handleStorageChange);
      return () => {
        window.removeEventListener(localEvent, handleLocalChange);
        window.removeEventListener("storage", handleStorageChange);
      };
    },
    [key],
  );

  const seenTrackIds = useSyncExternalStore(
    subscribe,
    () => (key ? readSeenTrackIds(key) : EMPTY_SEEN_IDS),
    () => EMPTY_SEEN_IDS,
  );

  const unseenCount = useMemo(
    () => countUnseenRadarTracks(currentTrackIds, seenTrackIds),
    [currentTrackIds, seenTrackIds],
  );

  const markVisibleTracksSeen = useCallback(() => {
    if (!key || currentTrackIds.length === 0) return;
    const currentSeenIds = readSeenTrackIds(key);
    const nextSeenIds = mergeSeenRadarTrackIds(
      currentSeenIds,
      currentTrackIds,
    );
    if (nextSeenIds.length === currentSeenIds.length) return;
    writeSeenTrackIds(key, nextSeenIds);
  }, [currentTrackIds, key]);

  return { unseenCount, markVisibleTracksSeen };
}
