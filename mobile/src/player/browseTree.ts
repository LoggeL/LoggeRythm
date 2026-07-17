import Player, { type BrowseCategory, type BrowseItem } from './player';
import { authenticatedHeadersFor } from '../api/client';
import type { Playlist, Track } from '../api/types';
import { trackArtistLabel } from '../api/trackArtists';
import { getApiBase } from '../config';
import { getConnectivitySnapshot } from '../connectivity/store';
import { musicRepository } from '../data/repositories';
import { strings } from '../localization';
import {
  getOfflinePlaylistBrowseDetail,
  listOfflinePlaylistSummaries,
} from '../offline/browse';
import {
  getOfflineSnapshot,
  offlineUriForTrack,
  type OfflineRuntimeSnapshot,
} from '../offline/registry';

const PLAYLIST_FETCH_CONCURRENCY = 4;
let publicationRevision = 0;
let activeController: AbortController | null = null;
let lastRemoteTree: { scope: string | null; categories: BrowseCategory[] } | null = null;

export interface OfflineBrowseTreeCopy {
  downloadsTitle: string;
  downloadedProgress(downloadedOccurrences: number, totalOccurrences: number): string;
}

export type OfflineTrackUriResolver = (trackId: string) => string | null;

export class BrowseTreePublicationCancelledError extends Error {
  constructor() {
    super('Android Auto library publication was cancelled');
    this.name = 'BrowseTreePublicationCancelledError';
  }
}

function assertCurrent(revision: number, signal?: AbortSignal): void {
  if (signal?.aborted || revision !== publicationRevision) {
    throw new BrowseTreePublicationCancelledError();
  }
}

export function cancelBrowseTreePublication(): void {
  publicationRevision += 1;
  activeController?.abort();
  activeController = null;
}

export function clearBrowseTree(): void {
  cancelBrowseTreePublication();
  lastRemoteTree = null;
  Player.setBrowseTree([]);
}

function currentOfflineCopy(): OfflineBrowseTreeCopy {
  return {
    downloadsTitle: strings.player.autoDownloads,
    downloadedProgress: strings.player.autoDownloadedProgress,
  };
}

/**
 * Build Android Auto nodes only from the encrypted manifest and verified native
 * file registry. The caller supplies the resolver so this transformation stays
 * synchronous and cannot cross an authentication or network boundary.
 */
export function buildOfflineDownloadsBrowseCategory(
  snapshot: OfflineRuntimeSnapshot,
  resolveTrackUri: OfflineTrackUriResolver,
  copy: OfflineBrowseTreeCopy,
): BrowseCategory | null {
  const { manifest, scope } = snapshot;
  if (
    !snapshot.hydrated
    || manifest === null
    || scope === null
    || manifest.scope !== scope
    || snapshot.directoryUri === null
  ) {
    return null;
  }

  const summaries = listOfflinePlaylistSummaries(manifest, scope);
  if (summaries.length === 0) return null;

  return {
    mediaId: 'library:downloads',
    title: copy.downloadsTitle,
    items: summaries.map((summary): BrowseItem => {
      const detail = getOfflinePlaylistBrowseDetail(manifest, scope, summary.id);
      if (detail === null) {
        throw new Error(`Offline playlist ${summary.id} disappeared while building browse tree`);
      }
      const children = detail.occurrences.flatMap(({ position, track, availability }) => {
        if (availability !== 'downloaded') return [];
        const uri = resolveTrackUri(track.id);
        const entry = manifest.tracks[track.id];
        if (
          uri === null
          || entry === undefined
          || uri !== snapshot.trackUris[track.id]
          || uri !== `${snapshot.directoryUri}${entry.fileName}`
          || !uri.startsWith('file://')
        ) {
          // A manifest ownership claim without matching native file evidence is
          // never exposed as playable, even during a concurrent remove/reconcile.
          return [];
        }
        return [{
          mediaId: `download:${summary.id}:${position}:${track.id}`,
          title: track.title,
          artist: trackArtistLabel(track),
          artworkUrl: track.cover || undefined,
          url: { uri },
          duration: track.duration_sec,
          mimeType: 'audio/mpeg',
          extras: {
            track: track as unknown as Record<string, unknown>,
            radio: false,
            explicitDownload: true,
          },
        } satisfies BrowseItem];
      });
      return {
        mediaId: `download-playlist:${summary.id}`,
        title: summary.name,
        artist: copy.downloadedProgress(children.length, summary.offline.totalOccurrences),
        artworkUrl: summary.cover_url || undefined,
        children,
      };
    }),
  };
}

