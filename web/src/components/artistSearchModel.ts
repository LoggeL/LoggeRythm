import type { TrackArtistDescriptor } from "@/lib/trackArtists";

function requiredText(value: string, label: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${label} must not be empty`);
  return text;
}

function quotedQueryValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Public Deezer search accepts quoted terms; artist:/track: return no matches. */
export function artistSongQuery(artistName: string, query: string): string {
  return `${quotedQueryValue(requiredText(artistName, "Artist name"))} ${quotedQueryValue(requiredText(query, "Song query"))}`;
}

function usableArtistId(value: string | number | undefined): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id !== "0" ? id : null;
}

function normalizedArtistName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/** Known performer IDs take precedence over legacy name-only metadata. */
export function isArtistTrack(
  track: TrackArtistDescriptor,
  artistId: string | number,
  artistName: string,
): boolean {
  const ids = [
    usableArtistId(track.artist_id),
    ...(track.artists ?? []).map((artist) => usableArtistId(artist.id)),
  ].filter((id): id is string => id !== null);
  if (ids.length > 0) {
    const targetId = usableArtistId(artistId);
    return targetId !== null && ids.includes(targetId);
  }

  const targetName = normalizedArtistName(requiredText(artistName, "Artist name"));
  const names = [track.artist, ...(track.artists ?? []).map((artist) => artist.name)];
  return names.some((name) => normalizedArtistName(name) === targetName);
}
