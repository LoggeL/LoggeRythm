import type { Track } from "@/types";

export const TRACK_DRAG_MIME = "application/x-loggerythm-track";

export function serializeDraggedTrack(track: Track): string {
  return JSON.stringify({
    id: String(track.id),
    title: track.title,
    artist: track.artist,
    artist_id: track.artist_id,
    artists: track.artists,
    album: track.album,
    album_id: track.album_id,
    cover: track.cover,
    duration_sec: track.duration_sec,
    isrc: track.isrc,
  });
}

export function parseDraggedTrack(raw: string): Track | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `Gezogene Titeldaten (${TRACK_DRAG_MIME}) sind kein gültiges JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Gezogene Titeldaten (${TRACK_DRAG_MIME}) müssen ein Objekt sein.`);
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    candidate.id.trim() === "" ||
    typeof candidate.title !== "string" ||
    typeof candidate.artist !== "string" ||
    typeof candidate.album !== "string" ||
    typeof candidate.cover !== "string" ||
    typeof candidate.duration_sec !== "number" ||
    !Number.isFinite(candidate.duration_sec)
  ) {
    throw new Error(`Gezogene Titeldaten (${TRACK_DRAG_MIME}) enthalten fehlende oder ungültige Pflichtfelder.`);
  }
  return candidate as unknown as Track;
}
