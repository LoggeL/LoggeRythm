import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_COMMAND_TRANSLATION,
  NATIVE_PLAYER_EVENT,
  NATIVE_SNAPSHOT_EVENT,
  createNativePlayerPort,
  mapBrowseTreeToNative,
  type LoggeRythmPlayerNativeModule,
  type NativePlayerEventEmitter,
} from './nativePlayerPort';
import {
  Event,
  PlaybackState,
  PlayerCommand,
  RepeatMode,
  type MediaItem,
  type RemoteControlConfig,
} from './playerPort';
import { serializePersistablePlayerState } from './playerState';

vi.mock('react-native', () => ({
  NativeEventEmitter: class {},
  NativeModules: {},
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeEmitter implements NativePlayerEventEmitter {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  addListener(eventName: string, listener: (payload: unknown) => void) {
    const listeners = this.listeners.get(eventName) ?? new Set();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
    return { remove: () => listeners.delete(listener) };
  }

  emit(eventName: string, payload: unknown): void {
    this.listeners.get(eventName)?.forEach((listener) => listener(payload));
  }
}

function nativeModule(overrides: Partial<LoggeRythmPlayerNativeModule> = {}) {
  return {
    setup: vi.fn(async () => undefined),
    command: vi.fn(async () => undefined),
    setBrowseTree: vi.fn(async () => undefined),
    clearPersistedState: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    claimPlaybackEvents: vi.fn(async () => ''),
    ackPlaybackEvent: vi.fn(async () => undefined),
    retryPlaybackEvent: vi.fn(async () => undefined),
    completeRadioPlaybackEvent: vi.fn(async () => undefined),
    setNotificationFavoriteState: vi.fn(async () => undefined),
    addListener: vi.fn(),
    removeListeners: vi.fn(),
    ...overrides,
  } satisfies LoggeRythmPlayerNativeModule;
}

function remoteItem(id: string, cookie = `session=${id}-private`): MediaItem {
  return {
    mediaId: id,
    url: {
      uri: `https://loggerythm.test/api/tracks/${id}/stream`,
      headers: { Cookie: cookie },
    },
    title: `Track ${id}`,
    artist: 'Logge',
    albumTitle: 'Private Sessions',
    artworkUrl: 'https://loggerythm.test/cover.jpg',
    duration: 12.5,
    extras: {
      track: { id, title: `Track ${id}` },
      queueOrigin: 'context',
      sessionToken: `${id}-must-never-leave-public-state`,
      nested: { authorization_header: 'also-private', safe: true },
    },
  };
}

const SESSION_BINDING = {
  accountScope: 'user:7',
  origin: 'https://loggerythm.logge.top',
} as const;

function nativeSnapshot(
  ids: readonly string[],
  options: {
    currentIndex?: number | null;
    positionMs?: number;
    isPlaying?: boolean;
    extras?: Record<string, unknown>;
    queuePersistence?: unknown;
    shuffleEnabled?: unknown;
    sleepTimer?: unknown;
  } = {},
): string {
  const currentIndex = options.currentIndex === undefined ? 0 : options.currentIndex;
  return JSON.stringify({
    schemaVersion: 1,
    playbackState: ids.length === 0 ? 'idle' : 'ready',
    playWhenReady: options.isPlaying ?? false,
    isPlaying: options.isPlaying ?? false,
    positionMs: options.positionMs ?? 0,
    durationMs: ids.length === 0 ? null : 12_500,
    bufferedPositionMs: ids.length === 0 ? 0 : 8_000,
    currentIndex,
    currentItemId: currentIndex === null || ids.length === 0 ? null : ids[currentIndex],
    repeatMode: 'off',
    queuePersistence: options.queuePersistence ?? {
      contextShuffleEnabled: false,
      contextShuffleRestoreOrder: [],
    },
    shuffleEnabled: options.shuffleEnabled ?? false,
    sleepTimer: options.sleepTimer ?? null,
    queue: ids.map((id) => ({
      id,
      title: `Native ${id}`,
      artist: 'Native Artist',
      album: 'Native Album',
      artworkUrl: 'https://loggerythm.test/native-cover.jpg',
      durationMs: 12_500,
      extras: options.extras ?? { track: { id }, queueOrigin: 'context' },
    })),
    errorCode: null,
  });
}

describe('NativeBackedPlayerPort', () => {
  let emitter: FakeEmitter;

  beforeEach(() => {
    emitter = new FakeEmitter();
  });

  it('covers the 38 currently used player calls behind the first-party port', () => {
    const port = createNativePlayerPort({ nativeModule: nativeModule(), emitter });
    const currentCalls = [
      'addEventListener',
      'addMediaItem',
      'addMediaItems',
      'cancelSleepTimer',
      'clear',
      'clearCache',
      'clearPersistedQueue',
      'getActiveMediaItem',
      'getActiveMediaItemIndex',
      'getProgress',
      'getQueue',
      'getQueuePersistenceState',
      'getRepeatMode',
      'getSleepTimer',
      'insertMediaItem',
      'isPlaying',
      'isShuffleEnabled',
      'moveMediaItem',
      'pause',
      'play',
      'registerBackgroundEventHandler',
      'removeMediaItem',
      'removeMediaItems',
      'replaceMediaItem',
      'seekTo',
      'setBrowseTree',
      'setCommands',
      'setMediaItem',
      'setMediaItems',
      'setNotificationFavoriteState',
      'setQueuePersistenceState',
      'setRepeatMode',
      'setShuffleEnabled',
      'setupPlayer',
      'skipToIndex',
      'skipToNext',
      'skipToPrevious',
      'sleepAfterMediaItemAtIndex',
      'sleepAfterTime',
    ] as const;

    expect(currentCalls).toHaveLength(39);
    currentCalls.forEach((name) => expect(typeof port[name], name).toBe('function'));
    expect(Object.keys(NATIVE_COMMAND_TRANSLATION)).toHaveLength(24);
    port.dispose();
  });

  it('keeps queue reads synchronous while serializing native commands', async () => {
    const resolvers: (() => void)[] = [];
    const module = nativeModule({
      command: vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve))),
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });

    port.setMediaItems([remoteItem('one')]);
    port.addMediaItem(remoteItem('two'));
    port.moveMediaItem(1, 0);

    expect(port.getQueue().map((item) => item.mediaId)).toEqual(['two', 'one']);
    expect(Object.isFrozen(port.getSnapshot())).toBe(true);
    expect(Object.isFrozen(port.getSnapshot().queue)).toBe(true);

    await vi.waitFor(() => expect(module.command).toHaveBeenCalledTimes(1));
    resolvers.shift()?.();
    await vi.waitFor(() => expect(module.command).toHaveBeenCalledTimes(2));
    resolvers.shift()?.();
    await vi.waitFor(() => expect(module.command).toHaveBeenCalledTimes(3));
    resolvers.shift()?.();
    await port.flush();

    expect(vi.mocked(module.command).mock.calls.map(([name]) => name)).toEqual([
      'setQueue',
      'setQueue',
      'setQueue',
    ]);
    port.dispose();
  });

  it('retains private Cookie sources across replace, insert, and move setQueue commands', async () => {
    const module = nativeModule();
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    port.setMediaItems([remoteItem('one', 'session=alpha'), remoteItem('two', 'session=beta')]);
    port.replaceMediaItem(1, remoteItem('two', 'session=beta-new'));
    port.insertMediaItem(1, remoteItem('three', 'session=gamma'));
    port.moveMediaItem(2, 0);
    await port.flush();

    const setQueuePayloads = vi.mocked(module.command).mock.calls.map(([_name, payload]) => (
      JSON.parse(payload) as { items: { id: string; headers?: { Cookie: string } }[] }
    ));
    expect(setQueuePayloads).toHaveLength(4);
    expect(setQueuePayloads[1].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'one', headers: { Cookie: 'session=alpha' } }),
      expect.objectContaining({ id: 'two', headers: { Cookie: 'session=beta-new' } }),
    ]));
    expect(setQueuePayloads[2].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'one', headers: { Cookie: 'session=alpha' } }),
      expect.objectContaining({ id: 'two', headers: { Cookie: 'session=beta-new' } }),
      expect.objectContaining({ id: 'three', headers: { Cookie: 'session=gamma' } }),
    ]));
    expect(setQueuePayloads[3].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'one', headers: { Cookie: 'session=alpha' } }),
      expect.objectContaining({ id: 'two', headers: { Cookie: 'session=beta-new' } }),
      expect.objectContaining({ id: 'three', headers: { Cookie: 'session=gamma' } }),
    ]));

    const publicJson = JSON.stringify(port.getSnapshot());
    const persistedJson = serializePersistablePlayerState(port.getSnapshot());
    for (const text of [publicJson, persistedJson]) {
      expect(text).not.toContain('Cookie');
      expect(text).not.toContain('session=');
      expect(text).not.toContain('sessionToken');
      expect(text).not.toContain('authorization_header');
      expect(text).not.toContain('must-never-leave');
    }
    port.dispose();
  });

  it('rolls the private source vault back when a same-ID replacement is rejected', async () => {
    const command = vi.fn(async (_name: string, _payloadJson: string) => undefined);
    const module = nativeModule({ command });
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    port.setMediaItem(remoteItem('one', 'session=original'));
    await port.flush();

    command.mockRejectedValueOnce(new Error('replacement rejected'));
    port.replaceMediaItem(0, remoteItem('one', 'session=rejected'));
    await expect(port.flush()).rejects.toMatchObject({ operation: 'replaceMediaItem' });

    port.addMediaItem(remoteItem('two', 'session=two'));
    await port.flush();
    const payload = JSON.parse(command.mock.calls.at(-1)?.[1] ?? '{}') as {
      items: { id: string; headers?: { Cookie: string } }[];
    };
    expect(payload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'one', headers: { Cookie: 'session=original' } }),
      expect.objectContaining({ id: 'two', headers: { Cookie: 'session=two' } }),
    ]));
    expect(JSON.stringify(port.getSnapshot())).not.toContain('session=');
    port.dispose();
  });

  it('maps the exact Native-v1 snapshot schema into seconds and exact media IDs', async () => {
    const module = nativeModule({
      command: vi.fn(async (_name, payloadJson) => {
        const payload = JSON.parse(payloadJson) as { items: { id: string }[] };
        return {
          snapshotJson: nativeSnapshot(payload.items.map((item) => item.id), {
            currentIndex: 1,
            positionMs: 1_250,
            isPlaying: true,
            extras: {
              track: { id: 'safe' },
              access_token: 'must-be-redacted',
              nested: { passwordHash: 'also-redacted', safe: true },
            },
          }),
        };
      }),
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    port.setMediaItems([remoteItem('one'), remoteItem('two')], 1);
    await port.flush();

    expect(port.getActiveMediaItemIndex()).toBe(1);
    expect(port.getActiveMediaItem()?.mediaId).toBe('two');
    expect(port.getProgress()).toEqual({
      position: 1.25,
      duration: 12.5,
      buffered: 8,
      cached: 0,
    });
    expect(port.getPlaybackState()).toBe(PlaybackState.Ready);
    expect(port.isPlaying()).toBe(true);
    expect(JSON.stringify(port.getSnapshot())).not.toContain('must-be-redacted');
    expect(JSON.stringify(port.getSnapshot())).not.toContain('also-redacted');
    port.dispose();
  });

  it('never sends restored items without a rehydrated private source back to native', async () => {
    const command = vi.fn(async (_name: string, _payloadJson: string) => undefined);
    const port = createNativePlayerPort({
      nativeModule: nativeModule({ command }),
      emitter,
    });
    const rejected: unknown[] = [];
    port.addEventListener(Event.CommandRejected, (event) => rejected.push(event));
    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one', 'two'], { currentIndex: 0 }),
    });

    expect(port.getQueue().map((item) => ({ id: item.mediaId, title: item.title }))).toEqual([
      { id: 'one', title: 'Native one' },
      { id: 'two', title: 'Native two' },
    ]);
    expect(String(port.getQueue()[0].url)).toMatch(/^file:\/\/\/__loggerythm_source_unavailable__/);
    expect(String(port.getQueue()[0].url)).not.toContain('http');

    const expectSourceUnavailable = async (operation: () => void): Promise<void> => {
      const callsBefore = command.mock.calls.length;
      operation();
      await expect(port.flush()).rejects.toMatchObject({ code: 'source-unavailable' });
      expect(command).toHaveBeenCalledTimes(callsBefore);
    };

    await expectSourceUnavailable(() => port.addMediaItem(remoteItem('three')));
    await expectSourceUnavailable(() => port.moveMediaItem(1, 0));
    await expectSourceUnavailable(() => port.skipToIndex(1));
    await expectSourceUnavailable(() => port.setMediaItems(port.getQueue()));
    expect(port.getQueue().map((item) => item.mediaId)).toEqual(['one', 'two']);
    expect(JSON.stringify(rejected)).not.toContain('__loggerythm_source_unavailable__');
    expect(JSON.stringify(rejected)).not.toContain('file:');

    // An explicit first-party rehydration for the exact IDs unlocks full-queue
    // reconciliation without ever serializing the display-only placeholder.
    port.setMediaItems([remoteItem('one'), remoteItem('two')]);
    await port.flush();
    port.moveMediaItem(1, 0);
    await port.flush();
    expect(command).toHaveBeenCalledTimes(2);
    command.mock.calls.forEach(([_name, payloadJson]) => {
      expect(payloadJson).not.toContain('__loggerythm_source_unavailable__');
      expect(payloadJson).not.toContain('redacted.invalid');
    });
    port.dispose();
  });

  it('reconciles snapshot and event envelopes without exposing native details', () => {
    const port = createNativePlayerPort({ nativeModule: nativeModule(), emitter });
    const errors: unknown[] = [];
    port.addEventListener(Event.PlaybackError, (event) => errors.push(event));

    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['native-one'], {
        extras: { safe: true, refreshToken: 'never-public' },
      }),
    });
    emitter.emit(NATIVE_PLAYER_EVENT, {
      eventJson: JSON.stringify({ schemaVersion: 1, type: 'error', code: 'player-error' }),
      headers: { Cookie: 'not-an-event-field' },
    });

    expect(port.getQueue().map((item) => item.mediaId)).toEqual(['native-one']);
    expect(port.getPlaybackState()).toBe(PlaybackState.Error);
    expect(errors).toContainEqual({ code: 'unknown', message: 'Playback failed' });
    expect(JSON.stringify({ errors, snapshot: port.getSnapshot() })).not.toContain('never-public');
    expect(JSON.stringify({ errors, snapshot: port.getSnapshot() })).not.toContain('Cookie');
    port.dispose();
  });

  it('publishes exact notification favorite state and decodes remote toggle requests', async () => {
    const module = nativeModule();
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    const requests: unknown[] = [];
    port.addEventListener(Event.RemoteToggleFavorite, (event) => requests.push(event));

    await port.setNotificationFavoriteState('queue:track:42', false);
    expect(module.setNotificationFavoriteState).toHaveBeenCalledWith('queue:track:42', false);
    emitter.emit(NATIVE_PLAYER_EVENT, {
      eventJson: JSON.stringify({
        schemaVersion: 1,
        type: 'notification-favorite-request',
        itemId: 'queue:track:42',
        requestedLiked: true,
      }),
    });

    expect(requests).toEqual([{ mediaId: 'queue:track:42', requestedLiked: true }]);
    await expect(port.setNotificationFavoriteState('queue:track:42', null)).rejects.toThrow(
      'must both be null or set',
    );
    port.dispose();
  });

  it('does not publish product transitions for optimistic queue state or its native rejection', async () => {
    const module = nativeModule({
      command: vi.fn(async () => {
        throw new Error('native queue rejected');
      }),
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    const transitions: unknown[] = [];
    port.addEventListener(Event.MediaItemTransition, (event) => transitions.push(event));

    port.setMediaItem(remoteItem('one'));
    expect(port.getActiveMediaItem()?.mediaId).toBe('one');
    expect(transitions).toEqual([]);

    await expect(port.flush()).rejects.toMatchObject({
      operation: 'setMediaItem',
      code: 'native-rejected',
    });
    expect(port.getQueue()).toEqual([]);
    expect(transitions).toEqual([]);
    port.dispose();
  });

  it('publishes one transition only for one confirmed native transition event', () => {
    const port = createNativePlayerPort({ nativeModule: nativeModule(), emitter });
    const transitions: unknown[] = [];
    port.addEventListener(Event.MediaItemTransition, (event) => transitions.push(event));

    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one'], { currentIndex: 0 }),
    });
    expect(port.getActiveMediaItem()?.mediaId).toBe('one');
    expect(transitions).toEqual([]);

    emitter.emit(NATIVE_PLAYER_EVENT, {
      eventJson: JSON.stringify({
        schemaVersion: 1,
        type: 'media-item-transition',
        itemId: 'one',
        reason: 'auto',
      }),
    });

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      item: { mediaId: 'one' },
      index: 0,
      reason: 'auto',
    });
    port.dispose();
  });

  it('keeps confirmed repeat-one transitions for the same native item distinct', () => {
    const port = createNativePlayerPort({ nativeModule: nativeModule(), emitter });
    const transitions: unknown[] = [];
    port.addEventListener(Event.MediaItemTransition, (event) => transitions.push(event));
    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one'], { currentIndex: 0 }),
    });
    const repeatEvent = {
      eventJson: JSON.stringify({
        schemaVersion: 1,
        type: 'media-item-transition',
        itemId: 'one',
        reason: 'repeat',
      }),
    };

    emitter.emit(NATIVE_PLAYER_EVENT, repeatEvent);
    emitter.emit(NATIVE_PLAYER_EVENT, repeatEvent);

    expect(transitions).toHaveLength(2);
    expect(transitions).toEqual([
      expect.objectContaining({ index: 0, reason: 'repeat' }),
      expect.objectContaining({ index: 0, reason: 'repeat' }),
    ]);
    port.dispose();
  });

  it('routes a confirmed transition to either foreground or background, never both', () => {
    const port = createNativePlayerPort({ nativeModule: nativeModule(), emitter });
    const foreground: unknown[] = [];
    const background = vi.fn(async (_event: unknown) => undefined);
    port.addEventListener(Event.MediaItemTransition, (event) => foreground.push(event));
    port.registerBackgroundEventHandler(() => background);
    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one'], { currentIndex: 0 }),
    });
    const eventJson = JSON.stringify({
      schemaVersion: 1,
      type: 'media-item-transition',
      itemId: 'one',
      reason: 'auto',
    });

    emitter.emit(NATIVE_PLAYER_EVENT, { eventJson, background: true });
    expect(background).toHaveBeenCalledOnce();
    expect(foreground).toEqual([]);

    emitter.emit(NATIVE_PLAYER_EVENT, { eventJson, background: false });
    expect(background).toHaveBeenCalledOnce();
    expect(foreground).toHaveLength(1);
    port.dispose();
  });

  it('turns sanitized snapshot ticks into one progress event per relevant advance', () => {
    const port = createNativePlayerPort({
      nativeModule: nativeModule(),
      emitter,
      now: () => 123_456,
    });
    const progress: unknown[] = [];
    port.addEventListener(Event.PlaybackProgressUpdated, (event) => progress.push(event));

    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one'], { positionMs: 1_000, isPlaying: true }),
    });
    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one'], { positionMs: 1_000, isPlaying: true }),
    });
    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one'], { positionMs: 2_000, isPlaying: true }),
    });

    expect(progress).toEqual([
      { mediaId: 'one', position: 1, duration: 12.5, timestamp: 123_456 },
      { mediaId: 'one', position: 2, duration: 12.5, timestamp: 123_456 },
    ]);
    expect(JSON.stringify(progress)).not.toContain('Cookie');
    port.dispose();
  });

  it('rolls back rejected optimistic mutations and emits only a generic error', async () => {
    const module = nativeModule({
      command: vi.fn(async () => {
        throw new Error('Cookie: session=do-not-leak');
      }),
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    const rejected: unknown[] = [];
    port.addEventListener(Event.CommandRejected, (event) => rejected.push(event));

    port.setMediaItem(remoteItem('one'));
    expect(port.getQueue()).toHaveLength(1);
    await expect(port.flush()).rejects.toMatchObject({
      code: 'native-rejected',
      operation: 'setMediaItem',
    });

    expect(port.getQueue()).toHaveLength(0);
    expect(rejected).toEqual([{
      command: 'setMediaItem',
      code: 'native-rejected',
      message: 'Player command could not be applied',
    }]);
    expect(JSON.stringify(rejected)).not.toContain('session=do-not-leak');
    port.dispose();
  });

  it('keeps Media3 global shuffle disabled and rejects attempts to enable it', async () => {
    const module = nativeModule();
    const port = createNativePlayerPort({ nativeModule: module, emitter });

    expect(() => port.setShuffleEnabled(true)).toThrow('Native global shuffle cannot be enabled');
    port.setShuffleEnabled(false);
    await port.flush();

    expect(port.isShuffleEnabled()).toBe(false);
    expect(module.command).toHaveBeenCalledWith('setShuffleEnabled', '{"enabled":false}');
    port.dispose();
  });

  it('awaits the exact native remote-command acknowledgement without polluting flush', async () => {
    const registration = deferred<unknown>();
    const module = nativeModule({
      command: vi.fn((name) => name === 'setCommands'
        ? registration.promise
        : Promise.resolve(undefined)),
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    let settled = false;

    const pending = port.setCommands({
      capabilities: [PlayerCommand.PlayPause, PlayerCommand.Next],
      handling: 'native',
    }).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    registration.resolve({ snapshotJson: nativeSnapshot([]) });
    await pending;

    expect(module.command).toHaveBeenCalledWith(
      'setCommands',
      '{"capabilities":["playPause","next"],"handling":"native"}',
    );
    await expect(port.flush()).resolves.toBeUndefined();
    port.dispose();
  });

  it('strictly rejects unsupported remote-command shapes before native dispatch', () => {
    const module = nativeModule();
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    expect(() => port.setCommands({
      capabilities: [PlayerCommand.PlayPause, PlayerCommand.PlayPause],
      handling: 'native',
    })).toThrow('Remote capabilities must be unique');
    expect(() => port.setCommands({
      capabilities: [PlayerCommand.PlayPause],
      handling: 'js',
    })).toThrow('Remote command handling must be native');
    expect(() => port.setCommands({
      capabilities: [PlayerCommand.PlayPause],
      handling: 'native',
      forwardInterval: 15,
    } as RemoteControlConfig)).toThrow('unsupported fields');
    expect(module.command).not.toHaveBeenCalled();
    port.dispose();
  });

  it('wires native queue-persistence and sleep commands with their exact payloads', async () => {
    const module = nativeModule();
    const port = createNativePlayerPort({ nativeModule: module, emitter });

    expect(NATIVE_COMMAND_TRANSLATION.setQueuePersistenceState.support).toBe('vertical-slice');
    expect(NATIVE_COMMAND_TRANSLATION.sleepAfterTime.support).toBe('vertical-slice');
    expect(NATIVE_COMMAND_TRANSLATION.sleepAfterMediaItemAtIndex.support).toBe('vertical-slice');
    expect(NATIVE_COMMAND_TRANSLATION.cancelSleepTimer.support).toBe('vertical-slice');
    expect(NATIVE_COMMAND_TRANSLATION.setCommands.support).toBe('vertical-slice');
    expect(NATIVE_COMMAND_TRANSLATION.setShuffleEnabled.support).toBe('vertical-slice');

    port.setMediaItem(remoteItem('one'));
    port.setQueuePersistenceState({
      contextShuffleEnabled: true,
      contextShuffleRestoreOrder: ['one'],
    });
    port.sleepAfterTime(90, { fadeOutSeconds: 5 });
    port.sleepAfterMediaItemAtIndex(0);
    port.cancelSleepTimer();
    await port.flush();

    const calls = vi.mocked(module.command).mock.calls.slice(1).map(([name, payload]) => [
      name,
      JSON.parse(payload) as unknown,
    ]);
    expect(calls).toEqual([
      ['setQueuePersistenceState', {
        contextShuffleEnabled: true,
        contextShuffleRestoreOrder: ['one'],
      }],
      ['sleepAfterTime', { seconds: 90, fadeOutSeconds: 5 }],
      ['sleepAfterMediaItemAtIndex', { index: 0 }],
      ['cancelSleepTimer', {}],
    ]);
    expect(port.getSleepTimer()).toBeNull();
    port.dispose();
  });

  it('validates exact IDs, indexes, positions, URL schemes, and Cookie syntax synchronously', () => {
    const port = createNativePlayerPort({ nativeModule: nativeModule(), emitter });
    expect(() => port.setMediaItem({ ...remoteItem('one'), mediaId: 'not/allowed' })).toThrow(
      /1-128 characters/,
    );
    expect(() => port.setMediaItem({ ...remoteItem('one'), url: 'http://insecure.test/a' })).toThrow(
      /https: or file:/,
    );
    expect(() => port.setMediaItem({
      ...remoteItem('one'),
      url: { uri: 'https://safe.test/a', headers: { Authorization: 'Bearer secret' } },
    })).toThrow(/only one safe Cookie/);
    expect(() => port.setMediaItem({
      ...remoteItem('one'),
      url: { uri: 'https://safe.test/a', headers: { Cookie: 'a=b\r\nInjected: yes' } },
    })).toThrow(/only one safe Cookie/);
    expect(() => port.setMediaItems([remoteItem('same'), remoteItem('same')])).toThrow(
      /duplicate mediaId/,
    );
    expect(() => port.setMediaItem({ ...remoteItem('one'), url: 'file://remote-host/a.mp3' })).toThrow(
      /file URL must be local/,
    );
    expect(() => port.setMediaItem({ ...remoteItem('one'), url: 'file:///safe/a.mp3?token=x' })).toThrow(
      /file URL must be local/,
    );
    expect(() => port.setMediaItem({ ...remoteItem('one'), url: 'file:///safe/a.mp3#fragment' })).toThrow(
      /user info or a fragment/,
    );
    expect(() => port.setMediaItem({
      ...remoteItem('one'),
      url: { uri: 'file:///safe/a.mp3', headers: { Cookie: 'a=b' } },
    })).toThrow(/local file must not carry Cookie/);
    expect(() => port.seekTo(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => port.skipToIndex(0)).toThrow(/outside a 0-item queue/);
    expect(() => port.setMediaItem({ ...remoteItem('one'), url: 'file:///safe/a.mp3' })).not.toThrow();
    port.dispose();
  });

  it('uses the dedicated async setup, browse, persistence, and cache boundaries', async () => {
    const module = nativeModule({
      clearPersistedState: vi.fn(async () => ({ snapshotJson: nativeSnapshot([]) })),
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    await port.setupPlayer({
      sessionBinding: SESSION_BINDING,
      contentType: 'music',
      progressSync: {
        http: { url: 'https://safe.test/progress', headers: { Cookie: 'not-sent-by-setup' } },
      },
    });
    port.setBrowseTree([]);
    await port.clearPersistedQueue();
    await port.clearCache();
    await port.flush();

    expect(module.setup).toHaveBeenCalledWith(JSON.stringify(SESSION_BINDING));
    expect(vi.mocked(module.setup).mock.calls[0][0]).not.toContain('progress');
    expect(vi.mocked(module.setup).mock.calls[0][0]).not.toContain('Cookie');
    expect(module.setBrowseTree).toHaveBeenCalledWith(JSON.stringify({
      root: {
        id: 'loggerythm:root',
        title: 'LoggeRythm',
        playable: false,
        children: [],
      },
    }));
    expect(module.clearPersistedState).toHaveBeenCalledOnce();
    expect(module.clearCache).toHaveBeenCalledOnce();
    expect(port.getSnapshot().isSetup).toBe(false);
    port.dispose();
  });

  it('accepts Media3\'s empty-timeline index sentinel during pre-setup cleanup only', async () => {
    const emptyTimeline = JSON.parse(nativeSnapshot([])) as Record<string, unknown>;
    emptyTimeline.currentIndex = 0;
    emptyTimeline.currentItemId = null;
    const module = nativeModule({
      clearPersistedState: vi.fn(async () => ({
        snapshotJson: JSON.stringify(emptyTimeline),
      })),
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });

    await expect(port.clearPersistedQueue()).resolves.toBeUndefined();

    expect(module.setup).not.toHaveBeenCalled();
    expect(port.getSnapshot()).toMatchObject({
      isSetup: false,
      queue: [],
      activeIndex: null,
      isPlaying: false,
    });
    port.dispose();
  });

  it('still rejects a nonzero empty-timeline index contradiction', async () => {
    const invalidEmptyTimeline = JSON.parse(nativeSnapshot([])) as Record<string, unknown>;
    invalidEmptyTimeline.currentIndex = 1;
    invalidEmptyTimeline.currentItemId = null;
    const module = nativeModule({
      clearPersistedState: vi.fn(async () => ({
        snapshotJson: JSON.stringify(invalidEmptyTimeline),
      })),
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });

    await expect(port.clearPersistedQueue()).rejects.toMatchObject({
      operation: 'clearPersistedQueue',
      code: 'native-rejected',
    });
    port.dispose();
  });

  it('strictly restores queue persistence, shuffle, and both native sleep timer shapes', () => {
    const port = createNativePlayerPort({ nativeModule: nativeModule(), emitter });

    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one', 'two'], {
        queuePersistence: {
          contextShuffleEnabled: true,
          contextShuffleRestoreOrder: ['stable:one', 'stable:two'],
        },
        shuffleEnabled: true,
        sleepTimer: { type: 'time', remainingMs: 12_500, fadeOutMs: 2_000 },
      }),
    });

    expect(port.getQueuePersistenceState()).toEqual({
      contextShuffleEnabled: true,
      contextShuffleRestoreOrder: ['stable:one', 'stable:two'],
    });
    expect(port.isShuffleEnabled()).toBe(true);
    expect(port.getSleepTimer()).toEqual({
      type: 'time',
      remainingSeconds: 12.5,
      fadeOutSeconds: 2,
    });

    emitter.emit(NATIVE_SNAPSHOT_EVENT, {
      snapshotJson: nativeSnapshot(['one', 'two'], {
        sleepTimer: { type: 'mediaItem', index: 1 },
      }),
    });
    expect(port.getSleepTimer()).toEqual({ type: 'mediaItem', index: 1 });
    port.dispose();
  });

  it('rejects missing or malformed required native persistence, shuffle, and timer fields', () => {
    const payload = (): Record<string, unknown> => (
      JSON.parse(nativeSnapshot(['one'])) as Record<string, unknown>
    );
    const withoutQueuePersistence = payload();
    delete withoutQueuePersistence.queuePersistence;
    const withoutShuffle = payload();
    delete withoutShuffle.shuffleEnabled;
    const withoutSleep = payload();
    delete withoutSleep.sleepTimer;
    const excessiveOrder = payload();
    excessiveOrder.queuePersistence = {
      contextShuffleEnabled: true,
      contextShuffleRestoreOrder: ['one', 'two'],
    };
    const disabledOrder = payload();
    disabledOrder.queuePersistence = {
      contextShuffleEnabled: false,
      contextShuffleRestoreOrder: ['one'],
    };
    const duplicateOrder = payload();
    duplicateOrder.queuePersistence = {
      contextShuffleEnabled: true,
      contextShuffleRestoreOrder: ['same', 'same'],
    };
    const invalidShuffle = payload();
    invalidShuffle.shuffleEnabled = 'false';
    const timerWithExtraField = payload();
    timerWithExtraField.sleepTimer = {
      type: 'time',
      remainingMs: 1_000,
      fadeOutMs: 0,
      privateValue: 'must-not-be-accepted',
    };
    const invalidFade = payload();
    invalidFade.sleepTimer = { type: 'time', remainingMs: 1_000, fadeOutMs: 86_400_001 };
    const invalidMediaIndex = payload();
    invalidMediaIndex.sleepTimer = { type: 'mediaItem', index: 1 };

    [
      withoutQueuePersistence,
      withoutShuffle,
      withoutSleep,
      excessiveOrder,
      disabledOrder,
      duplicateOrder,
      invalidShuffle,
      timerWithExtraField,
      invalidFade,
      invalidMediaIndex,
    ].forEach((invalid) => {
      const isolatedEmitter = new FakeEmitter();
      const port = createNativePlayerPort({ nativeModule: nativeModule(), emitter: isolatedEmitter });
      const errors: unknown[] = [];
      port.addEventListener(Event.PlaybackError, (event) => errors.push(event));

      isolatedEmitter.emit(NATIVE_SNAPSHOT_EVENT, { snapshotJson: JSON.stringify(invalid) });

      expect(errors).toEqual([{ code: 'unknown', message: 'Playback failed' }]);
      expect(port.getQueue()).toEqual([]);
      port.dispose();
    });
  });

  it.each([
    undefined,
    null,
    {},
    { accountScope: 'user:7', origin: SESSION_BINDING.origin, extra: true },
    { accountScope: 'account:7', origin: SESSION_BINDING.origin },
    { accountScope: 'user:0', origin: SESSION_BINDING.origin },
    { accountScope: 'user:01', origin: SESSION_BINDING.origin },
    { accountScope: 'user:9007199254740992', origin: SESSION_BINDING.origin },
    { accountScope: 'user:7', origin: 'http://loggerythm.logge.top' },
    { accountScope: 'user:7', origin: 'https://LOGGERYTHM.logge.top' },
    { accountScope: 'user:7', origin: 'https://loggerythm.logge.top/' },
    { accountScope: 'user:7', origin: 'https://loggerythm.logge.top:443' },
    { accountScope: 'user:7', origin: 'https://loggerythm.logge.top/path' },
    { accountScope: 'user:7', origin: `https://${'a'.repeat(506)}.test` },
  ])('rejects an invalid or non-exact native session binding: %j', (sessionBinding) => {
    const module = nativeModule();
    const port = createNativePlayerPort({ nativeModule: module, emitter });

    expect(() => port.setupPlayer({ sessionBinding } as never)).toThrow(
      'Player session binding is invalid',
    );
    expect(module.setup).not.toHaveBeenCalled();
    port.dispose();
  });

  it('keeps a binding reserved through setup failure and releases it only after cleanup', async () => {
    const firstSetup = deferred<void>();
    const setup = vi.fn()
      .mockReturnValueOnce(firstSetup.promise)
      .mockResolvedValueOnce(undefined);
    const cleanup = vi.fn()
      .mockRejectedValueOnce(new Error('cleanup rejected'))
      .mockResolvedValueOnce(undefined);
    const module = nativeModule({
      setup,
      clearPersistedState: cleanup,
    });
    const port = createNativePlayerPort({ nativeModule: module, emitter });

    const first = port.setupPlayer({ sessionBinding: SESSION_BINDING });
    expect(() => port.setupPlayer({
      sessionBinding: { ...SESSION_BINDING, accountScope: 'user:8' },
    })).toThrow('Player command could not be applied');
    firstSetup.reject(new Error('setup rejected'));
    await expect(first).rejects.toMatchObject({ operation: 'setupPlayer' });
    expect(() => port.setupPlayer({
      sessionBinding: { ...SESSION_BINDING, accountScope: 'user:8' },
    })).toThrow('Player command could not be applied');

    await expect(port.clearPersistedQueue()).rejects.toMatchObject({
      operation: 'clearPersistedQueue',
    });
    expect(() => port.setupPlayer({
      sessionBinding: { ...SESSION_BINDING, accountScope: 'user:8' },
    })).toThrow('Player command could not be applied');

    await expect(port.clearPersistedQueue()).resolves.toBeUndefined();
    expect(port.getSnapshot().isSetup).toBe(false);
    await expect(port.setupPlayer({
      sessionBinding: { ...SESSION_BINDING, accountScope: 'user:8' },
    })).resolves.toBeUndefined();
    expect(module.setup).toHaveBeenCalledTimes(2);
    port.dispose();
  });

  it('uses full-queue setQueue for index skips and restores play after live queue edits', async () => {
    const module = nativeModule();
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    port.setMediaItems([remoteItem('one'), remoteItem('two')]);
    port.play();
    port.addMediaItem(remoteItem('three'));
    port.skipToIndex(2);
    await port.flush();

    const names = vi.mocked(module.command).mock.calls.map(([name]) => name);
    expect(names).toEqual(['setQueue', 'play', 'setQueue', 'play', 'setQueue', 'play']);
    const lastQueuePayload = JSON.parse(vi.mocked(module.command).mock.calls[4][1]) as {
      items: { id: string }[];
      startIndex: number;
    };
    expect(lastQueuePayload.items.map((item) => item.id)).toEqual(['one', 'two', 'three']);
    expect(lastQueuePayload.startIndex).toBe(2);
    port.dispose();
  });

  it('keeps an acknowledged queue edit when only its playback resume fails', async () => {
    let playCalls = 0;
    const command = vi.fn(async (name: string) => {
      if (name === 'play' && ++playCalls === 2) throw new Error('resume failed');
      return undefined;
    });
    const port = createNativePlayerPort({
      nativeModule: nativeModule({ command }),
      emitter,
    });
    port.setMediaItem(remoteItem('one'));
    port.play();
    await port.flush();

    port.addMediaItem(remoteItem('two'));
    await expect(port.flush()).rejects.toMatchObject({
      operation: 'addMediaItem',
      code: 'native-rejected',
    });
    expect(port.getQueue().map((item) => item.mediaId)).toEqual(['one', 'two']);
    expect(port.isPlaying()).toBe(false);
    expect(JSON.stringify(port.getSnapshot())).not.toContain('session=');
    port.dispose();
  });

  it('maps repeat mode to the exact v1 payload', async () => {
    const module = nativeModule();
    const port = createNativePlayerPort({ nativeModule: module, emitter });
    port.setRepeatMode(RepeatMode.All);
    await port.flush();
    expect(module.command).toHaveBeenCalledWith('setRepeatMode', '{"mode":"all"}');
    expect(port.getRepeatMode()).toBe(RepeatMode.All);
    port.dispose();
  });

  it('maps browse categories through a non-playable root and keeps extras private', () => {
    const tree = mapBrowseTreeToNative([{
      mediaId: 'library:likes',
      title: 'Liked songs',
      items: [{
        mediaId: 'liked:one',
        title: 'One',
        artist: 'Logge',
        url: {
          uri: 'https://loggerythm.test/api/tracks/one/stream',
          headers: { Cookie: 'session=browse-private' },
        },
        duration: 2.5,
        extras: { track: { id: 'one' }, refreshToken: 'never-external' },
      }],
    }]);

    expect(tree).toEqual({
      root: {
        id: 'loggerythm:root',
        title: 'LoggeRythm',
        playable: false,
        children: [{
          id: 'library:likes',
          title: 'Liked songs',
          playable: false,
          children: [{
            id: 'liked:one',
            title: 'One',
            artist: 'Logge',
            durationMs: 2_500,
            playable: true,
            url: 'https://loggerythm.test/api/tracks/one/stream',
            headers: { Cookie: 'session=browse-private' },
          }],
        }],
      },
    });
    expect(JSON.stringify(tree)).not.toContain('never-external');
    expect(JSON.stringify(tree)).not.toContain('extras');
  });
});
