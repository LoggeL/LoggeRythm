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
}

export interface Playlist {
  id: string | number;
  name: string;
  description?: string;
  cover_url?: string;
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

export interface ResolveResult {
  type: string; // playlist | album | track
  name: string;
  image: string;
  total: number;
  matched: number;
  tracks: Track[];
  unmatched: { title: string; artist: string }[];
}
