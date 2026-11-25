/**
 * Device-local Cache Storage bucket (`sf-lyrics`) for synced/plain lyrics
 * fetched through `GET /api/playlists/{id}/sync-manifest?include_lyrics=true`.
 * Enables full karaoke & static lyrics inside Offline Mode without bloating
 * localStorage.
 */

import type { LyricsResponse } from "@/types";

export const LYRICS_CACHE_NAME = "sf-lyrics";

function lyricsCacheKey(trackId: string): string {
  return `/offline-lyrics/${encodeURIComponent(String(trackId))}`;
}

export async function cacheOfflineLyricsMap(
  lyricsMap: Record<string, LyricsResponse>,
): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const entries = Object.entries(lyricsMap);
  if (entries.length === 0) return 0;
  const cache = await caches.open(LYRICS_CACHE_NAME);
  let stored = 0;
  for (const [trackId, payload] of entries) {
    if (!trackId.trim() || !payload || typeof payload !== "object") continue;
    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await cache.put(lyricsCacheKey(trackId), response);
    stored += 1;
  }
  return stored;
}

export async function readOfflineLyrics(trackId: string): Promise<LyricsResponse | null> {
  if (typeof caches === "undefined" || !trackId.trim()) return null;
  const cache = await caches.open(LYRICS_CACHE_NAME);
  if (!cache) return null;
  const hit = await cache.match(lyricsCacheKey(trackId));
  if (!hit) return null;
  const parsed: unknown = await hit.json();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Offline-Songtext für Titel ${trackId} ist beschädigt.`);
  }
  return parsed as LyricsResponse;
}

export async function deleteOfflineLyrics(trackIds: readonly string[]): Promise<void> {
  if (typeof caches === "undefined" || trackIds.length === 0) return;
  const cache = await caches.open(LYRICS_CACHE_NAME);
  if (!cache) return;
  await Promise.all(trackIds.map((id) => cache.delete(lyricsCacheKey(id))));
}

export async function clearOfflineLyricsCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  await caches.delete(LYRICS_CACHE_NAME);
}
