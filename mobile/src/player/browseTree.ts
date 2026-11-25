import Player, { type BrowseCategory, type BrowseItem } from './player';
import { authenticatedHeadersFor } from '../api/client';
import { resolveServerUrl } from '../api/url';
import type { Playlist, Track } from '../api/types';
import { trackArtistLabel } from '../api/trackArtists';
import { getApiBase } from '../config';
import { getConnectivitySnapshot } from '../connectivity/store';
import { musicRepository } from '../data/repositories';
import { strings } from '../localization';
import { offlineScopeOrigin } from '../offline/scope';
import { clearPlayerNotice, getPlayerNotice } from './notices';
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
let publicationTail: Promise<void> = Promise.resolve();

function retainedRemoteForScope(scope: string | null): BrowseCategory[] {
  // An unhydrated/null scope is not an account identity and cannot authorize
  // retaining a previous user's library during a failed refresh.
  return scope !== null && lastRemoteTree?.scope === scope ? lastRemoteTree.categories : [];
}

/** Serialize native commits and their cache acknowledgement as one boundary. */
function commitPublication(action: () => Promise<void>): Promise<void> {
  const pending = publicationTail.then(action);
  // The returned promise reports this operation's failure to its caller. A
  // rejected commit must not prevent the next independently reported retry.
  publicationTail = pending.then(() => undefined, () => undefined);
  return pending;
}

export interface OfflineBrowseTreeCopy {
  downloadsTitle: string;
  downloadedSongsTitle?: string;
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

export async function clearBrowseTree(): Promise<void> {
  cancelBrowseTreePublication();
  lastRemoteTree = null;
  await commitPublication(() => Player.setBrowseTree([]));
}

function currentOfflineCopy(): OfflineBrowseTreeCopy {
  return {
    downloadsTitle: strings.player.autoDownloads,
    downloadedSongsTitle: strings.player.autoDownloadedSongs,
    downloadedProgress: strings.player.autoDownloadedProgress,
  };
}

function browseArtworkUrl(value: string | null | undefined, origin: string): string | undefined {
  if (!value) return undefined;
  // Verified local artwork remains subject to the native file allowlist. Server
  // covers, including uploaded playlist covers, use the bound account's origin.
  return value.startsWith('file:') ? value : resolveServerUrl(value, origin);
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
  const origin = offlineScopeOrigin(scope);
  const individualItems = Object.values(manifest.tracks)
    .filter((entry) => entry.individualDownload === true)
    .sort((left, right) => right.downloadedAt.localeCompare(left.downloadedAt))
    .flatMap((entry, position) => {
      const { track } = entry;
      const uri = resolveTrackUri(track.id);
      if (
        uri === null
        || uri !== snapshot.trackUris[track.id]
        || uri !== `${snapshot.directoryUri}${entry.fileName}`
        || !uri.startsWith('file://')
      ) {
        return [];
      }
      return [{
        mediaId: `download-song:${position}:${track.id}`,
        title: track.title,
        artist: trackArtistLabel(track),
        albumTitle: track.album,
        artworkUrl: browseArtworkUrl(track.cover, origin),
        url: { uri },
        duration: track.duration_sec,
        mimeType: 'audio/mpeg',
        mediaType: 'music',
        extras: {
          track: track as unknown as Record<string, unknown>,
          radio: false,
          explicitDownload: true,
        },
      } satisfies BrowseItem];
    });
  if (summaries.length === 0 && individualItems.length === 0) return null;

  const items: BrowseItem[] = summaries.map((summary): BrowseItem => {
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
          albumTitle: track.album,
          artworkUrl: browseArtworkUrl(track.cover, origin),
          url: { uri },
          duration: track.duration_sec,
          mimeType: 'audio/mpeg',
          mediaType: 'music',
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
        artworkUrl: browseArtworkUrl(summary.cover_url, origin),
        mediaType: 'playlist',
        children,
      };
    });

