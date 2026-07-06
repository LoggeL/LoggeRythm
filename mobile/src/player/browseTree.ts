import TrackPlayer, { type BrowseCategory, type BrowseItem } from '@rntp/player';
import type { Track } from '../api/types';
import { getApiBase } from '../config';
import * as api from '../api/endpoints';

/**
 * Publish the Android Auto / CarPlay browse tree from the user's library.
 *
 * Structure:
 *   • "Liked Songs"  → playable tracks (selecting one plays the whole liked set)
 *   • "Playlists"    → browsable folders, one per playlist, each holding its tracks
 *
 * Selecting a playable item is handled natively: RNTP loads the item's siblings
 * as the queue and starts playback with no JS round-trip. The tree must be built
 * eagerly (there's no lazy children callback), so we prefetch each playlist's
 * tracks. Fine for a personal library; call again to refresh.
 */
export async function publishBrowseTree(): Promise<void> {
  const base = await getApiBase();
  const toItem = (t: Track): BrowseItem => ({
    mediaId: String(t.id),
    title: t.title,
    artist: t.artist,
    artworkUrl: t.cover ?? undefined,
    url: `${base}/api/tracks/${t.id}/stream`,
    duration: t.duration_sec,
    extras: { track: t as unknown as Record<string, unknown> },
  });

  const categories: BrowseCategory[] = [];

  const likes = await api.getLikes();
  if (likes.length > 0) {
    categories.push({ mediaId: 'liked', title: 'Liked Songs', items: likes.map(toItem) });
  }

  const summaries = await api.getPlaylists();
  if (summaries.length > 0) {
    const playlists = await Promise.all(summaries.map((p) => api.getPlaylist(p.id)));
    categories.push({
      mediaId: 'playlists',
      title: 'Playlists',
      items: playlists.map((pl) => ({
        mediaId: `pl-${pl.id}`,
        title: pl.name,
        children: pl.tracks.map(toItem), // browsable folder (no url) → drills into tracks
      })),
    });
  }

  TrackPlayer.setBrowseTree(categories);
}
