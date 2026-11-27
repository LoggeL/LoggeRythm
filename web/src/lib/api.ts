import type {
  Track,
  User,
  AuthProviders,
  AdminUser,
  Album,
  AlbumSummary,
  Artist,
  ArtistAbout,
  ArtistSummary,
  Playlist,
  PlaylistIncomingInvitation,
  PlaylistInviteCandidate,
  PlaylistJoinResult,
  PlaylistOutgoingInvitation,
  PlaylistSummary,
  Genre,
  GenreDetail,
  HomeShelf,
  ImportJobDetail,
  ImportJobStatus,
  PartyState,
  PartyStart,
  PartySettingsUpdate,
  ConnectState,
  ConnectTicket,
  StorageInfo,
  LikesDeduplicationResult,
  InviteInfo,
  SystemStatus,
  AdminUsageRange,
  AudioQuality,
  BlendResult,
  DeezerPlaylistDetail,
  ImportJobCreateOptions,
  PublicProfile,
  PlaybackSettings,
  PlaylistDeduplicateResponse,
  PlaylistDuplicatesResponse,
  PlaylistSyncManifest,
  LyricsResponse,
  PartyReaction,
  PartyVoteSkipResult,
  RadarTrack,
  SocialActivityResponse,
  StatsInsightsRange,
} from "@/types";
import { decodeReleaseRadar } from "@/lib/releaseRadar";
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

