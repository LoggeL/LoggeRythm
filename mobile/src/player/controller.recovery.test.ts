import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Event, type MediaItem, type PlaybackErrorEvent } from './player';
import type { Track } from '../api/types';
import { strings } from '../localization';
import {
  handleBackgroundPlaybackEvent,
  installPlaybackListeners,
  resetControllerState,
  setPlaybackEventDrainerForTests,
} from './controller';
import { withQueueOrigin } from './queueContract';

const mocks = vi.hoisted(() => ({
  queue: [] as MediaItem[],
  activeIndex: null as number | null,
  position: 0,
  playing: false,
  listeners: new Map<string, (event: never) => void>(),
  getQueue: vi.fn(),
  getActiveMediaItemIndex: vi.fn(),
  getProgress: vi.fn(),
  replaceMediaItem: vi.fn(),
  seekTo: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  skipToNext: vi.fn(),
  addEventListener: vi.fn(),
  getApiBase: vi.fn(),
  authenticatedHeadersFor: vi.fn(),
  preloadTrack: vi.fn(),
  getRadio: vi.fn(),
  recordPlay: vi.fn(),
  clearPlayerError: vi.fn(),
  reportPlayerError: vi.fn(),
  clearPlayerNotice: vi.fn(),
  reportPlayerNotice: vi.fn(),
  drainPlaybackEvents: vi.fn(),
}));

vi.mock('./player', async () => {
  const { Event, RepeatMode } = await import('./playerPort');
  return {
    default: {
      getQueue: mocks.getQueue,
      getActiveMediaItemIndex: mocks.getActiveMediaItemIndex,
      getProgress: mocks.getProgress,
      replaceMediaItem: mocks.replaceMediaItem,
      seekTo: mocks.seekTo,
      play: mocks.play,
      pause: mocks.pause,
      skipToNext: mocks.skipToNext,
      addEventListener: mocks.addEventListener,
    },
    Event,
    RepeatMode,
  };
});
vi.mock('../config', () => ({ getApiBase: mocks.getApiBase }));
vi.mock('../api/client', () => ({ authenticatedHeadersFor: mocks.authenticatedHeadersFor }));
vi.mock('../data/repositories', () => ({
  musicRepository: {
    preloadTrack: mocks.preloadTrack,
    getRadio: mocks.getRadio,
    recordPlay: mocks.recordPlay,
  },
}));
vi.mock('./errors', () => ({
  clearPlayerError: mocks.clearPlayerError,
  reportPlayerError: mocks.reportPlayerError,
  UserFacingPlayerError: Error,
}));
vi.mock('./notices', () => ({
  clearPlayerNotice: mocks.clearPlayerNotice,
  reportPlayerNotice: mocks.reportPlayerNotice,
}));

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Recovery Artist',
    artist_id: '10',
    artists: [{ id: '10', name: 'Recovery Artist' }],
    album: 'Recovery Album',
    album_id: '20',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 1,
    release_date: '2026-07-15',
  };
}

function media(id: string, radio = false, explicitDownload = false): MediaItem {
  const value = track(id);
  return withQueueOrigin(
    {
      mediaId: `queue:${id}`,
      url: explicitDownload
        ? { uri: `file:///data/user/0/top.logge.loggerythm/no_backup/${id}.mp3` }
        : {
            uri: `https://music.test/api/tracks/${id}/stream`,
            headers: { Cookie: 'old-session' },
          },
      title: value.title,
      extras: { track: value, radio, explicitDownload },
    },
    id === 'manual' ? 'manual' : 'context',
  );
}

function playbackError(
  code: PlaybackErrorEvent['code'],
  message: string,
): PlaybackErrorEvent {
  return { code, message };
}

function backgroundError(error: PlaybackErrorEvent) {
  return handleBackgroundPlaybackEvent({ type: Event.PlaybackError, ...error });
}

