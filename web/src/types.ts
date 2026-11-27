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
  /** International Standard Recording Code (uppercase alphanumeric); empty when unknown. */
  isrc?: string;
  /** ReplayGain/R128 track gain adjustment in dB when upstream metadata provides it. */
  loudness_gain_db?: number | null;
  /** Integrated track loudness in LUFS/LKFS when measured or supplied by the backend. */
  loudness_lufs?: number | null;
  /** True/sample peak as a linear full-scale ratio when known. */
  loudness_peak?: number | null;
  /** Tempo in beats per minute when known. */
  bpm?: number | null;
  /** Explicit lyrics flag when known. */
  explicit?: boolean | null;
}

export type AudioQuality = "lossless" | "high" | "saver";

export interface TrackAudioMeta {
  deezer_id: string;
  peaks: number[];
  loudness_lufs: number | null;
  loudness_gain_db: number | null;
  loudness_peak: number | null;
  bpm: number | null;
  duration_sec: number | null;
  intro_end_sec: number | null;
  outro_start_sec: number | null;
  analyzed_at: string | null;
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
  preferred_quality?: AudioQuality;
  share_listening_activity?: boolean;
  /** Beat-matched DJ transitions; only the Android player implements them. */
  dj_transitions_enabled?: boolean;
}

export type TrackTransitionKind = "crossfade" | "smart-crossfade";
export type TrackTransitionOutcome = "completed" | "cancelled";

export interface TrackTransition {
  /** Monotonic sequence ID unique to each live transition run. */
  id: number;
  /** "smart-crossfade" when server-analyzed outro/intro cues adjusted the blend; otherwise "crossfade". */
  kind: TrackTransitionKind;
  /** Track currently fading out (matches `currentTrack(state)` throughout the overlap). */
  outgoing: Track;
  /** Track currently fading in. */
  incoming: Track;
  /** Queue index of `outgoing`. */
  outgoingIndex: number;
  /** Queue index of `incoming`. */
  incomingIndex: number;
  /** Monotonic `performance.now()` timestamp (ms) when audible overlap began. */
  startedAtMs: number;
  /** Total wall-clock duration (ms) of the audible overlap (> 0). */
  durationMs: number;
  /**
   * Normalized 0..1 progress snapshot (updated at ~10 Hz by PlaybackEngine
   * during active transitions, and directly usable in unit tests / frozen snapshots).
   */
  progress: number;
}

export interface TrackTransitionEnd {
  id: number;
  kind: TrackTransitionKind;
  outcome: TrackTransitionOutcome;
  outgoing: Track;
  incoming: Track;
  /** Monotonic `performance.now()` timestamp (ms) when the transition ended. */
  endedAtMs: number;
}

export interface LyricsWord {
  t: number;
  end: number;
  text: string;
}

export interface LyricsLine {
  t: number;
  text: string;
  words?: LyricsWord[];
}

export interface LyricsResponse {
  lines: LyricsLine[] | null;
  synced: boolean;
  source?: string | null;
  ai_generated?: boolean;
  cached?: boolean;
  instrumental?: boolean;
}

export type StatsInsightsRange = "7d" | "30d" | "90d" | "year" | "all";

export interface TimestampedPlay extends RecentPlay {
  played_at: string;
}

export interface UserStatsInsights {
  range: StatsInsightsRange;
  listening_sec: number;
  play_count: number;
  unique_tracks: number;
  unique_artists: number;
  top_tracks: StatEntry[];
  top_artists: StatEntry[];
  top_albums: StatEntry[];
  current_streak_days: number;
  longest_streak_days: number;
  hourly_distribution: number[];
  weekday_distribution: number[];
  new_artists_count: number;
  recent_plays: TimestampedPlay[];
}

export interface SocialActivityItem {
  user_id: number;
  display_name: string;
  avatar_url: string | null;
  is_playing: boolean;
  track: Track | null;
  device_name: string | null;
  device_type: DeviceType | null;
  party_code: string | null;
  updated_at: string | null;
}

export interface SocialActivityResponse {
  items: SocialActivityItem[];
  server_time: string;
}

export interface BlendResult {
  playlist: Playlist;
  match_percent: number;
  shared_artists: string[];
  shared_tracks_count: number;
  other_user: PlaylistCollaboratorUser;
}

export interface PlaylistSyncTrack {
  playlist_entry_id: number;
  deezer_id: string;
  title: string;
  artist: string;
  duration_sec: number;
  is_stored: boolean;
  size_bytes: number | null;
  audio_format: string | null;
  loudness_gain_db: number | null;
  loudness_lufs: number | null;
  loudness_peak: number | null;
  has_lyrics: boolean;
}

