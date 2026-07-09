import TrackPlayer, { type BrowseCategory, type BrowseItem } from '@rntp/player';
import { authenticatedHeadersFor } from '../api/client';
import type { Playlist, Track } from '../api/types';
import { getApiBase } from '../config';
import * as api from '../api/endpoints';

const PLAYLIST_FETCH_CONCURRENCY = 4;
let publicationRevision = 0;
let activeController: AbortController | null = null;

function assertCurrent(revision: number, signal?: AbortSignal): void {
  if (signal?.aborted || revision !== publicationRevision) {
    throw new Error('Android Auto library publication was cancelled');
  }
}

export function cancelBrowseTreePublication(): void {
  publicationRevision += 1;
  activeController?.abort();
  activeController = null;
}

export function clearBrowseTree(): void {
  cancelBrowseTreePublication();
  TrackPlayer.setBrowseTree([]);
}

async function loadPlaylists(
  summaries: Awaited<ReturnType<typeof api.getPlaylists>>,
  signal: AbortSignal | undefined,
  revision: number,
): Promise<Playlist[]> {
  const playlists: Playlist[] = [];
  const failures: string[] = [];
  for (let offset = 0; offset < summaries.length; offset += PLAYLIST_FETCH_CONCURRENCY) {
    assertCurrent(revision, signal);
    const batch = summaries.slice(offset, offset + PLAYLIST_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((summary) => api.getPlaylist(summary.id, signal)),
    );
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') playlists.push(result.value);
      else {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        failures.push(`${batch[index].name} (${batch[index].id}): ${reason}`);
      }
    });
  }
  assertCurrent(revision, signal);
  if (failures.length > 0) {
    throw new Error(`Failed to load Android Auto playlists: ${failures.join('; ')}`);
  }
  return playlists;
}

/** Publish an account-scoped, uniquely identified Android Auto / CarPlay tree. */
export async function publishBrowseTree(signal?: AbortSignal): Promise<void> {
  const revision = ++publicationRevision;
  // Clear any previous user's native library before starting network work.
  TrackPlayer.setBrowseTree([]);

  const base = await getApiBase();
  const streamHeaders = await authenticatedHeadersFor(base);
  const [likes, summaries] = await Promise.all([api.getLikes(signal), api.getPlaylists(signal)]);
  assertCurrent(revision, signal);
  const playlists = await loadPlaylists(summaries, signal, revision);

  const toItem = (track: Track, mediaId: string): BrowseItem => ({
    mediaId,
    title: track.title,
    artist: track.artist,
    artworkUrl: track.cover || undefined,
    url: { uri: `${base}/api/tracks/${track.id}/stream`, headers: streamHeaders },
    duration: track.duration_sec,
    extras: { track: track as unknown as Record<string, unknown>, radio: false },
  });

  const categories: BrowseCategory[] = [];
  if (likes.length > 0) {
    categories.push({
      mediaId: 'library:liked',
      title: 'Liked Songs',
      items: likes.map((track, index) => toItem(track, `liked:${index}:${track.id}`)),
    });
  }
  if (playlists.length > 0) {
    categories.push({
      mediaId: 'library:playlists',
      title: 'Playlists',
      items: playlists.map((playlist) => ({
        mediaId: `playlist:${playlist.id}`,
        title: playlist.name,
        children: playlist.tracks.map((track, index) =>
          toItem(track, `playlist:${playlist.id}:${index}:${track.id}`),
        ),
      })),
    });
  }

  assertCurrent(revision, signal);
  TrackPlayer.setBrowseTree(categories);
}

export async function refreshBrowseTree(): Promise<void> {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  try {
    await publishBrowseTree(controller.signal);
  } finally {
    if (activeController === controller) activeController = null;
  }
}
