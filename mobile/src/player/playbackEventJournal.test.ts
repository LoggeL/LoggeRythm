import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import type {
  AuthenticatedRequestAuthority,
  SessionInvalidationAuthority,
} from '../api/client';
import type {
  NativeQueueWireItem,
  PlaybackEventJournalNativePort,
} from './nativePlayerPort';
import {
  PLAYBACK_EVENT_CLAIM_MAX_EVENTS,
  PLAYBACK_EVENT_CLAIM_MAX_BYTES,
  PLAYBACK_EVENT_LEASE_MS,
  PLAYBACK_EVENT_MAX_AGE_MS,
  PLAYBACK_EVENT_MAX_ATTEMPT,
  PLAYBACK_EVENT_MAX_FUTURE_SKEW_MS,
  PLAYBACK_EVENT_REQUEST_TIMEOUT_MS,
  PLAYBACK_EVENT_RETRY_BASE_MS,
  PlaybackEventDrainError,
  PlaybackEventDrainer,
  decodePlaybackEventClaim,
  trackFromPlaybackEventMetadata,
  type PlaybackEventDrainerDependencies,
} from './playbackEventJournal';

vi.mock('react-native', () => ({ NativeModules: {} }));

const NOW = 1_784_230_000_000;
const LEASE_ID = '123e4567-e89b-42d3-a456-426614174000';
const PLAY_ID = '123e4567-e89b-42d3-a456-426614174001';
const RADIO_ID = '123e4567-e89b-42d3-a456-426614174002';
const BINDING = {
  accountScope: 'user:7',
  origin: 'https://loggerythm.logge.top',
} as const;
const REQUEST_AUTHORITY =
  Object.freeze({}) as AuthenticatedRequestAuthority;
const INVALIDATION_AUTHORITY =
  Object.freeze({}) as SessionInvalidationAuthority;

function metadata(id = '42') {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Journal Artist',
    artistId: '10',
    artists: [{ id: '10', name: 'Journal Artist' }],
    album: 'Journal Album',
    albumId: '20',
    durationSec: 180,
    rank: 1,
    releaseDate: '2026-07-16',
  };
}

function playEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: PLAY_ID,
    type: 'PLAY',
    createdAtMs: NOW - 1_000,
    attempt: 0,
    track: metadata(),
    ...overrides,
  };
}

function radioEvent(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    eventId: RADIO_ID,
    type: 'RADIO',
    createdAtMs: NOW - 500,
    attempt: 1,
    track: metadata('84'),
    activeMediaId: 'radio:9:84',
    queueGeneration: 33,
    ...overrides,
  };
}

function claim(events: unknown[], binding: unknown = BINDING): string {
  return JSON.stringify({
    schemaVersion: 1,
    leaseId: LEASE_ID,
    binding,
    events,
  });
}

function nativePort(raw = claim([])): PlaybackEventJournalNativePort & {
  claimPlaybackEvents: ReturnType<typeof vi.fn>;
  ackPlaybackEvent: ReturnType<typeof vi.fn>;
  retryPlaybackEvent: ReturnType<typeof vi.fn>;
  completeRadioPlaybackEvent: ReturnType<typeof vi.fn>;
} {
  return {
    claimPlaybackEvents: vi.fn(async () => raw),
    ackPlaybackEvent: vi.fn(async () => undefined),
    retryPlaybackEvent: vi.fn(async () => undefined),
    completeRadioPlaybackEvent: vi.fn(async () => undefined),
  };
}

function dependencies(
  native: PlaybackEventJournalNativePort,
  overrides: Partial<PlaybackEventDrainerDependencies> = {},
): PlaybackEventDrainerDependencies {
  return {
    native,
    captureAuthenticatedRequestAuthority: vi.fn(async () => REQUEST_AUTHORITY),
    authorizeBinding: vi.fn(async () => BINDING),
    authoritativeSessionInvalidation: vi.fn(() => null),
    isAuthenticatedRequestAuthorityError: vi.fn(() => false),
    clearAuthoritativeSessionAuthority: vi.fn(async () => undefined),
    recordPlay: vi.fn(async () => undefined),
    prepareRadioItems: vi.fn(async () => []),
    onPlayRecorded: vi.fn(async () => undefined),
    now: () => NOW,
    ...overrides,
  };
}