export interface PlaylistSyncManifest {
  playlist_id: number;
  revision: number;
  track_count: number;
  stored_count: number;
  total_known_bytes: number;
  tracks: PlaylistSyncTrack[];
  lyrics?: Record<string, LyricsResponse> | null;
}

export interface PlaylistDuplicateGroup {
  keep_entry_id: number;
  duplicate_entry_ids: number[];
  title: string;
  artist: string;
  isrc: string | null;
}

export interface PlaylistDuplicatesResponse {
  playlist_id: number;
  total_duplicates: number;
  groups: PlaylistDuplicateGroup[];
}

export interface PlaylistDeduplicateResponse {
  playlist_id: number;
  groups_merged: number;
  removed_count: number;
  removed_entry_ids: number[];
  revision: number;
}

export interface PlaylistSseEvent {
  playlist_id: number;
  revision: number;
  event: "snapshot" | "updated" | "revoked" | "deleted";
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

export type PlaylistRole = "owner" | "editor";

export interface PlaylistCollaboratorUser {
  id: number;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface PlaylistCollaborator {
  user_id: number;
  display_name?: string | null;
  avatar_url?: string | null;
  role: PlaylistRole;
  joined_at?: string | null;
}

export type PlaylistInviteCandidateStatus = "available" | "invited" | "collaborator";

/** An approved account the owner found by display name (never by email). */
export interface PlaylistInviteCandidate {
  user: PlaylistCollaboratorUser;
  status: PlaylistInviteCandidateStatus;
}

/** Owner view of an invitation the invitee has not answered yet. */
export interface PlaylistOutgoingInvitation {
  invitee: PlaylistCollaboratorUser;
  invited_by?: PlaylistCollaboratorUser | null;
  created_at: string;
}

/** What an invitee sees of a playlist before accepting. */
export interface PlaylistInvitationPlaylist {
  playlist_id: number;
  name: string;
  description?: string | null;
  cover_url?: string | null;
  track_count: number;
  collaborator_count: number;
  owner: PlaylistCollaboratorUser;
}

/** A pending invitation addressed to the current account. */
export interface PlaylistIncomingInvitation {
  id: number;
  playlist: PlaylistInvitationPlaylist;
  invited_by?: PlaylistCollaboratorUser | null;
  created_at: string;
}

export interface PlaylistJoinResult {
  playlist_id: number;
  playlist_name: string;
  joined: boolean;
  already_member: boolean;
  role: PlaylistRole;
}

export interface PlaylistTrack extends Track {
  /** Stable occurrence ID on the server (used for duplicate-safe remove/reorder). */
  playlist_entry_id?: number;
  added_by?: PlaylistCollaboratorUser | null;
  added_at?: string | null;
}

export interface PlaylistSummary {
  id: string | number;
  name: string;
  description?: string;
  cover_url?: string;
  track_count: number;
  is_public?: boolean;
  owner_id?: number | null;
  owner_name?: string | null;
  owner_avatar_url?: string | null;
  is_collaborative?: boolean;
  is_owner?: boolean;
  is_collaborator?: boolean;
  can_edit_tracks?: boolean;
  collaborator_count?: number;
}

export interface Playlist {
  id: string | number;
  name: string;
  description?: string;
  cover_url?: string;
  is_public?: boolean;
  is_owner?: boolean;
  owner_id?: number | null;
  owner_name?: string | null;
  owner_avatar_url?: string | null;
  is_collaborative?: boolean;
  is_collaborator?: boolean;
  can_edit_tracks?: boolean;
  collaborators?: PlaylistCollaborator[];
  collaborator_count?: number;
  revision?: number;
  tracks: PlaylistTrack[];
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
  /** ReplayGain/R128 track gain adjustment in dB when known. */
  loudness_gain_db?: number | null;
}

export type PartyLoadState = "ready" | "loading" | "queued" | "failed" | "idle";

export interface PartyReaction {
  id: string;
  emoji: string;
  member_key: string;
  member_name: string;
  created_at: string;
}

export interface PartyVoteSkipResult {
  code: string;
  track_item_id: number;
  votes: string[];
  votes_needed: number;
  skipped: boolean;
  state: PartyState;
}

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
  /** Auto-DJ automatically tops up the queue when <= 1 track remains. */
  auto_dj?: boolean;
  /** Member keys that voted to skip the current track. */
  skip_votes?: string[];
  /** Number of votes needed to trigger an automatic skip. */
  skip_votes_needed?: number;
  /** Most recent live emoji reaction broadcast via SSE. */
  latest_reaction?: PartyReaction | null;
}

export interface PartySettingsUpdate {
  name?: string | null;
  guests_can_control?: boolean | null;
  auto_dj?: boolean | null;
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

export interface LikesDeduplicationResult {
  users_processed: number;
  likes_scanned: number;
  isrc_backfilled: number;
  duplicate_groups_merged: number;
  likes_removed: number;
  playlist_tracks_backfilled: number;
  unresolved_tracks: string[];
  errors: string[];
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
  /** Populated automatically when the job targeted or created a playlist. */
  created_playlist_id?: number | null;
}

export interface ImportJobCreateOptions {
  target_playlist_id?: number | null;
  create_playlist_name?: string | null;
}

export interface ImportJobDetail extends ImportJobStatus {
  result: ResolveResult | null;
}

export type AdminUsageRange = "7d" | "30d" | "all";

export type TrackRequestSource =
  | "stream"
  | "preload"
  | "playlist_export"
  | "party_preload"
  | "radar_preload"
  | "lyrics_ai";

export interface AdminOverviewStorage {
  cached_tracks: number;
  total_audio_bytes: number;
  exclusive_audio_bytes: number;
  exclusive_audio_tracks: number;
  shared_audio_bytes: number;
  shared_audio_tracks: number;
  unattributed_audio_bytes: number;
  unattributed_audio_tracks: number;
  directly_attributed_tracks: number;
  directly_attributed_bytes: number;
  upload_bytes: number;
  disk_total: number;
  disk_used: number;
  disk_free: number;
  retention_days: number;
}

export interface AdminUsageOverview {
  total_users: number;
  approved_users: number;
  pending_users: number;
  active_users: number;
  total_plays: number;
  total_listening_sec: number;
  unique_tracks_played: number;
  tracks_requested: number;
  tracks_materialized: number;
  materialized_bytes: number;
  online_connect_devices: number;
  online_connect_users: number;
  active_parties: number;
  storage: AdminOverviewStorage;
}

export interface AdminUserStorage {
  exclusive_bytes: number;
  exclusive_tracks: number;
  shared_bytes: number;
  shared_tracks: number;
  accessed_bytes: number;
  accessed_tracks: number;
  materialized_bytes: number;
  materialized_tracks: number;
  pinned_bytes: number;
  pinned_tracks: number;
  upload_bytes: number;
}

export interface AdminUserStorageBreakdown extends AdminUserStorage {
  total_cache_bytes: number;
}

export interface AdminUserLibrary {
  likes: number;
  playlists: number;
  public_playlists: number;
  playlist_tracks: number;
  follows: number;
  party_tracks_added: number;
  party_hosted: number;
  import_jobs: number;
  import_tracks_matched: number;
}

export interface AdminUserUsageSummary {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  is_approved: boolean;
  created_at: string | null;
  last_active_at: string | null;
  plays: number;
  listening_sec: number;
  unique_tracks: number;
  tracks_requested: number;
  tracks_materialized: number;
  materialized_bytes: number;
  storage: AdminUserStorage;
  library: AdminUserLibrary;
  online_devices: number;
  is_playing_now: boolean;
  active_device_name: string | null;
  active_party_code: string | null;
}

export interface AdminUsageOverviewResponse {
  range: AdminUsageRange;
  generated_at: string;
  request_tracking_since: string | null;
  overview: AdminUsageOverview;
  users: AdminUserUsageSummary[];
}

export interface AdminRequestSourceStat {
  source: TrackRequestSource;
  requests: number;
  materialized: number;
  materialized_bytes: number;
}

export interface AdminConnectDevice {
  device_id: string;
  name: string;
  device_type: DeviceType;
  is_active: boolean;
  party_code: string | null;
  connected_at: string;
  last_seen_at: string;
}

export interface AdminRecentPlay {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration_sec: number;
  played_at: string;
}

export interface AdminRecentTrackRequest {
  deezer_id: string;
  title: string;
  artist: string;
  cover: string;
  source: TrackRequestSource;
  materialized: boolean;
  size_bytes: number;
  requested_at: string;
  is_currently_stored: boolean;
}

export interface AdminUserUsageDetailResponse {
  range: AdminUsageRange;
  generated_at: string;
  request_tracking_since: string | null;
  user: AdminUserUsageSummary;
  storage_breakdown: AdminUserStorageBreakdown;
  requests_by_source: AdminRequestSourceStat[];
  active_devices: AdminConnectDevice[];
  top_tracks: StatEntry[];
  top_artists: StatEntry[];
  recent_plays: AdminRecentPlay[];
  recent_requests: AdminRecentTrackRequest[];
}
