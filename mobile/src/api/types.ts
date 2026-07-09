/** Mirrors the backend wire format in `api/app/schemas/track.py`. */
export type DeezerId = string;

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
