import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Event, RepeatMode, type MediaItem } from './player';
import type { Track } from '../api/types';
import {
  addToQueue,
  cycleRepeat,
  handleBackgroundPlaybackEvent,
  isContextShuffleEnabled,
  playNext,
  playTrackRow,
  playTracks,
  prev,
  resetControllerState,
  startRadio,
  toggleShuffle,
} from './controller';
import { mediaItemUsesExplicitDownload } from './mediaItem';
import {
  queueContextOf,
  queueOriginOf,
  queueStableIdOf,
  withQueueOrigin,
} from './queueContract';

const mocks = vi.hoisted(() => ({
  queue: [] as MediaItem[],
  activeIndex: null as number | null,
  position: 0,
  playing: false,
  shuffle: false,
  repeatMode: undefined as unknown as RepeatMode,
  getQueue: vi.fn(),
  getActiveMediaItem: vi.fn(),
  getActiveMediaItemIndex: vi.fn(),
  setMediaItem: vi.fn(),
  setMediaItems: vi.fn(),
  insertMediaItem: vi.fn(),
  addMediaItem: vi.fn(),
  addMediaItems: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  isPlaying: vi.fn(),
  getProgress: vi.fn(),
  seekTo: vi.fn(),
  skipToPrevious: vi.fn(),
  isShuffleEnabled: vi.fn(),
  setShuffleEnabled: vi.fn(),
  moveMediaItem: vi.fn(),
  getRepeatMode: vi.fn(),
  setRepeatMode: vi.fn(),
  setQueuePersistenceState: vi.fn(),
  getApiBase: vi.fn(),
  authenticatedHeadersFor: vi.fn(),
  offlineUriForTrack: vi.fn(),
  getRadio: vi.fn(),
  recordPlay: vi.fn(),
  invalidateListeningStats: vi.fn(),
  clearPlayerError: vi.fn(),
}));

vi.mock('./player', async () => {
  const { Event, RepeatMode } = await import('./playerPort');
  return {
    default: {
      getQueue: mocks.getQueue,
      getActiveMediaItem: mocks.getActiveMediaItem,
      getActiveMediaItemIndex: mocks.getActiveMediaItemIndex,
      setMediaItem: mocks.setMediaItem,
      setMediaItems: mocks.setMediaItems,
      insertMediaItem: mocks.insertMediaItem,
      addMediaItem: mocks.addMediaItem,
      addMediaItems: mocks.addMediaItems,
      play: mocks.play,
      pause: mocks.pause,
      isPlaying: mocks.isPlaying,
      getProgress: mocks.getProgress,
      seekTo: mocks.seekTo,
      skipToPrevious: mocks.skipToPrevious,
      isShuffleEnabled: mocks.isShuffleEnabled,
      setShuffleEnabled: mocks.setShuffleEnabled,
      moveMediaItem: mocks.moveMediaItem,
      getRepeatMode: mocks.getRepeatMode,
      setRepeatMode: mocks.setRepeatMode,
      setQueuePersistenceState: mocks.setQueuePersistenceState,
    },
    Event,
    RepeatMode,
  };
});
vi.mock('../config', () => ({ getApiBase: mocks.getApiBase }));
vi.mock('../api/client', () => ({ authenticatedHeadersFor: mocks.authenticatedHeadersFor }));
vi.mock('../offline/registry', () => ({ offlineUriForTrack: mocks.offlineUriForTrack }));
vi.mock('../data/queryClient', () => ({
  invalidateListeningStats: mocks.invalidateListeningStats,
}));
vi.mock('../data/repositories', () => ({
  musicRepository: {
    getRadio: mocks.getRadio,
    recordPlay: mocks.recordPlay,
    preloadTrack: vi.fn(),
  },
}));
vi.mock('./errors', () => ({
  clearPlayerError: mocks.clearPlayerError,
  reportPlayerError: vi.fn(),
  UserFacingPlayerError: Error,
}));

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Contract Artist',
    artist_id: '10',
    artists: [{ id: '10', name: 'Contract Artist' }],
    album: 'Contract Album',
    album_id: '20',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 1,
    release_date: '2026-07-15',
  };
}

