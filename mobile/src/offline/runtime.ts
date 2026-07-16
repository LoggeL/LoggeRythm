import { authenticatedHeadersFor } from '../api/client';
import type { Playlist, Track } from '../api/types';
import { getApiBase } from '../config';
import {
  attachDownloadedTrack,
  beginPlaylistDownload,
  createEmptyOfflineManifest,
  decodeOfflineManifest,
  offlinePlaylistId,
  offlineTrackFileName,
  offlineTrackId,
  reconcileOfflineManifest,
  removePlaylistDownload,
  settlePlaylistDownload,
  type OfflineManifest,
  type OfflineTrackFailureInput,
} from './model';
import {
  clearAllNativeOfflineScopes,
  clearNativeOfflineScope,
  hydrateNativeOffline,
  persistNativeOfflineManifest,
  removeNativeOfflineFiles,
  startNativePlaylistDownload,
  subscribeNativeOfflineProgress,
  type NativeOfflineHydration,
  type NativeOfflineTrackRequest,
} from './native';
import {
  publishOfflineError,
  publishOfflineManifest,
  resetOfflineSnapshot,
} from './registry';

interface OfflineRuntimeContext {
  scope: string;
  generation: number;
  directoryUri: string;
  manifest: OfflineManifest;
  trackUris: Record<string, string>;
  availableDiskBytes: number;
  pendingOrphanedFiles: Set<string>;
  epoch: number;
}

interface ActiveDownload {
  scope: string;
  playlistId: string;
  epoch: number;
}

let context: OfflineRuntimeContext | null = null;
let runtimeEpoch = 0;
let operationTail: Promise<void> = Promise.resolve();
let clearBarrier: Promise<void> = Promise.resolve();
let activeClear: Promise<void> | null = null;
let activeClearScope: string | null | undefined;
let activeDownload: ActiveDownload | null = null;
let unsubscribeProgress: (() => void) | null = null;

function now(): string {
  return new Date().toISOString();
}

function cleanupDiagnosticCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[a-z][a-z0-9-]{1,63}$/.test(code)) return code;
  }
  if (
    error instanceof Error
    && error.message === 'Explicit downloads are unavailable in this Android build'
  ) {
    return 'module-unavailable';
  }
  return 'unknown';
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function assertCurrent(value: OfflineRuntimeContext): void {
  if (
    context !== value
    || value.epoch !== runtimeEpoch
    || context.scope !== value.scope
    || context.generation !== value.generation
  ) {
    throw new Error('Offline operation was invalidated by an account cleanup');
  }
}

function scopeOrigin(scope: string): string {
  const marker = '::user:';
  const markerIndex = scope.lastIndexOf(marker);
  if (markerIndex <= 0 || markerIndex + marker.length >= scope.length) {
    throw new Error('Offline account scope is invalid');
  }
  const origin = scope.slice(0, markerIndex);
  if (new URL(origin).origin !== origin) {
    throw new Error('Offline account scope origin is not canonical');
  }
  return origin;
}

function recoverableNativeManifestError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'manifest-read-failed' || code === 'manifest-corrupt';
}

function hydrationTrackUris(
  hydration: NativeOfflineHydration,
  manifest: OfflineManifest,
): Record<string, string> {
  const files = new Map(hydration.files.map((file) => [file.trackId, file]));
  return Object.fromEntries(Object.entries(manifest.tracks).map(([trackId, entry]) => {
    const file = files.get(trackId);
    if (
      file === undefined
      || file.fileName !== entry.fileName
      || file.sizeBytes !== entry.sizeBytes
      || file.uri !== `${hydration.directoryUri}${entry.fileName}`
    ) {
      throw new Error(`Offline track ${trackId} lacks verified native evidence`);
    }
    return [trackId, file.uri];
  }));
}

function publishContext(
  value: OfflineRuntimeContext,
  options: {
    progress?: Parameters<typeof publishOfflineManifest>[0]['progress'];
    error?: Parameters<typeof publishOfflineManifest>[0]['error'];
  } = {},
): void {
  assertCurrent(value);
  publishOfflineManifest({
    manifest: value.manifest,
    directoryUri: value.directoryUri,
    trackUris: value.trackUris,
    availableDiskBytes: value.availableDiskBytes,
    progress: options.progress,
    error: options.error,
  });
}

function ensureProgressSubscription(): void {
  if (unsubscribeProgress !== null) return;
  unsubscribeProgress = subscribeNativeOfflineProgress(
    (progress) => {
      const active = activeDownload;
      const current = context;
      if (
        active === null
        || current === null
        || active.epoch !== runtimeEpoch
        || active.scope !== current.scope
        || active.playlistId !== progress.playlistId
      ) return;
      publishContext(current, {
        progress: {
          phase: 'downloading',
          playlistId: progress.playlistId,
          done: progress.done,
          total: progress.total,
          currentTrackId: progress.currentTrackId,
          bytesWritten: progress.bytesWritten,
          // Native exposes the current file length, not a trustworthy aggregate.
          totalBytes: null,
        },
      });
    },
    () => {
      if (activeDownload !== null) publishOfflineError('download-failed');
    },
  );
}

