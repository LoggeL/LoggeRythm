import type { RadarTrack } from "@/types";

type TrackIdentity = { id: string | number };

function invalid(path: string, expected: string): never {
  throw new Error(`Ungültige Release-Radar-Antwort: ${path} muss ${expected} sein.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the Release Radar response at the API boundary. Every track must
 * say why it is in the radar; a response without reasons is rejected instead
 * of being shown as a radar that cannot explain itself.
 */
export function decodeReleaseRadar(value: unknown): RadarTrack[] {
  if (!Array.isArray(value)) invalid("radar", "eine Liste");
  value.forEach((track: unknown, index) => {
    const path = `radar[${index}]`;
    if (!isRecord(track)) invalid(path, "ein Objekt");
    if (typeof track.id !== "string" || !track.id.trim()) {
      invalid(`${path}.id`, "eine nichtleere Track-ID");
    }
    if (!("radar_reason" in track)) {
      throw new Error(
        `Ungültige Release-Radar-Antwort: ${path}.radar_reason fehlt – der Server nennt nicht, warum dieser Song im Release Radar ist.`,
      );
    }
    const reason = track.radar_reason;
    const reasonPath = `${path}.radar_reason`;
    if (!isRecord(reason)) invalid(reasonPath, "ein Objekt");
    if (reason.kind !== "followed" && reason.kind !== "played") {
      invalid(`${reasonPath}.kind`, '"followed" oder "played"');
    }
    if (typeof reason.artist_id !== "string" || !/^[0-9]+$/.test(reason.artist_id)) {
      invalid(`${reasonPath}.artist_id`, "eine numerische Künstler-ID als Text");
    }
    // Legitimately "" when the account's follow/play rows never stored a name.
    if (typeof reason.artist_name !== "string") {
      invalid(`${reasonPath}.artist_name`, "Text");
    }
    if (
      typeof reason.play_count !== "number" ||
      !Number.isSafeInteger(reason.play_count) ||
      reason.play_count < 0
    ) {
      invalid(`${reasonPath}.play_count`, "eine nichtnegative ganze Zahl");
    }
  });
  return value as RadarTrack[];
}

export function radarTrackIds(tracks: readonly TrackIdentity[]): string[] {
  const ids = new Set<string>();
  for (const track of tracks) {
    const id = String(track.id);
    if (!id) {
      throw new Error("Release Radar enthielt einen Song ohne Track-ID.");
    }
    ids.add(id);
  }
  return [...ids];
}

export function countUnseenRadarTracks(
  currentTrackIds: readonly string[],
  seenTrackIds: readonly string[],
): number {
  const seen = new Set(seenTrackIds);
  const unseen = new Set(
    currentTrackIds.filter((trackId) => !seen.has(trackId)),
  );
  return unseen.size;
}

export function mergeSeenRadarTrackIds(
  seenTrackIds: readonly string[],
  visibleTrackIds: readonly string[],
): string[] {
  return [...new Set([...seenTrackIds, ...visibleTrackIds])];
}
