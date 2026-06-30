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
  sublabel?: string;
  cover?: string;
  count: number;
}

export interface UserStats {
  total_plays: number;
  top_tracks: StatEntry[];
  top_artists: StatEntry[];
  recent: Track[];
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

export interface Album {
  id: string | number;
  title: string;
  artist: string;
  artist_id?: string | number;
  cover: string;
  release_date?: string;
  nb_tracks?: number;
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
}

export interface PartyMember {
  name: string;
  avatar_url?: string | null;
}

export interface PartyState {
  code: string;
  name: string;
  host_name: string;
  is_host: boolean;
  current_index: number;
  members: PartyMember[];
  tracks: PartyTrack[];
}

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