async function persistManifest(
  value: OfflineRuntimeContext,
  manifest: OfflineManifest,
): Promise<void> {
  assertCurrent(value);
  await persistNativeOfflineManifest(
    value.scope,
    value.generation,
    JSON.stringify(manifest),
  );
  assertCurrent(value);
}

async function hydrateContext(scope: string, epoch: number): Promise<OfflineRuntimeContext> {
  scopeOrigin(scope);
  if (context !== null && context.scope !== scope) {
    throw new Error('Clear the previous offline account before hydrating another account');
  }
  resetOfflineSnapshot(scope);

  let recoveredCorruption = false;
  let hydration: NativeOfflineHydration;
  try {
    hydration = await hydrateNativeOffline(scope);
  } catch (error) {
    if (!recoverableNativeManifestError(error)) throw error;
    await clearNativeOfflineScope(scope);
    if (epoch !== runtimeEpoch) {
      throw new Error('Offline recovery was invalidated by an account cleanup');
    }
    hydration = await hydrateNativeOffline(scope);
    recoveredCorruption = true;
  }
  if (epoch !== runtimeEpoch) {
    throw new Error('Offline hydration was invalidated by an account cleanup');
  }

  let manifest: OfflineManifest;
  try {
    manifest = decodeOfflineManifest(hydration.manifestJson, scope);
  } catch {
    // A corrupt or obsolete encrypted payload must never publish file:// URIs.
    await clearNativeOfflineScope(scope);
    if (epoch !== runtimeEpoch) {
      throw new Error('Offline recovery was invalidated by an account cleanup');
    }
    hydration = await hydrateNativeOffline(scope);
    manifest = createEmptyOfflineManifest(scope);
    recoveredCorruption = true;
  }

  const fileSizes = Object.fromEntries(
    hydration.files.map((file) => [file.fileName, file.sizeBytes]),
  );
  const reconciled = reconcileOfflineManifest(manifest, fileSizes, now(), {
    invalidTrackIds: hydration.invalidTrackIds,
    interruptedTrackIds: hydration.interruptedTrackIds,
  });
  const serializedManifest = JSON.stringify(reconciled);
  if (hydration.manifestJson !== serializedManifest) {
    await persistNativeOfflineManifest(
      scope,
      hydration.generation,
      serializedManifest,
    );
  }
  if (epoch !== runtimeEpoch) {
    throw new Error('Offline hydration was invalidated by an account cleanup');
  }

  const next: OfflineRuntimeContext = {
    scope,
    generation: hydration.generation,
    directoryUri: hydration.directoryUri,
    manifest: reconciled,
    trackUris: hydrationTrackUris(hydration, reconciled),
    availableDiskBytes: hydration.availableDiskBytes,
    pendingOrphanedFiles: new Set(),
    epoch,
  };
  ensureProgressSubscription();
  context = next;
  publishContext(next, {
    error: recoveredCorruption ? 'storage-unavailable' : null,
  });
  return next;
}

async function requireContext(
  scope: string,
  requestedEpoch: number,
): Promise<OfflineRuntimeContext> {
  await clearBarrier;
  if (requestedEpoch !== runtimeEpoch) {
    throw new Error('Offline operation was invalidated by an account cleanup');
  }
  if (context !== null) {
    if (context.scope !== scope) {
      runtimeEpoch += 1;
      context = null;
      activeDownload = null;
      resetOfflineSnapshot(scope);
      publishOfflineError('storage-unavailable');
      throw new Error('Offline data belongs to another account');
    }
    assertCurrent(context);
    return context;
  }
  return hydrateContext(scope, requestedEpoch);
}

/** Hydrate encrypted, verified offline state without blocking the online app on failure. */
export function initializeOfflineDownloads(scope: string): Promise<void> {
  const requestedEpoch = runtimeEpoch;
  return serialized(async () => {
    try {
      await requireContext(scope, requestedEpoch);
    } catch {
      if (requestedEpoch !== runtimeEpoch) return;
      if (context === null) resetOfflineSnapshot(scope);
      publishOfflineError('storage-unavailable');
    }
  });
}

function uniqueTracks(playlist: Playlist): Map<string, Track> {
  const tracks = new Map<string, Track>();
  for (const track of playlist.tracks) {
    const trackId = offlineTrackId(track.id);
    if (!tracks.has(trackId)) tracks.set(trackId, track);
  }
  return tracks;
}

