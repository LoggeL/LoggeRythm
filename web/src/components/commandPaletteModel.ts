import type { ArtistSummary, PlaylistSearchResult, Track } from "@/types";

export type PaletteRow =
  | { kind: "library"; track: Track }
  | { kind: "track"; track: Track }
  | { kind: "artist"; artist: ArtistSummary }
  | { kind: "album"; album: Track }
  | { kind: "playlist"; playlist: PlaylistSearchResult };

export function paletteRowKey(row: PaletteRow): string {
  switch (row.kind) {
    case "library": return `library-${row.track.id}`;
    case "track": return `track-${row.track.id}`;
    case "artist": return `artist-${row.artist.id}`;
    case "album": return `album-${row.album.album_id || row.album.id}`;
    case "playlist": return `playlist-${row.playlist.id}`;
  }
}

/**
 * `library` holds the saved songs matching the typed text. They lead the list,
 * and a catalog track already shown among them is not listed a second time.
 */
export function paletteRows({
  library = [], tracks = [], artists = [], albums = [], playlists = [],
}: {
  library?: readonly Track[];
  tracks?: readonly Track[];
  artists?: readonly ArtistSummary[];
  albums?: readonly Track[];
  playlists?: readonly PlaylistSearchResult[];
}): PaletteRow[] {
  const saved = library.slice(0, 3);
  const savedIds = new Set(saved.map((track) => String(track.id)));
  const candidates: PaletteRow[] = [
    ...saved.map((track) => ({ kind: "library" as const, track })),
    ...tracks.filter((track) => !savedIds.has(String(track.id))).slice(0, 6).map((track) => ({ kind: "track" as const, track })),
    ...artists.slice(0, 3).map((artist) => ({ kind: "artist" as const, artist })),
    ...albums.slice(0, 3).map((album) => ({ kind: "album" as const, album })),
    ...playlists.slice(0, 3).map((playlist) => ({ kind: "playlist" as const, playlist })),
  ];
  const seen = new Set<string>();
  return candidates.filter((row) => {
    const key = paletteRowKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A disappearing selection must not activate a different result at that index. */
export function paletteSelectedIndex(rows: readonly PaletteRow[], selectedKey: string | null): number {
  if (selectedKey === null) return rows.length > 0 ? 0 : -1;
  return rows.findIndex((row) => paletteRowKey(row) === selectedKey);
}

export function movePaletteSelection(rows: readonly PaletteRow[], selectedKey: string | null, direction: -1 | 1): string | null {
  if (rows.length === 0) return null;
  const selected = paletteSelectedIndex(rows, selectedKey);
  const next = selected < 0 ? (direction === 1 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, selected + direction));
  return paletteRowKey(rows[next]);
}
