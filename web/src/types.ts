export interface Track {
  id: string;
  title: string;
  artist: string;
  artist_id?: string | number;
  album: string;
  album_id?: string | number;
  cover: string;
  duration_sec: number;
  preview_url?: string;
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
  top: Track[];
  albums?: AlbumSummary[];
  related?: ArtistSummary[];
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
