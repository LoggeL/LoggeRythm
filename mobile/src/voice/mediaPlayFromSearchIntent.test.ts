import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyMediaFocus,
  parseMediaPlayFromSearchPayload,
  startMediaPlayFromSearchIntake,
} from './mediaPlayFromSearchIntent';

const mocks = vi.hoisted(() => ({
  os: 'android' as 'android' | 'ios',
  nativeModule: null as {
    consumePendingSearch: ReturnType<typeof vi.fn>;
    addListener: ReturnType<typeof vi.fn>;
    removeListeners: ReturnType<typeof vi.fn>;
  } | null,
  listeners: new Map<string, (payload: unknown) => void>(),
  callOrder: [] as string[],
  throwOnAddListener: false,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.os;
    },
  },
  NativeModules: {
    get MediaPlayFromSearchIntent() {
      return mocks.nativeModule;
    },
  },
  NativeEventEmitter: class {
    addListener(eventName: string, listener: (payload: unknown) => void) {
      mocks.callOrder.push('addListener');
      if (mocks.throwOnAddListener) {
        throw new Error('NativeEventEmitter failed');
      }
      mocks.listeners.set(eventName, listener);
      return {
        remove: () => {
          mocks.listeners.delete(eventName);
        },
      };
    }
  },
}));

describe('mediaPlayFromSearchIntent', () => {
  beforeEach(() => {
    mocks.os = 'android';
    mocks.listeners.clear();
    mocks.callOrder = [];
    mocks.throwOnAddListener = false;
    mocks.nativeModule = {
      consumePendingSearch: vi.fn(() => {
        mocks.callOrder.push('consumePendingSearch');
        return Promise.resolve(null);
      }),
      addListener: vi.fn(),
      removeListeners: vi.fn(),
    };
  });

  it('classifies standard Android EXTRA_MEDIA_FOCUS MIME types', () => {
    expect(classifyMediaFocus(null)).toBe('unstructured');
    expect(classifyMediaFocus('')).toBe('unstructured');
    expect(classifyMediaFocus('vnd.android.cursor.item/*')).toBe('unstructured');
    expect(classifyMediaFocus('vnd.android.cursor.item/audio')).toBe('audio');
    expect(classifyMediaFocus('vnd.android.cursor.item/album')).toBe('album');
    expect(classifyMediaFocus('vnd.android.cursor.item/artist')).toBe('artist');
    expect(classifyMediaFocus('vnd.android.cursor.item/playlist')).toBe('playlist');
    expect(classifyMediaFocus('vnd.android.cursor.item/genre')).toBe('genre');
    expect(classifyMediaFocus('vnd.android.cursor.item/custom')).toBe('unknown');
  });

  it('parses structured payloads and normalizes whitespace cleanly', () => {
    const parsed = parseMediaPlayFromSearchPayload(
      JSON.stringify({
        query: '  Around   the World  ',
        mediaFocus: 'vnd.android.cursor.item/audio',
        artist: ' Daft Punk ',
        album: 'Homework',
        title: 'Around the World',
        playlist: '   ',
        genre: null,
      }),
    );

    expect(parsed).toEqual({
      query: 'Around the World',
      mediaFocus: 'vnd.android.cursor.item/audio',
      focusKind: 'audio',
      artist: 'Daft Punk',
      album: 'Homework',
      title: 'Around the World',
      playlist: null,
      genre: null,
    });
  });

  it('accepts blank queries for "Hey Google, play music on LoggeRythm"', () => {
    expect(parseMediaPlayFromSearchPayload(JSON.stringify({ query: '' }))).toEqual({
      query: '',
      mediaFocus: null,
      focusKind: 'unstructured',
      artist: null,
      album: null,
      title: null,
      playlist: null,
      genre: null,
    });
  });

  it('fails loudly on corrupt JSON, unexpected keys, bad types, and oversized fields', () => {
    expect(() => parseMediaPlayFromSearchPayload('{broken')).toThrow(
      /Invalid MEDIA_PLAY_FROM_SEARCH JSON payload/,
    );
    expect(() => parseMediaPlayFromSearchPayload('[]')).toThrow(
      /must be a JSON object/,
    );
    expect(() => parseMediaPlayFromSearchPayload('{"query":"ok","extra":"nope"}')).toThrow(
      /unexpected key "extra"/,
    );
    expect(() => parseMediaPlayFromSearchPayload('{"query":123}')).toThrow(
      /must be a string or null/,
    );
    expect(() =>
      parseMediaPlayFromSearchPayload(JSON.stringify({ query: 'a'.repeat(513) })),
    ).toThrow(/exceeds 512 characters/);
  });

  it('subscribes before consuming pending launch intent and delivers both cold and warm intents', async () => {
    mocks.nativeModule!.consumePendingSearch.mockImplementation(() => {
      mocks.callOrder.push('consumePendingSearch');
      return Promise.resolve(JSON.stringify({ query: 'Cold Start Song' }));
    });
    const requests: unknown[] = [];
    const errors: unknown[] = [];

    const stop = startMediaPlayFromSearchIntake(
      (req) => requests.push(req),
      (err) => errors.push(err),
    );
    await Promise.resolve();

    expect(mocks.callOrder).toEqual(['addListener', 'consumePendingSearch']);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ query: 'Cold Start Song', focusKind: 'unstructured' });

    const emit = mocks.listeners.get('MediaPlayFromSearchReceived');
    expect(emit).toBeDefined();
    emit!(JSON.stringify({ query: 'Warm Intent', artist: 'Miles Davis' }));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ query: 'Warm Intent', artist: 'Miles Davis' });
    expect(errors).toEqual([]);

    stop();
    expect(mocks.listeners.size).toBe(0);
  });

  it('surfaces bridge registration, consume rejection, and corrupt payloads loudly via onError', async () => {
    mocks.throwOnAddListener = true;
    mocks.nativeModule!.consumePendingSearch.mockRejectedValue(new Error('native bridge boom'));
    const requests: unknown[] = [];
    const errors: unknown[] = [];

    startMediaPlayFromSearchIntake(
      (req) => requests.push(req),
      (err) => errors.push(err),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(requests).toEqual([]);
    expect(errors).toHaveLength(2);
    expect((errors[0] as Error).message).toBe('NativeEventEmitter failed');
    expect((errors[1] as Error).message).toBe('native bridge boom');
  });

  it('reports non-string and malformed payloads via onError without throwing silently', async () => {
    const errors: unknown[] = [];
    startMediaPlayFromSearchIntake(
      () => undefined,
      (err) => errors.push(err),
    );
    const emit = mocks.listeners.get('MediaPlayFromSearchReceived')!;
    emit(42);
    emit('{not-json');

    expect(errors).toHaveLength(2);
    expect((errors[0] as Error).message).toMatch(/Expected string/);
    expect((errors[1] as Error).message).toMatch(/Invalid MEDIA_PLAY_FROM_SEARCH JSON payload/);
  });

  it('is a clean no-op on non-Android platforms or when the native module is absent', () => {
    mocks.os = 'ios';
    const stopIos = startMediaPlayFromSearchIntake(vi.fn(), vi.fn());
    stopIos();
    expect(mocks.callOrder).toEqual([]);

    mocks.os = 'android';
    mocks.nativeModule = null;
    const stopMissing = startMediaPlayFromSearchIntake(vi.fn(), vi.fn());
    stopMissing();
    expect(mocks.callOrder).toEqual([]);
  });
});
