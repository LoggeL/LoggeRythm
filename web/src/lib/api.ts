import type {
  Track,
  User,
  Album,
  AlbumSummary,
  Artist,
  ArtistSummary,
  Playlist,
  PlaylistSummary,
  PlaylistSearchResult,
  Genre,
  GenreDetail,
  ResolveResult,
} from "@/types";

const BASE = "/api";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function req<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const isForm =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      ...(options.body && !isForm ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (data && typeof data.detail === "string") message = data.detail;
      else if (data && typeof data.message === "string") message = data.message;
    } catch {
      // ignore non-json error bodies
    }
    throw new ApiError(res.status, message || `Request failed (${res.status})`);
  }

  if (res.status === 204) return undefined as T;

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Discovery / catalog
  search: (q: string, type: "track" | "album" = "track") =>
    req<Track[]>(`/search?q=${encodeURIComponent(q)}&type=${type}`),
  searchArtists: (q: string) =>
    req<ArtistSummary[]>(`/search/artist?q=${encodeURIComponent(q)}`),
  searchPlaylists: (q: string) =>
    req<PlaylistSearchResult[]>(`/search/playlist?q=${encodeURIComponent(q)}`),
  charts: () => req<Track[]>(`/charts`),
  genres: () => req<Genre[]>(`/genres`),
  genre: (id: string) => req<GenreDetail>(`/genres/${encodeURIComponent(id)}`),
  newReleases: () => req<AlbumSummary[]>(`/new-releases`),
  track: (id: string) => req<Track>(`/tracks/${encodeURIComponent(id)}`),
  album: (id: string) => req<Album>(`/albums/${encodeURIComponent(id)}`),
  artist: (id: string) => req<Artist>(`/artists/${encodeURIComponent(id)}`),

  // Auth
  me: () => req<User>(`/auth/me`),
  login: (email: string, password: string) =>
    req<User>(`/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, display_name: string) =>
    req<User>(`/auth/register`, {
      method: "POST",
      body: JSON.stringify({ email, password, display_name }),
    }),
  logout: () => req<void>(`/auth/logout`, { method: "POST" }),

  // Likes
  likes: () => req<Track[]>(`/me/likes`),
  likedContains: (ids: string[]) =>
    req<Record<string, boolean>>(
      `/me/likes/contains?ids=${encodeURIComponent(ids.join(","))}`,
    ),
  like: (track: Track) =>
    req<void>(`/me/likes/${encodeURIComponent(track.id)}`, {
      method: "PUT",
      body: JSON.stringify(track),
    }),
  unlike: (deezerId: string) =>
    req<void>(`/me/likes/${encodeURIComponent(deezerId)}`, {
      method: "DELETE",
    }),

  // Follows
  following: () => req<ArtistSummary[]>(`/me/following/artists`),
  followContains: (ids: string[]) =>
    req<Record<string, boolean>>(
      `/me/following/artists/contains?ids=${encodeURIComponent(ids.join(","))}`,
    ),
  follow: (artist: ArtistSummary) =>
    req<void>(`/me/following/artists/${encodeURIComponent(String(artist.id))}`, {
      method: "PUT",
      body: JSON.stringify(artist),
    }),
  unfollow: (artistId: string) =>
    req<void>(`/me/following/artists/${encodeURIComponent(artistId)}`, {
      method: "DELETE",
    }),

  // Playlists
  playlists: () => req<PlaylistSummary[]>(`/playlists`),
  createPlaylist: (name: string, description?: string) =>
    req<PlaylistSummary>(`/playlists`, {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  playlist: (id: string) =>
    req<Playlist>(`/playlists/${encodeURIComponent(id)}`),
  updatePlaylist: (
    id: string,
    patch: { name?: string; description?: string },
  ) =>
    req<PlaylistSummary>(`/playlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deletePlaylist: (id: string) =>
    req<void>(`/playlists/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addToPlaylist: (id: string, track: Track) =>
    req<void>(`/playlists/${encodeURIComponent(id)}/tracks`, {
      method: "POST",
      body: JSON.stringify(track),
    }),
  removeFromPlaylist: (id: string, deezerId: string) =>
    req<void>(
      `/playlists/${encodeURIComponent(id)}/tracks/${encodeURIComponent(
        deezerId,
      )}`,
      { method: "DELETE" },
    ),
  reorderPlaylistTracks: (id: string, deezerIds: string[]) =>
    req<void>(`/playlists/${encodeURIComponent(id)}/tracks/order`, {
      method: "PATCH",
      body: JSON.stringify({ deezer_ids: deezerIds }),
    }),
  addTracksBulk: (id: string, tracks: Track[]) =>
    req<{ added: number }>(`/playlists/${encodeURIComponent(id)}/tracks/bulk`, {
      method: "POST",
      body: JSON.stringify(tracks),
    }),

  uploadPlaylistCover: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<PlaylistSummary>(`/playlists/${encodeURIComponent(id)}/cover`, {
      method: "PUT",
      body: form,
    });
  },

  // External link resolution (Spotify -> Deezer-playable)
  resolve: (url: string) =>
    req<ResolveResult>(`/resolve?url=${encodeURIComponent(url)}`),

  // Synchronized lyrics (lrclib LRC, parsed to timestamped lines; cached server-side)
  lyrics: (artist: string, title: string, deezerId?: string) =>
    req<{ lines: { t: number; text: string }[] | null; synced: boolean }>(
      `/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(
        title,
      )}${deezerId ? `&deezer_id=${encodeURIComponent(deezerId)}` : ""}`,
    ),
};

export { ApiError };

export function streamUrl(trackId: string): string {
  return `${BASE}/tracks/${encodeURIComponent(trackId)}/stream`;
}
