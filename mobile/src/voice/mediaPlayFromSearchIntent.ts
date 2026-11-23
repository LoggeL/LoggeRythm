import { NativeEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';

export type MediaFocusKind =
  | 'audio'
  | 'album'
  | 'artist'
  | 'playlist'
  | 'genre'
  | 'unstructured'
  | 'unknown';

export interface MediaPlayFromSearchRequest {
  readonly query: string;
  readonly mediaFocus: string | null;
  readonly focusKind: MediaFocusKind;
  readonly artist: string | null;
  readonly album: string | null;
  readonly title: string | null;
  readonly playlist: string | null;
  readonly genre: string | null;
}

interface MediaPlayFromSearchNativeModule {
  consumePendingSearch(): Promise<string | null>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

const EVENT_NAME = 'MediaPlayFromSearchReceived';
const MAX_FIELD_LENGTH = 512;
const ALLOWED_PAYLOAD_KEYS = new Set([
  'query',
  'mediaFocus',
  'artist',
  'album',
  'title',
  'playlist',
  'genre',
]);

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function readOptionalField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`MEDIA_PLAY_FROM_SEARCH field "${key}" must be a string or null`);
  }
  const normalized = normalizeWhitespace(value);
  if (normalized.length > MAX_FIELD_LENGTH) {
    throw new Error(
      `MEDIA_PLAY_FROM_SEARCH field "${key}" exceeds ${MAX_FIELD_LENGTH} characters`,
    );
  }
  return normalized.length === 0 ? null : normalized;
}

/** Classify Android's `MediaStore.EXTRA_MEDIA_FOCUS` MIME type into a semantic focus. */
export function classifyMediaFocus(mediaFocus: string | null): MediaFocusKind {
  if (mediaFocus === null || mediaFocus.length === 0) return 'unstructured';
  const normalized = mediaFocus.trim().toLowerCase();
  switch (normalized) {
    case 'vnd.android.cursor.item/*':
      return 'unstructured';
    case 'vnd.android.cursor.item/audio':
      return 'audio';
    case 'vnd.android.cursor.item/album':
      return 'album';
    case 'vnd.android.cursor.item/artist':
      return 'artist';
    case 'vnd.android.cursor.item/playlist':
      return 'playlist';
    case 'vnd.android.cursor.item/genre':
      return 'genre';
    default:
      return 'unknown';
  }
}

/**
 * Strictly parse the JSON payload serialized by `MediaPlayFromSearchInbox`.
 * Fails loudly on malformed JSON, unexpected keys, or invalid field types.
 */
export function parseMediaPlayFromSearchPayload(raw: string): MediaPlayFromSearchRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid MEDIA_PLAY_FROM_SEARCH JSON payload: ${detail}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('MEDIA_PLAY_FROM_SEARCH payload must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) {
      throw new Error(`MEDIA_PLAY_FROM_SEARCH payload contains unexpected key "${key}"`);
    }
  }

  const query = readOptionalField(record, 'query') ?? '';
  const mediaFocus = readOptionalField(record, 'mediaFocus');
  const artist = readOptionalField(record, 'artist');
  const album = readOptionalField(record, 'album');
  const title = readOptionalField(record, 'title');
  const playlist = readOptionalField(record, 'playlist');
  const genre = readOptionalField(record, 'genre');

  return Object.freeze({
    query,
    mediaFocus,
    focusKind: classifyMediaFocus(mediaFocus),
    artist,
    album,
    title,
    playlist,
    genre,
  });
}

function nativeModule(): MediaPlayFromSearchNativeModule | null {
  if (Platform.OS !== 'android') return null;
  const candidate = NativeModules.MediaPlayFromSearchIntent as
    | MediaPlayFromSearchNativeModule
    | undefined;
  return candidate ?? null;
}

/**
 * Subscribe before draining the cold-start launch intent so no voice search
 * request can be missed or duplicated across startup and warm `onNewIntent`.
 *
 * Non-Android platforms (or test/Expo Go builds without the native module) are
 * an explicit no-op; bridge and payload errors are always reported loudly via `onError`.
 */
export function startMediaPlayFromSearchIntake(
  onRequest: (request: MediaPlayFromSearchRequest) => void,
  onError: (error: unknown) => void,
): () => void {
  const module = nativeModule();
  if (module === null) return () => undefined;

  let active = true;
  let subscription: EmitterSubscription | null = null;

  const deliver = (raw: unknown) => {
    if (!active) return;
    if (typeof raw !== 'string') {
      onError(new Error(`Expected string MEDIA_PLAY_FROM_SEARCH payload, received ${typeof raw}`));
      return;
    }
    try {
      onRequest(parseMediaPlayFromSearchPayload(raw));
    } catch (error) {
      onError(error);
    }
  };

  try {
    subscription = new NativeEventEmitter(module).addListener(EVENT_NAME, deliver);
  } catch (error) {
    onError(error);
  }

  void module
    .consumePendingSearch()
    .then((raw) => {
      if (!active || raw === null) return;
      deliver(raw);
    })
    .catch((error) => {
      if (active) onError(error);
    });

  return () => {
    active = false;
    subscription?.remove();
  };
}