function isHtmlResponse(res: Response, text: string): boolean {
  if (res.headers.get("content-type")?.includes("text/html")) return true;
  const start = text.trimStart().slice(0, 15).toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

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
      if (isHtmlResponse(res, text)) {
        // A proxy (Cloudflare replaces origin 502/504 bodies) answered with an
        // HTML page; the markup is unreadable in a toast but stays on `body`.
        message = `HTTP ${res.status} – der Server antwortete mit einer HTML-Fehlerseite statt einer API-Antwort.`;
      } else if (res.headers.get("content-type")?.includes("application/json")) {
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
  homePersonalMixes: () => req<HomeShelf[]>(`/home/personal-mixes`),
  becauseYouListened: () => req<HomeShelf[]>(`/home/because-you-listened`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),
  homeChartsCollections: () => req<HomeShelf[]>(`/home/charts-collections`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),
  /** Every track carries `radar_reason`: the watched artist that put it in the radar. */
  releaseRadar: async (refresh = false): Promise<RadarTrack[]> => {
    const path = `/home/release-radar${refresh ? "?refresh=true" : ""}`;
    const payload = await req<unknown>(path, {
      timeoutMs: DISCOVERY_TIMEOUT_MS,
      cache: refresh ? "no-store" : undefined,
    });
    try {
      return decodeReleaseRadar(payload);
    } catch (cause) {
      const error = new ApiError(200, `API ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
      error.cause = cause;
      throw error;
    }
  },
  homeMood: (tag: string) =>
    req<Track[]>(`/home/mood/${encodeURIComponent(tag)}`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),
  genres: () => req<Genre[]>(`/genres`),
  genre: (id: string) => req<GenreDetail>(`/genres/${encodeURIComponent(id)}`),
  newReleases: () => req<AlbumSummary[]>(`/new-releases`),
  track: (id: string) => req<Track>(`/tracks/${encodeURIComponent(id)}`),
  trackAudioMeta: (id: string) =>
    req<unknown>(`/tracks/${encodeURIComponent(id)}/audio-meta`, { timeoutMs: 60_000 }),
  album: (id: string) => req<Album>(`/albums/${encodeURIComponent(id)}`),
  artist: (id: string) => req<Artist>(`/artists/${encodeURIComponent(id)}`),
  artistAbout: (name: string) =>
    req<ArtistAbout>(`/artist-about?name=${encodeURIComponent(name)}`),

  // Auth
  authProviders: () => req<AuthProviders>(`/auth/providers`),
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
  forgotPassword: (email: string) =>
    req<void>(`/auth/password/forgot`, { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    req<User>(`/auth/password/reset`, { method: "POST", body: JSON.stringify({ token, password }) }),
  updateMe: (patch: {
    display_name?: string;
    email?: string;
    password?: string;
  }) => req<User>(`/me`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteMe: () => req<void>(`/me`, { method: "DELETE" }),
  settings: () => req<PlaybackSettings>(`/me/settings`),
  updateSettings: (patch: Partial<PlaybackSettings>) =>
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
  playlists: (scope?: "all" | "owned" | "collaborative") =>
    req<PlaylistSummary[]>(
      scope ? `/playlists?scope=${encodeURIComponent(scope)}` : `/playlists`,
    ),
  publicPlaylists: () => req<PlaylistSummary[]>(`/playlists/public`),
  createPlaylist: (name: string, description?: string, isCollaborative?: boolean) =>
    req<PlaylistSummary>(`/playlists`, {
      method: "POST",
      body: JSON.stringify({
        name,
        description,
        ...(isCollaborative !== undefined ? { is_collaborative: isCollaborative } : {}),
      }),
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
  removePlaylistEntry: (id: string, entryId: number) =>
    req<void>(
      `/playlists/${encodeURIComponent(id)}/tracks/entries/${encodeURIComponent(
        String(entryId),
      )}`,
      { method: "DELETE" },
    ),
  reorderPlaylistTracks: (id: string, deezerIds: string[]) =>
    req<void>(`/playlists/${encodeURIComponent(id)}/tracks/order`, {
      method: "PATCH",
      body: JSON.stringify({ deezer_ids: deezerIds }),
    }),
  reorderPlaylistEntries: (id: string, entryIds: number[]) =>
    req<void>(`/playlists/${encodeURIComponent(id)}/tracks/entries/order`, {
      method: "PATCH",
      body: JSON.stringify({ entry_ids: entryIds }),
    }),
  addTracksBulk: (id: string, tracks: Track[]) =>
    req<{ added: number }>(`/playlists/${encodeURIComponent(id)}/tracks/bulk`, {
      method: "POST",
      body: JSON.stringify(tracks),
    }),
  setPlaylistCollaborative: (id: string, isCollaborative: boolean) =>
    req<PlaylistSummary>(
      `/playlists/${encodeURIComponent(id)}/collaborative`,
      {
        method: "PATCH",
        body: JSON.stringify({ is_collaborative: isCollaborative }),
      },
    ),
  /** Owner-only: approved accounts whose display name contains `query`. */
  playlistInviteCandidates: (id: string, query: string, signal?: AbortSignal) =>
    req<PlaylistInviteCandidate[]>(
      `/playlists/${encodeURIComponent(id)}/invite-candidates?q=${encodeURIComponent(query)}`,
      { signal },
    ),
  /** Owner-only: invitations the invitees have not answered yet. */
  playlistInvitations: (id: string) =>
    req<PlaylistOutgoingInvitation[]>(
      `/playlists/${encodeURIComponent(id)}/invitations`,
    ),
  inviteToPlaylist: (id: string, userId: number) =>
    req<PlaylistOutgoingInvitation>(
      `/playlists/${encodeURIComponent(id)}/invitations`,
      {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      },
    ),
  withdrawPlaylistInvitation: (id: string, userId: number) =>
    req<void>(
      `/playlists/${encodeURIComponent(id)}/invitations/${encodeURIComponent(
        String(userId),
      )}`,
      { method: "DELETE" },
    ),
  /** Pending invitations addressed to the current account, newest first. */
  myPlaylistInvitations: () =>
    req<PlaylistIncomingInvitation[]>(`/playlists/invitations`),
  acceptPlaylistInvitation: (invitationId: number) =>
    req<PlaylistJoinResult>(
      `/playlists/invitations/${encodeURIComponent(String(invitationId))}/accept`,
      { method: "POST" },
    ),
  declinePlaylistInvitation: (invitationId: number) =>
    req<void>(
      `/playlists/invitations/${encodeURIComponent(String(invitationId))}/decline`,
      { method: "POST" },
    ),
  removePlaylistCollaborator: (id: string, userId: string | number) =>
    req<void>(
      `/playlists/${encodeURIComponent(id)}/collaborators/${encodeURIComponent(
        String(userId),
      )}`,
      { method: "DELETE" },
    ),
  leavePlaylist: (id: string) =>
    req<void>(`/playlists/${encodeURIComponent(id)}/leave`, {
      method: "POST",
    }),

  uploadPlaylistCover: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<PlaylistSummary>(`/playlists/${encodeURIComponent(id)}/cover`, {
      method: "PUT",
      body: form,
    });
  },

  // Spotify link import (Spotify -> Deezer-playable) as a background job:
  // start it, poll its progress, fetch the result whenever convenient.
  startImportJob: (url: string, options?: ImportJobCreateOptions) =>
    req<ImportJobStatus>(`/resolve/jobs`, {
      method: "POST",
      body: JSON.stringify({
        url,
        ...(options?.target_playlist_id != null
          ? { target_playlist_id: options.target_playlist_id }
          : {}),
        ...(options?.create_playlist_name
          ? { create_playlist_name: options.create_playlist_name }
          : {}),
      }),
    }),
  importJobs: () => req<ImportJobStatus[]>(`/resolve/jobs`),
  importJob: (id: string) => req<ImportJobDetail>(`/resolve/jobs/${encodeURIComponent(id)}`),
  deleteImportJob: (id: string) =>
    req<void>(`/resolve/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Synchronized lyrics (lrclib LRC, parsed to timestamped lines; cached
  // server-side). variant "ai" forces the Whisper transcription instead.
  lyrics: (
    artist: string,
    title: string,
    deezerId?: string,
    variant?: "ai",
    options?: { album?: string; duration_sec?: number },
  ) => {
    const parts = [
      `artist=${encodeURIComponent(artist)}`,
      `title=${encodeURIComponent(title)}`,
    ];
    if (deezerId) parts.push(`deezer_id=${encodeURIComponent(deezerId)}`);
    if (variant) parts.push(`variant=${encodeURIComponent(variant)}`);
    if (options?.album) parts.push(`album=${encodeURIComponent(options.album)}`);
    if (typeof options?.duration_sec === "number" && Number.isFinite(options.duration_sec) && options.duration_sec > 0) {
      parts.push(`duration_sec=${encodeURIComponent(String(Math.round(options.duration_sec)))}`);
    }
    return req<LyricsResponse>(`/lyrics?${parts.join("&")}`, { timeoutMs: 300_000 });
  },

  // Deezer playlist (public) → playable tracks
  deezerPlaylist: (id: string) =>
    req<DeezerPlaylistDetail>(`/deezer-playlist/${encodeURIComponent(id)}`),

  // Song radio (seed track → similar tracks) & multi-seed radio (playlists/liked)
  radio: (deezerId: string) =>
    req<Track[]>(`/radio/${encodeURIComponent(deezerId)}`, { timeoutMs: DISCOVERY_TIMEOUT_MS }),
  radioSeed: (body: {
    track_ids?: string[];
    exclude_ids?: string[];
    mood_tag?: string;
    limit?: number;
  }) =>
    req<Track[]>(`/radio/seed`, {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: DISCOVERY_TIMEOUT_MS,
    }),

  // Playlist deduplication, offline sync manifest & taste blend
  playlistDuplicates: (id: string) =>
    req<PlaylistDuplicatesResponse>(`/playlists/${encodeURIComponent(id)}/duplicates`),
  deduplicatePlaylist: (id: string) =>
    req<PlaylistDeduplicateResponse>(`/playlists/${encodeURIComponent(id)}/deduplicate`, {
      method: "POST",
    }),
  playlistSyncManifest: (
    id: string,
    options?: { include_lyrics?: boolean; preload?: boolean },
  ) => {
    const params = new URLSearchParams();
    if (options?.include_lyrics) params.set("include_lyrics", "true");
    if (options?.preload !== undefined) params.set("preload", String(options.preload));
    const qs = params.toString();
    return req<PlaylistSyncManifest>(
      `/playlists/${encodeURIComponent(id)}/sync-manifest${qs ? `?${qs}` : ""}`,
      { timeoutMs: 60_000 },
    );
  },
  playlistBlend: (otherUserId: string | number) =>
    req<BlendResult>(`/playlists/blend/${encodeURIComponent(String(otherUserId))}`, {
      method: "POST",
      timeoutMs: DISCOVERY_TIMEOUT_MS,
    }),

  // Profile / avatar / public profile / social activity
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<User>(`/me/avatar`, { method: "PUT", body: form });
  },
  publicProfile: (id: string) => req<PublicProfile>(`/users/${encodeURIComponent(id)}`),
  socialActivity: () => req<SocialActivityResponse>(`/social/activity`),

  // Play tracking + stats
  recordPlay: (track: Track, idempotencyKey?: string) => {
    const key =
      idempotencyKey ??
      (typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `play-${String(track.id)}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    return req<void>(`/me/plays`, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(track),
    });
  },
  stats: () => req<unknown>(`/me/stats`),
  statsInsights: (range: StatsInsightsRange = "30d") =>
    req<unknown>(`/me/stats/insights?range=${encodeURIComponent(range)}`),
  statsWrapped: (range: StatsInsightsRange = "30d") =>
    req<unknown>(`/me/stats/wrapped?range=${encodeURIComponent(range)}`),

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

  // Admin system status / health & usage
  adminStatus: () => req<SystemStatus>(`/admin/status`),
  adminUsage: (range: AdminUsageRange = "all") =>
    req<unknown>(`/admin/usage?range=${encodeURIComponent(range)}`),
  adminUsageUser: (userId: string | number, range: AdminUsageRange = "all") =>
    req<unknown>(
      `/admin/usage/users/${encodeURIComponent(String(userId))}?range=${encodeURIComponent(range)}`,
    ),

  // Admin storage overview + invites
  adminStorage: () => req<StorageInfo>(`/admin/storage`),
  adminStorageCleanup: () =>
    req<{ removed: number; freed_bytes: number }>(`/admin/storage/cleanup`, {
      method: "POST",
    }),
  adminDeduplicateLikes: () =>
    req<LikesDeduplicationResult>(`/admin/likes/deduplicate`, {
      method: "POST",
      timeoutMs: 300_000,
    }),
  adminInvites: () => req<InviteInfo[]>(`/admin/invites`),
  adminCreateInvite: () => req<InviteInfo>(`/admin/invites`, { method: "POST" }),

  // Party mode (collaborative Jam shared queue)
  /** Return the signed-in user's active Jam session, or null. */
  activeParty: () => req<PartyState | null>(`/party/active`),
  /** Start a party; `start` seeds it with the host's queue and playhead. */
  createParty: (name?: string, start?: PartyStart) =>
    req<PartyState>(`/party`, {
      method: "POST",
      body: JSON.stringify({ name: name ?? "", ...start }),
    }),
  getParty: (code: string) => req<PartyState>(`/party/${encodeURIComponent(code)}`),
  /** Track ids stored on the server, scoped to any valid party actor (including anonymous guests). */
  partyCachedTracks: (code: string) =>
    req<{ ids: string[] }>(`/party/${encodeURIComponent(code)}/cached-tracks`),
  joinParty: (code: string) =>
    req<PartyState>(`/party/${encodeURIComponent(code)}/join`, { method: "POST" }),
  /** Join anonymously with a nickname; the server sets a party-scoped cookie. */
  joinPartyAsGuest: (code: string, nickname: string) =>
    req<PartyState>(`/party/${encodeURIComponent(code)}/guest`, {
      method: "POST",
      body: JSON.stringify({ nickname }),
    }),
  partyUpdateSettings: (code: string, patch: PartySettingsUpdate) =>
    req<PartyState>(`/party/${encodeURIComponent(code)}/settings`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  partyAddTrack: (code: string, track: Track, insert: "end" | "next" = "end") =>
    req<void>(
      `/party/${encodeURIComponent(code)}/tracks${insert === "next" ? "?insert=next" : ""}`,
      {
        method: "POST",
        body: JSON.stringify(track),
      },
    ),
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
  partyPatchPlayback: (code: string, isPlaying: boolean, positionSec: number) =>
    req<void>(`/party/${encodeURIComponent(code)}/playback`, {
      method: "PATCH",
      body: JSON.stringify({ is_playing: isPlaying, position_sec: positionSec }),
    }),
  leaveParty: (code: string) =>
    req<void>(`/party/${encodeURIComponent(code)}/leave`, { method: "POST" }),
  endParty: (code: string) =>
    req<void>(`/party/${encodeURIComponent(code)}`, { method: "DELETE" }),
  kickPartyMember: (code: string, memberKey: string) =>
    req<void>(
      `/party/${encodeURIComponent(code)}/members/${encodeURIComponent(memberKey)}`,
      { method: "DELETE" },
    ),
  partySavePlaylist: (
    code: string,
    body: { name?: string; collaborative?: boolean },
  ) =>
    req<PlaylistSummary>(`/party/${encodeURIComponent(code)}/save-playlist`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  partyTransferHost: (code: string, memberKey: string) =>
    req<PartyState>(`/party/${encodeURIComponent(code)}/host`, {
      method: "PATCH",
      body: JSON.stringify({ member_key: memberKey }),
    }),
  partyAutoDjFill: (code: string, count = 5) =>
    req<PartyState>(
      `/party/${encodeURIComponent(code)}/auto-dj/fill?count=${encodeURIComponent(String(count))}`,
      { method: "POST", timeoutMs: DISCOVERY_TIMEOUT_MS },
    ),
  partyReact: (code: string, emoji: string) =>
    req<PartyReaction>(`/party/${encodeURIComponent(code)}/react`, {
      method: "POST",
      body: JSON.stringify({ emoji }),
    }),
  partyVoteSkip: (code: string) =>
    req<PartyVoteSkipResult>(`/party/${encodeURIComponent(code)}/vote-skip`, {
      method: "POST",
    }),

  // Personal multi-device Connect mode (Spotify Connect-like WS)
  connectTicket: () => req<ConnectTicket>(`/connect/ticket`, { method: "POST" }),
  connectState: () => req<ConnectState>(`/connect/state`),

  // Playlist visibility
  setPlaylistVisibility: (id: string, isPublic: boolean) =>
    req<PlaylistSummary>(`/playlists/${encodeURIComponent(id)}/visibility`, {
      method: "PATCH",
      body: JSON.stringify({ is_public: isPublic }),
    }),
};

export { ApiError };

export function streamUrl(trackId: string, quality?: AudioQuality): string {
  const base = `${BASE}/tracks/${encodeURIComponent(trackId)}/stream`;
  return quality ? `${base}?quality=${encodeURIComponent(quality)}` : base;
}

export function playlistExportUrl(playlistId: string): string {
  return `${BASE}/playlists/${encodeURIComponent(playlistId)}/export`;
}

export function playlistEventsUrl(playlistId: string): string {
  return `${BASE}/playlists/${encodeURIComponent(playlistId)}/events`;
}

export function socialActivityEventsUrl(): string {
  return `${BASE}/social/activity/events`;
}
