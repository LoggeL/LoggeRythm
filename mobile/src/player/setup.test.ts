import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';

const mocks = vi.hoisted(() => ({
  setupPlayer: vi.fn(),
  setCommands: vi.fn(),
  installPlaybackListeners: vi.fn(),
  clearPersistedQueue: vi.fn(),
  resetControllerState: vi.fn(),
  restoreControllerStateFromNativeQueue: vi.fn(),
  pause: vi.fn(),
  clear: vi.fn(),
  cancelSleepTimer: vi.fn(),
  clearCache: vi.fn(),
}));

vi.mock('./player', () => ({
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
vi.mock('./controller', () => ({
  installPlaybackListeners: mocks.installPlaybackListeners,
  resetControllerState: mocks.resetControllerState,
  restoreControllerStateFromNativeQueue: mocks.restoreControllerStateFromNativeQueue,
}));

const ORIGIN = 'https://loggerythm.logge.top';
const ACCOUNT_SCOPE = `${ORIGIN}::user:7`;
const OTHER_ACCOUNT_SCOPE = `${ORIGIN}::user:8`;

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

describe('account-bound native player readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setupPlayer.mockReset().mockResolvedValue(undefined);
    mocks.clearPersistedQueue.mockReset().mockResolvedValue(undefined);
    mocks.setCommands.mockReset().mockResolvedValue(undefined);
    mocks.installPlaybackListeners.mockReset();
    mocks.resetControllerState.mockReset();
    mocks.restoreControllerStateFromNativeQueue.mockReset();
  });

  it('strictly converts a canonical query scope to the minimal native binding', async () => {
    const player = await freshSetupModule();

    const binding = player.playerSessionBindingFromQueryScope(ACCOUNT_SCOPE);

    expect(binding).toEqual({ accountScope: 'user:7', origin: ORIGIN });
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it.each([
    '',
    'not-a-scope',
    'http://loggerythm.logge.top::user:7',
    'https://LOGGERYTHM.logge.top::user:7',
    'https://loggerythm.logge.top/::user:7',
    'https://loggerythm.logge.top:443::user:7',
    'https://loggerythm.logge.top/path::user:7',
    'https://loggerythm.logge.top::user:0',
    'https://loggerythm.logge.top::user:01',
    'https://loggerythm.logge.top::user:-1',
    'https://loggerythm.logge.top::user:9007199254740992',
    'https://loggerythm.logge.top::user:7::user:8',
  ])('rejects a non-canonical player query scope without echoing it: %s', async (scope) => {
    const player = await freshSetupModule();

    let failure: unknown;
    try {
      player.playerSessionBindingFromQueryScope(scope);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ message: 'Player account scope is invalid' });
    if (scope.length > 0) expect((failure as Error).message).not.toContain(scope);
  });

  it('requires a scope for the first setup attempt', async () => {
    const player = await freshSetupModule();

    await expect(player.ensurePlayer()).rejects.toThrow('Player session is unavailable');
    expect(mocks.setupPlayer).not.toHaveBeenCalled();
  });

  it('shares one pending attempt and stabilizes the exact binding', async () => {
    const nativeConnection = deferred<void>();
    mocks.setupPlayer.mockReturnValueOnce(nativeConnection.promise);
    const player = await freshSetupModule();

    const first = player.ensurePlayer(ACCOUNT_SCOPE);
    const concurrent = player.ensurePlayer(ACCOUNT_SCOPE);
    const boundWithoutArgument = player.ensurePlayer();

    expect(concurrent).toBe(first);
    expect(boundWithoutArgument).toBe(first);
    expect(player.isPlayerReady()).toBe(false);
    expect(mocks.setupPlayer).toHaveBeenCalledTimes(1);
    expect(mocks.setupPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionBinding: { accountScope: 'user:7', origin: ORIGIN },
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

    nativeConnection.resolve();
    await first;

    expect(player.isPlayerReady()).toBe(true);
    expect(mocks.setCommands).toHaveBeenCalledOnce();
    expect(mocks.restoreControllerStateFromNativeQueue).toHaveBeenCalledOnce();
    expect(mocks.installPlaybackListeners).toHaveBeenCalledOnce();
    await expect(player.ensurePlayer()).resolves.toBeUndefined();
  });

  it('rejects a cross-account call while the first binding is pending', async () => {
    const nativeConnection = deferred<void>();
    mocks.setupPlayer.mockReturnValueOnce(nativeConnection.promise);
    const player = await freshSetupModule();
    const first = player.ensurePlayer(ACCOUNT_SCOPE);

    await expect(player.ensurePlayer(OTHER_ACCOUNT_SCOPE)).rejects.toThrow(
      'Player session is unavailable',
    );
    expect(mocks.setupPlayer).toHaveBeenCalledOnce();

    nativeConnection.resolve();
    await first;
  });

  it('retains the binding across a failed connection and retries only that account', async () => {
    mocks.setupPlayer
      .mockRejectedValueOnce(new Error(`native details must stay private: ${ACCOUNT_SCOPE}`))
      .mockResolvedValueOnce(undefined);
    const player = await freshSetupModule();

    await expect(player.ensurePlayer(ACCOUNT_SCOPE)).rejects.toThrow(
      'Native audio player initialization failed',
    );
    await expect(player.ensurePlayer(OTHER_ACCOUNT_SCOPE)).rejects.toThrow(
      'Player session is unavailable',
    );
    await expect(player.ensurePlayer()).resolves.toBeUndefined();

    expect(mocks.setupPlayer).toHaveBeenCalledTimes(2);
    expect(player.isPlayerReady()).toBe(true);
  });

  it('retries command setup without reconnecting an already bound controller', async () => {
    mocks.setCommands
      .mockRejectedValueOnce(new Error('command registration failed'))
      .mockResolvedValueOnce(undefined);
    const player = await freshSetupModule();

    await expect(player.ensurePlayer(ACCOUNT_SCOPE)).rejects.toThrow(
      'Native audio player initialization failed',
    );
    await expect(player.ensurePlayer(ACCOUNT_SCOPE)).resolves.toBeUndefined();

    expect(mocks.setupPlayer).toHaveBeenCalledOnce();
    expect(mocks.setCommands).toHaveBeenCalledTimes(2);
    expect(mocks.installPlaybackListeners).toHaveBeenCalledOnce();
  });

  it('does not become ready when restoration reports native global shuffle enabled', async () => {
    mocks.restoreControllerStateFromNativeQueue.mockImplementationOnce(() => {
      throw new Error('Native global shuffle must remain disabled');
    });
    const player = await freshSetupModule();

    await expect(player.ensurePlayer(ACCOUNT_SCOPE)).rejects.toThrow(
      'Native audio player initialization failed',
    );

    expect(player.isPlayerReady()).toBe(false);
    expect(mocks.setCommands).not.toHaveBeenCalled();
    expect(mocks.installPlaybackListeners).not.toHaveBeenCalled();
  });

  it('does not report ready until the exact native command policy is acknowledged', async () => {
    const registration = deferred<void>();
    mocks.setCommands.mockReturnValueOnce(registration.promise);
    const player = await freshSetupModule();

    const pending = player.ensurePlayer(ACCOUNT_SCOPE);
    await vi.waitFor(() => expect(mocks.setCommands).toHaveBeenCalledOnce());

    expect(player.isPlayerReady()).toBe(false);
    expect(mocks.installPlaybackListeners).not.toHaveBeenCalled();

    registration.resolve();
    await pending;

    expect(player.isPlayerReady()).toBe(true);
    expect(mocks.installPlaybackListeners).toHaveBeenCalledOnce();
  });

  it('uses one native atomic cleanup boundary, then resets JS and releases the binding', async () => {
    const player = await freshSetupModule();
    await player.ensurePlayer(ACCOUNT_SCOPE);

    await expect(player.clearPlayerSession()).resolves.toBeUndefined();

    expect(mocks.clearPersistedQueue).toHaveBeenCalledOnce();
    expect(mocks.resetControllerState).toHaveBeenCalledOnce();
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.cancelSleepTimer).not.toHaveBeenCalled();
    expect(mocks.clearCache).not.toHaveBeenCalled();
    expect(player.isPlayerReady()).toBe(false);

    await expect(player.ensurePlayer(OTHER_ACCOUNT_SCOPE)).resolves.toBeUndefined();
    expect(mocks.setupPlayer).toHaveBeenCalledTimes(2);
    expect(mocks.setupPlayer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionBinding: { accountScope: 'user:8', origin: ORIGIN },
      }),
    );
  });

  it('shares concurrent cleanup and does not release flags before native confirmation', async () => {
    const nativeCleanup = deferred<void>();
    mocks.clearPersistedQueue.mockReturnValueOnce(nativeCleanup.promise);
    const player = await freshSetupModule();
    await player.ensurePlayer(ACCOUNT_SCOPE);

    const first = player.clearPlayerSession();
    const concurrent = player.clearPlayerSession();

    expect(concurrent).toBe(first);
    expect(player.isPlayerReady()).toBe(true);
    expect(mocks.resetControllerState).not.toHaveBeenCalled();
    await expect(player.ensurePlayer(OTHER_ACCOUNT_SCOPE)).rejects.toThrow(
      'Player session is unavailable',
    );

    nativeCleanup.resolve();
    await first;
    expect(player.isPlayerReady()).toBe(false);
    expect(mocks.resetControllerState).toHaveBeenCalledOnce();
  });

  it('keeps the binding fail-closed after native cleanup failure until a retry succeeds', async () => {
    mocks.clearPersistedQueue
      .mockRejectedValueOnce(new Error(`private native failure ${ACCOUNT_SCOPE}`))
      .mockResolvedValueOnce(undefined);
    const player = await freshSetupModule();
    await player.ensurePlayer(ACCOUNT_SCOPE);

    await expect(player.clearPlayerSession()).rejects.toMatchObject({
      name: 'PlayerSessionCleanupError',
      failedBoundaries: ['native-player-session'],
      message: 'Player session cleanup could not be completed',
    });
    expect(player.isPlayerReady()).toBe(true);
    await expect(player.ensurePlayer(OTHER_ACCOUNT_SCOPE)).rejects.toThrow(
      'Player session is unavailable',
    );

    await expect(player.clearPlayerSession()).resolves.toBeUndefined();
    await expect(player.ensurePlayer(OTHER_ACCOUNT_SCOPE)).resolves.toBeUndefined();
  });

  it('requires a second cleanup when the process-local reset fails', async () => {
    mocks.resetControllerState
      .mockImplementationOnce(() => { throw new Error('local reset failed'); })
      .mockImplementationOnce(() => undefined);
    const player = await freshSetupModule();
    await player.ensurePlayer(ACCOUNT_SCOPE);

    await expect(player.clearPlayerSession()).rejects.toMatchObject({
      failedBoundaries: ['javascript-controller-state'],
    });
    expect(player.isPlayerReady()).toBe(true);
    await expect(player.ensurePlayer(ACCOUNT_SCOPE)).rejects.toThrow(
      'Player session is unavailable',
    );

    await expect(player.clearPlayerSession()).resolves.toBeUndefined();
    expect(mocks.clearPersistedQueue).toHaveBeenCalledTimes(2);
    expect(player.isPlayerReady()).toBe(false);
  });
});
