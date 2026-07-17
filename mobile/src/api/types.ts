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
  /** Stable database identity of this exact occurrence in a playlist detail. */
  playlist_entry_id?: PlaylistEntryId;
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

export interface PlaylistSummary {
  id: number;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  track_count: number;
  owner_name: string | null;
}

export interface Playlist {
  id: number;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  is_owner: boolean;
  owner_name: string | null;
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
}

export interface PartyMember {
  name: string;
  avatar_url: string | null;
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
  members: PartyMember[];
  tracks: PartyTrack[];
}

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
