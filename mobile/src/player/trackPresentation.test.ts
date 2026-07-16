import type { MediaItem, PlaybackState } from './player';
import { describe, expect, it } from 'vitest';
import {
  activeTrackOccurrenceFromMediaItem,
  matchTrackOccurrence,
  resolveTrackPresentation,
  type ActiveTrackOccurrence,
  type TrackOccurrenceIdentity,
} from './trackPresentation';

const READY = 'ready' as PlaybackState;
const BUFFERING = 'buffering' as PlaybackState;
const ENDED = 'ended' as PlaybackState;

function active(
  trackId = '42',
  contextId = 'album-7',
  order = 3,
): ActiveTrackOccurrence {
  return {
    trackId,
    queueContext: { type: 'album', id: contextId },
    originalContextOrder: order,
  };
}

function target(
  trackId = '42',
  contextId = 'album-7',
  order = 3,
): TrackOccurrenceIdentity {
  return {
    trackId,
    queueContext: { type: 'album', id: contextId },
    originalContextOrder: order,
  };
}

function mediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    mediaId: 'queue:1:3:42',
    url: 'https://music.test/42',
    extras: {
      track: { id: '42' },
      queueContextType: 'album',
      queueContextId: 'album-7',
      queueContextLabel: 'Album Seven',
      queueOriginalContextOrder: 3,
    },
    ...overrides,
  };
}

describe('track occurrence identity', () => {
  it('reads complete product occurrence metadata from the active media item', () => {
    expect(activeTrackOccurrenceFromMediaItem(mediaItem())).toEqual(active());
  });

  it('distinguishes duplicate ids by context and original occurrence order', () => {
    expect(matchTrackOccurrence(target(), active())).toBe('occurrence');
    expect(matchTrackOccurrence(target('42', 'album-7', 2), active())).toBe('none');
    expect(matchTrackOccurrence(target('42', 'album-8', 3), active())).toBe('none');
  });

  it('documents the track-id-only fallback for legacy rows and active items', () => {
    expect(matchTrackOccurrence({ trackId: '42' }, active())).toBe('legacy-track-id');
    expect(
      matchTrackOccurrence(target(), {
        trackId: '42',
        queueContext: null,
        originalContextOrder: null,
      }),
    ).toBe('legacy-track-id');
    expect(matchTrackOccurrence({ trackId: '41' }, active())).toBe('none');
  });

  it('degrades corrupt restored metadata without throwing and rejects browse parent ids', () => {
    const corrupt = mediaItem({
      extras: {
        track: { id: 42 },
        queueContextType: 'album',
        queueContextId: null,
        queueOriginalContextOrder: -1,
      },
    });
    expect(activeTrackOccurrenceFromMediaItem(corrupt)).toEqual({
      trackId: '42',
      queueContext: null,
      originalContextOrder: null,
    });
    expect(
      activeTrackOccurrenceFromMediaItem({
        mediaId: 'playlist:7',
        url: 'https://music.test/not-a-track',
      }),
    ).toBeNull();
  });

  it('recovers supported legacy media ids when extras.track is absent', () => {
    expect(
      activeTrackOccurrenceFromMediaItem({
        mediaId: 'queue:2:0:AC%2FDC',
        url: 'https://music.test/legacy',
      }),
    ).toEqual({
      trackId: 'AC/DC',
      queueContext: null,
      originalContextOrder: null,
    });
  });
});

describe('track presentation resolver', () => {
  const base = {
    target: target(),
    activeOccurrence: active(),
    playbackState: READY,
    isPlaying: false,
    serverCachedTrackIds: new Set(['42']),
    explicitDownloadedTrackIds: new Set(['42']),
  };

  it('prioritizes buffering over the playing flag', () => {
    expect(
      resolveTrackPresentation({
        ...base,
        playbackState: BUFFERING,
        isPlaying: true,
      }),
    ).toMatchObject({ active: true, playback: 'buffering' });
  });

  it('separates playing, paused, active-only, and inactive phases', () => {
    expect(resolveTrackPresentation({ ...base, isPlaying: true }).playback).toBe('playing');
    expect(resolveTrackPresentation(base).playback).toBe('paused');
    expect(
      resolveTrackPresentation({ ...base, playbackState: ENDED }).playback,
    ).toBe('active');
    expect(
      resolveTrackPresentation({ ...base, target: target('99') }).playback,
    ).toBe('inactive');
  });

  it('keeps server cache tri-state and does not infer absence from failure/unknown data', () => {
    expect(resolveTrackPresentation(base).serverCache).toBe('cached');
    expect(
      resolveTrackPresentation({ ...base, serverCachedTrackIds: new Set() }).serverCache,
    ).toBe('not-cached');
    expect(
      resolveTrackPresentation({ ...base, serverCachedTrackIds: null }).serverCache,
    ).toBe('unknown');
  });

  it('exposes positive rolling LRU evidence only for the active occurrence', () => {
    expect(
      resolveTrackPresentation({ ...base, rollingDeviceCacheSeconds: 61.25 }),
    ).toMatchObject({
      rollingDeviceCache: { kind: 'rolling-lru', seconds: 61.25 },
      explicitDownload: { kind: 'downloaded' },
    });
    expect(
      resolveTrackPresentation({
        ...base,
        target: target('99'),
        rollingDeviceCacheSeconds: 61.25,
      }).rollingDeviceCache,
    ).toBeNull();
    expect(
      resolveTrackPresentation({ ...base, rollingDeviceCacheSeconds: 0 })
        .rollingDeviceCache,
    ).toBeNull();
  });

  it('keeps explicit downloads tri-state until the native manifest is hydrated', () => {
    expect(resolveTrackPresentation(base).explicitDownload).toEqual({
      kind: 'downloaded',
    });
    expect(
      resolveTrackPresentation({
        ...base,
        explicitDownloadedTrackIds: new Set(),
      }).explicitDownload,
    ).toEqual({ kind: 'not-downloaded' });
    expect(
      resolveTrackPresentation({
        ...base,
        explicitDownloadedTrackIds: null,
      }).explicitDownload,
    ).toEqual({ kind: 'unknown' });
  });
});
