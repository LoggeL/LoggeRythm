import type { ArtistRef, DeezerId } from '../api/types';

/** Product-facing aggregate row, independent from the generated API wire. */
export interface StatEntry {
  readonly key: string;
  readonly label: string;
  readonly sublabel: string;
  readonly cover: string;
  readonly count: number;
}

/**
 * A persisted play-history item.
 *
 * It intentionally is narrower than Track: history does not invent preview,
 * rank, or release-date data that the backend never stored.
 */
export interface RecentPlay {
  readonly id: DeezerId;
  readonly title: string;
  readonly artist: string;
  readonly artist_id: string;
  readonly artists: ArtistRef[];
  readonly album: string;
  readonly album_id: string;
  readonly cover: string;
  readonly duration_sec: number;
}

/** Additive all-time plus rolling-30-day listening statistics. */
export interface UserStats {
  readonly total_plays: number;
  readonly top_tracks: StatEntry[];
  readonly top_artists: StatEntry[];
  readonly recent: RecentPlay[];
  readonly total_plays_month: number;
  readonly top_tracks_month: StatEntry[];
  readonly top_artists_month: StatEntry[];
}