function offlineCategoryForScope(scope: string | null): BrowseCategory | null {
  const snapshot = getOfflineSnapshot();
  if (snapshot.scope !== scope) throw new BrowseTreePublicationCancelledError();
  return buildOfflineDownloadsBrowseCategory(
    snapshot,
    offlineUriForTrack,
    currentOfflineCopy(),
  );
}

async function loadPlaylists(
  summaries: Awaited<ReturnType<typeof musicRepository.getPlaylists>>,
  signal: AbortSignal | undefined,
  revision: number,
): Promise<Playlist[]> {
  const playlists: Playlist[] = [];
  const failures: string[] = [];
  for (let offset = 0; offset < summaries.length; offset += PLAYLIST_FETCH_CONCURRENCY) {
    assertCurrent(revision, signal);
    const batch = summaries.slice(offset, offset + PLAYLIST_FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((summary) => musicRepository.getPlaylist(summary.id, signal)),
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
  const publicationScope = getOfflineSnapshot().scope;
  try {
    assertCurrent(revision, signal);
    const initialDownloads = offlineCategoryForScope(publicationScope);
    if (getConnectivitySnapshot().status === 'offline') {
      // Known-offline startup must not wait for auth or issue doomed repository
      // requests. Remote entries are deliberately omitted because their URLs are
      // not verified local downloads and would not be playable in this state.
      Player.setBrowseTree(initialDownloads === null ? [] : [initialDownloads]);
      return;
    }
    const base = await getApiBase();
    const streamHeaders = await authenticatedHeadersFor(base);
    const [likes, summaries] = await Promise.all([
      musicRepository.getLikes(signal),
      musicRepository.getPlaylists(signal),
    ]);
    assertCurrent(revision, signal);
    const playlists = await loadPlaylists(summaries, signal, revision);

    const toItem = (track: Track, mediaId: string): BrowseItem => ({
      mediaId,
      title: track.title,
      artist: trackArtistLabel(track),
      artworkUrl: track.cover || undefined,
      url: {
        uri: `${base}/api/tracks/${encodeURIComponent(track.id)}/stream`,
        headers: streamHeaders,
      },
      duration: track.duration_sec,
      extras: { track: track as unknown as Record<string, unknown>, radio: false },
    });

    const categories: BrowseCategory[] = [];
    if (likes.length > 0) {
      categories.push({
        mediaId: 'library:liked',
        title: strings.player.autoLikedSongs,
        items: likes.map((track, index) => toItem(track, `liked:${index}:${track.id}`)),
      });
    }
    if (playlists.length > 0) {
      categories.push({
        mediaId: 'library:playlists',
        title: strings.player.autoPlaylists,
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
    const downloads = offlineCategoryForScope(publicationScope);
    const remoteCategories = [...categories];
    if (downloads !== null) categories.push(downloads);
    // Atomically replace only after every remote source has loaded. The remote
    // subset is retained separately so a transient same-account refresh failure
    // can refresh verified Downloads without blanking previously published nodes.
    Player.setBrowseTree(categories);
    lastRemoteTree = { scope: publicationScope, categories: remoteCategories };
  } catch (error) {
    if (signal?.aborted || revision !== publicationRevision) {
      if (error instanceof BrowseTreePublicationCancelledError) throw error;
      throw new BrowseTreePublicationCancelledError();
    }
    const downloads = offlineCategoryForScope(publicationScope);
    if (downloads !== null) {
      const retainedRemote = lastRemoteTree?.scope === publicationScope
        ? lastRemoteTree.categories
        : [];
      Player.setBrowseTree([...retainedRemote, downloads]);
    }
    throw error;
  }
}

export async function refreshBrowseTree(): Promise<void> {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  try {
    await publishBrowseTree(controller.signal);
  } catch (error) {
    if (!(error instanceof BrowseTreePublicationCancelledError)) throw error;
  } finally {
    if (activeController === controller) activeController = null;
  }
}

/**
 * Re-publish only verified local Downloads while retaining the last complete
 * same-account remote tree. This never crosses an auth or network boundary.
 */
export async function refreshOfflineBrowseTree(): Promise<void> {
  const scope = getOfflineSnapshot().scope;
  const downloads = offlineCategoryForScope(scope);
  const retainedRemote = lastRemoteTree?.scope === scope
    ? lastRemoteTree.categories
    : [];
  Player.setBrowseTree(
    downloads === null ? retainedRemote : [...retainedRemote, downloads],
  );
}
