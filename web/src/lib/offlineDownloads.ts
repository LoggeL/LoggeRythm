import { streamUrl } from "@/lib/api";
import type { Track } from "@/types";

const AUDIO_CACHE = "sf-audio";
const IMG_CACHE = "sf-img";

export interface DownloadEntry {
  name: string;
  total: number;
  // Older entries require the playlist response to identify their cached audio.
  trackIds?: string[];
}

export function assertDownloadEntries(value: unknown): asserts value is Record<string, DownloadEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error('Lokale Daten "sf_downloads": Ein Verzeichnis von Offline-Playlists wurde erwartet.');
  }
  for (const [id, entry] of Object.entries(value)) {
    if (
      !entry || typeof entry !== "object" ||
      typeof entry.name !== "string" ||
      !Number.isInteger(entry.total) || entry.total < 0 ||
      (entry.trackIds !== undefined && (!Array.isArray(entry.trackIds) || entry.trackIds.some((track: unknown) => typeof track !== "string" || track.trim() === "")))
    ) {
      throw new Error(`Lokale Daten "sf_downloads": Offline-Playlist "${id}" hat ein ungültiges Format.`);
    }
  }
}

function detail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function requireCacheStorage() {
  if (typeof caches === "undefined") {
    throw new Error("Dieser Browser unterstützt keine Offline-Downloads.");
  }
  return caches;
}

function trackId(track: Track): string {
  if (!track || typeof track !== "object" || (typeof track.id !== "string" && typeof track.id !== "number") || String(track.id).trim() === "") {
    throw new Error(`Offline-Download: Ein Titel hat keine gültige ID.`);
  }
  return String(track.id);
}

export function downloadedTrackIds(tracks: Track[]): string[] {
  if (!Array.isArray(tracks)) throw new Error("Offline-Download: Eine Liste von Titeln wurde erwartet.");
  return tracks.map(trackId);
}

/** Older indexes gain track identities before any shared audio is removed. */
export async function resolveLegacyDownloadEntries(
  downloads: Record<string, DownloadEntry>,
  resolveTracks: (id: string) => Promise<Track[]>,
): Promise<Record<string, DownloadEntry>> {
  assertDownloadEntries(downloads);
  const legacy = Object.entries(downloads).filter(([, entry]) => entry.trackIds === undefined);
  if (legacy.length === 0) return downloads;
  const resolutions = await Promise.allSettled(legacy.map(async ([id, entry]) => {
    const trackIds = downloadedTrackIds(await resolveTracks(id));
    if (trackIds.length !== entry.total) {
      throw new Error(`Die Titelliste hat sich geändert (${entry.total} offline gespeichert, ${trackIds.length} aktuell).`);
    }
    return { id, entry: { ...entry, trackIds } };
  }));
  const resolved = { ...downloads };
  const failures: Error[] = [];
  resolutions.forEach((result, index) => {
    if (result.status === "fulfilled") resolved[result.value.id] = result.value.entry;
    else {
      const [id, entry] = legacy[index];
      failures.push(new Error(`"${entry.name}" (${id}): ${detail(result.reason)}`, { cause: result.reason }));
    }
  });
  if (failures.length > 0) {
    throw new AggregateError(failures, `Der Offline-Index konnte nicht aktualisiert werden: ${failures.map((error) => error.message).join("; ")}. Für nicht mehr erreichbare Playlists steht "Alle Offline-Downloads löschen" in der Bibliothek bereit.`);
  }
  return resolved;
}

/** Explicitly remove all offline audio, including irretrievable legacy indexes. */
export async function clearOfflineCaches(onAudioRemoved: () => void): Promise<void> {
  const storage = requireCacheStorage();
  try {
    await storage.delete(AUDIO_CACHE);
  } catch (cause) {
    throw new Error(`Offline-Audio konnte nicht entfernt werden: ${detail(cause)}`, { cause });
  }
  onAudioRemoved();
  try {
    await storage.delete(IMG_CACHE);
  } catch (cause) {
    throw new Error(`Audio-Downloads wurden entfernt; Offline-Cover konnten nicht entfernt werden: ${detail(cause)}`, { cause });
  }
}

