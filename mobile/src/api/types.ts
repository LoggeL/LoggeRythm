/** Mirrors the backend wire format in `api/app/schemas/track.py`. */
export type DeezerId = string;
export type PlaylistEntryId = number;

export interface ArtistRef {
  id: string | number;
  name: string;
}

export interface Track {
  id: DeezerId;
  title: string;
  artist: string;
  artist_id: string | number;
  artists: ArtistRef[];
  album: string;
  album_id: string | number;
  cover: string;
  duration_sec: number;
  preview_url: string | null;
  rank: number;
  release_date: string;
  /** International Standard Recording Code (uppercase alphanumeric); empty when unknown. */
  isrc?: string;
  /** ReplayGain/R128 track gain adjustment in dB when upstream metadata provides it. */
  loudness_gain_db?: number | null;
  /** Integrated track loudness in LUFS/LKFS when measured or supplied by the backend. */
  loudness_lufs?: number | null;
  /** True/sample peak as a linear full-scale ratio when known. */
  loudness_peak?: number | null;
  /** Stable database identity of this exact occurrence in a playlist detail. */
  playlist_entry_id?: PlaylistEntryId;
  /** User who added this occurrence to a playlist (present on playlist detail tracks). */
  added_by?: PlaylistCollaboratorUser | null;
  /** ISO-8601 UTC timestamp when this occurrence was added to a playlist. */
  added_at?: string | null;
}

/** Fail closed when a playlist mutation is attempted with catalog-only data. */
export function playlistEntryId(
  track: Pick<Track, 'playlist_entry_id'>,
): PlaylistEntryId {
  const entryId = track.playlist_entry_id;
  if (entryId === undefined || !Number.isSafeInteger(entryId) || entryId <= 0) {
    throw new Error('Playlist track is missing a stable positive entry id');
  }
  return entryId;
}

/** Request shape accepted by the backend Track model (only `id` is required). */
export interface TrackInput {
  id: DeezerId;
  title?: string;
  artist?: string;
  artist_id?: string | number;
  artists?: ArtistRef[];
  album?: string;
  album_id?: string | number;
  cover?: string;
  duration_sec?: number;
  preview_url?: string | null;
  rank?: number;
  release_date?: string;
  isrc?: string;
  loudness_gain_db?: number | null;
  loudness_lufs?: number | null;
  loudness_peak?: number | null;
}

/** Response of `POST /api/auth/login` and `GET /api/auth/me` (`UserOut`). */
export interface User {
  id: number;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  is_approved: boolean;
  avatar_url: string | null;
}

export type PlaylistRole = 'owner' | 'editor';
export type PlaylistListScope = 'all' | 'owned' | 'collaborative';

export interface PlaylistCollaboratorUser {
  id: number;
  display_name: string | null;
  avatar_url: string | null;
}

export interface PlaylistCollaborator {
  user_id: number;
  display_name: string | null;
  avatar_url: string | null;
  role: PlaylistRole;
  joined_at: string | null;
}

export interface PlaylistInvite {
  token: string;
  created_at: string;
  expires_at: string | null;
}

export interface PlaylistInviteStatus {
  invite: PlaylistInvite | null;
}

export interface PlaylistInvitePreview {
  playlist_id: number;
  name: string;
  description: string | null;
  cover_url: string | null;
  track_count: number;
  collaborator_count: number;
  owner: PlaylistCollaboratorUser;
  is_owner: boolean;
  already_collaborator: boolean;
}

export interface PlaylistJoinResult {
  playlist_id: number;
  playlist_name: string;
  joined: boolean;
  already_member: boolean;
  role: PlaylistRole;
}

export interface PlaylistSummary {
  id: number;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  track_count: number;
  owner_id: number | null;
  owner_name: string | null;
  owner_avatar_url: string | null;
  is_collaborative: boolean;
  is_owner: boolean;
  is_collaborator: boolean;
  can_edit_tracks: boolean;
  collaborator_count: number;
}

export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  is_owner: boolean;
  owner_id: number | null;
  owner_name: string | null;
  owner_avatar_url: string | null;
  is_collaborative: boolean;
  is_collaborator: boolean;
  can_edit_tracks: boolean;
  collaborators: PlaylistCollaborator[];
  collaborator_count: number;
  revision: number;
  tracks: Track[];
}

