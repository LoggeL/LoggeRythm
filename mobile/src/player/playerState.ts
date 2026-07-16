import {
  PlaybackState,
  RepeatMode,
  type BrowseCategory,
  type BrowseItem,
  type MediaItem,
  type MediaUrl,
  type PlayerSnapshot,
  type QueueMediaItem,
  type QueuePersistenceState,
} from './playerPort';

const SENSITIVE_KEY_PARTS = [
  'authorization',
  'cookie',
  'credential',
  'header',
  'password',
  'proxyauth',
  'secret',
  'session',
  'setcookie',
  'token',
] as const;

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeNumber(value: unknown, label: string, options: { min?: number } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new RangeError(`${label} must be at least ${options.min}`);
  }
  return value;
}

export function requireFinitePosition(value: number, label = 'position'): number {
  return safeNumber(value, label, { min: 0 });
}

export function requireQueueIndex(
  index: number,
  queueLength: number,
  label: string,
  allowEnd = false,
): number {
  const maximum = allowEnd ? queueLength : queueLength - 1;
  if (!Number.isInteger(index) || index < 0 || index > maximum) {
    throw new RangeError(`${label} index ${String(index)} is outside a ${queueLength}-item queue`);
  }
  return index;
}

export function requireMediaId(value: unknown, label = 'mediaId'): string {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new TypeError(
      `${label} must be 1-128 characters using only letters, digits, dot, underscore, colon, or dash`,
    );
  }
  return value;
}

function assertJsonValue(value: unknown, label: string, seen: Set<object>): void {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${label} must be JSON-serializable`);
  if (seen.has(value)) throw new TypeError(`${label} must not contain cycles`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${label}[${index}]`, seen));
  } else {
    Object.entries(value).forEach(([key, entry]) => {
      if (entry !== undefined) assertJsonValue(entry, `${label}.${key}`, seen);
    });
  }
  seen.delete(value);
}

function assertHttpsOrFileUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute https: or file: URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'file:') {
    throw new TypeError(`${label} must use https: or file:`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.hash.length > 0) {
    throw new TypeError(`${label} must not contain user info or a fragment`);
  }
  if (parsed.protocol === 'https:' && parsed.hostname.length === 0) {
    throw new TypeError(`${label} https URL must contain a host`);
  }
  if (parsed.protocol === 'file:') {
    if (
      parsed.hostname.length > 0
      || parsed.search.length > 0
      || parsed.pathname.length === 0
      || !parsed.pathname.startsWith('/')
    ) {
      throw new TypeError(`${label} file URL must be local, absolute, and have no query`);
    }
  }
}

function validatePlaybackUrl(value: MediaUrl, label: string): void {
  if (typeof value === 'string') {
    assertHttpsOrFileUrl(value, label);
    return;
  }
  if (typeof value === 'number') {
    throw new TypeError(`${label} playback source cannot be an asset reference`);
  }
  if (!isRecord(value)) throw new TypeError(`${label} is invalid`);
  if (typeof value.uri !== 'string') {
    throw new TypeError(`${label}.uri playback source must be a URL string`);
  }
  assertHttpsOrFileUrl(value.uri, `${label}.uri`);
  if (value.headers !== undefined) {
    if (!isRecord(value.headers)) throw new TypeError(`${label}.headers must be an object`);
    Object.entries(value.headers).forEach(([name, headerValue]) => {
      if (
        name !== 'Cookie'
        || typeof headerValue !== 'string'
        || headerValue.length < 1
        || headerValue.length > 4_096
        || /[\r\n]/.test(headerValue)
      ) {
        throw new TypeError(`${label}.headers may contain only one safe Cookie value`);
      }
    });
    if (Object.keys(value.headers).length !== 1) {
      throw new TypeError(`${label}.headers may contain only Cookie`);
    }
    if (value.uri.startsWith('file:')) {
      throw new TypeError(`${label} local file must not carry Cookie headers`);
    }
  }
  if (value.bundle !== undefined) {
    throw new TypeError(`${label}.bundle is not supported for playback`);
  }
}

function validateArtworkUrl(value: MediaUrl, label: string): void {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`${label} asset reference must be a non-negative integer`);
    }
    return;
  }
  const uri = typeof value === 'string' ? value : value.uri;
  if (typeof uri === 'number') {
    if (!Number.isInteger(uri) || uri < 0) {
      throw new TypeError(`${label} asset reference must be a non-negative integer`);
    }
    return;
  }
  assertHttpsOrFileUrl(uri, label);
  if (typeof value === 'object' && value.headers !== undefined) {
    throw new TypeError(`${label} must not carry request headers`);
  }
}

