export interface ArtistRef {
  id: string | number;
  name: string;
}

export interface Track {
  id: string;
  title: string;
  /** Primary performer (drives lyrics/Last.fm lookups, titles, play history). */
  artist: string;
  artist_id?: string | number;
  /** Full performer credit list when a track has more than one artist. */
  artists?: ArtistRef[];
  album: string;
  album_id?: string | number;
  cover: string;
  duration_sec: number;
  preview_url?: string;
  /** Deezer popularity rank (0–~1,000,000); 0/undefined when unknown. */
  rank?: number;
  /** Release date (YYYY-MM-DD); set by the release radar, empty elsewhere. */
  release_date?: string;
  /** ReplayGain/R128 track gain adjustment in dB when upstream metadata provides it. */
  loudness_gain_db?: number | null;
  /** Integrated track loudness in LUFS/LKFS when measured or supplied by the backend. */
  loudness_lufs?: number | null;
  /** True/sample peak as a linear full-scale ratio when known. */
  loudness_peak?: number | null;
}

/** `followed` wins when the source artist is both followed and played. */
export type RadarReasonKind = "followed" | "played";

/**
 * Why a track is in the Release Radar (`RadarReason` in `api/app/schemas/track.py`).
 * Names the watched *source* artist whose release list produced the track, which
 * is not necessarily the track's primary artist.
 */
export interface RadarReason {
  kind: RadarReasonKind;
  /** The watched source artist; compare with `track.artist_id` to spot a contribution. */
  artist_id: string;
  /** From the account's own follow/play rows; "" when none of them stored a name. */
  artist_name: string;
  /** The account's plays of the source artist in the last 90 days; 0 if none. */
  play_count: number;
}

/** A Release Radar track: a normal `Track` plus the reason it is in the radar. */
export interface RadarTrack extends Track {
  radar_reason: RadarReason;
}

export interface User {
  id: string | number;
  email: string;
  display_name: string;
  is_admin?: boolean;
  is_approved?: boolean;
  avatar_url?: string | null;
}

export interface PublicProfile {
  id: string | number;
  display_name: string;
  avatar_url?: string | null;
  playlists: PlaylistSummary[];
  top_artists: ArtistSummary[];
}

export interface StatEntry {
  key: string;
  label: string;
  sublabel: string;
  cover: string;
  count: number;
}

/** Persisted play-history projection; intentionally narrower than Track. */
export interface RecentPlay {
  id: string;
  title: string;
  artist: string;
  artist_id: string;
  artists: ArtistRef[];
  album: string;
  album_id: string;
  cover: string;
  duration_sec: number;
}

export interface UserStats {
  total_plays: number;
  top_tracks: StatEntry[];
  top_artists: StatEntry[];
  recent: RecentPlay[];
  total_plays_month: number;
  top_tracks_month: StatEntry[];
  top_artists_month: StatEntry[];
}

export interface PlaybackSettings {
  crossfade_enabled: boolean;
  crossfade_duration_sec: number;
}

export interface LyricsLine {
  t: number;
  text: string;
}

export interface LyricsResponse {
  lines: LyricsLine[] | null;
  synced: boolean;
  source?: string | null;
  ai_generated?: boolean;
  cached?: boolean;
}

export interface AdminUser {
  id: string | number;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  is_admin: boolean;
  is_approved: boolean;
  created_at: string;
}

export interface AlbumSummary {
  id: string | number;
  title: string;
  artist: string;
  cover: string;
  release_date?: string;
}

/** A Deezer genre an album is filed under (`AlbumGenre` in `api/app/schemas/track.py`). */
export interface AlbumGenre {
  /** Deezer genre id, e.g. "106" for Electro. */
  id: string;
  name: string;
}

export interface Album {
  id: string | number;
  title: string;
  artist: string;
  artist_id?: string | number;
  cover: string;
  release_date?: string;
  nb_tracks?: number;
  /** Most specific first; empty when Deezer files the album under none. */
  genres: AlbumGenre[];
  tracks: Track[];
}

