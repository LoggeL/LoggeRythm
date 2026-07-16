import type { Track } from '../api/types';
import {
  requirePlayerSessionBinding,
  type PlayerSessionBinding,
} from './playerPort';
import type {
  NativeQueueWireItem,
  PlaybackEventJournalNativePort,
} from './nativePlayerPort';

export const PLAYBACK_EVENT_SCHEMA_VERSION = 1;
export const PLAYBACK_EVENT_CLAIM_MAX_EVENTS = 8;
export const PLAYBACK_EVENT_CLAIM_MAX_BYTES = 256 * 1024;
export const PLAYBACK_EVENT_LEASE_MS = 120_000;
export const PLAYBACK_EVENT_MAX_ATTEMPT = 16;
export const PLAYBACK_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
export const PLAYBACK_EVENT_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
export const PLAYBACK_EVENT_REQUEST_TIMEOUT_MS = 4_000;
export const PLAYBACK_EVENT_RETRY_BASE_MS = 5_000;
export const PLAYBACK_EVENT_RETRY_MAX_MS = 5 * 60 * 1_000;
export const RADIO_COMPLETION_MAX_ITEMS = 5;
export const PLAYBACK_EVENT_HEADLESS_TASK = 'LoggeRythmPlaybackEventDrain';

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEEZER_ID = /^[0-9]{1,32}$/;
const MAX_EVENT_MEDIA_ID_LENGTH = 512;
const MAX_TRACK_TEXT_LENGTH = 512;
const MAX_REFERENCE_TEXT_LENGTH = 256;
const MAX_ARTISTS = 32;
const MAX_RELEASE_DATE_LENGTH = 64;
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60;

export interface PlaybackEventTrackMetadata {
  id: string;
  title: string;
  artist: string;
  artistId: string | number;
  artists: readonly Readonly<{ id: string | number; name: string }>[];
  album: string;
  albumId: string | number;
  durationSec: number;
  rank: number;
  releaseDate: string;
}

interface PlaybackEventCommon {
  schemaVersion: 1;
  eventId: string;
  createdAtMs: number;
  attempt: number;
  track: Readonly<PlaybackEventTrackMetadata>;
}

export interface PlayPlaybackEvent extends PlaybackEventCommon {
  type: 'PLAY';
}

export interface RadioPlaybackEvent extends PlaybackEventCommon {
  type: 'RADIO';
  activeMediaId: string;
  queueGeneration: number;
}

export type DurablePlaybackEvent = PlayPlaybackEvent | RadioPlaybackEvent;

export interface PlaybackEventClaim {
  schemaVersion: 1;
  leaseId: string;
  binding: Readonly<PlayerSessionBinding>;
  events: readonly Readonly<DurablePlaybackEvent>[];
}

export interface PlaybackEventDrainResult {
  claimed: number;
  completed: number;
  retried: number;
}

export interface PlaybackEventDrainerDependencies {
  native: PlaybackEventJournalNativePort;
  /** Resolve a recent approved offline identity and ensure this exact player account is bound. */
  authorizeBinding(): Promise<Readonly<PlayerSessionBinding>>;
  recordPlay(track: Track, timeoutMs: number, eventId: string): Promise<void>;
  prepareRadioItems(
    event: Readonly<RadioPlaybackEvent>,
    timeoutMs: number,
  ): Promise<readonly NativeQueueWireItem[]>;
  onPlayRecorded?(): Promise<void>;
  now?: () => number;
}

export class PlaybackEventDrainError extends Error {
  constructor(readonly code: string) {
    super(`Playback event drain failed: ${code}`);
    this.name = 'PlaybackEventDrainError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length
    || actual.some((key, index) => key !== required[index])
  ) {
    throw new TypeError(`${label} has invalid fields`);
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new TypeError(`${label} must be a bounded safe integer`);
  }
  return value;
}

function hasUnsafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (following < 0xdc00 || following > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function safeString(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string'
    || value.length > maximumLength
    || (!allowEmpty && value.trim().length === 0)
    || hasUnsafeText(value)
  ) {
    throw new TypeError(`${label} must be bounded safe text`);
  }
  return value;
}

function canonicalUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    throw new TypeError(`${label} must be a canonical lowercase UUID`);
  }
  return value;
}

function referenceId(value: unknown, label: string): string | number {
  if (value === '') return '';
  if (typeof value === 'string') {
    if (!DEEZER_ID.test(value)) throw new TypeError(`${label} is invalid`);
    return value;
  }
  return safeInteger(value, label);
}

function decodeTrackMetadata(value: unknown, label: string): PlaybackEventTrackMetadata {
  const source = object(value, label);
  exactKeys(source, [
    'id',
    'title',
    'artist',
    'artistId',
    'artists',
    'album',
    'albumId',
    'durationSec',
    'rank',
    'releaseDate',
  ], label);
  if (!Array.isArray(source.artists) || source.artists.length > MAX_ARTISTS) {
    throw new TypeError(`${label}.artists must be a bounded array`);
  }
  const artists = source.artists.map((artist, index) => {
    const path = `${label}.artists[${index}]`;
    const entry = object(artist, path);
    exactKeys(entry, ['id', 'name'], path);
    return Object.freeze({
      id: referenceId(entry.id, `${path}.id`),
      name: safeString(entry.name, `${path}.name`, MAX_REFERENCE_TEXT_LENGTH, true),
    });
  });
  return Object.freeze({
    id: (() => {
      const id = safeString(source.id, `${label}.id`, 32);
      if (!DEEZER_ID.test(id)) throw new TypeError(`${label}.id is invalid`);
      return id;
    })(),
    title: safeString(source.title, `${label}.title`, MAX_TRACK_TEXT_LENGTH, true),
    artist: safeString(source.artist, `${label}.artist`, MAX_TRACK_TEXT_LENGTH, true),
    artistId: referenceId(source.artistId, `${label}.artistId`),
    artists: Object.freeze(artists),
    album: safeString(source.album, `${label}.album`, MAX_TRACK_TEXT_LENGTH, true),
    albumId: referenceId(source.albumId, `${label}.albumId`),
    durationSec: safeInteger(
      source.durationSec,
      `${label}.durationSec`,
      0,
      MAX_DURATION_SECONDS,
    ),
    rank: safeInteger(source.rank, `${label}.rank`),
    releaseDate: safeString(
      source.releaseDate,
      `${label}.releaseDate`,
      MAX_RELEASE_DATE_LENGTH,
      true,
    ),
  });
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const following = value.charCodeAt(index + 1);
      if (following >= 0xdc00 && following <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
    if (bytes > PLAYBACK_EVENT_CLAIM_MAX_BYTES) return bytes;
  }
  return bytes;
}

function decodeEvent(
  value: unknown,
  index: number,
  now: number,
): Readonly<DurablePlaybackEvent> {
  const label = `Playback event ${index}`;
  const source = object(value, label);
  if (source.type === 'PLAY') {
    exactKeys(source, [
      'schemaVersion',
      'eventId',
      'type',
      'createdAtMs',
      'attempt',
      'track',
    ], label);
  } else if (source.type === 'RADIO') {
    exactKeys(source, [
      'schemaVersion',
      'eventId',
      'type',
      'createdAtMs',
      'attempt',
      'track',
      'activeMediaId',
      'queueGeneration',
    ], label);
  } else {
    throw new TypeError(`${label}.type is unsupported`);
  }
  if (source.schemaVersion !== PLAYBACK_EVENT_SCHEMA_VERSION) {
    throw new TypeError(`${label}.schemaVersion is unsupported`);
  }
  const createdAtMs = safeInteger(source.createdAtMs, `${label}.createdAtMs`, 1);
  if (
    now - createdAtMs > PLAYBACK_EVENT_MAX_AGE_MS
    || createdAtMs - now > PLAYBACK_EVENT_MAX_FUTURE_SKEW_MS
  ) {
    throw new TypeError(`${label}.createdAtMs is outside the accepted window`);
  }
  const common = {
    schemaVersion: PLAYBACK_EVENT_SCHEMA_VERSION,
    eventId: canonicalUuid(source.eventId, `${label}.eventId`),
    createdAtMs,
    attempt: safeInteger(
      source.attempt,
      `${label}.attempt`,
      0,
      PLAYBACK_EVENT_MAX_ATTEMPT,
    ),
    track: decodeTrackMetadata(source.track, `${label}.track`),
  } as const;
  if (source.type === 'PLAY') return Object.freeze({ ...common, type: 'PLAY' as const });
  return Object.freeze({
    ...common,
    type: 'RADIO' as const,
    activeMediaId: safeString(
      source.activeMediaId,
      `${label}.activeMediaId`,
      MAX_EVENT_MEDIA_ID_LENGTH,
    ),
    queueGeneration: safeInteger(source.queueGeneration, `${label}.queueGeneration`),
  });
}