export interface AlbumDetail {
  id: DeezerId;
  title: string;
  artist: string;
  artist_id: string | number;
  cover: string;
  release_date: string;
  nb_tracks: number;
  tracks: Track[];
}

/** Album card returned by browse, genre, and artist-detail endpoints. */
export interface AlbumSummary {
  id: DeezerId;
  title: string;
  artist: string;
  cover: string;
  release_date: string;
}

/** Artist card returned by search, browse, follow, and profile endpoints. */
export interface ArtistSummary {
  id: DeezerId;
  name: string;
  picture: string;
}

export interface ArtistDetail extends ArtistSummary {
  fans: number;
  albums_count: number;
  top: Track[];
  albums: AlbumSummary[];
  related: ArtistSummary[];
}

export interface ArtistAbout {
  bio: string;
  listeners: number;
  playcount: number;
  tags: string[];
}

/** `/api/search?type=album` is currently serialized through the Track schema. */
export type AlbumSearchResult = Track;

export interface PlaylistSearchResult {
  id: DeezerId;
  title: string;
  cover: string;
  track_count: number;
}

export interface Genre {
  id: DeezerId;
  name: string;
  picture: string;
}

export interface GenreDetail extends Genre {
  tracks: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
}

export interface HomeShelf {
  key: string;
  title: string;
  subtitle: string;
  cover: string;
  tracks: Track[];
}

/** `followed` wins when the source artist is both followed and played. */
export type RadarReasonKind = 'followed' | 'played';

/**
 * Why a track is in the Release Radar (`RadarReason` in `api/app/schemas/track.py`).
 * Names the watched *source* artist whose release list produced the track, which
 * is not necessarily the track's primary artist.
 */
export interface RadarReason {
  kind: RadarReasonKind;
  /** The watched source artist; compare with `track.artist_id` to spot a contribution. */
  artist_id: DeezerId;
  /** From the account's own follow/play rows; `''` when none of them stored a name. */
  artist_name: string;
  /** The account's plays of the source artist in the last 90 days; 0 if none. */
  play_count: number;
}

/**
 * One Release Radar row. The wire object is a flat `Track` plus `radar_reason`;
 * it is split here so `track` stays a plain `Track` that can be played, liked,
 * queued and downloaded through the strict track validators unchanged, and the
 * reason can never leak into a persisted track record.
 */
export interface ReleaseRadarEntry {
  track: Track;
  radar_reason: RadarReason;
}

export interface PublicProfile {
  id: number;
  display_name: string | null;
  avatar_url: string | null;
  playlists: PlaylistSummary[];
  top_artists: ArtistSummary[];
}

export interface PlaybackSettings {
  crossfade_enabled: boolean;
  crossfade_duration_sec: number;
}

export interface PlaylistCreateRequest {
  name: string;
  description?: string | null;
  is_collaborative?: boolean;
}

export interface PlaylistUpdateRequest {
  name?: string | null;
  description?: string | null;
}

export interface AddedTracksResult {
  added: number;
}

export type ResolveKind = 'playlist' | 'album' | 'track';

export interface UnmatchedTrack {
  title: string;
  artist: string;
}

export interface ResolveResult {
  type: ResolveKind;
  name: string;
  image: string;
  total: number;
  source_total: number;
  matched: number;
  tracks: Track[];
  unmatched: UnmatchedTrack[];
}

export type ImportJobState = 'queued' | 'running' | 'done' | 'failed';