export interface ArtistSummary {
  id: string | number;
  name: string;
  picture: string;
}

export interface Artist {
  id: string | number;
  name: string;
  picture: string;
  fans?: number;
  albums_count?: number;
  top: Track[];
  albums?: AlbumSummary[];
  related?: ArtistSummary[];
}

export interface ArtistAbout {
  bio: string;
  listeners: number;
  playcount: number;
  tags: string[];
}

export interface PlaylistSearchResult {
  id: string | number;
  title: string;
  cover: string;
  track_count: number;
}

export interface PlaylistSummary {
  id: string | number;
  name: string;
  description?: string;
  cover_url?: string;
  track_count: number;
  is_public?: boolean;
  owner_name?: string | null;
}

export interface Playlist {
  id: string | number;
  name: string;
  description?: string;
  cover_url?: string;
  is_public?: boolean;
  is_owner?: boolean;
  owner_name?: string | null;
  tracks: Track[];
}

export interface Genre {
  id: string | number;
  name: string;
  picture: string;
}

export interface GenreDetail {
  id: string | number;
  name: string;
  picture: string;
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
}

export interface DeezerPlaylistDetail {
  id: string | number;
  name: string;
  cover: string;
  tracks: Track[];
}

export interface PartyTrack {
  id: number;
  deezer_id: string;
  title: string;
  artist: string;
  artist_id?: string | number;
  artists?: ArtistRef[];
  album: string;
  album_id?: string | number;
  cover: string;
  duration_sec: number;
  added_by: string;
  /** Member key of whoever added it; equals `PartyState.viewer_key` for your own. */
  added_by_member: string;
  /** Avatar URL of the contributor when they have an account avatar. */
  added_by_avatar_url?: string | null;
  /** Authoritative server-cache status (`storage.is_ready(deezer_id)`). */
  is_stored?: boolean;
  /** Server cache state of the audio, kept warm in the background. */
  load_state: PartyLoadState;
  /** Why the last background load failed (only for `failed`). */
  load_error: string | null;
}

export type PartyLoadState = "ready" | "loading" | "queued" | "failed" | "idle";

export interface PartyMember {
  /** Stable actor key (`u:<id>` or `g:<id>`), used by host kick actions. */
  key?: string;
  name: string;
  avatar_url?: string | null;
  /** Joined anonymously with a nickname. */
  is_guest: boolean;
  /** True for the Jam host. */
  is_host?: boolean;
}

export interface PartyState {
  code: string;
  name: string;
  host_name: string;
  is_host: boolean;
  current_index: number;
  members: PartyMember[];
  tracks: PartyTrack[];
  viewer_key: string;
  viewer_name: string;
  viewer_is_guest: boolean;
  /** When true, participants may also control playback and reorder/remove upcoming tracks. */
  guests_can_control?: boolean;
  /** Actor key of whoever last changed playback/current track. */
  playback_changed_by?: string;
  /** Monotonic revision incremented on explicit playback/current mutations. */
  playback_revision?: number;
  /** Terminal frame sent when the host ends the Jam. */
  ended?: boolean;
  is_playing: boolean;
  position_sec: number;
  /** ISO-8601 timestamp of the last playback update, or null. */
  playback_updated_at: string | null;
  /** Server UTC timestamp for drift compensation. */
  server_time?: string | null;
}

export interface PartySettingsUpdate {
  name?: string | null;
  guests_can_control?: boolean | null;
}

/** The host's player queue and playhead a new party continues from. */
export interface PartyStart {
  tracks: Track[];
  current_index: number;
  is_playing: boolean;
  position_sec: number;
  guests_can_control?: boolean;
}

export type DeviceType =
  | "web"
  | "mobile"
  | "tablet"
  | "desktop"
  | "tv"
  | "speaker"
  | "other";