/** Strictly decode the only native journal data allowed to enter JavaScript. */
export function decodePlaybackEventClaim(
  raw: string,
  options: { now?: number; maxEvents?: number } = {},
): Readonly<PlaybackEventClaim> {
  if (
    typeof raw !== 'string'
    || utf8ByteLength(raw) > PLAYBACK_EVENT_CLAIM_MAX_BYTES
  ) {
    throw new TypeError('Playback event claim exceeds its byte limit');
  }
  const maxEvents = safeInteger(
    options.maxEvents ?? PLAYBACK_EVENT_CLAIM_MAX_EVENTS,
    'Playback event claim maxEvents',
    1,
    PLAYBACK_EVENT_CLAIM_MAX_EVENTS,
  );
  const now = safeInteger(options.now ?? Date.now(), 'Playback event decode time', 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError('Playback event claim is not valid JSON');
  }
  const source = object(parsed, 'Playback event claim');
  exactKeys(source, ['schemaVersion', 'leaseId', 'binding', 'events'], 'Playback event claim');
  if (source.schemaVersion !== PLAYBACK_EVENT_SCHEMA_VERSION) {
    throw new TypeError('Playback event claim schema is unsupported');
  }
  if (!Array.isArray(source.events) || source.events.length > maxEvents) {
    throw new TypeError('Playback event claim has too many events');
  }
  const binding = requirePlayerSessionBinding(source.binding);
  const events = source.events.map((event, index) => decodeEvent(event, index, now));
  const uniqueEventIds = new Set(events.map((event) => event.eventId));
  if (uniqueEventIds.size !== events.length) {
    throw new TypeError('Playback event claim contains duplicate event IDs');
  }
  return Object.freeze({
    schemaVersion: PLAYBACK_EVENT_SCHEMA_VERSION,
    leaseId: canonicalUuid(source.leaseId, 'Playback event claim leaseId'),
    binding,
    events: Object.freeze(events),
  });
}

/** Convert safe journal metadata to the API Track shape without restoring any media URL. */
export function trackFromPlaybackEventMetadata(
  track: Readonly<PlaybackEventTrackMetadata>,
): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    artist_id: track.artistId,
    artists: track.artists.map((artist) => ({ ...artist })),
    album: track.album,
    album_id: track.albumId,
    cover: '',
    duration_sec: track.durationSec,
    preview_url: null,
    rank: track.rank,
    release_date: track.releaseDate,
  };
}

function sameBinding(
  left: Readonly<PlayerSessionBinding>,
  right: Readonly<PlayerSessionBinding>,
): boolean {
  return left.accountScope === right.accountScope && left.origin === right.origin;
}

