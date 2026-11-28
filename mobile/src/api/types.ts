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
  /** Track tempo in beats per minute when known. */
  bpm?: number | null;
  /** Whether the track carries explicit lyrics when known. */
  explicit?: boolean | null;
  /** Stable database identity of this exact occurrence in a playlist detail. */
  playlist_entry_id?: PlaylistEntryId;
  /** User who added this occurrence to a playlist (present on playlist detail tracks). */
  added_by?: PlaylistCollaboratorUser | null;
  /** ISO-8601 UTC timestamp when this occurrence was added to a playlist. */
  added_at?: string | null;
}

export type AudioQualityTier = 'lossless' | 'high' | 'saver';

export interface TrackAudioMeta {
  deezer_id: DeezerId;
  peaks: number[];
  loudness_lufs: number | null;
  loudness_gain_db: number | null;
  loudness_peak: number | null;
  bpm: number | null;
  duration_sec: number | null;
  intro_end_sec: number | null;
  outro_start_sec: number | null;
  analyzed_at: string;
}

export interface BatchPreloadResponse {
  queued: DeezerId[];
  already_cached: DeezerId[];
}

export interface RadioSeedRequest {
  track_ids?: DeezerId[];
  mood_tag?: string | null;
  limit?: number;
  exclude_ids?: DeezerId[];
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
  has_password?: boolean;
  google_linked?: boolean;
}

export interface AuthProviders {
  google: boolean;
}

