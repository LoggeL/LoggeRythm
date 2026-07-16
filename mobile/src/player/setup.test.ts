import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';

const mocks = vi.hoisted(() => ({
  setupPlayer: vi.fn(),
  setCommands: vi.fn(),
  installPlaybackListeners: vi.fn(),
  clearBrowseTree: vi.fn(),
  clearPersistedQueue: vi.fn(),
  clearCache: vi.fn(),
  resetControllerState: vi.fn(),
  restoreControllerStateFromNativeQueue: vi.fn(),
  pause: vi.fn(),
  clear: vi.fn(),
  cancelSleepTimer: vi.fn(),
}));

vi.mock('@rntp/player', () => ({
  default: {
    setupPlayer: mocks.setupPlayer,
    setCommands: mocks.setCommands,
    pause: mocks.pause,
    clear: mocks.clear,
    cancelSleepTimer: mocks.cancelSleepTimer,
    clearPersistedQueue: mocks.clearPersistedQueue,
    clearCache: mocks.clearCache,
  },
  PlayerCommand: {
    PlayPause: 'play-pause',
    Next: 'next',
    Previous: 'previous',
    Seek: 'seek',
  },
}));
vi.mock('./browseTree', () => ({ clearBrowseTree: mocks.clearBrowseTree }));
vi.mock('./controller', () => ({
  installPlaybackListeners: mocks.installPlaybackListeners,
  resetControllerState: mocks.resetControllerState,
  restoreControllerStateFromNativeQueue: mocks.restoreControllerStateFromNativeQueue,
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

async function freshSetupModule() {
  vi.resetModules();
  return import('./setup');
}

describe('native player readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shares one pending attempt and stays unready until native connection resolves', async () => {
    const nativeConnection = deferred<void>();
    mocks.setupPlayer.mockReturnValueOnce(nativeConnection.promise);
    const player = await freshSetupModule();

    const first = player.ensurePlayer();
    const concurrent = player.ensurePlayer();

    expect(concurrent).toBe(first);
    expect(player.isPlayerReady()).toBe(false);
    expect(mocks.setupPlayer).toHaveBeenCalledTimes(1);
    expect(mocks.setCommands).not.toHaveBeenCalled();
    expect(mocks.installPlaybackListeners).not.toHaveBeenCalled();

    nativeConnection.resolve();
    await first;

    expect(player.isPlayerReady()).toBe(true);
    expect(mocks.setupPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'music',
        audioMixing: 'exclusive',
        handleAudioBecomingNoisy: true,
        android: expect.objectContaining({
          notification: expect.objectContaining({
            channelName: strings.player.notificationChannelName,
          }),
        }),
        cache: {
          maxSizeBytes: 500 * 1024 * 1024,
          preloading: { window: 1 },
        },
      }),
    );
    expect(mocks.setCommands).toHaveBeenCalledTimes(1);
    expect(mocks.restoreControllerStateFromNativeQueue).toHaveBeenCalledTimes(1);
    expect(mocks.installPlaybackListeners).toHaveBeenCalledTimes(1);
  });

  it('clears a failed native attempt and reconnects on retry', async () => {
    const failedConnection = deferred<void>();
    mocks.setupPlayer
      .mockReturnValueOnce(failedConnection.promise)
      .mockResolvedValueOnce(undefined);
    const player = await freshSetupModule();

    const failedAttempt = player.ensurePlayer();
    failedConnection.reject(new Error('MediaSession rejected the controller'));

    await expect(failedAttempt).rejects.toThrow(
      'Native audio player initialization failed: MediaSession rejected the controller',
    );
    expect(player.isPlayerReady()).toBe(false);

    await expect(player.ensurePlayer()).resolves.toBeUndefined();
    expect(mocks.setupPlayer).toHaveBeenCalledTimes(2);
    expect(player.isPlayerReady()).toBe(true);
  });

  it('retries command setup without reconnecting an already connected controller', async () => {
    mocks.setupPlayer.mockResolvedValueOnce(undefined);
    mocks.setCommands
      .mockImplementationOnce(() => {
        throw new Error('command registration failed');
      })
      .mockImplementationOnce(() => undefined);
    const player = await freshSetupModule();

    await expect(player.ensurePlayer()).rejects.toThrow('command registration failed');
    await expect(player.ensurePlayer()).resolves.toBeUndefined();

    expect(mocks.setupPlayer).toHaveBeenCalledTimes(1);
    expect(mocks.setCommands).toHaveBeenCalledTimes(2);
    expect(mocks.installPlaybackListeners).toHaveBeenCalledTimes(1);
  });

  it('deletes encrypted queue state before connecting, then clears any surviving live session', async () => {
    mocks.setupPlayer.mockResolvedValueOnce(undefined);
    const player = await freshSetupModule();

    await expect(player.clearPlayerSession()).resolves.toBeUndefined();

    expect(mocks.clearBrowseTree).toHaveBeenCalledOnce();
    expect(mocks.setupPlayer).toHaveBeenCalledOnce();
    expect(mocks.clearPersistedQueue).toHaveBeenCalledTimes(2);
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.cancelSleepTimer).toHaveBeenCalledOnce();
    expect(mocks.clearCache).toHaveBeenCalledOnce();
    expect(mocks.resetControllerState).toHaveBeenCalledOnce();

    const [firstPersist, secondPersist] = mocks.clearPersistedQueue.mock.invocationCallOrder;
    expect(firstPersist).toBeLessThan(mocks.setupPlayer.mock.invocationCallOrder[0]);
    expect(mocks.setupPlayer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clear.mock.invocationCallOrder[0],
    );
    expect(mocks.clear.mock.invocationCallOrder[0]).toBeLessThan(secondPersist);
  });

  it('stops live playback and clears its notification-owned queue after setup', async () => {
    mocks.setupPlayer.mockResolvedValueOnce(undefined);
    const player = await freshSetupModule();
    await player.ensurePlayer();

    await expect(player.clearPlayerSession()).resolves.toBeUndefined();

    expect(mocks.clearBrowseTree).toHaveBeenCalledOnce();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.cancelSleepTimer).toHaveBeenCalledOnce();
    expect(mocks.clearPersistedQueue).toHaveBeenCalledTimes(2);
    expect(mocks.clearCache).toHaveBeenCalledOnce();
    expect(mocks.resetControllerState).toHaveBeenCalledOnce();
  });

  it('does not confirm cleanup until native automatic-cache eviction resolves', async () => {
    const cacheEviction = deferred<void>();
    mocks.setupPlayer.mockResolvedValueOnce(undefined);
    mocks.clearCache.mockReturnValueOnce(cacheEviction.promise);
    const player = await freshSetupModule();

    const cleanup = player.clearPlayerSession();
    await vi.waitFor(() => expect(mocks.clearCache).toHaveBeenCalledOnce());

    expect(mocks.clearPersistedQueue).toHaveBeenCalledTimes(1);
    expect(mocks.resetControllerState).not.toHaveBeenCalled();

    cacheEviction.resolve();
    await expect(cleanup).resolves.toBeUndefined();
    expect(mocks.clearPersistedQueue).toHaveBeenCalledTimes(2);
    expect(mocks.resetControllerState).toHaveBeenCalledOnce();
  });

  it('reports native automatic-cache eviction failure after attempting later boundaries', async () => {
    mocks.setupPlayer.mockResolvedValueOnce(undefined);
    mocks.clearCache.mockRejectedValueOnce(new Error('native eviction rejected'));
    const player = await freshSetupModule();

    await expect(player.clearPlayerSession()).rejects.toMatchObject({
      name: 'PlayerSessionCleanupError',
      failedBoundaries: ['audio-cache'],
      message: expect.stringContaining('audio cache: native eviction rejected'),
    });

    expect(mocks.clearPersistedQueue).toHaveBeenCalledTimes(2);
    expect(mocks.resetControllerState).toHaveBeenCalledOnce();
  });

  it('attempts every player boundary when one cleanup operation fails', async () => {
    mocks.setupPlayer.mockResolvedValueOnce(undefined);
    mocks.clearBrowseTree.mockImplementationOnce(() => { throw new Error('tree'); });
    mocks.clear.mockImplementationOnce(() => { throw new Error('queue'); });
    const player = await freshSetupModule();
    await player.ensurePlayer();

    await expect(player.clearPlayerSession()).rejects.toMatchObject({
      failedBoundaries: ['android-auto-library', 'queue'],
      message: expect.stringContaining('Android Auto library: tree; queue: queue'),
    });

    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.cancelSleepTimer).toHaveBeenCalledOnce();
    expect(mocks.clearPersistedQueue).toHaveBeenCalledTimes(2);
    expect(mocks.clearCache).toHaveBeenCalledOnce();
    expect(mocks.resetControllerState).toHaveBeenCalledOnce();
  });
});
