import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativePlayerPort,
  NATIVE_SNAPSHOT_EVENT,
  resetPlayerPortForTests,
  setPlayerPortForTests,
  type LoggeRythmPlayerNativeModule,
} from './nativePlayerPort';
import {
  useActiveMediaItem,
  useActiveQueueSlot,
  useActiveTrackId,
  useHasActiveTrack,
  useIsPlaying,
  usePlaybackState,
  useProgress,
} from './playerHooks';
import { PlaybackState, RepeatMode, type MediaItem, type PlayerPort } from './playerPort';

const reactMocks = vi.hoisted(() => ({
  subscriptions: [] as ((listener: () => void) => () => void)[],
}));

vi.mock('react-native', () => ({
  NativeEventEmitter: class {},
  NativeModules: {},
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useSyncExternalStore: <T,>(
      subscribe: (listener: () => void) => () => void,
      getSnapshot: () => T,
    ): T => {
      reactMocks.subscriptions.push(subscribe);
      return getSnapshot();
    },
  };
});

function nativeModule(): LoggeRythmPlayerNativeModule {
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
  };
}

describe('first-party player hooks', () => {
  beforeEach(() => {
    reactMocks.subscriptions = [];
  });

  afterEach(() => {
    resetPlayerPortForTests();
  });

  it('selects active item, track id, presence, playing state, playback state, and progress from one store with a stable subscribe function', () => {
    const port = createNativePlayerPort({
      nativeModule: nativeModule(),
      emitter: { addListener: () => ({ remove: vi.fn() }) },
    });
    setPlayerPortForTests(port);

    expect(useHasActiveTrack()).toBe(false);
    expect(useActiveTrackId()).toBeNull();

    port.setMediaItem({
      mediaId: 'track:42',
      url: 'https://loggerythm.test/one',
      title: 'One',
      extras: { track: { id: '42', title: 'One' } },
    });
    port.seekTo(2.5);
    port.play();

    expect(useActiveMediaItem()?.mediaId).toBe('track:42');
    expect(useHasActiveTrack()).toBe(true);
    expect(useActiveTrackId()).toBe('42');
    expect(useIsPlaying()).toBe(true);
    expect(usePlaybackState()).toBe(PlaybackState.Ready);
    expect(useProgress(0.5)).toMatchObject({ position: 2.5 });

    // Every hook for the same PlayerPort reuses the exact same subscribe closure
    // so useSyncExternalStore never unsubscribes/resubscribes across renders.
    expect(reactMocks.subscriptions).toHaveLength(8);
    expect(new Set(reactMocks.subscriptions).size).toBe(1);
  });

  it('stabilizes useActiveMediaItem object identity across progress-only ticks and updates when metadata changes', () => {
    let activeItem: MediaItem | null = {
      mediaId: 'track:1',
      url: 'https://loggerythm.test/1',
      title: 'Track One',
      artist: 'Artist A',
      extras: { track: { id: '1', title: 'Track One' } },
    };
    const fakePort = {
      subscribe: vi.fn(() => () => undefined),
      getActiveMediaItem: () => activeItem,
      isPlaying: () => true,
      getPlaybackState: () => PlaybackState.Ready,
      getSnapshot: () => ({ progress: { position: 1, duration: 180, buffered: 10, cached: 0 } }),
    } as unknown as PlayerPort;
    setPlayerPortForTests(fakePort);

    const firstRef = useActiveMediaItem();
    // Simulate a 1s progress tick emitting a freshly allocated, structurally identical item.
    activeItem = {
      mediaId: 'track:1',
      url: 'https://loggerythm.test/1',
      title: 'Track One',
      artist: 'Artist A',
      extras: { track: { id: '1', title: 'Track One' } },
    };
    const secondRef = useActiveMediaItem();
    expect(secondRef).toBe(firstRef);

    // Changing metadata must produce the new item reference.
    activeItem = {
      mediaId: 'track:1',
      url: 'https://loggerythm.test/1',
      title: 'Track One (Remastered)',
      artist: 'Artist A',
      extras: { track: { id: '1', title: 'Track One (Remastered)' } },
    };
    const thirdRef = useActiveMediaItem();
    expect(thirdRef).not.toBe(firstRef);
    expect(thirdRef?.title).toBe('Track One (Remastered)');
  });

  it('keeps useActiveMediaItem reference stable across native 1s progress ticks', () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const port = createNativePlayerPort({
      nativeModule: nativeModule(),
      emitter: {
        addListener: (eventName, listener) => {
          listeners.set(eventName, listener);
          return { remove: vi.fn() };
        },
      },
    });
    setPlayerPortForTests(port);
    const emitSnapshot = (positionMs: number) => {
      listeners.get(NATIVE_SNAPSHOT_EVENT)?.({
        snapshotJson: JSON.stringify({
          schemaVersion: 1,
          playbackState: 'ready',
          playWhenReady: true,
          isPlaying: true,
          positionMs,
          durationMs: 180_000,
          bufferedPositionMs: positionMs + 5_000,
          currentIndex: 0,
          currentItemId: 'track:7',
          repeatMode: 'off',
          queuePersistence: {
            contextShuffleEnabled: false,
            contextShuffleRestoreOrder: [],
          },
          autoRadioEnabled: true,
          shuffleEnabled: false,
          sleepTimer: null,
          queue: [
            {
              id: 'track:7',
              title: 'Seven',
              artist: 'Artist',
              album: 'Album',
              artworkUrl: 'https://loggerythm.test/7.jpg',
              durationMs: 180_000,
              extras: { track: { id: '7', title: 'Seven' } },
            },
          ],
          errorCode: null,
        }),
      });
    };

    emitSnapshot(1_000);
    const atOneSecond = useActiveMediaItem();
    emitSnapshot(2_000);
    const atTwoSeconds = useActiveMediaItem();

    expect(atTwoSeconds).toBe(atOneSecond);
    expect(useActiveTrackId()).toBe('7');
    expect(useProgress(1).position).toBe(2);
  });

  it('reports the active queue slot, stable across progress ticks and fresh item copies', () => {
    const item = (index: number) => ({
      mediaId: `queue:1:${index}:${index}`,
      url: `https://loggerythm.test/${index}`,
      extras: { track: { id: String(index) } },
    });
    let snapshot: Record<string, unknown> = {
      revision: 1,
      queue: [item(0), item(1), item(2)],
      activeIndex: 1,
      repeatMode: RepeatMode.Off,
      progress: { position: 1, duration: 180, buffered: 10, cached: 0 },
    };
    setPlayerPortForTests({
      subscribe: vi.fn(() => () => undefined),
      getSnapshot: () => snapshot,
    } as unknown as PlayerPort);

    const first = useActiveQueueSlot();
    expect(first).toEqual({ mediaId: 'queue:1:1:1', trackId: '1', index: 1, length: 3, repeatAll: false });
    snapshot = {
      ...snapshot,
      revision: 2,
      queue: [item(0), item(1), item(2)],
      progress: { position: 2, duration: 180, buffered: 10, cached: 0 },
    };
    expect(useActiveQueueSlot()).toBe(first);

    snapshot = { ...snapshot, revision: 3, repeatMode: RepeatMode.All, queue: [item(0), item(1), item(2), item(3)] };
    expect(useActiveQueueSlot()).toEqual({
      mediaId: 'queue:1:1:1', trackId: '1', index: 1, length: 4, repeatAll: true,
    });

    snapshot = { ...snapshot, revision: 4, activeIndex: null };
    expect(useActiveQueueSlot()).toBeNull();

    snapshot = { ...snapshot, revision: 5, activeIndex: 9 };
    expect(() => useActiveQueueSlot()).toThrow(/activeIndex 9 outside its 4-item queue/);
  });

  it('falls back to mediaId for bare MediaItems and fails loudly on malformed extras.track', () => {
    const port = createNativePlayerPort({
      nativeModule: nativeModule(),
      emitter: { addListener: () => ({ remove: vi.fn() }) },
    });
    setPlayerPortForTests(port);
    port.setMediaItem({
      mediaId: 'bare-item',
      url: 'https://loggerythm.test/bare',
      title: 'Bare',
    });
    expect(useActiveTrackId()).toBe('bare-item');

    port.setMediaItem({
      mediaId: 'broken-item',
      url: 'https://loggerythm.test/broken',
      extras: { track: { title: 'Missing ID' } },
    });
    expect(() => useActiveTrackId()).toThrow(/missing a valid id/);
  });

  it('retains the compatible interval parameter but rejects invalid cadences', () => {
    const port = createNativePlayerPort({
      nativeModule: nativeModule(),
      emitter: { addListener: () => ({ remove: vi.fn() }) },
    });
    setPlayerPortForTests(port);
    expect(() => useProgress(0)).toThrow(/interval must be positive/);
    expect(() => useProgress(Number.NaN)).toThrow(/interval must be positive/);
  });
});