/** Validate an input item while retaining request headers for its native command. */
export function validateMediaItem(
  item: MediaItem,
  label = 'mediaItem',
): asserts item is QueueMediaItem {
  if (!isRecord(item)) throw new TypeError(`${label} must be an object`);
  requireMediaId(item.mediaId, `${label}.mediaId`);
  validatePlaybackUrl(item.url, `${label}.url`);
  if (item.artworkUrl !== undefined) validateArtworkUrl(item.artworkUrl, `${label}.artworkUrl`);
  if (item.duration !== undefined) safeNumber(item.duration, `${label}.duration`, { min: 0 });
  if (item.extras !== undefined) assertJsonValue(item.extras, `${label}.extras`, new Set());
}

export function validateMediaItems(
  items: readonly MediaItem[],
  label = 'mediaItems',
): asserts items is readonly QueueMediaItem[] {
  if (!Array.isArray(items)) throw new TypeError(`${label} must be an array`);
  const ids = new Set<string>();
  items.forEach((item, index) => {
    validateMediaItem(item, `${label}[${index}]`);
    if (ids.has(item.mediaId)) {
      throw new Error(`${label} contains duplicate mediaId ${item.mediaId}`);
    }
    ids.add(item.mediaId);
  });
}

function sanitizeUnknown(value: unknown, seen = new Set<object>()): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => sanitizeUnknown(entry, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (isSensitiveKey(key)) return;
    const sanitized = sanitizeUnknown(entry, seen);
    if (sanitized !== undefined) result[key] = sanitized;
  });
  seen.delete(value);
  return result;
}

function sanitizeMediaUrl(value: MediaUrl): MediaUrl {
  if (typeof value !== 'object' || value === null) return value;
  return {
    uri: value.uri,
    ...(value.bundle === undefined ? {} : { bundle: value.bundle }),
  };
}

/**
 * Build a public/persistable item. HTTP headers and cookie-shaped metadata are
 * intentionally absent even when the native command receives them.
 */
export function sanitizeMediaItemForPublic(item: MediaItem): Readonly<QueueMediaItem> {
  validateMediaItem(item);
  const extras = item.extras === undefined
    ? undefined
    : sanitizeUnknown(item.extras) as Record<string, unknown>;
  return deepFreeze({
    mediaId: item.mediaId,
    url: sanitizeMediaUrl(item.url),
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.artist === undefined ? {} : { artist: item.artist }),
    ...(item.albumTitle === undefined ? {} : { albumTitle: item.albumTitle }),
    ...(item.artworkUrl === undefined ? {} : { artworkUrl: sanitizeMediaUrl(item.artworkUrl) }),
    ...(item.duration === undefined ? {} : { duration: item.duration }),
    ...(item.isLive === undefined ? {} : { isLive: item.isLive }),
    ...(item.mimeType === undefined ? {} : { mimeType: item.mimeType }),
    ...(extras === undefined ? {} : { extras }),
  });
}

export function sanitizeMediaItemsForPublic(
  items: readonly MediaItem[],
): readonly Readonly<QueueMediaItem>[] {
  validateMediaItems(items);
  return deepFreeze(items.map(sanitizeMediaItemForPublic));
}

function validateBrowseItem(item: BrowseItem, ids: Set<string>, label: string): void {
  if (!isRecord(item)) throw new TypeError(`${label} must be an object`);
  const id = requireMediaId(item.mediaId, `${label}.mediaId`);
  if (ids.has(id)) throw new Error(`Browse tree contains duplicate mediaId ${id}`);
  ids.add(id);
  if (typeof item.title !== 'string' || item.title.trim().length === 0) {
    throw new TypeError(`${label}.title must be a non-empty string`);
  }
  if (item.url !== undefined) validatePlaybackUrl(item.url, `${label}.url`);
  if (item.artworkUrl !== undefined) validateArtworkUrl(item.artworkUrl, `${label}.artworkUrl`);
  if (item.duration !== undefined) safeNumber(item.duration, `${label}.duration`, { min: 0 });
  if (item.extras !== undefined) assertJsonValue(item.extras, `${label}.extras`, new Set());
  item.children?.forEach((child, index) => validateBrowseItem(child, ids, `${label}.children[${index}]`));
}

