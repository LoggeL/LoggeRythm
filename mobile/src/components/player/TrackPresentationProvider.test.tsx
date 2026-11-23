import type React from 'react';
import type { MediaItem, PlaybackState } from '../../player/player';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TrackPresentationProvider,
  useTrackPresentation,
  type TrackPresentationContextValue,
} from './TrackPresentationProvider';

const READY = 'ready' as PlaybackState;
const BUFFERING = 'buffering' as PlaybackState;

const mocks = vi.hoisted(() => ({
  activeItem: null as MediaItem | null,
  isPlaying: false,
  playbackState: 'ready' as PlaybackState,
  queryData: undefined as { ids: string[] } | undefined,
  queryError: null as unknown,
  offlineSnapshot: {
    hydrated: true,
    downloadedTrackIds: new Set(['42']),
  },
  contextValue: null as TrackPresentationContextValue | null,
  activeCalls: 0,
  playingCalls: 0,
  playbackCalls: 0,
  queryCalls: 0,
  queryOptionsCalls: 0,
  offlineCalls: 0,
  trackHooks: false,
  hookCursor: 0,
  hookSlots: [] as { deps: readonly unknown[]; value: unknown }[],
}));

function depsEqual(
  prev: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (prev === undefined || next === undefined || prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) return false;
  }
  return true;
}

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    default: actual,
    useCallback: <T,>(callback: T, deps?: readonly unknown[]): T => {
      if (!mocks.trackHooks) return callback;
      const index = mocks.hookCursor++;
      const slot = mocks.hookSlots[index];
      if (slot && depsEqual(slot.deps, deps)) return slot.value as T;
      mocks.hookSlots[index] = { deps: deps ?? [], value: callback };
      return callback;
    },
    useContext: () => mocks.contextValue,
    useMemo: <T,>(factory: () => T, deps?: readonly unknown[]): T => {
      if (!mocks.trackHooks) return factory();
      const index = mocks.hookCursor++;
      const slot = mocks.hookSlots[index];
      if (slot && depsEqual(slot.deps, deps)) return slot.value as T;
      const value = factory();
      mocks.hookSlots[index] = { deps: deps ?? [], value };
      return value;
    },
  };
});

vi.mock('../../player/player', () => ({
  useActiveMediaItem: () => {
    mocks.activeCalls += 1;
    return mocks.activeItem;
  },
  useIsPlaying: () => {
    mocks.playingCalls += 1;
    return mocks.isPlaying;
  },
  usePlaybackState: () => {
    mocks.playbackCalls += 1;
    return mocks.playbackState;
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => {
    mocks.queryCalls += 1;
    return { data: mocks.queryData, error: mocks.queryError };
  },
}));

vi.mock('../../data', () => ({
  musicQueries: {
    cachedTrackIds: () => {
      mocks.queryOptionsCalls += 1;
      return { queryKey: ['cached-track-ids'] };
    },
  },
}));

vi.mock('../../offline/hooks', () => ({
  useOfflineDownloads: () => {
    mocks.offlineCalls += 1;
    return mocks.offlineSnapshot;
  },
}));

type ProviderElement = React.ReactElement<{
  value: TrackPresentationContextValue;
}>;

function providerValue(): TrackPresentationContextValue {
  mocks.hookCursor = 0;
  const element = TrackPresentationProvider({ children: null }) as ProviderElement;
  return element.props.value;
}

function activeMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    mediaId: 'queue:3:1:42',
    url: 'https://music.test/42',
    extras: {
      track: { id: '42' },
      queueContextType: 'album',
      queueContextId: 'album-7',
      queueContextLabel: 'Album Seven',
      queueOriginalContextOrder: 1,
    },
    ...overrides,
  };
}