export interface DeviceCapabilities {
  can_play_audio: boolean;
  can_control_volume: boolean;
}

export interface ConnectDevice {
  device_id: string;
  name: string;
  device_type: DeviceType;
  capabilities: DeviceCapabilities;
  volume: number;
  muted: boolean;
  is_active: boolean;
  party_code: string | null;
  connected_at: string;
  last_seen_at: string;
}

export interface ConnectPlaybackState {
  queue: Track[];
  origins: ("manual" | "context")[];
  queue_context: string | null;
  current_index: number;
  is_playing: boolean;
  position_sec: number;
  duration_sec: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  volume: number;
  muted: boolean;
  updated_at: string | null;
}

export interface ConnectState {
  revision: number;
  active_device_id: string | null;
  devices: ConnectDevice[];
  playback: ConnectPlaybackState;
  server_time?: string;
}

export interface ConnectTicket {
  ticket: string;
  expires_in_sec: number;
}

export type ConnectCommandAction =
  | "play"
  | "pause"
  | "toggle"
  | "next"
  | "prev"
  | "clear_queue"
  | "seek"
  | "set_volume"
  | "set_mute"
  | "set_shuffle"
  | "set_repeat"
  | "play_tracks"
  | "queue_add"
  | "queue_play_next"
  | "queue_remove"
  | "queue_reorder"
  | "select_index";

export interface StorageItem {
  deezer_id: string;
  title: string;
  artist: string;
  size_bytes: number;
  last_accessed?: string | null;
}

export interface StorageInfo {
  track_count: number;
  total_bytes: number;
  disk_total: number;
  disk_used: number;
  disk_free: number;
  retention_days: number;
  tracks: StorageItem[];
}

export interface InviteInfo {
  code: string;
  url: string;
  used_by_name?: string | null;
  created_at: string;
}

export interface SystemStatus {
  deezer: {
    arl_configured: boolean;
    arl_ok: boolean;
    quality: string;
  };
  storage: {
    track_count: number;
    total_bytes: number;
    disk_total: number;
    disk_used: number;
    disk_free: number;
    retention_days: number;
    /** Set when the automatic cleanup daemon crashed; stays stopped until the API restarts. */
    cleanup_stopped_at: string | null;
    cleanup_error: string | null;
  };
  users: {
    total: number;
    approved: number;
    pending: number;
    admins: number;
  };
  content: {
    playlists: number;
    likes: number;
    follows: number;
    plays: number;
    stored_lyrics: number;
    parties: number;
    invites_total: number;
    invites_used: number;
  };
  integrations: {
    spotify_configured: boolean;
    lastfm_configured: boolean;
    mail_configured: boolean;
  };
  system: {
    app_env: string;
    database: string;
    jwt_secure: boolean;
    cookie_secure: boolean;
  };
}

export interface HomeShelf {
  key: string;
  title: string;
  subtitle?: string;
  cover?: string;
  tracks: Track[];
}

export interface ResolveResult {
  type: string; // playlist | album | track
  name: string;
  image: string;
  total: number;
  source_total: number;
  matched: number;
  tracks: Track[];
  unmatched: { title: string; artist: string }[];
}

export type ImportJobState = "queued" | "running" | "done" | "failed";

/** A Spotify import running on the server; the client may leave and come back. */
export interface ImportJobStatus {
  id: string;
  url: string;
  status: ImportJobState;
  type: string;
  name: string;
  image: string;
  /** Tracks to match (after dedupe and cap); 0 until Spotify answered. */
  total: number;
  source_total: number;
  processed: number;
  matched: number;
  /** Deezer lookups that failed with an error; listed as unmatched. */
  failed_lookups: number;
  lookup_error: string | null;
  /** Why a failed job ended. */
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface ImportJobDetail extends ImportJobStatus {
  result: ResolveResult | null;
}