function explicitUri(id: string): string {
  return `file:///data/user/0/top.logge.loggerythm/no_backup/loggerythm_explicit_downloads/v1/scopes/${'a'.repeat(64)}/audio/${id}.mp3`;
}

function media(id: string, origin: 'manual' | 'context' = 'context', radio = false): MediaItem {
  const value = track(id);
  return withQueueOrigin(
    {
      mediaId: `fixture:${id}`,
      url: `https://music.test/api/tracks/${id}/stream`,
      title: value.title,
      extras: { track: value, radio },
    },
    origin,
  );
}

const ids = () => mocks.queue.map((item) => (item.extras?.track as Track).id);

describe('controller Phase-0 queue contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queue = [];
    mocks.activeIndex = null;
    mocks.position = 0;
    mocks.playing = false;
    mocks.shuffle = false;
    mocks.repeatMode = RepeatMode.Off;
    mocks.getQueue.mockImplementation(() => [...mocks.queue]);
    mocks.getActiveMediaItem.mockImplementation(() =>
      mocks.activeIndex === null ? null : (mocks.queue[mocks.activeIndex] ?? null),
    );
    mocks.getActiveMediaItemIndex.mockImplementation(() => mocks.activeIndex);
    mocks.setMediaItem.mockImplementation((item: MediaItem) => {
      mocks.queue = [item];
      mocks.activeIndex = 0;
    });
    mocks.setMediaItems.mockImplementation((items: MediaItem[], index: number) => {
      mocks.queue = [...items];
      mocks.activeIndex = index;
    });
    mocks.insertMediaItem.mockImplementation((index: number, item: MediaItem) => {
      mocks.queue.splice(index, 0, item);
    });
    mocks.addMediaItem.mockImplementation((item: MediaItem) => mocks.queue.push(item));
    mocks.addMediaItems.mockImplementation((items: MediaItem[]) => mocks.queue.push(...items));
    mocks.play.mockImplementation(() => {
      mocks.playing = true;
    });
    mocks.pause.mockImplementation(() => {
      mocks.playing = false;
    });
    mocks.isPlaying.mockImplementation(() => mocks.playing);
    mocks.getProgress.mockImplementation(() => ({
      position: mocks.position,
      duration: 180,
      buffered: 180,
      cached: 180,
    }));
    mocks.seekTo.mockImplementation((position: number) => {
      mocks.position = position;
    });
    mocks.skipToPrevious.mockImplementation(() => {
      if (mocks.activeIndex !== null && mocks.activeIndex > 0) mocks.activeIndex -= 1;
    });
    mocks.isShuffleEnabled.mockImplementation(() => mocks.shuffle);
    mocks.setShuffleEnabled.mockImplementation((enabled: boolean) => {
      mocks.shuffle = enabled;
    });
    mocks.moveMediaItem.mockImplementation((fromIndex: number, toIndex: number) => {
      const [moved] = mocks.queue.splice(fromIndex, 1);
      if (moved) mocks.queue.splice(toIndex, 0, moved);
    });
    mocks.getRepeatMode.mockImplementation(() => mocks.repeatMode);
    mocks.setRepeatMode.mockImplementation((mode: RepeatMode) => {
      mocks.repeatMode = mode;
    });
    mocks.getApiBase.mockResolvedValue('https://music.test');
    mocks.authenticatedHeadersFor.mockResolvedValue({ Cookie: 'sf_session=test' });
    mocks.offlineUriForTrack.mockReturnValue(null);
    mocks.getRadio.mockResolvedValue([]);
    mocks.recordPlay.mockResolvedValue(undefined);
    mocks.invalidateListeningStats.mockResolvedValue(undefined);
    resetControllerState();
  });

  it('creates context queues with authenticated media and starts at the requested index', async () => {
    await playTracks([track('a'), track('b'), track('c')], 1, {
      context: { type: 'playlist', id: 'playlist-42', label: 'Road-trip mix' },
    });

    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(mocks.activeIndex).toBe(1);
    expect(mocks.queue.map(queueOriginOf)).toEqual(['context', 'context', 'context']);
    expect(mocks.queue.map(queueContextOf)).toEqual([
      { type: 'playlist', id: 'playlist-42', label: 'Road-trip mix' },
      { type: 'playlist', id: 'playlist-42', label: 'Road-trip mix' },
      { type: 'playlist', id: 'playlist-42', label: 'Road-trip mix' },
    ]);
    expect(mocks.queue[0].url).toEqual({
      uri: 'https://music.test/api/tracks/a/stream',
      headers: { Cookie: 'sf_session=test' },
    });
    expect(mocks.play).toHaveBeenCalledOnce();
  });

  it('starts a wholly explicit-download queue without auth or compatibility preflight', async () => {
    mocks.offlineUriForTrack.mockImplementation((id: string) => explicitUri(id));

    await playTracks([track('a'), track('b'), track('c')], 1, {
      context: { type: 'playlist', id: 'offline-42', label: 'Offline mix' },
    });

    expect(mocks.getApiBase).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(mocks.queue.map((item) => item.url)).toEqual([
      { uri: explicitUri('a') },
      { uri: explicitUri('b') },
      { uri: explicitUri('c') },
    ]);
    expect(mocks.queue.every(mediaItemUsesExplicitDownload)).toBe(true);
    expect(mocks.queue.map(queueOriginOf)).toEqual(['context', 'context', 'context']);
    expect(mocks.activeIndex).toBe(1);
  });

  it('assembles a required-explicit queue locally without crossing the network boundary', async () => {
    mocks.offlineUriForTrack.mockImplementation((id: string) => explicitUri(id));

    await playTracks([track('a'), track('b'), track('a')], 2, {
      context: { type: 'playlist', id: 'offline-only-42', label: 'Offline only' },
      requireExplicitDownloads: true,
    });

    expect(mocks.offlineUriForTrack.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'a']);
    expect(mocks.getApiBase).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(mocks.queue.map((item) => item.url)).toEqual([
      { uri: explicitUri('a') },
      { uri: explicitUri('b') },
      { uri: explicitUri('a') },
    ]);
    expect(mocks.queue.every(mediaItemUsesExplicitDownload)).toBe(true);
    expect(mocks.activeIndex).toBe(2);
  });

  it('fails closed when the registry is cleared immediately before required-explicit playback', async () => {
    const staleSelection = [track('local'), track('removed')];
    mocks.queue = [media('existing')];
    mocks.activeIndex = 0;

    // The caller selected a playlist while both files were present. Removal
    // wins immediately before the controller assembles the native queue.
    mocks.offlineUriForTrack.mockImplementation((id: string) => explicitUri(id));
    expect(staleSelection.every((value) => mocks.offlineUriForTrack(value.id) !== null)).toBe(true);
    mocks.offlineUriForTrack.mockClear();
    mocks.offlineUriForTrack.mockImplementation((id: string) =>
      id === 'removed' ? null : explicitUri(id),
    );

    await expect(
      playTracks(staleSelection, 0, {
        context: { type: 'playlist', id: 'offline-only-removed', label: 'Stale offline' },
        requireExplicitDownloads: true,
      }),
    ).rejects.toThrow(
      'Offline-only playback requires a verified explicit download for every selected track',
    );

    expect(mocks.offlineUriForTrack.mock.calls.map(([id]) => id)).toEqual([
      'local',
      'removed',
    ]);
    expect(mocks.getApiBase).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(mocks.setMediaItems).not.toHaveBeenCalled();
    expect(mocks.play).not.toHaveBeenCalled();
    expect(ids()).toEqual(['existing']);
    expect(mocks.activeIndex).toBe(0);
  });

  it('authenticates once for only the remote members of a hybrid queue', async () => {
    mocks.offlineUriForTrack.mockImplementation((id: string) =>
      id === 'local' ? explicitUri(id) : null,
    );

    await playTracks([track('local'), track('remote-1'), track('remote-2')], 0, {
      context: { type: 'playlist', id: 'hybrid-42', label: 'Hybrid mix' },
    });

    expect(mocks.getApiBase).toHaveBeenCalledOnce();
    expect(mocks.authenticatedHeadersFor).toHaveBeenCalledOnce();
    expect(mocks.queue[0].url).toEqual({ uri: explicitUri('local') });
    expect(mocks.queue.slice(1).map((item) => item.url)).toEqual([
      {
        uri: 'https://music.test/api/tracks/remote-1/stream',
        headers: { Cookie: 'sf_session=test' },
      },
      {
        uri: 'https://music.test/api/tracks/remote-2/stream',
        headers: { Cookie: 'sf_session=test' },
      },
    ]);
    expect(mocks.queue.map(mediaItemUsesExplicitDownload)).toEqual([true, false, false]);
  });

  it('keeps repeated Recently Heard events distinct in their exact history order', async () => {
    await playTracks([track('repeat'), track('middle'), track('repeat')], 2, {
      context: { type: 'recent', id: 'user-42', label: 'Recently Heard' },
    });

    expect(ids()).toEqual(['repeat', 'middle', 'repeat']);
    expect(mocks.activeIndex).toBe(2);
    expect(new Set(mocks.queue.map(queueStableIdOf)).size).toBe(3);
    expect(mocks.queue.map(queueContextOf)).toEqual([
      { type: 'recent', id: 'user-42', label: 'Recently Heard' },
      { type: 'recent', id: 'user-42', label: 'Recently Heard' },
      { type: 'recent', id: 'user-42', label: 'Recently Heard' },
    ]);
  });

  it('toggles or resumes an active row without replacing its queue', async () => {
    const tracks = [track('active'), track('other')];
    mocks.queue = [media('active'), media('other')];
    mocks.activeIndex = 0;
    mocks.playing = true;

    await expect(
      playTrackRow(tracks, 0, {
        context: { type: 'search', id: 'active', label: 'Search: active' },
      }),
    ).resolves.toBe('toggled-current');
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.setMediaItems).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();

    mocks.pause.mockClear();
    mocks.play.mockClear();
    await expect(
      playTrackRow(tracks, 0, {
        context: { type: 'search', id: 'active', label: 'Search: active' },
      }),
    ).resolves.toBe('toggled-current');
    expect(mocks.play).toHaveBeenCalledOnce();
    expect(mocks.setMediaItems).not.toHaveBeenCalled();
  });

  it('starts a fresh context when a row is not the active catalog track', async () => {
    mocks.queue = [media('active')];
    mocks.activeIndex = 0;

    await expect(
      playTrackRow([track('active'), track('other')], 1, {
        context: { type: 'search', id: 'other', label: 'Search: other' },
      }),
    ).resolves.toBe('started-context');

    expect(ids()).toEqual(['active', 'other']);
    expect(mocks.activeIndex).toBe(1);
    expect(mocks.setMediaItems).toHaveBeenCalledOnce();
    expect(mocks.authenticatedHeadersFor).toHaveBeenCalledOnce();
  });

  it.each([
    ['Play next', playNext],
    ['Add to queue', addToQueue],
  ])('%s replaces an inactive queue with a visible playing manual item', async (_label, action) => {
    mocks.queue = [media('stale')];
    mocks.activeIndex = null;

    await action(track('manual'));

    expect(ids()).toEqual(['manual']);
    expect(mocks.activeIndex).toBe(0);
    expect(queueOriginOf(mocks.queue[0])).toBe('manual');
    expect(mocks.setMediaItem).toHaveBeenCalledOnce();
    expect(mocks.play).toHaveBeenCalledOnce();
  });

  it('puts Play next at the front and ordinary additions at the manual tail', async () => {
    mocks.queue = [
      media('active', 'context', true),
      media('manual-old', 'manual', true),
      media('context-1', 'context', true),
      media('context-2', 'context', true),
    ];
    mocks.activeIndex = 0;

    await playNext(track('next'));
    await addToQueue(track('added-1'));
    await addToQueue(track('added-2'));

    expect(ids()).toEqual([
      'active',
      'next',
      'manual-old',
      'added-1',
      'added-2',
      'context-1',
      'context-2',
    ]);
    expect(mocks.queue.map(queueOriginOf)).toEqual([
      'context',
      'manual',
      'manual',
      'manual',
      'manual',
      'context',
      'context',
    ]);
    expect(mocks.queue.slice(1, 5).every((item) => item.extras?.radio === true)).toBe(true);
    expect(mocks.setShuffleEnabled).not.toHaveBeenCalled();
  });

  it('inserts local manual items without touching auth and preserves manual priority', async () => {
    mocks.queue = [
      media('active'),
      media('manual-old', 'manual'),
      media('context-tail'),
    ];
    mocks.activeIndex = 0;
    mocks.offlineUriForTrack.mockImplementation((id: string) => explicitUri(id));

    await playNext(track('local-next'));
    await addToQueue(track('local-added'));

    expect(mocks.getApiBase).not.toHaveBeenCalled();
    expect(mocks.authenticatedHeadersFor).not.toHaveBeenCalled();
    expect(ids()).toEqual([
      'active',
      'local-next',
      'manual-old',
      'local-added',
      'context-tail',
    ]);
    expect(mocks.queue.slice(1, 4).map(queueOriginOf)).toEqual([
      'manual',
      'manual',
      'manual',
    ]);
    expect(mediaItemUsesExplicitDownload(mocks.queue[1])).toBe(true);
    expect(mediaItemUsesExplicitDownload(mocks.queue[3])).toBe(true);
    expect(mocks.queue[1].url).toEqual({ uri: explicitUri('local-next') });
    expect(mocks.queue[3].url).toEqual({ uri: explicitUri('local-added') });
  });

  it('gives repeated manual track additions distinct persisted stable ids', async () => {
    mocks.queue = [media('active')];
    mocks.activeIndex = 0;

    await addToQueue(track('repeat'));
    await addToQueue(track('repeat'));

    const stableIds = mocks.queue.slice(1).map(queueStableIdOf);
    expect(new Set(stableIds).size).toBe(2);
    expect(ids()).toEqual(['active', 'repeat', 'repeat']);
  });

  it('rejects an already-corrupt primary/secondary order before native mutation', async () => {
    mocks.queue = [media('active'), media('context'), media('stranded', 'manual')];
    mocks.activeIndex = 0;

    await expect(addToQueue(track('new'))).rejects.toThrow('Manual queue priority is invalid');
    expect(mocks.insertMediaItem).not.toHaveBeenCalled();
    expect(mocks.addMediaItem).not.toHaveBeenCalled();
  });

  it('implements the three-second Previous rule exactly', () => {
    mocks.queue = [media('a'), media('b')];
    mocks.activeIndex = 1;
    mocks.position = 3.01;
    prev();
    expect(mocks.seekTo).toHaveBeenLastCalledWith(0);
    expect(mocks.skipToPrevious).not.toHaveBeenCalled();

    mocks.seekTo.mockClear();
    mocks.position = 3;
    prev();
    expect(mocks.skipToPrevious).toHaveBeenCalledOnce();
    expect(mocks.activeIndex).toBe(0);

    mocks.position = 1;
    prev();
    expect(mocks.seekTo).toHaveBeenLastCalledWith(0);
  });

  it('advances repeat mode with exactly one native setter call', () => {
    expect(cycleRepeat()).toBe(RepeatMode.All);
    expect(mocks.setRepeatMode).toHaveBeenCalledTimes(1);
    expect(mocks.setRepeatMode).toHaveBeenCalledWith(RepeatMode.All);
  });

  it('shuffles only context while preserving manual priority, then restores order', async () => {
    mocks.queue = [
      media('active'),
      media('manual', 'manual'),
      media('context-1'),
      media('context-2'),
      media('context-3'),
    ];
    mocks.activeIndex = 0;

    await expect(toggleShuffle(undefined, () => 0)).resolves.toBe(true);
    expect(ids()).toEqual(['active', 'manual', 'context-2', 'context-3', 'context-1']);
    expect(isContextShuffleEnabled()).toBe(true);
    expect(mocks.shuffle).toBe(false);
    expect(mocks.setShuffleEnabled).not.toHaveBeenCalled();

    await expect(toggleShuffle()).resolves.toBe(false);
    expect(ids()).toEqual(['active', 'manual', 'context-1', 'context-2', 'context-3']);
    expect(isContextShuffleEnabled()).toBe(false);
  });

  it('deduplicates radio against the post-request native queue and response duplicates', async () => {
    let resolveRadio!: (tracks: Track[]) => void;
    mocks.queue = [media('seed', 'context', true)];
    mocks.activeIndex = 0;
    mocks.getRadio.mockReturnValueOnce(new Promise((resolve) => {
      resolveRadio = resolve;
    }));

    const pending = handleBackgroundPlaybackEvent({
      type: Event.MediaItemTransition,
      item: mocks.queue[0],
      index: 0,
    });
    await vi.waitFor(() => expect(mocks.getRadio).toHaveBeenCalledOnce());
    expect(mocks.getRadio).toHaveBeenCalledWith('seed', undefined, 4_000);
    mocks.queue.push(media('arrived-during-request', 'manual', true));
    resolveRadio([
      track('arrived-during-request'),
      track('new-1'),
      track('new-1'),
      track('new-2'),
    ]);
    await pending;

    expect(ids()).toEqual(['seed', 'arrived-during-request', 'new-1', 'new-2']);
    expect(mocks.queue.slice(2).map(queueOriginOf)).toEqual(['context', 'context']);
    expect(mocks.recordPlay).toHaveBeenCalledWith(track('seed'), 4_000);
    expect(mocks.invalidateListeningStats).toHaveBeenCalledOnce();
  });

  it('invalidates account stats only after play history persists successfully', async () => {
    const active = media('active', 'context', false);
    mocks.queue = [active];
    mocks.activeIndex = 0;

    await handleBackgroundPlaybackEvent({
      type: Event.MediaItemTransition,
      item: active,
      index: 0,
    });
    expect(mocks.invalidateListeningStats).toHaveBeenCalledOnce();

    mocks.recordPlay.mockRejectedValueOnce(new Error('history unavailable'));
    await handleBackgroundPlaybackEvent({
      type: Event.MediaItemTransition,
      item: active,
      index: 0,
    });
    expect(mocks.invalidateListeningStats).toHaveBeenCalledOnce();
  });

  it('does not append stale radio results after a native Android Auto queue replacement', async () => {
    let resolveRadio!: (tracks: Track[]) => void;
    const seed = media('seed', 'context', true);
    mocks.queue = [seed];
    mocks.activeIndex = 0;
    mocks.getRadio.mockReturnValueOnce(new Promise((resolve) => {
      resolveRadio = resolve;
    }));

    const pending = handleBackgroundPlaybackEvent({
      type: Event.MediaItemTransition,
      item: seed,
      index: 0,
    });
    await vi.waitFor(() => expect(mocks.getRadio).toHaveBeenCalledOnce());
    mocks.queue = [media('auto-selection', 'context', false)];
    resolveRadio([track('stale')]);
    await pending;

    expect(ids()).toEqual(['auto-selection']);
    expect(mocks.addMediaItems).not.toHaveBeenCalled();
  });

  it('deduplicates a newly started radio queue while retaining the seed first', async () => {
    mocks.getRadio.mockResolvedValueOnce([
      track('seed'),
      track('a'),
      track('a'),
      track('b'),
    ]);

    await startRadio(track('seed'));

    expect(mocks.getRadio).toHaveBeenCalledWith('seed');
    expect(ids()).toEqual(['seed', 'a', 'b']);
    expect(mocks.queue.every((item) => item.extras?.radio === true)).toBe(true);
    expect(mocks.queue.every((item) => queueOriginOf(item) === 'context')).toBe(true);
  });
});
