import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativePlayerPort,
  resetPlayerPortForTests,
  setPlayerPortForTests,
  type LoggeRythmPlayerNativeModule,
} from './nativePlayerPort';
import {
  useActiveMediaItem,
  useIsPlaying,
  usePlaybackState,
  useProgress,
} from './playerHooks';
import { PlaybackState } from './playerPort';

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

  it('selects active item, playing state, playback state, and progress from one snapshot store', () => {
    const port = createNativePlayerPort({
      nativeModule: nativeModule(),
      emitter: { addListener: () => ({ remove: vi.fn() }) },
    });
    setPlayerPortForTests(port);
    port.setMediaItem({
      mediaId: 'one',
      url: 'https://loggerythm.test/one',
      title: 'One',
    });
    port.seekTo(2.5);
    port.play();

    expect(useActiveMediaItem()?.mediaId).toBe('one');
    expect(useIsPlaying()).toBe(true);
    expect(usePlaybackState()).toBe(PlaybackState.Ready);
    expect(useProgress(0.5)).toMatchObject({ position: 2.5 });
    expect(reactMocks.subscriptions).toHaveLength(4);
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
