import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Event } from './playerPort';
import {
  handleBackgroundPlaybackEvent,
  installPlaybackListeners,
  resetControllerState,
  setPlaybackEventDrainerForTests,
} from './controller';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, ((event: unknown) => void)[]>(),
  reportPlayerError: vi.fn(),
  clearPlayerError: vi.fn(),
  drain: vi.fn(),
}));

vi.mock('./player', async () => {
  const { Event: PlayerEvent, RepeatMode } = await import('./playerPort');
  return {
    default: {
      addEventListener: vi.fn((event: string, listener: (payload: unknown) => void) => {
        const list = mocks.listeners.get(event) ?? [];
        list.push(listener);
        mocks.listeners.set(event, list);
        return { remove: vi.fn() };
      }),
    },
    Event: PlayerEvent,
    RepeatMode,
    mapMediaItemToNativeQueueItem: vi.fn(),
  };
});
vi.mock('../config', () => ({ getApiBase: vi.fn() }));
vi.mock('../api/client', () => ({
  authenticatedHeadersFor: vi.fn(),
  authoritativeSessionInvalidationFor: vi.fn(() => null),
  captureAuthenticatedRequestAuthority: vi.fn(),
  isAuthenticatedRequestAuthorityError: vi.fn(() => false),
}));
vi.mock('../offline/registry', () => ({ offlineUriForTrack: vi.fn() }));
vi.mock('../data/queryClient', () => ({
  invalidateListeningStats: vi.fn(),
  musicCacheScope: vi.fn(),
  musicQueryClient: { getQueryData: vi.fn(() => undefined) },
}));
vi.mock('../data/repositories', () => ({
  musicRepository: {
    getRadio: vi.fn(),
    recordPlay: vi.fn(),
    likeTrack: vi.fn(),
    unlikeTrack: vi.fn(),
  },
}));
vi.mock('./errors', () => ({
  clearPlayerError: mocks.clearPlayerError,
  reportPlayerError: mocks.reportPlayerError,
  UserFacingPlayerError: Error,
}));

describe('controller RemoteToggleFavorite wiring', () => {
  let restoreDrainer: (() => void) | null = null;

  beforeEach(() => {
    mocks.listeners.clear();
    mocks.reportPlayerError.mockReset();
    mocks.clearPlayerError.mockReset();
    mocks.drain.mockReset();
    mocks.drain.mockResolvedValue({
      claimed: 1,
      acknowledged: 1,
      retried: 0,
      deferred: 0,
      stoppedForAuth: false,
    });
    restoreDrainer = setPlaybackEventDrainerForTests({ drain: mocks.drain });
  });

  afterEach(() => {
    restoreDrainer?.();
    restoreDrainer = null;
    resetControllerState();
  });

  it('drains durable playback events when a background RemoteToggleFavorite arrives', async () => {
    await handleBackgroundPlaybackEvent({
      type: Event.RemoteToggleFavorite,
      mediaId: 'queue:1:1001',
      requestedLiked: true,
    });

    expect(mocks.drain).toHaveBeenCalledTimes(1);
  });

  it('registers a foreground RemoteToggleFavorite listener that drains and reports failures loudly', async () => {
    installPlaybackListeners();
    const handlers = mocks.listeners.get(Event.RemoteToggleFavorite) ?? [];
    expect(handlers).toHaveLength(1);

    handlers[0]({ mediaId: 'queue:1:1001', requestedLiked: true });
    await Promise.resolve();
    expect(mocks.drain).toHaveBeenCalledTimes(1);

    const boom = new Error('favorite-drain-failed');
    mocks.drain.mockRejectedValueOnce(boom);
    handlers[0]({ mediaId: 'queue:1:1001', requestedLiked: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(expect.any(String), boom);
  });
});