function trackOwnedByPlaylist(
  manifest: OfflineManifest,
  playlistId: string,
  trackId: string,
): boolean {
  return manifest.tracks[trackId]?.ownerPlaylistIds.includes(playlistId) ?? false;
}

function pendingFailures(
  manifest: OfflineManifest,
  playlist: Playlist,
  code: string,
  retryable: boolean,
): OfflineTrackFailureInput[] {
  const playlistId = offlinePlaylistId(playlist.id);
  return [...uniqueTracks(playlist).keys()]
    .filter((trackId) => !trackOwnedByPlaylist(manifest, playlistId, trackId))
    .map((trackId) => ({ trackId, code, retryable }));
}

function authenticatedCookie(headers: Record<string, string>): { Cookie: string } {
  const keys = Object.keys(headers);
  if (keys.length !== 1 || keys[0] !== 'Cookie') {
    throw new Error('Offline download authentication returned unsafe headers');
  }
  const cookie = headers.Cookie;
  if (typeof cookie !== 'string' || cookie.length === 0) {
    throw new Error('Offline download authentication is unavailable');
  }
  return { Cookie: cookie };
}

function validateNativeOutcomes(
  requested: ReadonlySet<string>,
  successes: readonly { trackId: string }[],
  failures: readonly { trackId: string }[],
): void {
  const outcomes = [...successes, ...failures].map(({ trackId }) => trackId);
  if (
    new Set(outcomes).size !== outcomes.length
    || outcomes.some((trackId) => !requested.has(trackId))
  ) {
    throw new Error('Native offline result does not match the requested tracks');
  }
}

async function settleFailedDownload(
  value: OfflineRuntimeContext,
  playlist: Playlist,
  error: unknown,
): Promise<never> {
  assertCurrent(value);
  const failures = pendingFailures(
    value.manifest,
    playlist,
    'download-failed',
    true,
  );
  const settled = settlePlaylistDownload(value.manifest, playlist, now(), failures);
  await persistManifest(value, settled);
  value.manifest = settled;
  publishContext(value, { error: 'download-failed' });
  throw error;
}

/** Persist an exact playlist snapshot, then download only its missing unique files. */
export function downloadPlaylistForOffline(scope: string, playlist: Playlist): Promise<void> {
  const requestedEpoch = runtimeEpoch;
  return serialized(async () => {
    const value = await requireContext(scope, requestedEpoch);
    const playlistId = offlinePlaylistId(playlist.id);
    let pending = beginPlaylistDownload(value.manifest, playlist, now());

    // A verified deduplicated file can gain another playlist owner without network.
    for (const [trackId, track] of uniqueTracks(playlist)) {
      const existing = pending.tracks[trackId];
      if (existing !== undefined && !existing.ownerPlaylistIds.includes(playlistId)) {
        pending = attachDownloadedTrack(
          pending,
          playlistId,
          track,
          existing.sizeBytes,
          now(),
        );
      }
    }

    await persistManifest(value, pending);
    value.manifest = pending;
    publishContext(value);

    const missing = [...uniqueTracks(playlist)].filter(([trackId]) =>
      !trackOwnedByPlaylist(value.manifest, playlistId, trackId));
    if (missing.length === 0) {
      const complete = settlePlaylistDownload(value.manifest, playlist, now());
      await persistManifest(value, complete);
      value.manifest = complete;
      publishContext(value);
      return;
    }

    try {
      const origin = scopeOrigin(scope);
      const configuredOrigin = new URL(await getApiBase()).origin;
      if (origin !== configuredOrigin) {
        throw new Error('Offline download scope does not match the configured server');
      }
      const firstUrl = `${origin}/api/tracks/${missing[0][0]}/stream`;
      const headers = authenticatedCookie(await authenticatedHeadersFor(firstUrl));
      assertCurrent(value);
      const requests: NativeOfflineTrackRequest[] = missing.map(([trackId]) => ({
        trackId,
        fileName: offlineTrackFileName(trackId),
        url: `${origin}/api/tracks/${trackId}/stream`,
        headers,
      }));
      activeDownload = { scope, playlistId, epoch: value.epoch };
      const result = await startNativePlaylistDownload({
        scope,
        generation: value.generation,
        playlistId,
        tracks: requests,
        directoryUri: value.directoryUri,
      });
      assertCurrent(value);
      validateNativeOutcomes(
        new Set(requests.map((request) => request.trackId)),
        result.successes,
        result.failures,
      );

      let completed = value.manifest;
      const sourceTracks = uniqueTracks(playlist);
      const nextTrackUris = { ...value.trackUris };
      const completedAt = now();
      for (const success of result.successes) {
        const track = sourceTracks.get(success.trackId);
        if (track === undefined) {
          throw new Error('Native offline result lacks matching source metadata');
        }
        completed = attachDownloadedTrack(
          completed,
          playlistId,
          track,
          success.sizeBytes,
          completedAt,
        );
        nextTrackUris[success.trackId] = success.uri;
      }
      completed = settlePlaylistDownload(
        completed,
        playlist,
        completedAt,
        result.failures,
      );
      await persistManifest(value, completed);
      value.manifest = completed;
      value.trackUris = nextTrackUris;
      value.availableDiskBytes = result.availableDiskBytes;
      publishContext(value);
    } catch (error) {
      if (value.epoch !== runtimeEpoch || context !== value) throw error;
      await settleFailedDownload(value, playlist, error);
    } finally {
      if (
        activeDownload?.epoch === value.epoch
        && activeDownload.scope === value.scope
        && activeDownload.playlistId === playlistId
      ) activeDownload = null;
    }
  });
}