describe('native playback recovery integration', () => {
  let restorePlaybackEventDrainer = (): void => undefined;

  beforeAll(() => {
    mocks.addEventListener.mockImplementation(
      (event: string, listener: (payload: never) => void) => {
        mocks.listeners.set(event, listener);
        return { remove: vi.fn() };
      },
    );
    installPlaybackListeners();
  });

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.queue = [media('bad', true), media('manual', true), media('tail', true)];
    mocks.activeIndex = 0;
    mocks.position = 37;
    mocks.playing = false;
    mocks.getQueue.mockImplementation(() => [...mocks.queue]);
    mocks.getActiveMediaItemIndex.mockImplementation(() => mocks.activeIndex);
    mocks.getProgress.mockImplementation(() => ({
      position: mocks.position,
      duration: 180,
      buffered: 37,
      cached: 0,
    }));
    mocks.replaceMediaItem.mockImplementation((index: number, item: MediaItem) => {
      mocks.queue[index] = item;
    });
    mocks.seekTo.mockImplementation((position: number) => {
      mocks.position = position;
    });
    mocks.play.mockImplementation(() => {
      mocks.playing = true;
    });
    mocks.pause.mockImplementation(() => {
      mocks.playing = false;
    });
    mocks.skipToNext.mockImplementation(() => {
      if (mocks.activeIndex !== null && mocks.activeIndex + 1 < mocks.queue.length) {
        mocks.activeIndex += 1;
      }
    });
    mocks.getApiBase.mockResolvedValue('https://music.test');
    mocks.authenticatedHeadersFor.mockResolvedValue({ Cookie: 'fresh-session' });
    mocks.preloadTrack.mockResolvedValue(undefined);
    mocks.getRadio.mockResolvedValue([]);
    mocks.recordPlay.mockResolvedValue(undefined);
    mocks.drainPlaybackEvents.mockResolvedValue({ claimed: 0, completed: 0, retried: 0 });
    restorePlaybackEventDrainer = setPlaybackEventDrainerForTests({
      drain: mocks.drainPlaybackEvents,
    });
    resetControllerState();
  });

  afterEach(() => {
    restorePlaybackEventDrainer();
    vi.useRealTimers();
  });

  it('coalesces foreground and headless delivery, materializes, refreshes auth, and restores position', async () => {
    let resolvePreload!: () => void;
    mocks.preloadTrack.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePreload = resolve;
      }),
    );
    const error = playbackError('source', 'HTTP response status 416');

    mocks.listeners.get(Event.PlaybackError)?.(error as never);
    const background = backgroundError(error);
    await vi.waitFor(() => expect(mocks.preloadTrack).toHaveBeenCalledOnce());
    resolvePreload();
    await background;

    expect(mocks.preloadTrack).toHaveBeenCalledWith('bad', { timeoutMs: 5_000 });
    expect(mocks.replaceMediaItem).toHaveBeenCalledOnce();
    expect(mocks.seekTo).toHaveBeenCalledWith(37);
    expect(mocks.play).toHaveBeenCalledOnce();
    expect(mocks.queue.map((item) => item.mediaId)).toEqual([
      'queue:bad',
      'queue:manual',
      'queue:tail',
    ]);
    expect(mocks.queue[0].url).toEqual({
      uri: expect.stringMatching(
        /^https:\/\/music\.test\/api\/tracks\/bad\/stream\?lr_recovery=/,
      ),
      headers: { Cookie: 'fresh-session' },
    });
    expect(mocks.queue[0].extras).toEqual(
      expect.objectContaining({ radio: true, queueOrigin: 'context' }),
    );
    expect(mocks.reportPlayerError).not.toHaveBeenCalled();
  });

  it('skips a failed explicit download without probing or falling back to the network', async () => {
    mocks.queue[0] = media('bad', true, true);

    await backgroundError(playbackError('source', 'local file is unavailable'));

    expect(mocks.preloadTrack).not.toHaveBeenCalled();
    expect(mocks.getApiBase).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(mocks.replaceMediaItem).not.toHaveBeenCalled();
    expect(mocks.seekTo).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.skipToNext).toHaveBeenCalledOnce();
    expect(mocks.activeIndex).toBe(1);
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.player.recovery.skippedTitle,
      expect.objectContaining({
        message: expect.stringContaining(strings.player.recovery.attempts(1)),
      }),
    );
  });

  it('stops at queue end after a local failure without attempting remote recovery', async () => {
    mocks.queue = [media('bad', false, true)];
    mocks.activeIndex = 0;

    await backgroundError(playbackError('network', 'file descriptor was closed'));

    expect(mocks.preloadTrack).not.toHaveBeenCalled();
    expect(mocks.getApiBase).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(mocks.replaceMediaItem).not.toHaveBeenCalled();
    expect(mocks.skipToNext).not.toHaveBeenCalled();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.player.recovery.stoppedTitle,
      expect.objectContaining({
        message: expect.stringContaining(strings.player.recovery.attempts(1)),
      }),
    );
  });

  it('keeps transition bookkeeping failures out of the fatal player channel', async () => {
    const diagnostic = 'backend internal sf_session=must-not-leak';
    mocks.drainPlaybackEvents.mockRejectedValueOnce(new Error(diagnostic));
    const before = [...mocks.queue];

    await expect(
      handleBackgroundPlaybackEvent({
        type: Event.MediaItemTransition,
        item: mocks.queue[0],
        index: 0,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.reportPlayerNotice).toHaveBeenCalledOnce();
    expect(mocks.reportPlayerNotice).toHaveBeenCalledWith(
      'bookkeeping',
      'transition:queue:bad',
      strings.player.bookkeepingFailedTitle,
      strings.player.bookkeepingFailedMessage,
    );
    expect(mocks.reportPlayerNotice.mock.calls[0]).not.toContain(diagnostic);
    expect(mocks.reportPlayerError).not.toHaveBeenCalled();
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(mocks.skipToNext).not.toHaveBeenCalled();
    expect(mocks.queue).toEqual(before);
  });

  it('ignores untrusted foreground transition metadata and drains only the native journal', async () => {
    const malformed = { ...mocks.queue[0], extras: { radio: true } };

    await expect(
      handleBackgroundPlaybackEvent({
        type: Event.MediaItemTransition,
        item: malformed,
        index: 0,
      }),
    ).resolves.toBeUndefined();

    expect(mocks.recordPlay).not.toHaveBeenCalled();
    expect(mocks.drainPlaybackEvents).toHaveBeenCalledOnce();
    expect(mocks.reportPlayerNotice).not.toHaveBeenCalled();
    expect(mocks.reportPlayerError).not.toHaveBeenCalled();
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(mocks.skipToNext).not.toHaveBeenCalled();
  });

  it('abandons an in-flight reload when the same item makes real progress', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let resolvePreload!: () => void;
    mocks.preloadTrack.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePreload = resolve;
      }),
    );

    const pending = backgroundError(playbackError('network', 'connection reset'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.preloadTrack).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    mocks.listeners.get(Event.PlaybackProgressUpdated)?.({
      mediaId: 'queue:bad',
      position: 42,
      duration: 180,
      timestamp: 5_000,
    } as never);
    resolvePreload();
    await pending;

    expect(mocks.replaceMediaItem).not.toHaveBeenCalled();
    expect(mocks.seekTo).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it('retries a timed-out authenticated probe with deterministic network backoff', async () => {
    vi.useFakeTimers();
    mocks.preloadTrack
      .mockRejectedValueOnce({ status: 0, message: 'Network request timed out' })
      .mockResolvedValueOnce(undefined);

    const pending = backgroundError(playbackError('network', 'socket closed'));
    await vi.advanceTimersByTimeAsync(250);
    await pending;

    expect(mocks.preloadTrack).toHaveBeenCalledTimes(2);
    expect(mocks.preloadTrack).toHaveBeenLastCalledWith('bad', { timeoutMs: 2_500 });
    expect(mocks.play).toHaveBeenCalledOnce();
    expect(mocks.skipToNext).not.toHaveBeenCalled();
  });

  it('retries backend materialization failures on their own policy before replaying', async () => {
    vi.useFakeTimers();
    mocks.preloadTrack
      .mockRejectedValueOnce({ status: 502, message: 'upstream failed' })
      .mockRejectedValueOnce({ status: 503, message: 'still unavailable' })
      .mockResolvedValueOnce(undefined);

    const pending = backgroundError(playbackError('source', 'HTTP status 502'));
    await vi.advanceTimersByTimeAsync(1_200);
    await pending;

    expect(mocks.preloadTrack).toHaveBeenCalledTimes(3);
    expect(mocks.play).toHaveBeenCalledOnce();
    expect(mocks.reportPlayerError).not.toHaveBeenCalled();
  });

  it('stops on session expiry and leaves the queue and active item intact', async () => {
    mocks.preloadTrack.mockRejectedValueOnce({ status: 401, message: 'session expired' });

    await backgroundError(playbackError('source', 'bad HTTP status'));

    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.skipToNext).not.toHaveBeenCalled();
    expect(mocks.activeIndex).toBe(0);
    expect(mocks.queue).toHaveLength(3);
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.player.recovery.stoppedTitle,
      expect.objectContaining({
        message: strings.player.recovery.sessionExpired('Track bad'),
      }),
    );
  });

  it.each([
    [403, 'authorization'],
    [404, 'missing source'],
    [416, 'bad range'],
  ])('skips a definitively bad item only after its authenticated HTTP %i probe', async (status, label) => {
    mocks.preloadTrack.mockRejectedValueOnce({ status, message: label });

    await backgroundError(playbackError('source', 'bad HTTP status'));

    expect(mocks.preloadTrack).toHaveBeenCalledOnce();
    expect(mocks.skipToNext).toHaveBeenCalledOnce();
    expect(mocks.activeIndex).toBe(1);
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.player.recovery.skippedTitle,
      expect.objectContaining({
        message: expect.stringContaining(strings.player.recovery.attempts(1)),
      }),
    );
  });

  it('uses the full renderer retry budget before skipping an unplayable codec', async () => {
    vi.useFakeTimers();
    const error = playbackError('renderer', 'decoder initialization failed');

    await backgroundError(error);
    const second = backgroundError(error);
    await vi.advanceTimersByTimeAsync(250);
    await second;
    await backgroundError(error);

    expect(mocks.preloadTrack).toHaveBeenCalledTimes(2);
    expect(mocks.skipToNext).toHaveBeenCalledOnce();
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.player.recovery.skippedTitle,
      expect.objectContaining({
        message: expect.stringContaining(strings.player.recovery.attempts(2)),
      }),
    );
  });

  it('replenishes renderer retries only after plausible playback progress', async () => {
    vi.useFakeTimers();
    const error = playbackError('renderer', 'decoder initialization failed');

    await backgroundError(error);
    const second = backgroundError(error);
    await vi.advanceTimersByTimeAsync(250);
    await second;
    await vi.advanceTimersByTimeAsync(10_000);
    mocks.position = 47;
    await backgroundError(error);

    expect(mocks.preloadTrack).toHaveBeenCalledTimes(3);
    expect(mocks.skipToNext).not.toHaveBeenCalled();
  });

  it('pauses instead of walking the queue when offline retries are exhausted', async () => {
    vi.useFakeTimers();
    mocks.preloadTrack.mockRejectedValue({ status: 0, message: 'offline network timeout' });

    const pending = backgroundError(playbackError('network', 'offline'));
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(mocks.preloadTrack).toHaveBeenCalledTimes(3);
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.skipToNext).not.toHaveBeenCalled();
    expect(mocks.activeIndex).toBe(0);
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.player.recovery.stoppedTitle,
      expect.objectContaining({ message: expect.stringContaining('Warteschlange beibehalten') }),
    );
  });

  it('stops safely at queue end rather than wrapping after a permanent source failure', async () => {
    mocks.activeIndex = 2;
    mocks.preloadTrack.mockRejectedValueOnce({ status: 404, message: 'missing' });

    await backgroundError(playbackError('source', 'HTTP 404'));

    expect(mocks.skipToNext).not.toHaveBeenCalled();
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.activeIndex).toBe(2);
    expect(mocks.reportPlayerError).toHaveBeenCalledWith(
      strings.player.recovery.stoppedTitle,
      expect.objectContaining({ message: expect.stringContaining('Ende der Warteschlange') }),
    );
  });

  it('does not expose native or backend diagnostics in the localized recovery alert', async () => {
    const diagnostic = 'backend internal detail sf_session=must-not-leak';
    mocks.preloadTrack.mockRejectedValueOnce({ status: 401, message: diagnostic });

    await backgroundError(playbackError('source', diagnostic));

    const reported = mocks.reportPlayerError.mock.calls.at(-1)?.[1] as Error;
    expect(reported.message).toBe(strings.player.recovery.sessionExpired('Track bad'));
    expect(reported.message).not.toContain(diagnostic);
    expect(reported.message).not.toContain('sf_session');
  });
});
