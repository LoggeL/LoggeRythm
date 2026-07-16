import { describe, expect, it } from 'vitest';
import {
  authoritativeQueueTrackPresentation,
  formatQueueSeconds,
  queueMetadataFacts,
  queueRowMetadata,
  resolveQueueMetadataVisualState,
} from './queueMetadata';

const copy = {
  duration: (value: string) => `Duration ${value}`,
  deviceCache: (value: string) => `Device cache ${value}`,
  serverCached: 'Stored on the server',
};

describe('queue row metadata', () => {
  it('lets native queue index defeat an id-only duplicate match', () => {
    const presentation = {
      active: true,
      playback: 'playing' as const,
      serverCache: 'cached' as const,
      rollingDeviceCache: { kind: 'rolling-lru' as const, seconds: 40 },
      explicitDownload: { kind: 'unknown' as const },
    };

    expect(authoritativeQueueTrackPresentation(presentation, false)).toEqual({
      ...presentation,
      active: false,
      playback: 'inactive',
      rollingDeviceCache: null,
    });
    expect(authoritativeQueueTrackPresentation(presentation, true)).toBe(presentation);
  });

  it('formats duration and positive active-track rolling cache evidence', () => {
    const metadata = queueRowMetadata({
      durationSeconds: 185.9,
      serverCached: true,
      active: true,
      activeCachedSeconds: 61.8,
    });

    expect(metadata).toEqual({
      duration: '3:05',
      deviceCache: '1:01',
      serverCached: true,
    });
    const facts = queueMetadataFacts(metadata, copy);
    expect(facts).toEqual([
      'Duration 3:05',
      'Device cache 1:01',
      'Stored on the server',
    ]);
    expect(facts.join(' ')).not.toMatch(/download/i);
  });

  it('never attributes rolling cache progress to an inactive queue row', () => {
    expect(
      queueRowMetadata({
        durationSeconds: 90,
        serverCached: false,
        active: false,
        activeCachedSeconds: 45,
      }),
    ).toEqual({ duration: '1:30', deviceCache: null, serverCached: false });
  });

  it('omits unknown native and corrupt duration values instead of inventing state', () => {
    expect(formatQueueSeconds(0)).toBeNull();
    expect(formatQueueSeconds(Number.NaN)).toBeNull();
    expect(formatQueueSeconds('120')).toBeNull();
    expect(
      queueMetadataFacts(
        queueRowMetadata({
          durationSeconds: undefined,
          serverCached: false,
          active: true,
          activeCachedSeconds: 0,
        }),
        copy,
      ),
    ).toEqual([]);
  });

  it('keeps optional server-cache metadata failures separate from queue content', () => {
    expect(resolveQueueMetadataVisualState({
      hasData: false,
      empty: false,
      pending: true,
      fetching: true,
      stale: true,
      fetchStatus: 'fetching',
      error: null,
    })).toEqual({ body: 'loading', notice: null });
    expect(resolveQueueMetadataVisualState({
      hasData: false,
      empty: false,
      pending: false,
      fetching: false,
      stale: true,
      fetchStatus: 'paused',
      error: null,
    })).toEqual({ body: 'offline', notice: null });
    expect(resolveQueueMetadataVisualState({
      hasData: true,
      empty: false,
      pending: false,
      fetching: false,
      stale: true,
      fetchStatus: 'idle',
      error: new Error('refresh failed'),
    })).toEqual({ body: 'content', notice: 'cached-refresh-error' });
  });
});
