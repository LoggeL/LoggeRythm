import type {
  Track,
  User,
  AdminUser,
  Album,
  AlbumSummary,
  Artist,
  ArtistAbout,
  ArtistSummary,
  Playlist,
  PlaylistSummary,
  Genre,
  GenreDetail,
  HomeShelf,
  ResolveResult,
  PartyState,
  StorageInfo,
  InviteInfo,
  SystemStatus,
  DeezerPlaylistDetail,
  PublicProfile,
  PlaybackSettings,
  LyricsResponse,
} from "@/types";
import { decodeSearchArtists, decodeSearchPlaylists, decodeSearchTracks } from "@/lib/searchDecoders";

const BASE = "/api";
// Cold personalized discovery resolves many provider records before replying.
const DISCOVERY_TIMEOUT_MS = 90_000;

class ApiError extends Error {
  status: number;
  /** Full parsed error body from the server (may carry error_type/traceback). */
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "ApiError";
  }
}

type ApiRequestOptions = RequestInit & { timeoutMs?: number };

async function req<T>(
  path: string,
  { timeoutMs = 30_000, ...options }: ApiRequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) abortFromCaller();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const headers = new Headers(options.headers);
    const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
    if (options.body && !isForm && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
    // Keep the deadline active until the body has arrived, not just the headers.
    const text = await res.text();
    if (!res.ok) {
      let body: unknown = text;
      let message = text || res.statusText || `HTTP ${res.status}`;
      if (res.headers.get("content-type")?.includes("application/json")) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new ApiError(res.status, `API ${path}: HTTP ${res.status} mit ungültiger JSON-Fehlerantwort`, text);
        }
        if (body && typeof body === "object") {
          if ("detail" in body && typeof body.detail === "string") message = body.detail;
          else if ("message" in body && typeof body.message === "string") message = body.message;
        }
      }
      throw new ApiError(res.status, `API ${path}: ${message}`, body);
    }
    if (res.status === 204) return undefined as T;
    if (!res.headers.get("content-type")?.includes("application/json")) {
      throw new ApiError(res.status, `API ${path}: JSON erwartet, aber ${res.headers.get("content-type") || "kein Content-Type"} erhalten.`, text);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, `API ${path}: ungültige oder leere JSON-Antwort.`, text);
    }
  } catch (error) {
    if (timedOut) {
      throw new ApiError(0, `API ${path}: Zeitüberschreitung nach ${timeoutMs / 1000} Sekunden.`);
    }
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, `API ${path}: Netzwerkfehler (${error instanceof Error ? error.message : String(error)}).`);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function searchReq<T>(path: string, decode: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
  const payload = await req<unknown>(path, { signal });
  try {
    return decode(payload);
  } catch (cause) {
    const error = new ApiError(200, `API ${path}: ${cause instanceof Error ? cause.message : "Ungültige Suchantwort."}`);
    error.cause = cause;
    throw error;
  }
}