describe('TrackPresentationProvider', () => {
  beforeEach(() => {
    mocks.activeItem = activeMediaItem();
    mocks.isPlaying = true;
    mocks.playbackState = READY;
    mocks.queryData = { ids: ['42'] };
    mocks.queryError = null;
    mocks.offlineSnapshot = {
      hydrated: true,
      downloadedTrackIds: new Set(['42']),
    };
    mocks.contextValue = null;
    mocks.activeCalls = 0;
    mocks.playingCalls = 0;
    mocks.playbackCalls = 0;
    mocks.queryCalls = 0;
    mocks.queryOptionsCalls = 0;
    mocks.offlineCalls = 0;
    mocks.trackHooks = false;
    mocks.hookCursor = 0;
    mocks.hookSlots = [];
  });

  it('subscribes to every global source and the cached-id query exactly once', () => {
    const value = providerValue();

    expect(mocks.activeCalls).toBe(1);
    expect(mocks.playingCalls).toBe(1);
    expect(mocks.playbackCalls).toBe(1);
    expect(mocks.queryOptionsCalls).toBe(1);
    expect(mocks.queryCalls).toBe(1);
    expect(mocks.offlineCalls).toBe(1);
    expect(
      value.presentationFor({
        trackId: '42',
        queueContext: { type: 'album', id: 'album-7' },
        originalContextOrder: 1,
      }),
    ).toMatchObject({
      active: true,
      playback: 'playing',
      serverCache: 'cached',
      rollingDeviceCache: null,
      explicitDownload: { kind: 'downloaded' },
    });
  });

  it('preserves strict context value identity across 1s ticks with new MediaItem refs of identical occurrence', () => {
    mocks.trackHooks = true;
    const first = providerValue();

    // Simulate a 1s tick emitting a brand-new MediaItem object with identical
    // occurrence identity (e.g., refreshed URL/title/duration metadata).
    mocks.activeItem = activeMediaItem({ title: 'Updated Metadata Title' });
    const second = providerValue();

    expect(second).toBe(first);
    expect(second.presentationFor).toBe(first.presentationFor);

    // Changing playback phase updates context identity cleanly.
    mocks.playbackState = BUFFERING;
    const third = providerValue();
    expect(third).not.toBe(first);
    expect(
      third.presentationFor({
        trackId: '42',
        queueContext: { type: 'album', id: 'album-7' },
        originalContextOrder: 1,
      }).playback,
    ).toBe('buffering');

    // While idle (no active track), state changes do not churn context value.
    mocks.activeItem = null;
    mocks.isPlaying = false;
    mocks.playbackState = 'idle' as PlaybackState;
    const idleFirst = providerValue();
    mocks.playbackState = 'ended' as PlaybackState;
    const idleSecond = providerValue();
    expect(idleSecond).toBe(idleFirst);
  });

  it('accepts caller-owned rolling cache evidence without adding a progress subscription', () => {
    const presentation = providerValue().presentationFor(
      {
        trackId: '42',
        queueContext: { type: 'album', id: 'album-7' },
        originalContextOrder: 1,
      },
      { rollingDeviceCacheSeconds: 75 },
    );

    expect(presentation.rollingDeviceCache).toEqual({
      kind: 'rolling-lru',
      seconds: 75,
    });
  });

  it('treats a query failure without last-good data as unknown, never not-cached', () => {
    mocks.queryData = undefined;
    mocks.queryError = new Error('network unavailable');

    expect(providerValue().presentationFor({ trackId: '42' }).serverCache).toBe('unknown');
  });

  it('does not infer an absent download before native hydration completes', () => {
    mocks.offlineSnapshot = {
      hydrated: false,
      downloadedTrackIds: new Set(),
    };

    expect(providerValue().presentationFor({ trackId: '42' }).explicitDownload).toEqual({
      kind: 'unknown',
    });
  });

  it('retains exact cached membership when a refresh fails over last-good data', () => {
    mocks.queryData = { ids: ['42'] };
    mocks.queryError = new Error('refresh failed');

    expect(providerValue().presentationFor({ trackId: '42' }).serverCache).toBe('cached');
    expect(providerValue().presentationFor({ trackId: '99' }).serverCache).toBe('not-cached');
  });

  it('degrades malformed active queue metadata to the documented id fallback', () => {
    mocks.activeItem = activeMediaItem({
      extras: {
        track: { id: '42' },
        queueContextType: 'album',
        queueContextId: null,
        queueOriginalContextOrder: 'first',
      },
    });

    expect(
      providerValue().presentationFor({
        trackId: '42',
        queueContext: { type: 'album', id: 'album-7' },
        originalContextOrder: 1,
      }).active,
    ).toBe(true);
  });
});

describe('useTrackPresentation', () => {
  it('delegates to the single provider value', () => {
    const presentationFor = vi.fn(() => ({
      active: false,
      playback: 'inactive' as const,
      serverCache: 'unknown' as const,
      rollingDeviceCache: null,
      explicitDownload: { kind: 'unknown' as const },
    }));
    mocks.contextValue = { presentationFor };

    expect(useTrackPresentation({ trackId: '7' })).toMatchObject({
      playback: 'inactive',
    });
    expect(presentationFor).toHaveBeenCalledExactlyOnceWith({ trackId: '7' }, undefined);
  });

  it('fails loudly when a consumer is mounted outside the provider', () => {
    mocks.contextValue = null;
    expect(() => useTrackPresentation({ trackId: '7' })).toThrow(
      'useTrackPresentation must be used within TrackPresentationProvider',
    );
  });
});