/** Cache complete tracks and retain every failed request for an explicit retry. */
export async function cachePlaylistTracks(
  tracks: Track[],
  onProgress: (done: number) => void,
): Promise<string[]> {
  if (!Array.isArray(tracks)) throw new Error("Offline-Download: Eine Liste von Titeln wurde erwartet.");
  if (tracks.length === 0) throw new Error("Die Playlist enthält keine Titel zum Herunterladen.");
  const ids = downloadedTrackIds(tracks);
  const storage = requireCacheStorage();
  const [audio, images] = await Promise.all([storage.open(AUDIO_CACHE), storage.open(IMG_CACHE)]);
  const failures: Error[] = [];
  for (const [index, track] of tracks.entries()) {
    try {
      const url = streamUrl(ids[index]);
      if (!(await audio.match(url))) {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(`Audio: HTTP ${response.status}`);
        await audio.put(url, response);
      }
      if (track.cover && !(await images.match(track.cover))) {
        const response = await fetch(track.cover, { mode: "no-cors" });
        if (response.type !== "opaque" && !response.ok) {
          throw new Error(`Cover: HTTP ${response.status}`);
        }
        await images.put(track.cover, response);
      }
    } catch (cause) {
      failures.push(new Error(`"${track.title}" (${ids[index]}): ${detail(cause)}`, { cause }));
    }
    onProgress(index + 1);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length} von ${tracks.length} Titeln sind nicht vollständig offline: ${failures.map((error) => error.message).join("; ")}`,
    );
  }
  return ids;
}

/** Keep tracks referenced by other downloaded playlists, including new writes. */
export async function removePlaylistAudio(
  id: string,
  downloads: Record<string, DownloadEntry>,
  tracks?: Track[],
): Promise<void> {
  assertDownloadEntries(downloads);
  const entry = downloads[id];
  if (!entry) throw new Error(`Offline-Playlist "${id}" ist nicht gespeichert.`);
  const ids = entry.trackIds ?? (tracks ? downloadedTrackIds(tracks) : undefined);
  if (!ids) throw new Error(`Offline-Playlist "${entry.name}" benötigt ihre Titel zum Entfernen.`);
  const keep = new Set<string>();
  for (const [otherId, other] of Object.entries(downloads)) {
    if (otherId === id) continue;
    if (!other.trackIds) {
      throw new Error(`Offline-Playlist "${other.name}" hat keine gespeicherten Titel-IDs. Lade sie erneut herunter, bevor du andere Offline-Playlists entfernst.`);
    }
    other.trackIds.forEach((track) => keep.add(track));
  }
  const audio = await requireCacheStorage().open(AUDIO_CACHE);
  const removable = [...new Set(ids)].filter((track) => !keep.has(track));
  // Cache Storage has no transaction. Keep the original responses so a failed
  // batch can restore its completed deletions before metadata is retained.
  const originals = new Map<string, Response>();
  for (const track of removable) {
    const response = await audio.match(streamUrl(track));
    if (response) originals.set(track, response);
  }
  const failures: Error[] = [];
  const deleted: string[] = [];
  for (const track of removable) {
    try {
      // false means the cache entry was already absent, so removal is complete.
      if (await audio.delete(streamUrl(track))) deleted.push(track);
    } catch (cause) {
      failures.push(new Error(`Titel ${track}: ${detail(cause)}`, { cause }));
    }
  }
  if (failures.length > 0) {
    for (const track of deleted) {
      const response = originals.get(track);
      if (!response) continue;
      try {
        await audio.put(streamUrl(track), response);
      } catch (cause) {
        failures.push(new Error(`Titel ${track} konnte nicht wiederhergestellt werden: ${detail(cause)}`, { cause }));
      }
    }
    throw new AggregateError(failures, `Offline-Playlist "${entry.name}" konnte nicht vollständig entfernt werden: ${failures.map((error) => error.message).join("; ")}`);
  }
}
