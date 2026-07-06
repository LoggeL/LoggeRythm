/** Mirrors `api/app/schemas/track.py`. `id` is the Deezer numeric track id (as a number). */
export interface ArtistRef {
  id: number;
  name: string;
}

export interface Track {
  id: number;
  title: string;
  artist: string;
  artist_id: number | null;
  artists: ArtistRef[];
  album: string;
  album_id: number | null;
  cover: string | null;
  duration_sec: number;
  preview_url: string | null;
  rank: number | null;
  release_date: string | null;
}

/** Response of `POST /api/auth/login` and `GET /api/auth/me` (`UserOut`). */
export interface User {
  id: number;
  email: string;
  display_name: string;
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
}

export interface Playlist extends PlaylistSummary {
  tracks: Track[];
}

export interface AlbumDetail {
  id: number;
  title: string;
  artist: string;
  cover: string | null;
  tracks: Track[];
}
