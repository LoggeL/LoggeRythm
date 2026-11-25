import type { ArtistSummary, PlaylistSearchResult, PlaylistSummary, Track } from "@/types";

export interface PaletteCommand {
  id: string;
  label: string;
  detail: string;
  keywords: readonly string[];
  shortcut?: string;
}

export type PaletteRow =
  | { kind: "command"; command: PaletteCommand }
  | { kind: "library"; track: Track }
  | { kind: "own-playlist"; playlist: PlaylistSummary }
  | { kind: "followed-artist"; artist: ArtistSummary }
  | { kind: "track"; track: Track }
  | { kind: "artist"; artist: ArtistSummary }
  | { kind: "album"; album: Track }
  | { kind: "playlist"; playlist: PlaylistSearchResult };

export function paletteRowKey(row: PaletteRow): string {
  switch (row.kind) {
    case "command": return `command-${row.command.id}`;
    case "library": return `library-${row.track.id}`;
    case "own-playlist": return `own-playlist-${row.playlist.id}`;
    case "followed-artist": return `followed-artist-${row.artist.id}`;
    case "track": return `track-${row.track.id}`;
    case "artist": return `artist-${row.artist.id}`;
    case "album": return `album-${row.album.album_id || row.album.id}`;
    case "playlist": return `playlist-${row.playlist.id}`;
  }
}

export function isCommandQuery(input: string): boolean {
  return input.trimStart().startsWith(">");
}

export function matchPaletteCommands(
  commands: readonly PaletteCommand[],
  input: string,
  limit = 12,
): PaletteCommand[] {
  const trimmed = input.trim();
  const commandMode = trimmed.startsWith(">");
  const raw = commandMode ? trimmed.slice(1).trim().toLowerCase() : trimmed.toLowerCase();
  if (!commandMode && raw.length < 2) return [];
  if (!raw) return commands.slice(0, limit);
  const tokens = raw.split(/\s+/).filter(Boolean);
  return commands
    .filter((cmd) => {
      const haystack = `${cmd.label} ${cmd.detail} ${cmd.keywords.join(" ")}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .slice(0, commandMode ? limit : Math.min(limit, 4));
}

export function matchOwnPlaylists(
  playlists: readonly PlaylistSummary[],
  input: string,
  limit = 3,
): PlaylistSummary[] {
  const needle = input.trim().toLowerCase();
  if (needle.length < 2 || needle.startsWith(">")) return [];
  return playlists
    .filter((p) => p.name.toLowerCase().includes(needle))
    .slice(0, limit);
}

export function matchFollowedArtists(
  artists: readonly ArtistSummary[],
  input: string,
  limit = 3,
): ArtistSummary[] {
  const needle = input.trim().toLowerCase();
  if (needle.length < 2 || needle.startsWith(">")) return [];
  return artists
    .filter((a) => a.name.toLowerCase().includes(needle))
    .slice(0, limit);
}

/**
 * `library` holds the saved songs matching the typed text. They lead the list,
 * and a catalog track already shown among them is not listed a second time.
 * In `>` command mode, commands lead exclusively; in normal search mode,
 * matching commands trail catalog results so Enter always activates music first.
 */
export function paletteRows({
  commands = [],
  commandMode = false,
  library = [],
  ownPlaylists = [],
  followedArtists = [],
  tracks = [],
  artists = [],
  albums = [],
  playlists = [],
}: {
  commands?: readonly PaletteCommand[];
  commandMode?: boolean;
  library?: readonly Track[];
  ownPlaylists?: readonly PlaylistSummary[];
  followedArtists?: readonly ArtistSummary[];
  tracks?: readonly Track[];
  artists?: readonly ArtistSummary[];
  albums?: readonly Track[];
  playlists?: readonly PlaylistSearchResult[];
}): PaletteRow[] {
  if (commandMode) {
    return commands.map((command) => ({ kind: "command" as const, command }));
  }
  const saved = library.slice(0, 3);
  const savedIds = new Set(saved.map((track) => String(track.id)));
  const followed = followedArtists.slice(0, 3);
  const followedIds = new Set(followed.map((artist) => String(artist.id)));
  const candidates: PaletteRow[] = [
    ...saved.map((track) => ({ kind: "library" as const, track })),
    ...ownPlaylists.slice(0, 3).map((playlist) => ({ kind: "own-playlist" as const, playlist })),
    ...followed.map((artist) => ({ kind: "followed-artist" as const, artist })),
    ...tracks.filter((track) => !savedIds.has(String(track.id))).slice(0, 6).map((track) => ({ kind: "track" as const, track })),
    ...artists.filter((artist) => !followedIds.has(String(artist.id))).slice(0, 3).map((artist) => ({ kind: "artist" as const, artist })),
    ...albums.slice(0, 3).map((album) => ({ kind: "album" as const, album })),
    ...playlists.slice(0, 3).map((playlist) => ({ kind: "playlist" as const, playlist })),
    ...commands.slice(0, 4).map((command) => ({ kind: "command" as const, command })),
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
