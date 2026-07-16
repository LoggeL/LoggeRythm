import { NativeEventEmitter, NativeModules } from 'react-native';

const MODULE_NAME = 'OfflineDownloads';
const PROGRESS_EVENT = 'OfflineDownloadProgress';
const SAFE_CODE = /^[a-z][a-z0-9-]{1,63}$/;
const TRACK_ID = /^[1-9][0-9]{0,31}$/;
const PLAYLIST_ID = /^[1-9][0-9]{0,31}$/;

export interface NativeOfflineFile {
  trackId: string;
  fileName: string;
  uri: string;
  sizeBytes: number;
}

export interface NativeOfflineHydration {
  scope: string;
  generation: number;
  directoryUri: string;
  manifestJson: string | null;
  availableDiskBytes: number;
  files: NativeOfflineFile[];
  interruptedTrackIds: string[];
  invalidTrackIds: string[];
}

export interface NativeOfflineTrackRequest {
  trackId: string;
  fileName: string;
  url: string;
  headers: { Cookie: string };
}

export interface NativeOfflineTrackSuccess extends NativeOfflineFile {
  reused: boolean;
}

export interface NativeOfflineTrackFailure {
  trackId: string;
  code: string;
  retryable: boolean;
}

export interface NativeOfflineDownloadResult {
  scope: string;
  generation: number;
  playlistId: string;
  successes: NativeOfflineTrackSuccess[];
  failures: NativeOfflineTrackFailure[];
  availableDiskBytes: number;
}

export interface NativeOfflineProgress {
  playlistId: string;
  done: number;
  total: number;
  currentTrackId: string | null;
  bytesWritten: number;
  currentBytes: number;
  currentTotalBytes: number | null;
}

export interface NativeOfflineClearAllResult {
  cleanupGeneration: number;
  cleared: true;
}

interface OfflineDownloadsNativeModule {
  hydrate(scope: string): Promise<unknown>;
  persistManifest(scope: string, generation: number, manifestJson: string): Promise<unknown>;
  startPlaylistDownload(
    scope: string,
    generation: number,
    playlistId: string,
    tracks: NativeOfflineTrackRequest[],
  ): Promise<unknown>;
  removeFiles(scope: string, generation: number, fileNames: string[]): Promise<unknown>;
  clearScope(scope: string): Promise<unknown>;
  clearAllScopes(): Promise<unknown>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is invalid`);
  return value;
}

function natural(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function positiveId(value: unknown, pattern: RegExp, label: string): string {
  const id = text(value, label);
  if (!pattern.test(id)) throw new Error(`${label} is invalid`);
  return id;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid`);
  return value;
}

function stringIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} is invalid`);
  const ids = value.map((id) => positiveId(id, TRACK_ID, label));
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicates`);
  return ids;
}

function decodeFile(value: unknown, directoryUri: string, label: string): NativeOfflineFile {
  const item = record(value, label);
  const trackId = positiveId(item.trackId, TRACK_ID, `${label} track id`);
  const fileName = text(item.fileName, `${label} file name`);
  if (fileName !== `${trackId}.mp3`) throw new Error(`${label} file name is invalid`);
  const uri = text(item.uri, `${label} URI`);
  if (uri !== `${directoryUri}${fileName}`) throw new Error(`${label} URI escaped its directory`);
  const sizeBytes = natural(item.sizeBytes, `${label} size`);
  if (sizeBytes === 0) throw new Error(`${label} size is invalid`);
  return { trackId, fileName, uri, sizeBytes };
}

export function decodeNativeHydration(
  value: unknown,
  expectedScope: string,
): NativeOfflineHydration {
  const result = record(value, 'Offline hydration');
  const scope = text(result.scope, 'Offline hydration scope');
  if (scope !== expectedScope) throw new Error('Offline hydration belongs to another account');
  const generation = natural(result.generation, 'Offline hydration generation');
  const directoryUri = text(result.directoryUri, 'Offline hydration directory');
  if (!directoryUri.startsWith('file:///') || !directoryUri.endsWith('/')) {
    throw new Error('Offline hydration directory is invalid');
  }
  if (!Array.isArray(result.files)) throw new Error('Offline hydration files are invalid');
  const files = result.files.map((file, index) =>
    decodeFile(file, directoryUri, `Offline hydration file ${index}`));
  if (new Set(files.map((file) => file.trackId)).size !== files.length) {
    throw new Error('Offline hydration contains duplicate tracks');
  }
  const manifestJson = result.manifestJson;
  if (manifestJson !== null && typeof manifestJson !== 'string') {
    throw new Error('Offline hydration manifest is invalid');
  }
  return {
    scope,
    generation,
    directoryUri,
    manifestJson,
    availableDiskBytes: natural(result.availableDiskBytes, 'Offline available bytes'),
    files,
    interruptedTrackIds: stringIds(result.interruptedTrackIds, 'Interrupted track ids'),
    invalidTrackIds: stringIds(result.invalidTrackIds, 'Invalid track ids'),
  };
}