/** Progress of a background Spotify import (`/api/resolve/jobs`), without the tracks. */
export interface ImportJobStatus {
  id: string;
  url: string;
  status: ImportJobState;
  /** Empty until Spotify answered. */
  type: ResolveKind | '';
  name: string;
  image: string;
  /** Tracks to match after dedupe and cap; 0 while Spotify is still being read. */
  total: number;
  source_total: number;
  processed: number;
  matched: number;
  /** Deezer lookups that raised; those tracks are listed as unmatched. */
  failed_lookups: number;
  lookup_error: string | null;
  /** Why a failed job ended. */
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface ImportJobDetail extends ImportJobStatus {
  /** Set once the job is done. */
  result: ResolveResult | null;
}

/** The unmodeled Deezer-playlist route omits Track.release_date. */
export type DeezerPlaylistTrack = Omit<Track, 'release_date'>;

export interface DeezerPlaylistDetail {
  id: DeezerId;
  name: string;
  cover: string;
  tracks: DeezerPlaylistTrack[];
}

export interface LyricsLine {
  t: number;
  text: string;
}

/** `cached` is present only when the server serves a persisted lyrics row. */
export interface LyricsResponse {
  lines: LyricsLine[] | null;
  synced: boolean;
  source: string | null;
  ai_generated: boolean;
  cached?: true;
}

export interface CachedTrackIds {
  ids: DeezerId[];
}

export interface TrackPlayQuery {
  id: DeezerId;
  artist: string;
  title: string;
}

export interface TrackPlayCount {
  plays: number;
  listeners: number;
}

export type TrackPlayCounts = Record<DeezerId, TrackPlayCount>;

export interface PartyTrack {
  id: number;
  deezer_id: DeezerId;
  title: string;
  artist: string;
  artist_id: string;
  artists: ArtistRef[];
  album: string;
  album_id: string;
  cover: string;
  duration_sec: number;
  added_by: string;
  /** Member key of whoever added it; equals `PartyState.viewer_key` for your own additions. */
  added_by_member: string;
  /** Optional contributor avatar URL for Jam queue rows. */
  added_by_avatar_url: string | null;
  /** Server cache state of the audio, kept warm in the background. */
  load_state: PartyLoadState;
  /** Why the last background load failed (only for `failed`). */
  load_error: string | null;
  /** Authoritative server-stored boolean from backend storage. */
  is_stored: boolean;
}

export type PartyLoadState = 'ready' | 'loading' | 'queued' | 'failed' | 'idle';

export interface PartyMember {
  key: string;
  name: string;
  avatar_url: string | null;
  /** Joined anonymously with a nickname (web guests without an account). */
  is_guest: boolean;
  is_host: boolean;
}

export interface PartyState {
  code: string;
  name: string;
  host_name: string;
  is_host: boolean;
  current_index: number;
  is_playing: boolean;
  position_sec: number;
  playback_updated_at: string | null;
  server_time: string;
  guests_can_control: boolean;
  playback_changed_by: string;
  playback_revision: number;
  ended: boolean;
  members: PartyMember[];
  tracks: PartyTrack[];
  /** Member key of the requesting account ("u:<id>"). */
  viewer_key: string;
  viewer_name: string;
  viewer_is_guest: boolean;
}

export type ConnectDeviceType =
  | 'web'
  | 'mobile'
  | 'tablet'
  | 'desktop'
  | 'tv'
  | 'speaker'
  | 'other';

export interface ConnectDeviceCapabilities {
  can_play_audio: boolean;
  can_control_volume: boolean;
}

export interface ConnectDevice {
  device_id: string;
  name: string;
  device_type: ConnectDeviceType;
  capabilities: ConnectDeviceCapabilities;
  volume: number;
  muted: boolean;
  is_active: boolean;
  party_code: string | null;
  connected_at: string;
  last_seen_at: string;
}

export type ConnectQueueOrigin = 'manual' | 'context';
export type ConnectRepeatMode = 'off' | 'all' | 'one';

export interface ConnectPlaybackState {
  queue: Track[];
  origins: ConnectQueueOrigin[];
  queue_context: string | null;
  current_index: number;
  is_playing: boolean;
  position_sec: number;
  duration_sec: number;
  shuffle: boolean;
  repeat: ConnectRepeatMode;
  volume: number;
  muted: boolean;
  updated_at: string | null;
}

export interface ConnectState {
  revision: number;
  active_device_id: string | null;
  devices: ConnectDevice[];
  playback: ConnectPlaybackState;
  server_time: string;
}

export interface ConnectTicket {
  ticket: string;
  expires_in_sec: number;
}

export type ConnectCommandAction =
  | 'play'
  | 'pause'
  | 'toggle'
  | 'next'
  | 'prev'
  | 'clear_queue'
  | 'seek'
  | 'set_volume'
  | 'set_mute'
  | 'set_shuffle'
  | 'set_repeat'
  | 'play_tracks'
  | 'queue_add'
  | 'queue_play_next'
  | 'queue_remove'
  | 'queue_reorder'
  | 'select_index';

export interface ConnectCommandPayloadMap {
  play: Record<string, never>;
  pause: Record<string, never>;
  toggle: Record<string, never>;
  next: Record<string, never>;
  prev: Record<string, never>;
  clear_queue: Record<string, never>;
  seek: { position_sec: number };
  set_volume: { volume: number };
  set_mute: { muted: boolean };
  set_shuffle: { shuffle: boolean };
  set_repeat: { repeat: ConnectRepeatMode };
  play_tracks: {
    tracks: Track[];
    start_index: number;
    queue_context?: string | null;
    origins?: ConnectQueueOrigin[];
  };
  queue_add: { track: Track };
  queue_play_next: { track: Track };
  queue_remove: { index: number };
  queue_reorder: { from_index: number; to_index: number };
  select_index: { index: number };
}

export type ConnectPlaybackInput = Omit<ConnectPlaybackState, 'updated_at'>;

export type ConnectClientFrame =
  | {
      type: 'register';
      device_id: string;
      name: string;
      device_type: ConnectDeviceType;
      capabilities?: ConnectDeviceCapabilities;
      volume?: number;
      muted?: boolean;
      party_code?: string | null;
      take_active?: boolean;
      playback?: ConnectPlaybackInput;
    }
  | { type: 'ping' }
  | { type: 'pong' }
  | {
      type: 'update_device';
      name?: string;
      volume?: number;
      muted?: boolean;
      party_code?: string | null;
    }
  | {
      type: 'playback_state';
      claim_active?: boolean;
      state: ConnectPlaybackInput;
    }
  | {
      type: 'transfer';
      target_device_id: string;
      play?: boolean;
      request_id?: string;
    }
  | {
      type: 'command';
      request_id?: string;
      target_device_id?: string | null;
      action: ConnectCommandAction;
      payload?: Record<string, unknown>;
    }
  | {
      type: 'command_ack';
      command_id: string;
      ok: boolean;
      error?: string | null;
    };

export type ConnectServerFrame =
  | {
      type: 'welcome';
      self_device_id: string;
      heartbeat_interval_sec: number;
      state: ConnectState;
    }
  | {
      type: 'state';
      state: ConnectState;
    }
  | {
      type: 'activate';
      from_device_id: string | null;
      playback: ConnectPlaybackState;
    }
  | {
      type: 'deactivated';
      new_active_device_id: string;
      reason: 'transferred' | 'claimed_by_other_device';
    }
  | {
      type: 'command';
      command_id: string;
      request_id: string | null;
      from_device_id: string;
      action: ConnectCommandAction;
      payload: Record<string, unknown>;
    }
  | {
      type: 'command_result';
      request_id: string | null;
      command_id: string;
      ok: boolean;
      error: string | null;
    }
  | {
      type: 'ping' | 'pong';
      ts: string;
    }
  | {
      type: 'error';
      code: string;
      detail: string;
      request_id: string | null;
    };

export interface AdminUser {
  id: number;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  is_approved: boolean;
  created_at: string | null;
}

export interface AdminStorageItem {
  deezer_id: DeezerId;
  title: string;
  artist: string;
  size_bytes: number;
  last_accessed: string | null;
}

export interface AdminStorageInfo {
  track_count: number;
  total_bytes: number;
  disk_total: number;
  disk_used: number;
  disk_free: number;
  retention_days: number;
  tracks: AdminStorageItem[];
}

export interface AdminInvite {
  code: string;
  url: string;
  used_by_name: string | null;
  created_at: string;
}

export interface AdminStatus {
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
  };
  system: {
    app_env: string;
    database: string;
    jwt_secure: boolean;
    cookie_secure: boolean;
  };
}

export interface StorageCleanupResult {
  removed: number;
  freed_bytes: number;
}