/** Remove playlist ownership first; orphaned files are never published afterward. */
export function removeOfflinePlaylist(scope: string, playlistIdValue: unknown): Promise<void> {
  const requestedEpoch = runtimeEpoch;
  return serialized(async () => {
    const value = await requireContext(scope, requestedEpoch);
    const playlistId = offlinePlaylistId(playlistIdValue);
    const removal = removePlaylistDownload(value.manifest, playlistId);
    if (removal.manifest === value.manifest && value.pendingOrphanedFiles.size === 0) return;

    const progress = {
      phase: 'removing' as const,
      playlistId,
      done: 0,
      total: Math.max(
        1,
        new Set([...value.pendingOrphanedFiles, ...removal.orphanedFiles]).size,
      ),
      currentTrackId: null,
      bytesWritten: 0,
      totalBytes: null,
    };
    if (removal.manifest !== value.manifest) {
      await persistManifest(value, removal.manifest);
      value.manifest = removal.manifest;
      value.trackUris = Object.fromEntries(
        Object.entries(value.trackUris).filter(([trackId]) =>
          value.manifest.tracks[trackId] !== undefined),
      );
      removal.orphanedFiles.forEach((fileName) => value.pendingOrphanedFiles.add(fileName));
    }
    publishContext(value, { progress });

    try {
      if (value.pendingOrphanedFiles.size > 0) {
        const pendingFiles = [...value.pendingOrphanedFiles].sort();
        value.availableDiskBytes = await removeNativeOfflineFiles(
          value.scope,
          value.generation,
          pendingFiles,
        );
        assertCurrent(value);
        pendingFiles.forEach((fileName) => value.pendingOrphanedFiles.delete(fileName));
      }
      publishContext(value);
    } catch (error) {
      if (value.epoch === runtimeEpoch && context === value) {
        publishContext(value, { error: 'remove-failed' });
      }
      throw error;
    }
  });
}

/**
 * Clear immediately invalidates JS state. A null/unknown account uses the
 * native all-scopes eraser so a cold authoritative 401 cannot leave old audio.
 */
export function clearOfflineDownloads(scope: string | null): Promise<void> {
  if (activeClear !== null) {
    if (activeClearScope === null || activeClearScope === scope) return activeClear;
    const narrowerClear = activeClear;
    const promotedClear = narrowerClear
      .catch(() => undefined)
      .then(() => {
        if (activeClear === narrowerClear) {
          activeClear = null;
          activeClearScope = undefined;
        }
        return clearOfflineDownloads(null);
      });
    clearBarrier = promotedClear;
    return promotedClear;
  }
  runtimeEpoch += 1;
  const previousContext = context;
  context = null;
  activeDownload = null;
  resetOfflineSnapshot();
  const clearAll = scope === null
    || (previousContext !== null && previousContext.scope !== scope);

  const clear = (async () => {
    try {
      if (clearAll) {
        await clearAllNativeOfflineScopes();
      } else {
        await clearNativeOfflineScope(scope);
      }
    } catch (error) {
      publishOfflineError('storage-unavailable');
      console.warn(
        `[LoggeRythm] offline audio cleanup failed: ${cleanupDiagnosticCode(error)}`,
      );
      throw error;
    }
  })();
  activeClear = clear;
  activeClearScope = clearAll ? null : scope;
  clearBarrier = clear;
  void clear.finally(() => {
    if (activeClear === clear) {
      activeClear = null;
      activeClearScope = undefined;
    }
  }).catch(() => undefined);
  return clear;
}

/** Test-only reset; never erases native user data. */
export function resetOfflineRuntimeStateForTests(): void {
  runtimeEpoch += 1;
  context = null;
  activeDownload = null;
  activeClear = null;
  activeClearScope = undefined;
  operationTail = Promise.resolve();
  clearBarrier = Promise.resolve();
  unsubscribeProgress?.();
  unsubscribeProgress = null;
  resetOfflineSnapshot();
}