export interface GoogleMobileStartResponse {
  auth_url: string;
  handoff_secret: string;
  expires_in_sec: number;
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

export type PlaylistInviteCandidateStatus = 'available' | 'invited' | 'collaborator';

/** Approved account found by display name that the owner may invite. */
export interface PlaylistInviteCandidate {
  user: PlaylistCollaboratorUser;
  status: PlaylistInviteCandidateStatus;
}

/** Owner view of a pending invitation the invitee has not answered yet. */
export interface PlaylistOutgoingInvitation {
  invitee: PlaylistCollaboratorUser;
  invited_by: PlaylistCollaboratorUser | null;
  created_at: string;
}

/** What an invitee sees of a playlist before accepting. */
export interface PlaylistInvitationPlaylist {
  playlist_id: number;
  name: string;
  description: string | null;
  cover_url: string | null;
  track_count: number;
  collaborator_count: number;
  owner: PlaylistCollaboratorUser;
}

/** A pending invitation addressed to the current account. */
export interface PlaylistIncomingInvitation {
  id: number;
  playlist: PlaylistInvitationPlaylist;
  invited_by: PlaylistCollaboratorUser | null;
  created_at: string;
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
  preferred_quality?: AudioQualityTier;
  share_listening_activity?: boolean;
  dj_transitions_enabled?: boolean;
}

export interface PlaylistSyncTrackItem {
  playlist_entry_id: PlaylistEntryId;
  deezer_id: DeezerId;
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
  tracks: PlaylistSyncTrackItem[];
  lyrics?: Record<DeezerId, LyricsResponse> | null;
}

export interface PlaylistDuplicateGroup {
  keep_entry_id: PlaylistEntryId;
  duplicate_entry_ids: PlaylistEntryId[];
  title: string;
  artist: string;
  isrc: string;
}

export interface PlaylistDuplicatesResponse {
  playlist_id: number;
  total_duplicates: number;
  groups: PlaylistDuplicateGroup[];
}

export interface PlaylistDeduplicateResult {
  playlist_id: number;
  groups_merged: number;
  removed_count: number;
  removed_entry_ids: PlaylistEntryId[];
  revision: number;
}

export interface PlaylistBlendResult {
  playlist: Playlist;
  match_percent: number;
  shared_artists: string[];
  shared_tracks_count: number;
  other_user: PlaylistCollaboratorUser;
}

export type PlaylistLiveEventType = 'snapshot' | 'updated' | 'revoked' | 'deleted';

export interface PlaylistLiveEvent {
  playlist_id: number;
  revision: number;
  event: PlaylistLiveEventType;
}

export type StatsInsightsRange = '7d' | '30d' | '90d' | 'year' | 'all';

export interface InsightsStatEntry {
  key: string | number;
  label: string;
  sublabel: string;
  cover: string;
  count: number;
}

export interface TimestampedPlay {
  id: DeezerId;
  title: string;
  artist: string;
  artist_id: string | number;
  artists: ArtistRef[];
  album: string;
  album_id: string | number;
  cover: string;
  duration_sec: number;
  played_at: string;
}

export interface UserStatsInsights {
  range: StatsInsightsRange;
  listening_sec: number;
  play_count: number;
  unique_tracks: number;
  unique_artists: number;
  top_tracks: InsightsStatEntry[];
  top_artists: InsightsStatEntry[];
  top_albums: InsightsStatEntry[];
  current_streak_days: number;
  longest_streak_days: number;
  hourly_distribution: number[];
  weekday_distribution: number[];
  new_artists_count: number;
  recent_plays: TimestampedPlay[];
}

export type WrappedChronotype =
  | 'night_owl'
  | 'early_bird'
  | 'day_cruiser'
  | 'evening_viber';

export type WrappedEmblemId =
  | 'moon_wave'
  | 'infinite_vinyl'
  | 'compass_radar'
  | 'tonearm_disc'
  | 'strobe_bars'
  | 'sunrise_pulse'
  | 'flame_metro'
  | 'prism_beat';

export type WrappedEquivalentIcon =
  | 'vinyl'
  | 'movie'
  | 'flight'
  | 'marathon'
  | 'concert';

export type WrappedCardTemplateId =
  | 'summary'
  | 'persona'
  | 'receipt'
  | 'festival'
  | 'obsession'
  | 'aura'
  | 'peak';

export type WrappedThemeId = 'signal' | 'cover' | 'vinyl' | 'neon' | 'paper';

export type WrappedFormat = 'story' | 'square';

export interface WrappedUser {
  display_name: string;
  avatar_url: string;
}

export interface WrappedTotals {
  play_count: number;
  listening_sec: number;
  unique_tracks: number;
  unique_artists: number;
  unique_albums: number;
  new_artists_count: number;
  active_days: number;
  total_days: number;
  avg_daily_sec: number;
  current_streak_days: number;
  longest_streak_days: number;
}

export interface WrappedPersona {
  id: string;
  title: string;
  subtitle: string;
  tagline: string;
  emblem: WrappedEmblemId;
  traits: string[];
}

export interface WrappedAura {
  id: string;
  title: string;
  description: string;
  colors: [string, string, string];
  mood_tags: string[];
}

export interface WrappedRhythm {
  chronotype: WrappedChronotype;
  chronotype_label: string;
  peak_hour: number;
  peak_weekday: number;
  weekend_share_pct: number;
  discovery_score_pct: number;
  repeat_score_pct: number;
  hourly_distribution: number[];
  weekday_distribution: number[];
}

export interface WrappedObsession {
  track_key: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  play_count: number;
  listening_sec: number;
  share_pct: number;
  peak_day_date: string | null;
  peak_day_plays: number;
}

export interface WrappedPeakDay {
  date: string;
  weekday: number;
  play_count: number;
  listening_sec: number;
  top_track_title: string;
  top_track_artist: string;
  top_track_cover: string;
}

export interface WrappedTempo {
  avg_bpm: number;
  min_bpm: number;
  max_bpm: number;
  analyzed_plays: number;
  vibe_label: string;
}

export interface WrappedEquivalent {
  icon: WrappedEquivalentIcon;
  value: string;
  label: string;
}

export interface WrappedRankedItem {
  rank: number;
  key: string;
  label: string;
  sublabel: string;
  cover: string;
  count: number;
  listening_sec: number;
  share_pct: number;
}

export interface WrappedReport {
  range: StatsInsightsRange;
  generated_at: string;
  period_start: string | null;
  period_end: string;
  user: WrappedUser;
  totals: WrappedTotals;
  persona: WrappedPersona | null;
  aura: WrappedAura | null;
  rhythm: WrappedRhythm;
  obsession: WrappedObsession | null;
  peak_day: WrappedPeakDay | null;
  tempo: WrappedTempo | null;
  equivalents: WrappedEquivalent[];
  top_tracks: WrappedRankedItem[];
  top_artists: WrappedRankedItem[];
  top_albums: WrappedRankedItem[];
}

export interface FriendActivityItem {
  user_id: number;
  display_name: string | null;
  avatar_url: string | null;
  is_playing: boolean;
  track: Track | null;
  device_name: string | null;
  device_type: ConnectDeviceType | null;
  party_code: string | null;
  updated_at: string | null;
}

export interface SocialActivityResponse {
  items: FriendActivityItem[];
  server_time: string;
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
  target_playlist_id?: number | null;
  create_playlist_name?: string | null;
  created_playlist_id?: number | null;
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

/** `cached` is present only when the server serves a persisted lyrics row. */
export interface LyricsResponse {
  lines: LyricsLine[] | null;
  synced: boolean;
  instrumental?: boolean;
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
  /** Optional ReplayGain/R128 track gain adjustment in dB. */
  loudness_gain_db?: number | null;
}

export type PartyLoadState = 'ready' | 'loading' | 'queued' | 'failed' | 'idle';

export interface PartyReaction {
  id: string;
  emoji: string;
  member_key: string;
  member_name: string;
  created_at: string;
}

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
  auto_dj?: boolean;
  skip_votes?: string[];
  skip_votes_needed?: number;
  latest_reaction?: PartyReaction | null;
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

export interface PartyVoteSkipResult {
  code: string;
  track_item_id: number;
  votes: string[];
  votes_needed: number;
  skipped: boolean;
  state: PartyState;
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

export type AdminUsageRange = '7d' | '30d' | 'all';

export type AdminTrackRequestSource =
  | 'stream'
  | 'preload'
  | 'playlist_export'
  | 'party_preload'
  | 'radar_preload'
  | 'lyrics_ai';

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
  id: number;
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
  source: AdminTrackRequestSource;
  requests: number;
  materialized: number;
  materialized_bytes: number;
}

export interface AdminConnectDevice {
  device_id: string;
  name: string;
  device_type: ConnectDeviceType;
  is_active: boolean;
  party_code: string | null;
  connected_at: string;
  last_seen_at: string;
}

export interface AdminStatEntry {
  key: string;
  label: string;
  sublabel: string;
  cover: string;
  count: number;
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
  source: AdminTrackRequestSource;
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
  top_tracks: AdminStatEntry[];
  top_artists: AdminStatEntry[];
  recent_plays: AdminRecentPlay[];
  recent_requests: AdminRecentTrackRequest[];
}