export function decodeNativeDownloadResult(
  value: unknown,
  expectedScope: string,
  expectedGeneration: number,
  expectedPlaylistId: string,
  directoryUri: string,
): NativeOfflineDownloadResult {
  const result = record(value, 'Offline download result');
  if (result.scope !== expectedScope) throw new Error('Offline result belongs to another account');
  if (natural(result.generation, 'Offline result generation') !== expectedGeneration) {
    throw new Error('Offline result is stale');
  }
  const playlistId = positiveId(result.playlistId, PLAYLIST_ID, 'Offline result playlist');
  if (playlistId !== expectedPlaylistId) throw new Error('Offline result belongs to another playlist');
  if (!Array.isArray(result.successes) || !Array.isArray(result.failures)) {
    throw new Error('Offline result collections are invalid');
  }
  const successes = result.successes.map((success, index) => {
    const item = record(success, `Offline success ${index}`);
    return {
      ...decodeFile(item, directoryUri, `Offline success ${index}`),
      reused: boolean(item.reused, `Offline success ${index} reused`),
    };
  });
  const failures = result.failures.map((failure, index) => {
    const item = record(failure, `Offline failure ${index}`);
    const code = text(item.code, `Offline failure ${index} code`);
    if (!SAFE_CODE.test(code)) throw new Error(`Offline failure ${index} code is invalid`);
    return {
      trackId: positiveId(item.trackId, TRACK_ID, `Offline failure ${index} track`),
      code,
      retryable: boolean(item.retryable, `Offline failure ${index} retryable`),
    };
  });
  return {
    scope: expectedScope,
    generation: expectedGeneration,
    playlistId,
    successes,
    failures,
    availableDiskBytes: natural(result.availableDiskBytes, 'Offline result available bytes'),
  };
}

export function decodeNativeProgress(value: unknown): NativeOfflineProgress {
  const result = record(value, 'Offline progress');
  const total = natural(result.total, 'Offline progress total');
  const done = natural(result.done, 'Offline progress done');
  if (total === 0 || done > total) throw new Error('Offline progress range is invalid');
  const currentTrackId = result.currentTrackId === null
    ? null
    : positiveId(result.currentTrackId, TRACK_ID, 'Offline progress track');
  const currentTotalBytes = result.currentTotalBytes === null
    ? null
    : natural(result.currentTotalBytes, 'Offline progress current total');
  return {
    playlistId: positiveId(result.playlistId, PLAYLIST_ID, 'Offline progress playlist'),
    done,
    total,
    currentTrackId,
    bytesWritten: natural(result.bytesWritten, 'Offline progress bytes'),
    currentBytes: natural(result.currentBytes, 'Offline progress current bytes'),
    currentTotalBytes,
  };
}

function requireModule(): OfflineDownloadsNativeModule {
  const module = NativeModules[MODULE_NAME] as Partial<OfflineDownloadsNativeModule> | undefined;
  const methods = [
    'hydrate',
    'persistManifest',
    'startPlaylistDownload',
    'removeFiles',
    'clearScope',
    'clearAllScopes',
  ];
  if (module === undefined || methods.some((method) => typeof module[method as keyof typeof module] !== 'function')) {
    throw new Error('Explicit downloads are unavailable in this Android build');
  }
  return module as OfflineDownloadsNativeModule;
}

export async function hydrateNativeOffline(scope: string): Promise<NativeOfflineHydration> {
  return decodeNativeHydration(await requireModule().hydrate(scope), scope);
}

export async function persistNativeOfflineManifest(
  scope: string,
  generation: number,
  manifestJson: string,
): Promise<void> {
  await requireModule().persistManifest(scope, generation, manifestJson);
}

export async function startNativePlaylistDownload(input: {
  scope: string;
  generation: number;
  playlistId: string;
  tracks: NativeOfflineTrackRequest[];
  directoryUri: string;
}): Promise<NativeOfflineDownloadResult> {
  const raw = await requireModule().startPlaylistDownload(
    input.scope,
    input.generation,
    input.playlistId,
    input.tracks,
  );
  return decodeNativeDownloadResult(
    raw,
    input.scope,
    input.generation,
    input.playlistId,
    input.directoryUri,
  );
}

export async function removeNativeOfflineFiles(
  scope: string,
  generation: number,
  fileNames: string[],
): Promise<number> {
  const result = record(
    await requireModule().removeFiles(scope, generation, fileNames),
    'Offline remove result',
  );
  return natural(result.availableDiskBytes, 'Offline remove available bytes');
}

export async function clearNativeOfflineScope(scope: string): Promise<number> {
  const result = record(await requireModule().clearScope(scope), 'Offline clear result');
  return natural(result.generation, 'Offline clear generation');
}

export function decodeNativeClearAllResult(value: unknown): NativeOfflineClearAllResult {
  const result = record(value, 'Offline clear-all result');
  if (result.cleared !== true) throw new Error('Offline clear-all result is incomplete');
  return {
    cleanupGeneration: natural(
      result.cleanupGeneration,
      'Offline clear-all cleanup generation',
    ),
    cleared: true,
  };
}

export async function clearAllNativeOfflineScopes(): Promise<NativeOfflineClearAllResult> {
  return decodeNativeClearAllResult(await requireModule().clearAllScopes());
}

export function subscribeNativeOfflineProgress(
  listener: (progress: NativeOfflineProgress) => void,
  onInvalid: () => void,
): () => void {
  const module = requireModule();
  const subscription = new NativeEventEmitter(module).addListener(PROGRESS_EVENT, (value) => {
    try {
      listener(decodeNativeProgress(value));
    } catch {
      onInvalid();
    }
  });
  return () => subscription.remove();
}