export function validateBrowseTree(categories: readonly BrowseCategory[]): void {
  if (!Array.isArray(categories)) throw new TypeError('Browse tree must be an array');
  const ids = new Set<string>();
  categories.forEach((category, categoryIndex) => {
    if (!isRecord(category)) throw new TypeError(`Browse category ${categoryIndex} is invalid`);
    const id = requireMediaId(category.mediaId, `categories[${categoryIndex}].mediaId`);
    if (ids.has(id)) throw new Error(`Browse tree contains duplicate mediaId ${id}`);
    ids.add(id);
    if (typeof category.title !== 'string' || category.title.trim().length === 0) {
      throw new TypeError(`categories[${categoryIndex}].title must be a non-empty string`);
    }
    if (!Array.isArray(category.items)) {
      throw new TypeError(`categories[${categoryIndex}].items must be an array`);
    }
    category.items.forEach((item, itemIndex) => {
      validateBrowseItem(item, ids, `categories[${categoryIndex}].items[${itemIndex}]`);
    });
  });
}

export function validateQueuePersistenceState(
  state: QueuePersistenceState,
): Readonly<QueuePersistenceState> {
  if (!isRecord(state) || typeof state.contextShuffleEnabled !== 'boolean') {
    throw new TypeError('Queue persistence state is invalid');
  }
  if (!Array.isArray(state.contextShuffleRestoreOrder)) {
    throw new TypeError('Queue persistence restore order must be an array');
  }
  const ids = new Set<string>();
  const order = state.contextShuffleRestoreOrder.map((id, index) => {
    const exact = requireMediaId(id, `contextShuffleRestoreOrder[${index}]`);
    if (ids.has(exact)) throw new Error(`Queue persistence contains duplicate ID ${exact}`);
    ids.add(exact);
    return exact;
  });
  if (!state.contextShuffleEnabled && order.length > 0) {
    throw new Error('Queue persistence cannot retain a restore order while shuffle is disabled');
  }
  return deepFreeze({
    contextShuffleEnabled: state.contextShuffleEnabled,
    contextShuffleRestoreOrder: order,
  });
}

export function createInitialPlayerSnapshot(): Readonly<PlayerSnapshot> {
  return deepFreeze({
    revision: 0,
    isSetup: false,
    queue: [],
    activeIndex: null,
    playbackState: PlaybackState.Idle,
    isPlaying: false,
    progress: { position: 0, duration: 0, buffered: 0, cached: 0 },
    repeatMode: RepeatMode.Off,
    shuffleEnabled: false,
    playbackSpeed: 1,
    volume: 1,
    sleepTimer: null,
    queuePersistence: {
      contextShuffleEnabled: false,
      contextShuffleRestoreOrder: [],
    },
  });
}

export function nextSnapshot(
  previous: Readonly<PlayerSnapshot>,
  patch: Partial<Omit<PlayerSnapshot, 'revision'>>,
): Readonly<PlayerSnapshot> {
  const queue = patch.queue ?? previous.queue;
  const activeIndex = patch.activeIndex === undefined ? previous.activeIndex : patch.activeIndex;
  if (activeIndex !== null) requireQueueIndex(activeIndex, queue.length, 'Active');
  return deepFreeze({
    ...previous,
    ...patch,
    revision: previous.revision + 1,
  });
}

/** Safe JSON used by a future native persistence checkpoint. */
export function serializePersistablePlayerState(snapshot: Readonly<PlayerSnapshot>): string {
  return JSON.stringify({
    version: 1,
    queue: snapshot.queue.map((item) => sanitizeMediaItemForPublic(item as MediaItem)),
    activeIndex: snapshot.activeIndex,
    progress: snapshot.progress,
    repeatMode: snapshot.repeatMode,
    shuffleEnabled: snapshot.shuffleEnabled,
    playbackSpeed: snapshot.playbackSpeed,
    volume: snapshot.volume,
    sleepTimer: snapshot.sleepTimer,
    queuePersistence: validateQueuePersistenceState(snapshot.queuePersistence),
  });
}

export function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`${label} is not valid JSON`);
  }
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value as Readonly<T>;
  }
  Object.freeze(value);
  Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child));
  return value as Readonly<T>;
}
