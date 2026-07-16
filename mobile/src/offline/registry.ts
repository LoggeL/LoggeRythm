import type { OfflineManifest, OfflinePlaylistView } from './model';
import { offlinePlaylistViews, offlineStorageBytes, offlineTrackId } from './model';

export type OfflineRuntimeError = 'storage-unavailable' | 'download-failed' | 'remove-failed';

export interface OfflineDownloadProgress {
  phase: 'downloading' | 'removing';
  playlistId: string;
  done: number;
  total: number;
  currentTrackId: string | null;
  bytesWritten: number;
  totalBytes: number | null;
}

export interface OfflineRuntimeSnapshot {
  scope: string | null;
  hydrated: boolean;
  manifest: OfflineManifest | null;
  directoryUri: string | null;
  playlists: readonly OfflinePlaylistView[];
  trackUris: Readonly<Record<string, string>>;
  downloadedTrackIds: ReadonlySet<string>;
  storageBytes: number;
  availableDiskBytes: number | null;
  progress: OfflineDownloadProgress | null;
  error: OfflineRuntimeError | null;
}

const EMPTY_IDS = new Set<string>();
const EMPTY_URIS: Readonly<Record<string, string>> = {};
const EMPTY_PLAYLISTS: readonly OfflinePlaylistView[] = [];

let snapshot: OfflineRuntimeSnapshot = {
  scope: null,
  hydrated: false,
  manifest: null,
  directoryUri: null,
  playlists: EMPTY_PLAYLISTS,
  trackUris: EMPTY_URIS,
  downloadedTrackIds: EMPTY_IDS,
  storageBytes: 0,
  availableDiskBytes: null,
  progress: null,
  error: null,
};

const listeners = new Set<() => void>();

export function getOfflineSnapshot(): OfflineRuntimeSnapshot {
  return snapshot;
}

export function subscribeOfflineDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: OfflineRuntimeSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function resetOfflineSnapshot(scope: string | null = null): void {
  publish({
    scope,
    hydrated: false,
    manifest: null,
    directoryUri: null,
    playlists: EMPTY_PLAYLISTS,
    trackUris: EMPTY_URIS,
    downloadedTrackIds: EMPTY_IDS,
    storageBytes: 0,
    availableDiskBytes: null,
    progress: null,
    error: null,
  });
}

export function publishOfflineManifest(input: {
  manifest: OfflineManifest;
  directoryUri: string;
  trackUris: Readonly<Record<string, string>>;
  availableDiskBytes: number | null;
  progress?: OfflineDownloadProgress | null;
  error?: OfflineRuntimeError | null;
}): void {
  if (snapshot.scope !== null && snapshot.scope !== input.manifest.scope) {
    throw new Error('Offline manifest cannot replace another active account scope');
  }
  const directoryUri = exactOfflineDirectoryUri(input.directoryUri);
  const trackUris: Record<string, string> = {};
  for (const [trackId, entry] of Object.entries(input.manifest.tracks)) {
    const uri = input.trackUris[trackId];
    if (uri !== `${directoryUri}${entry.fileName}`) {
      throw new Error(`Offline track ${trackId} is not bound to its verified native file`);
    }
    trackUris[trackId] = uri;
  }
  const downloadedTrackIds = new Set(Object.keys(trackUris));
  publish({
    scope: input.manifest.scope,
    hydrated: true,
    manifest: input.manifest,
    directoryUri,
    playlists: offlinePlaylistViews(input.manifest),
    trackUris,
    downloadedTrackIds,
    storageBytes: offlineStorageBytes(input.manifest),
    availableDiskBytes:
      typeof input.availableDiskBytes === 'number'
      && Number.isFinite(input.availableDiskBytes)
      && input.availableDiskBytes >= 0
        ? input.availableDiskBytes
        : null,
    progress: input.progress ?? null,
    error: input.error ?? null,
  });
}

export function publishOfflineProgress(progress: OfflineDownloadProgress | null): void {
  publish({ ...snapshot, progress, error: progress === null ? snapshot.error : null });
}

export function publishOfflineError(error: OfflineRuntimeError | null): void {
  publish({ ...snapshot, error });
}

/** Synchronous, account-bound resolver used while assembling native queue items. */
export function offlineUriForTrack(trackIdValue: unknown): string | null {
  let trackId: string;
  try {
    trackId = offlineTrackId(trackIdValue);
  } catch {
    return null;
  }
  if (!snapshot.hydrated || snapshot.scope === null) return null;
  const entry = snapshot.manifest?.tracks[trackId];
  const uri = snapshot.trackUris[trackId];
  return entry !== undefined
    && snapshot.directoryUri !== null
    && uri === `${snapshot.directoryUri}${entry.fileName}`
    ? uri
    : null;
}

function exactOfflineDirectoryUri(value: string): string {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    throw new Error('Offline native directory URI is invalid');
  }
  if (
    uri.protocol !== 'file:'
    || uri.host !== ''
    || uri.username !== ''
    || uri.password !== ''
    || uri.search !== ''
    || uri.hash !== ''
    || uri.toString() !== value
    || /%[0-9a-f]{2}/i.test(uri.pathname)
    || !/\/loggerythm_explicit_downloads\/v1\/scopes\/[a-f0-9]{64}\/audio\/$/.test(uri.pathname)
  ) {
    throw new Error('Offline native directory URI is outside the controlled scope');
  }
  return value;
}

export function trackIsExplicitlyDownloaded(trackIdValue: unknown): boolean {
  try {
    return snapshot.downloadedTrackIds.has(offlineTrackId(trackIdValue));
  } catch {
    return false;
  }
}