  if (individualItems.length > 0) {
    items.push({
      mediaId: 'download-songs:all',
      title: copy.downloadedSongsTitle ?? strings.player.autoDownloadedSongs,
      artist: copy.downloadedProgress(individualItems.length, individualItems.length),
      artworkUrl: individualItems[0]?.artworkUrl,
      mediaType: 'playlist',
      children: individualItems,
    });
  }

  return {
    mediaId: 'library:downloads',
    title: copy.downloadsTitle,
    contentStyle: 'list',
    contentStyleBrowsable: 'grid',
    contentStylePlayable: 'list',
    mediaType: 'folder_playlists',
    items,
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
): Promise<{ playlists: Playlist[]; failures: string[] }> {
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
  return { playlists, failures };
}

/** Publish an account-scoped, uniquely identified Android Auto / CarPlay tree. */
export async function publishBrowseTree(signal?: AbortSignal): Promise<void> {
  const revision = ++publicationRevision;
  const publicationScope = getOfflineSnapshot().scope;
  const failures: string[] = [];
  try {
    assertCurrent(revision, signal);
    const initialDownloads = offlineCategoryForScope(publicationScope);
    if (getConnectivitySnapshot().status === 'offline') {
      // Known-offline startup must not wait for auth or issue doomed repository
      // requests. Remote entries are deliberately omitted because their URLs are
      // not verified local downloads and would not be playable in this state.
      await commitPublication(async () => {
        assertCurrent(revision, signal);
        await Player.setBrowseTree(initialDownloads === null ? [] : [initialDownloads]);
      });
      return;
    }
    const base = await getApiBase();
    const streamHeaders = await authenticatedHeadersFor(base);
    const [likesResult, summariesResult] = await Promise.allSettled([
      musicRepository.getLikes(signal),
      musicRepository.getPlaylists(signal),
    ]);
    assertCurrent(revision, signal);
    const retained = retainedRemoteForScope(publicationScope);
    const likes = likesResult.status === 'fulfilled' ? likesResult.value : null;
    if (likesResult.status === 'rejected') {
      failures.push(`Liked songs: ${String(likesResult.reason)}`);
    }
    if (summariesResult.status === 'rejected') {
      failures.push(`Playlists: ${String(summariesResult.reason)}`);
    }
    const loaded = summariesResult.status === 'fulfilled'
      ? await loadPlaylists(summariesResult.value, signal, revision)
      : null;
    if (loaded !== null) failures.push(...loaded.failures);

    const toItem = (track: Track, mediaId: string): BrowseItem => {
      const offlineUri =
        publicationScope !== null && getOfflineSnapshot().scope === publicationScope
          ? offlineUriForTrack(track.id)
          : null;
      if (offlineUri !== null && offlineUri.startsWith('file://')) {
        return {
          mediaId,
          title: track.title,
          artist: trackArtistLabel(track),
          albumTitle: track.album,
          artworkUrl: browseArtworkUrl(track.cover, base),
          url: { uri: offlineUri },
          duration: track.duration_sec,
          mimeType: 'audio/mpeg',
          mediaType: 'music',
          extras: {
            track: track as unknown as Record<string, unknown>,
            radio: false,
            explicitDownload: true,
          },
        };
      }
      return {
        mediaId,
        title: track.title,
        artist: trackArtistLabel(track),
        albumTitle: track.album,
        artworkUrl: browseArtworkUrl(track.cover, base),
        url: {
          uri: `${base}/api/tracks/${encodeURIComponent(track.id)}/stream`,
          headers: streamHeaders,
        },
        duration: track.duration_sec,
        mediaType: 'music',
        extras: { track: track as unknown as Record<string, unknown>, radio: false },
      };
    };

    const categories: BrowseCategory[] = [];

    // Android Auto 2.0 Home category (Recent + Personal Mixes + Release Radar)
    const homeItems: BrowseItem[] = [];
    const optionalReads = await Promise.allSettled([
      typeof musicRepository.getStats === 'function'
        ? musicRepository.getStats(signal)
        : Promise.resolve(null),
      typeof musicRepository.getHomeMixes === 'function'
        ? musicRepository.getHomeMixes(signal)
        : Promise.resolve(null),
      typeof musicRepository.getReleaseRadar === 'function'
        ? musicRepository.getReleaseRadar(signal)
        : Promise.resolve(null),
    ]);
    assertCurrent(revision, signal);
    const statsResult = optionalReads[0];
    if (statsResult.status === 'rejected') {
      failures.push(`Recent plays: ${String(statsResult.reason)}`);
    } else if (statsResult.value && statsResult.value.recent.length > 0) {
      const recentChildren = statsResult.value.recent.map((play, index) =>
        toItem(
          {
            ...play,
            preview_url: null,
            rank: 0,
            release_date: '',
          },
          `recent:${index}:${play.id}`,
        ),
      );
      homeItems.push({
        mediaId: 'home:recent',
        title: strings.player.autoRecent,
        artworkUrl: recentChildren[0]?.artworkUrl,
        mediaType: 'playlist',
        children: recentChildren,
      });
    }
    const mixesResult = optionalReads[1];
    if (mixesResult.status === 'rejected') {
      failures.push(`Personal mixes: ${String(mixesResult.reason)}`);
    } else if (Array.isArray(mixesResult.value)) {
      mixesResult.value.forEach((shelf, shelfIndex) => {
        if (shelf.tracks.length === 0) return;
        const children = shelf.tracks.map((track, trackIndex) =>
          toItem(track, `mix:${shelfIndex}:${trackIndex}:${track.id}`),
        );
        homeItems.push({
          mediaId: `home:mix:${shelfIndex}`,
          title: shelf.title,
          artist: shelf.subtitle,
          artworkUrl: children[0]?.artworkUrl,
          mediaType: 'playlist',
          children,
        });
      });
    }
    const radarResult = optionalReads[2];
    if (radarResult.status === 'rejected') {
      failures.push(`Release radar: ${String(radarResult.reason)}`);
    } else if (Array.isArray(radarResult.value) && radarResult.value.length > 0) {
      const radarChildren = radarResult.value.map((entry, index) =>
        toItem(entry.track, `radar:${index}:${entry.track.id}`),
      );
      homeItems.push({
        mediaId: 'home:radar',
        title: strings.player.autoReleaseRadar,
        artworkUrl: radarChildren[0]?.artworkUrl,
        mediaType: 'playlist',
        children: radarChildren,
      });
    }
    if (homeItems.length > 0) {
      categories.push({
        mediaId: 'library:home',
        title: strings.player.autoHome,
        contentStyle: 'grid',
        contentStyleBrowsable: 'grid',
        contentStylePlayable: 'list',
        mediaType: 'folder_mixed',
        items: homeItems,
      });
    }

    if (likes !== null && likes.length > 0) {
      categories.push({
        mediaId: 'library:liked',
        title: strings.player.autoLikedSongs,
        contentStyle: 'list',
        contentStylePlayable: 'list',
        mediaType: 'playlist',
        items: likes.map((track, index) => toItem(track, `liked:${index}:${track.id}`)),
      });
    } else if (likes === null) {
      const previous = retained.find(({ mediaId }) => mediaId === 'library:liked');
      if (previous) categories.push(previous);
    }
    if (loaded !== null && summariesResult.status === 'fulfilled') {
      const previous = retained.find(({ mediaId }) => mediaId === 'library:playlists');
      const byId = new Map(loaded.playlists.map((playlist) => [playlist.id, playlist]));
      const items = summariesResult.value.flatMap((summary): BrowseItem[] => {
        const playlist = byId.get(summary.id);
        if (playlist === undefined) {
          const existing = previous?.items.find(({ mediaId }) => mediaId === `playlist:${summary.id}`);
          // Only retain a failed playlist while it is still in this account's
          // current index. Every such failure is reported after publication.
          return existing === undefined ? [] : [existing];
        }
        return [{
          mediaId: `playlist:${playlist.id}`,
          title: playlist.name,
          artworkUrl: browseArtworkUrl(playlist.cover_url, base),
          mediaType: 'playlist',
          children: playlist.tracks.map((track, index) =>
            toItem(track, `playlist:${playlist.id}:${index}:${track.id}`),
          ),
        }];
      });
      if (items.length > 0) categories.push({
        mediaId: 'library:playlists',
        title: strings.player.autoPlaylists,
        contentStyle: 'grid',
        contentStyleBrowsable: 'grid',
        contentStylePlayable: 'list',
        mediaType: 'folder_playlists',
        items,
      });
    } else if (loaded === null) {
      const previous = retained.find(({ mediaId }) => mediaId === 'library:playlists');
      if (previous) categories.push(previous);
    }

    // Android Auto 2.0 Radio category (Mood Radio stations)
    if (typeof musicRepository.getMood === 'function') {
      const moods = [
        { tag: 'chill', title: strings.radio.moods.chill.title },
        { tag: 'focus', title: strings.radio.moods.focus.title },
        { tag: 'workout', title: strings.radio.moods.workout.title },
        { tag: 'party', title: strings.radio.moods.party.title },
      ] as const;
      const moodResults = await Promise.allSettled(
        moods.map(({ tag }) => musicRepository.getMood(tag, signal)),
      );
      assertCurrent(revision, signal);
      const radioItems: BrowseItem[] = [];
      moodResults.forEach((result, index) => {
        const mood = moods[index];
        if (result.status === 'rejected') {
          failures.push(`Mood radio (${mood.tag}): ${String(result.reason)}`);
          return;
        }
        if (result.value.length === 0) return;
        const children = result.value.map((track, trackIndex) =>
          toItem(track, `radio:mood:${mood.tag}:${trackIndex}:${track.id}`),
        );
        radioItems.push({
          mediaId: `radio:mood:${mood.tag}`,
          title: mood.title,
          artworkUrl: children[0]?.artworkUrl,
          mediaType: 'radio_station',
          children,
        });
      });
      if (radioItems.length > 0) {
        categories.push({
          mediaId: 'library:radio',
          title: strings.player.autoRadio,
          contentStyle: 'grid',
          contentStyleBrowsable: 'grid',
          contentStylePlayable: 'list',
          mediaType: 'folder_radio_stations',
          items: radioItems,
        });
      }
    }

    assertCurrent(revision, signal);
    const downloads = offlineCategoryForScope(publicationScope);
    const remoteCategories = [...categories];
    if (downloads !== null) categories.push(downloads);
    // A broken playlist must not make all healthy categories unavailable in the
    // car. Publish the usable same-account subset atomically, then report every
    // source failure. Never overwrite a cold-restored tree with an empty failure.
    if (categories.length > 0 || failures.length === 0) {
      await commitPublication(async () => {
        assertCurrent(revision, signal);
        await Player.setBrowseTree(categories);
        assertCurrent(revision, signal);
        lastRemoteTree = publicationScope === null
          ? null : { scope: publicationScope, categories: remoteCategories };
      });
    }
  } catch (error) {
    if (signal?.aborted || revision !== publicationRevision) {
      if (error instanceof BrowseTreePublicationCancelledError) throw error;
      throw new BrowseTreePublicationCancelledError();
    }
    const downloads = offlineCategoryForScope(publicationScope);
    if (downloads !== null) {
      await commitPublication(async () => {
        assertCurrent(revision, signal);
        const retainedRemote = retainedRemoteForScope(publicationScope);
        await Player.setBrowseTree([...retainedRemote, downloads]);
      });
    }
    throw error;
  }
  if (failures.length > 0) {
    throw new Error(`Android Auto library refresh incomplete: ${failures.join('; ')}`);
  }
}

export async function refreshBrowseTree(): Promise<void> {
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  try {
    await publishBrowseTree(controller.signal);
    if (controller.signal.aborted) return;
    const notice = getPlayerNotice();
    if (notice?.dedupeKey === 'auto-library-refresh') clearPlayerNotice(notice.id);
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
  await commitPublication(async () => {
    const downloads = offlineCategoryForScope(scope);
    const retainedRemote = retainedRemoteForScope(scope);
    await Player.setBrowseTree(
      downloads === null ? retainedRemote : [...retainedRemote, downloads],
    );
  });
}
