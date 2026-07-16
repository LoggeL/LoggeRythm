import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../api/types';
import { strings } from '../localization';
import {
  dismissTrackActions,
  getTrackActionRequest,
  runAuthorizedTrackRemoval,
  runTrackQueueAction,
  showTrackActions,
  subscribeTrackActions,
  trackActionIdsForRequest,
} from './trackActions';

const mocks = vi.hoisted(() => ({
  announce: vi.fn(),
  playNext: vi.fn(),
  addToQueue: vi.fn(),
  startRadio: vi.fn(),
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: mocks.announce },
}));

vi.mock('../player/controller', () => ({
  playNext: mocks.playNext,
  addToQueue: mocks.addToQueue,
  startRadio: mocks.startRadio,
}));

const track: Track = {
  id: 'track-1',
  title: 'Midnight Signal',
  artist: 'LoggeRythm',
  artist_id: 'artist-1',
  artists: [{ id: 'artist-1', name: 'LoggeRythm' }],
  album: 'Parity',
  album_id: 'album-1',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

describe('track action sheet contract', () => {
  beforeEach(() => {
    dismissTrackActions();
    vi.clearAllMocks();
    mocks.playNext.mockResolvedValue(undefined);
    mocks.addToQueue.mockResolvedValue(undefined);
    mocks.startRadio.mockResolvedValue(undefined);
  });

  it('publishes one shared request instead of truncating actions in an Android Alert', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTrackActions(listener);
    const onError = vi.fn();

    showTrackActions(track, onError);

    expect(listener).toHaveBeenCalledOnce();
    expect(getTrackActionRequest()).toEqual(expect.objectContaining({ track, onError }));
    unsubscribe();
  });

  it.each([
    ['play-next', 'playNext', strings.trackActions.playNextSucceeded(track.title)],
    ['add-to-queue', 'addToQueue', strings.trackActions.addToQueueSucceeded(track.title)],
    ['start-radio', 'startRadio', strings.trackActions.startRadioSucceeded(track.title)],
  ] as const)('announces the exact successful %s outcome', async (action, method, message) => {
    showTrackActions(track, vi.fn());
    const request = getTrackActionRequest();
    if (request === null) throw new Error('Expected active track action request');

    await expect(runTrackQueueAction(request, action)).resolves.toBe(true);

    expect(mocks[method]).toHaveBeenCalledWith(track);
    expect(mocks.announce).toHaveBeenCalledWith(message);
    expect(getTrackActionRequest()).toBeNull();
  });

  it('keeps the sheet open and reports a failed action without announcing success', async () => {
    const onError = vi.fn();
    mocks.addToQueue.mockRejectedValueOnce(new Error('native queue rejected mutation'));
    showTrackActions(track, onError);
    const request = getTrackActionRequest();
    if (request === null) throw new Error('Expected active track action request');

    await expect(runTrackQueueAction(request, 'add-to-queue')).resolves.toBe(false);

    expect(onError).toHaveBeenCalledWith(strings.trackActions.addToQueueFailed);
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('native queue rejected mutation'));
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(getTrackActionRequest()?.requestId).toBe(request.requestId);
  });

  it('does not let completion from an older sheet close a newer request', async () => {
    showTrackActions(track, vi.fn());
    const oldRequest = getTrackActionRequest();
    if (oldRequest === null) throw new Error('Expected old request');
    showTrackActions({ ...track, id: 'track-2', title: 'New request' }, vi.fn());
    const newRequest = getTrackActionRequest();

    await runTrackQueueAction(oldRequest, 'play-next');

    expect(getTrackActionRequest()).toBe(newRequest);
  });

  it('publishes contextual removal only when an owner caller explicitly grants it', () => {
    const onRemove = vi.fn();
    showTrackActions(track, vi.fn(), {
      authorizedRemove: { accountScope: 'account-7', onRemove },
    });

    expect(getTrackActionRequest()?.authorizedRemove).toEqual({
      accountScope: 'account-7',
      onRemove,
    });
    expect(() =>
      showTrackActions(track, vi.fn(), {
        authorizedRemove: { accountScope: '', onRemove },
      }),
    ).toThrow('requires an account scope and callback');
  });

  it('defines the complete shared action order and exposes Remove only to its granting account', () => {
    showTrackActions(track, vi.fn());
    expect(trackActionIdsForRequest(getTrackActionRequest(), 'account-7')).toEqual([
      'play-next',
      'add-to-queue',
      'start-radio',
      'add-to-playlist',
      'open-album',
      'open-artist',
    ]);

    showTrackActions(track, vi.fn(), {
      authorizedRemove: { accountScope: 'account-7', onRemove: vi.fn() },
    });
    const request = getTrackActionRequest();
    expect(trackActionIdsForRequest(request, 'account-8')).not.toContain('remove');
    expect(trackActionIdsForRequest(request, 'account-7')).toEqual([
      'play-next',
      'add-to-queue',
      'start-radio',
      'add-to-playlist',
      'open-album',
      'open-artist',
      'remove',
    ]);
  });

  it('removes, announces, and closes for the exact active account scope', async () => {
    const onRemove = vi.fn(async () => undefined);
    showTrackActions(track, vi.fn(), {
      authorizedRemove: { accountScope: 'account-7', onRemove },
    });
    const request = getTrackActionRequest();
    if (request === null) throw new Error('Expected active track action request');

    await expect(runAuthorizedTrackRemoval(request, 'account-7')).resolves.toEqual({
      status: 'removed',
    });

    expect(onRemove).toHaveBeenCalledOnce();
    expect(mocks.announce).toHaveBeenCalledWith(
      strings.trackActions.removeSucceeded(track.title),
    );
    expect(getTrackActionRequest()).toBeNull();
  });

  it('never invokes removal for a stale request or different account scope', async () => {
    const onRemove = vi.fn(async () => undefined);
    showTrackActions(track, vi.fn(), {
      authorizedRemove: { accountScope: 'account-7', onRemove },
    });
    const oldRequest = getTrackActionRequest();
    if (oldRequest === null) throw new Error('Expected active track action request');

    await expect(runAuthorizedTrackRemoval(oldRequest, 'account-8')).resolves.toEqual({
      status: 'stale',
    });
    showTrackActions({ ...track, id: 'track-2' }, vi.fn());
    await expect(runAuthorizedTrackRemoval(oldRequest, 'account-7')).resolves.toEqual({
      status: 'stale',
    });

    expect(onRemove).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it('keeps an authorized remove failure recoverable on the active sheet', async () => {
    const onError = vi.fn();
    const onRemove = vi.fn(async () => {
      throw new Error('server rejected removal');
    });
    showTrackActions(track, onError, {
      authorizedRemove: { accountScope: 'account-7', onRemove },
    });
    const request = getTrackActionRequest();
    if (request === null) throw new Error('Expected active track action request');

    const expected = strings.trackActions.removeFailed;
    await expect(runAuthorizedTrackRemoval(request, 'account-7')).resolves.toEqual({
      status: 'failed',
      message: expected,
    });

    expect(onError).toHaveBeenCalledWith(expected);
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('server rejected removal'));
    expect(getTrackActionRequest()).toBe(request);
    expect(mocks.announce).not.toHaveBeenCalled();
  });

  it('does not deliver an in-flight removal outcome into a replacement sheet', async () => {
    let resolveRemoval: (() => void) | undefined;
    const onRemove = vi.fn(
      () => new Promise<void>((resolve) => { resolveRemoval = resolve; }),
    );
    showTrackActions(track, vi.fn(), {
      authorizedRemove: { accountScope: 'account-7', onRemove },
    });
    const oldRequest = getTrackActionRequest();
    if (oldRequest === null) throw new Error('Expected active track action request');

    const outcome = runAuthorizedTrackRemoval(oldRequest, 'account-7');
    showTrackActions({ ...track, id: 'track-2', title: 'Replacement' }, vi.fn());
    const replacement = getTrackActionRequest();
    resolveRemoval?.();

    await expect(outcome).resolves.toEqual({ status: 'stale' });
    expect(onRemove).toHaveBeenCalledOnce();
    expect(getTrackActionRequest()).toBe(replacement);
    expect(mocks.announce).not.toHaveBeenCalled();
  });
});