function queueItem(id: string): NativeQueueWireItem {
  return {
    id: `radio:completion:${id}`,
    url: `https://loggerythm.logge.top/api/tracks/${id}/stream`,
    title: `Track ${id}`,
    headers: { Cookie: 'sf_session=private-and-never-journaled' },
    extras: { track: { id }, radio: true },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('durable playback-event schema', () => {
  it('decodes only the exact mixed claim and reconstructs a URL-free API Track', () => {
    const decoded = decodePlaybackEventClaim(claim([playEvent(), radioEvent()]), { now: NOW });

    expect(decoded).toEqual({
      schemaVersion: 1,
      leaseId: LEASE_ID,
      binding: BINDING,
      events: [playEvent(), radioEvent()],
    });
    expect(trackFromPlaybackEventMetadata(decoded.events[0].track)).toEqual({
      id: '42',
      title: 'Track 42',
      artist: 'Journal Artist',
      artist_id: '10',
      artists: [{ id: '10', name: 'Journal Artist' }],
      album: 'Journal Album',
      album_id: '20',
      cover: '',
      duration_sec: 180,
      preview_url: null,
      rank: 1,
      release_date: '2026-07-16',
    } satisfies Track);
  });

  it('accepts backend-valid empty display metadata but never an empty track ID', () => {
    const emptyDisplay = metadata();
    emptyDisplay.title = '';
    emptyDisplay.artist = '';
    emptyDisplay.artists = [{ id: '10', name: '' }];
    expect(() => decodePlaybackEventClaim(claim([
      playEvent({ track: emptyDisplay }),
    ]), { now: NOW })).not.toThrow();
    expect(() => decodePlaybackEventClaim(claim([
      playEvent({ track: { ...emptyDisplay, id: '' } }),
    ]), { now: NOW })).toThrow();
  });

  it.each([
    ['top-level extra field', () => JSON.stringify({ ...JSON.parse(claim([])), auth: 'x' })],
    ['uppercase UUID', () => claim([{ ...playEvent(), eventId: PLAY_ID.toUpperCase() }])],
    ['non-v4 UUID', () => claim([{ ...playEvent(), eventId: '123e4567-e89b-12d3-a456-426614174001' }])],
    ['unsupported type', () => claim([{ ...playEvent(), type: 'ERROR' }])],
    ['event extra field', () => claim([{ ...playEvent(), rawError: 'private' }])],
    ['track media URL', () => claim([{ ...playEvent(), track: { ...metadata(), url: 'https://x' } }])],
    ['track cookie', () => claim([{ ...playEvent(), track: { ...metadata(), cookie: 'x' } }])],
    ['track preview URL', () => claim([{
      ...playEvent(),
      track: { ...metadata(), previewUrl: 'https://x' },
    }])],
    ['attempt overflow', () => claim([playEvent({ attempt: PLAYBACK_EVENT_MAX_ATTEMPT + 1 })])],
    ['expired event', () => claim([playEvent({ createdAtMs: NOW - PLAYBACK_EVENT_MAX_AGE_MS - 1 })])],
    ['future event', () => claim([playEvent({
      createdAtMs: NOW + PLAYBACK_EVENT_MAX_FUTURE_SKEW_MS + 1,
    })])],
    ['duplicate IDs', () => claim([playEvent(), playEvent()])],
    ['too many events', () => claim(Array.from(
      { length: PLAYBACK_EVENT_CLAIM_MAX_EVENTS + 1 },
      (_value, index) => playEvent({
        eventId: `123e4567-e89b-42d3-a456-4266141740${String(index).padStart(2, '0')}`,
      }),
    ))],
  ])('rejects %s without accepting a partial claim', (_label, raw) => {
    expect(() => decodePlaybackEventClaim(raw(), { now: NOW })).toThrow();
  });

  it('rejects a claim above the 256 KiB wire limit before parsing', () => {
    expect(() => decodePlaybackEventClaim(
      ' '.repeat(PLAYBACK_EVENT_CLAIM_MAX_BYTES + 1),
      { now: NOW },
    )).toThrow('byte limit');
  });
});

describe('durable playback-event drainer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('coalesces concurrent foreground/headless drains into one bounded claim', async () => {
    const pending = deferred<string>();
    const native = nativePort();
    native.claimPlaybackEvents.mockReturnValueOnce(pending.promise);
    const authorizeBinding = vi.fn(async () => BINDING);
    const drainer = new PlaybackEventDrainer(dependencies(native, { authorizeBinding }));

    const foreground = drainer.drain();
    const headless = drainer.drain();
    expect(headless).toBe(foreground);
    expect(native.claimPlaybackEvents).toHaveBeenCalledWith(
      PLAYBACK_EVENT_CLAIM_MAX_EVENTS,
      PLAYBACK_EVENT_LEASE_MS,
    );
    pending.resolve(claim([]));

    await expect(foreground).resolves.toEqual({ claimed: 0, completed: 0, retried: 0 });
    expect(native.claimPlaybackEvents).toHaveBeenCalledOnce();
    expect(authorizeBinding).not.toHaveBeenCalled();
  });

  it('records PLAY with its event UUID, then acknowledges and refreshes stats', async () => {
    const native = nativePort(claim([playEvent()]));
    const recordPlay = vi.fn(async () => undefined);
    const onPlayRecorded = vi.fn(async () => undefined);
    const drainer = new PlaybackEventDrainer(dependencies(native, {
      recordPlay,
      onPlayRecorded,
    }));

    await expect(drainer.drain()).resolves.toEqual({ claimed: 1, completed: 1, retried: 0 });
    expect(recordPlay).toHaveBeenCalledWith(
      expect.objectContaining({ id: '42', cover: '', preview_url: null }),
      PLAYBACK_EVENT_REQUEST_TIMEOUT_MS,
      PLAY_ID,
      REQUEST_AUTHORITY,
    );
    expect(native.ackPlaybackEvent).toHaveBeenCalledWith(LEASE_ID, PLAY_ID);
    expect(native.retryPlaybackEvent).not.toHaveBeenCalled();
    expect(onPlayRecorded).toHaveBeenCalledOnce();
  });

  it('does not retry an acknowledged PLAY when the best-effort stats callback throws', async () => {
    const native = nativePort(claim([playEvent()]));
    const drainer = new PlaybackEventDrainer(dependencies(native, {
      onPlayRecorded: () => {
        throw new Error('stats refresh failed');
      },
    }));

    await expect(drainer.drain()).resolves.toEqual({ claimed: 1, completed: 1, retried: 0 });
    expect(native.ackPlaybackEvent).toHaveBeenCalledWith(LEASE_ID, PLAY_ID);
    expect(native.retryPlaybackEvent).not.toHaveBeenCalled();
  });

  it('releases a failed event with bounded backoff and no diagnostic payload', async () => {
    const failed = playEvent({ attempt: 2 });
    const native = nativePort(claim([failed]));
    const recordPlay = vi.fn(async () => {
      throw new Error('server leaked sf_session=do-not-forward');
    });
    const drainer = new PlaybackEventDrainer(dependencies(native, { recordPlay }));

    await expect(drainer.drain()).resolves.toEqual({ claimed: 1, completed: 0, retried: 1 });
    expect(native.retryPlaybackEvent).toHaveBeenCalledWith(
      LEASE_ID,
      PLAY_ID,
      NOW + PLAYBACK_EVENT_RETRY_BASE_MS * 4,
    );
    expect(native.retryPlaybackEvent.mock.calls[0]).toHaveLength(3);
    expect(native.ackPlaybackEvent).not.toHaveBeenCalled();
  });

  it('clears all local authority and stops without native retry after PLAY returns 401', async () => {
    const unauthorized = { status: 401, privateBody: 'never forward this value' };
    const native = nativePort(claim([playEvent(), radioEvent()]));
    const clearAuthoritativeSessionAuthority = vi.fn(async () => undefined);
    const prepareRadioItems = vi.fn(async () => [queueItem('101')]);
    const drainer = new PlaybackEventDrainer(dependencies(native, {
      recordPlay: vi.fn(async () => {
        throw unauthorized;
      }),
      authoritativeSessionInvalidation: (error) =>
        error === unauthorized ? INVALIDATION_AUTHORITY : null,
      clearAuthoritativeSessionAuthority,
      prepareRadioItems,
    }));

    await expect(drainer.drain()).rejects.toEqual(
      expect.objectContaining<Partial<PlaybackEventDrainError>>({
        code: 'session-invalidated',
      }),
    );
    expect(clearAuthoritativeSessionAuthority)
      .toHaveBeenCalledExactlyOnceWith(INVALIDATION_AUTHORITY);
    expect(native.retryPlaybackEvent).not.toHaveBeenCalled();
    expect(native.ackPlaybackEvent).not.toHaveBeenCalled();
    expect(native.completeRadioPlaybackEvent).not.toHaveBeenCalled();
    expect(prepareRadioItems).not.toHaveBeenCalled();
  });

  it('stops without native retry when RADIO returns 401 and authority cleanup fails', async () => {
    const unauthorized = { status: 401 };
    const native = nativePort(claim([radioEvent()]));
    const clearAuthoritativeSessionAuthority = vi.fn(async () => {
      throw new Error('private cleanup diagnostic');
    });
    const drainer = new PlaybackEventDrainer(dependencies(native, {
      prepareRadioItems: vi.fn(async () => {
        throw unauthorized;
      }),
      authoritativeSessionInvalidation: (error) =>
        error === unauthorized ? INVALIDATION_AUTHORITY : null,
      clearAuthoritativeSessionAuthority,
    }));

    await expect(drainer.drain()).rejects.toEqual(
      expect.objectContaining<Partial<PlaybackEventDrainError>>({
        code: 'session-cleanup-failed',
        message: 'Playback event drain failed: session-cleanup-failed',
      }),
    );
    expect(clearAuthoritativeSessionAuthority)
      .toHaveBeenCalledExactlyOnceWith(INVALIDATION_AUTHORITY);
    expect(native.retryPlaybackEvent).not.toHaveBeenCalled();
    expect(native.ackPlaybackEvent).not.toHaveBeenCalled();
    expect(native.completeRadioPlaybackEvent).not.toHaveBeenCalled();
  });

  it('fails closed before processing when approved identity and claim binding differ', async () => {
    const native = nativePort(claim([playEvent()]));
    const recordPlay = vi.fn(async () => undefined);
    const drainer = new PlaybackEventDrainer(dependencies(native, {
      authorizeBinding: vi.fn(async () => ({ ...BINDING, accountScope: 'user:8' })),
      recordPlay,
    }));

    await expect(drainer.drain()).rejects.toEqual(
      expect.objectContaining<Partial<PlaybackEventDrainError>>({
        code: 'account-binding-mismatch',
      }),
    );
    expect(recordPlay).not.toHaveBeenCalled();
    expect(native.ackPlaybackEvent).not.toHaveBeenCalled();
    expect(native.retryPlaybackEvent).not.toHaveBeenCalled();
    expect(native.completeRadioPlaybackEvent).not.toHaveBeenCalled();
  });

  it('submits RADIO completion atomically and never acknowledges it separately', async () => {
    const native = nativePort(claim([radioEvent()]));
    const items = [queueItem('101'), queueItem('102')];
    const prepareRadioItems = vi.fn(async () => items);
    const drainer = new PlaybackEventDrainer(dependencies(native, { prepareRadioItems }));

    await expect(drainer.drain()).resolves.toEqual({ claimed: 1, completed: 1, retried: 0 });
    expect(prepareRadioItems).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: RADIO_ID, activeMediaId: 'radio:9:84' }),
      PLAYBACK_EVENT_REQUEST_TIMEOUT_MS,
      REQUEST_AUTHORITY,
    );
    expect(native.completeRadioPlaybackEvent).toHaveBeenCalledWith(
      LEASE_ID,
      RADIO_ID,
      JSON.stringify({
        schemaVersion: 1,
        expectedQueueGeneration: 33,
        expectedActiveMediaId: 'radio:9:84',
        items,
      }),
    );
    expect(native.ackPlaybackEvent).not.toHaveBeenCalled();
  });

  it('completes a stale RADIO as an atomic empty no-op instead of appending in JS', async () => {
    const native = nativePort(claim([radioEvent()]));
    const prepareRadioItems = vi.fn(async () => []);
    const drainer = new PlaybackEventDrainer(dependencies(native, { prepareRadioItems }));

    await drainer.drain();

    expect(native.completeRadioPlaybackEvent).toHaveBeenCalledWith(
      LEASE_ID,
      RADIO_ID,
      JSON.stringify({
        schemaVersion: 1,
        expectedQueueGeneration: 33,
        expectedActiveMediaId: 'radio:9:84',
        items: [],
      }),
    );
    expect(native.ackPlaybackEvent).not.toHaveBeenCalled();
  });

  it('retries instead of submitting more than five RADIO items', async () => {
    const native = nativePort(claim([radioEvent()]));
    const prepareRadioItems = vi.fn(async () =>
      Array.from({ length: 6 }, (_value, index) => queueItem(String(index))),
    );
    const drainer = new PlaybackEventDrainer(dependencies(native, { prepareRadioItems }));

    await expect(drainer.drain()).resolves.toEqual({ claimed: 1, completed: 0, retried: 1 });
    expect(native.completeRadioPlaybackEvent).not.toHaveBeenCalled();
    expect(native.retryPlaybackEvent).toHaveBeenCalledWith(
      LEASE_ID,
      RADIO_ID,
      NOW + PLAYBACK_EVENT_RETRY_BASE_MS * 2,
    );
  });

  it('never starts PLAY with session B after the claim captured authority A', async () => {
    const authorityChanged = new Error('opaque authority changed');
    const native = nativePort(claim([playEvent()]));
    const recordPlay = vi.fn(async (
      _track,
      _timeout,
      _eventId,
      authority,
    ) => {
      expect(authority).toBe(REQUEST_AUTHORITY);
      throw authorityChanged;
    });
    const drainer = new PlaybackEventDrainer(dependencies(native, {
      recordPlay,
      isAuthenticatedRequestAuthorityError: (error) =>
        error === authorityChanged,
    }));

    await expect(drainer.drain()).rejects.toMatchObject({
      code: 'session-authority-changed',
    });
    expect(recordPlay).toHaveBeenCalledOnce();
    expect(native.ackPlaybackEvent).not.toHaveBeenCalled();
    expect(native.retryPlaybackEvent).not.toHaveBeenCalled();
  });

  it('never starts RADIO with session B after the claim captured authority A', async () => {
    const authorityChanged = new Error('opaque authority changed');
    const native = nativePort(claim([radioEvent()]));
    const prepareRadioItems = vi.fn(async (
      _event,
      _timeout,
      authority,
    ) => {
      expect(authority).toBe(REQUEST_AUTHORITY);
      throw authorityChanged;
    });
    const drainer = new PlaybackEventDrainer(dependencies(native, {
      prepareRadioItems,
      isAuthenticatedRequestAuthorityError: (error) =>
        error === authorityChanged,
    }));

    await expect(drainer.drain()).rejects.toMatchObject({
      code: 'session-authority-changed',
    });
    expect(prepareRadioItems).toHaveBeenCalledOnce();
    expect(native.completeRadioPlaybackEvent).not.toHaveBeenCalled();
    expect(native.retryPlaybackEvent).not.toHaveBeenCalled();
  });
});