export const api = {
  // Discovery / catalog
  search: (q: string, type: "track" | "album" = "track", signal?: AbortSignal) =>
    searchReq(`/search?q=${encodeURIComponent(q)}&type=${type}`, decodeSearchTracks, signal),
  searchArtists: (q: string, signal?: AbortSignal) =>
    searchReq(`/search/artist?q=${encodeURIComponent(q)}`, decodeSearchArtists, signal),
  searchPlaylists: (q: string, signal?: AbortSignal) =>
    searchReq(`/search/playlist?q=${encodeURIComponent(q)}`, decodeSearchPlaylists, signal),
  charts: () => req<Track[]>(`/charts`),
  // Home / discovery shelves
  homeMixes: () => req<HomeShelf[]>(`/home/mixes`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),
  becauseYouListened: () => req<HomeShelf[]>(`/home/because-you-listened`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),
  homeChartsCollections: () => req<HomeShelf[]>(`/home/charts-collections`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),
  releaseRadar: (refresh = false) =>
    req<Track[]>(
      `/home/release-radar${refresh ? "?refresh=true" : ""}`,
      { timeoutMs: DISCOVERY_TIMEOUT_MS, cache: refresh ? "no-store" : undefined },
    ),
  homeMood: (tag: string) =>
    req<Track[]>(`/home/mood/${encodeURIComponent(tag)}`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),
  genres: () => req<Genre[]>(`/genres`),
  genre: (id: string) => req<GenreDetail>(`/genres/${encodeURIComponent(id)}`),
  newReleases: () => req<AlbumSummary[]>(`/new-releases`),
  track: (id: string) => req<Track>(`/tracks/${encodeURIComponent(id)}`),
  album: (id: string) => req<Album>(`/albums/${encodeURIComponent(id)}`),
  artist: (id: string) => req<Artist>(`/artists/${encodeURIComponent(id)}`),
  artistAbout: (name: string) =>
    req<ArtistAbout>(`/artist-about?name=${encodeURIComponent(name)}`),

  // Auth
  me: () => req<User>(`/auth/me`),
  login: (email: string, password: string) =>
    req<User>(`/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (
    email: string,
    password: string,
    display_name: string,
    invite?: string,
  ) =>
    req<User>(`/auth/register`, {
      method: "POST",
      body: JSON.stringify({ email, password, display_name, invite }),
    }),
  logout: () => req<void>(`/auth/logout`, { method: "POST" }),
  updateMe: (patch: {
    display_name?: string;
    email?: string;
    password?: string;
  }) => req<User>(`/me`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMe: () => req<void>(`/me`, { method: "DELETE" }),
  settings: () => req<PlaybackSettings>(`/me/settings`),
  updateSettings: (patch: {
    crossfade_enabled?: boolean;
    crossfade_duration_sec?: number;
  }) =>
    req<PlaybackSettings>(`/me/settings`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  // Admin
  adminUsers: () => req<AdminUser[]>(`/admin/users`),
  approveUser: (id: string | number) =>
    req<void>(`/admin/users/${encodeURIComponent(String(id))}/approve`, {
      method: "PUT",
    }),
  deleteUser: (id: string | number) =>
    req<void>(`/admin/users/${encodeURIComponent(String(id))}`, {
      method: "DELETE",
    }),

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
  publicPlaylists: () => req<PlaylistSummary[]>(`/playlists/public`),
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
    req<ResolveResult>(`/resolve?url=${encodeURIComponent(url)}`, { timeoutMs: 180_000 }),

  // Synchronized lyrics (lrclib LRC, parsed to timestamped lines; cached
  // server-side). variant "ai" forces the Whisper transcription instead.
  lyrics: (artist: string, title: string, deezerId?: string, variant?: "ai") =>
    req<LyricsResponse>(
      `/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(
        title,
      )}${deezerId ? `&deezer_id=${encodeURIComponent(deezerId)}` : ""}${
        variant ? `&variant=${variant}` : ""
      }`,
      { timeoutMs: 300_000 },
    ),

  // Deezer playlist (public) → playable tracks
  deezerPlaylist: (id: string) =>
    req<DeezerPlaylistDetail>(`/deezer-playlist/${encodeURIComponent(id)}`),

  // Song radio (seed track → similar tracks)
  radio: (deezerId: string) =>
    req<Track[]>(`/radio/${encodeURIComponent(deezerId)}`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),

  // Profile / avatar / public profile
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<User>(`/me/avatar`, { method: "PUT", body: form });
  },
  publicProfile: (id: string) => req<PublicProfile>(`/users/${encodeURIComponent(id)}`),

  // Play tracking + stats
  recordPlay: (track: Track) =>
    req<void>(`/me/plays`, { method: "POST", body: JSON.stringify(track) }),
  stats: () => req<unknown>(`/me/stats`),

  // Track ids cached on the server (no Deezer re-fetch needed)
  cachedTracks: () => req<{ ids: string[] }>(`/cached-tracks`),
  preloadTrack: (deezerId: string) =>
    req<void>(`/tracks/${encodeURIComponent(deezerId)}/preload`, {
      method: "POST",
      timeoutMs: 180_000,
    }),

  // Batched Last.fm play counts → { [trackId]: { plays, listeners } }
  trackPlays: (tracks: { id: string; artist: string; title: string }[]) =>
    req<Record<string, { plays: number; listeners: number }>>(`/track-plays`, {
      method: "POST",
      body: JSON.stringify({ tracks }),
    }),

  // Admin system status / health
  adminStatus: () => req<SystemStatus>(`/admin/status`),

  // Admin storage overview + invites
  adminStorage: () => req<StorageInfo>(`/admin/storage`),
  adminStorageCleanup: () =>
    req<{ removed: number; freed_bytes: number }>(`/admin/storage/cleanup`, {
      method: "POST",
    }),
  adminInvites: () => req<InviteInfo[]>(`/admin/invites`),
  adminCreateInvite: () => req<InviteInfo>(`/admin/invites`, { method: "POST" }),

  // Party mode (collaborative shared queue)
  createParty: (name?: string) =>
    req<PartyState>(`/party`, {
      method: "POST",
      body: JSON.stringify({ name: name ?? "" }),
    }),
  getParty: (code: string) => req<PartyState>(`/party/${encodeURIComponent(code)}`),
  joinParty: (code: string) =>
    req<PartyState>(`/party/${encodeURIComponent(code)}/join`, { method: "POST" }),
  partyAddTrack: (code: string, track: Track) =>
    req<void>(`/party/${encodeURIComponent(code)}/tracks`, {
      method: "POST",
      body: JSON.stringify(track),
    }),
  partyRemoveTrack: (code: string, itemId: number) =>
    req<void>(`/party/${encodeURIComponent(code)}/tracks/${itemId}`, {
      method: "DELETE",
    }),
  partyReorder: (code: string, ids: number[]) =>
    req<void>(`/party/${encodeURIComponent(code)}/tracks/order`, {
      method: "PATCH",
      body: JSON.stringify({ ids }),
    }),
  partySetCurrent: (code: string, index: number) =>
    req<void>(`/party/${encodeURIComponent(code)}/current`, {
      method: "PATCH",
      body: JSON.stringify({ index }),
    }),
  leaveParty: (code: string) =>
    req<void>(`/party/${encodeURIComponent(code)}/leave`, { method: "POST" }),

  // Playlist visibility
  setPlaylistVisibility: (id: string, isPublic: boolean) =>
    req<PlaylistSummary>(`/playlists/${encodeURIComponent(id)}/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ is_public: isPublic }),
    }),
};

export { ApiError };

export function streamUrl(trackId: string): string {
  return `${BASE}/tracks/${encodeURIComponent(trackId)}/stream`;
}

export function playlistExportUrl(playlistId: string): string {
  return `${BASE}/playlists/${encodeURIComponent(playlistId)}/export`;
}