function retryNotBefore(now: number, attempt: number): number {
  const delay = Math.min(
    PLAYBACK_EVENT_RETRY_MAX_MS,
    PLAYBACK_EVENT_RETRY_BASE_MS * (2 ** attempt),
  );
  const notBefore = now + delay;
  if (!Number.isSafeInteger(notBefore)) {
    throw new PlaybackEventDrainError('retry-time-invalid');
  }
  return notBefore;
}

export class PlaybackEventDrainer {
  private inFlight: Promise<Readonly<PlaybackEventDrainResult>> | null = null;
  private readonly now: () => number;

  constructor(private readonly dependencies: PlaybackEventDrainerDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  /** Concurrent foreground/headless requests share one bounded native claim. */
  drain(): Promise<Readonly<PlaybackEventDrainResult>> {
    if (this.inFlight !== null) return this.inFlight;
    const attempt = this.run();
    this.inFlight = attempt;
    const clear = (): void => {
      if (this.inFlight === attempt) this.inFlight = null;
    };
    void attempt.then(clear, clear);
    return attempt;
  }

  private async run(): Promise<Readonly<PlaybackEventDrainResult>> {
    let raw: string;
    try {
      raw = await this.dependencies.native.claimPlaybackEvents(
        PLAYBACK_EVENT_CLAIM_MAX_EVENTS,
        PLAYBACK_EVENT_LEASE_MS,
      );
    } catch {
      throw new PlaybackEventDrainError('claim-failed');
    }
    const decodeTime = safeInteger(this.now(), 'Playback event drain time', 1);
    const claim = decodePlaybackEventClaim(raw, { now: decodeTime });
    if (claim.events.length === 0) {
      return Object.freeze({ claimed: 0, completed: 0, retried: 0 });
    }

    let authorizedBinding: Readonly<PlayerSessionBinding>;
    try {
      authorizedBinding = requirePlayerSessionBinding(
        await this.dependencies.authorizeBinding(),
      );
    } catch {
      throw new PlaybackEventDrainError('offline-identity-unavailable');
    }
    if (!sameBinding(authorizedBinding, claim.binding)) {
      throw new PlaybackEventDrainError('account-binding-mismatch');
    }

    let completed = 0;
    let retried = 0;
    for (const event of claim.events) {
      try {
        if (event.type === 'PLAY') {
          await this.dependencies.recordPlay(
            trackFromPlaybackEventMetadata(event.track),
            PLAYBACK_EVENT_REQUEST_TIMEOUT_MS,
            event.eventId,
          );
          await this.dependencies.native.ackPlaybackEvent(claim.leaseId, event.eventId);
          completed += 1;
          if (this.dependencies.onPlayRecorded !== undefined) {
            try {
              void this.dependencies.onPlayRecorded().catch(() => undefined);
            } catch {
              // Stats refresh is best-effort and must not retry an already acknowledged event.
            }
          }
        } else {
          const items = await this.dependencies.prepareRadioItems(
            event,
            PLAYBACK_EVENT_REQUEST_TIMEOUT_MS,
          );
          if (!Array.isArray(items) || items.length > RADIO_COMPLETION_MAX_ITEMS) {
            throw new PlaybackEventDrainError('radio-items-invalid');
          }
          const payload = JSON.stringify({
            schemaVersion: PLAYBACK_EVENT_SCHEMA_VERSION,
            expectedQueueGeneration: event.queueGeneration,
            expectedActiveMediaId: event.activeMediaId,
            items,
          });
          await this.dependencies.native.completeRadioPlaybackEvent(
            claim.leaseId,
            event.eventId,
            payload,
          );
          completed += 1;
        }
      } catch {
        const notBeforeEpochMs = retryNotBefore(
          safeInteger(this.now(), 'Playback event retry time', 1),
          event.attempt,
        );
        try {
          await this.dependencies.native.retryPlaybackEvent(
            claim.leaseId,
            event.eventId,
            notBeforeEpochMs,
          );
        } catch {
          throw new PlaybackEventDrainError('retry-failed');
        }
        retried += 1;
      }
    }
    return Object.freeze({ claimed: claim.events.length, completed, retried });
  }
}
