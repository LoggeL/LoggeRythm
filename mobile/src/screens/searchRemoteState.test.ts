import { describe, expect, it } from 'vitest';
import {
  resolveSearchAggregateRemoteState,
  searchRemoteEntry,
  type SearchRemoteQueryLike,
} from './searchRemoteState';

function query(
  patch: Partial<SearchRemoteQueryLike> = {},
): SearchRemoteQueryLike {
  return {
    data: undefined,
    error: null,
    isPending: true,
    isFetching: true,
    isStale: true,
    fetchStatus: 'fetching',
    ...patch,
  };
}

describe('search remote-state composition', () => {
  it('keeps partial cached results visible while another entity loads or fails', () => {
    const tracks = searchRemoteEntry(
      'track',
      query({ data: [{ id: 'track-1' }], isPending: false, isFetching: false, isStale: false, fetchStatus: 'idle' }),
      1,
    );
    const albums = searchRemoteEntry(
      'album',
      query({ error: new Error('albums failed'), isPending: false, isFetching: false, fetchStatus: 'idle' }),
      0,
    );
    const artists = searchRemoteEntry('artist', query(), 0);

    expect(resolveSearchAggregateRemoteState([tracks, albums, artists])).toEqual({
      body: 'content',
      resultCount: 1,
      loadingKeys: ['artist'],
      refreshingKeys: [],
      staleKeys: [],
      issues: [{ key: 'album', kind: 'hard-error', error: new Error('albums failed') }],
    });
  });

  it('only reports empty after every active entity has a successful response', () => {
    const knownEmpty = searchRemoteEntry(
      'track',
      query({ data: [], isPending: false, isFetching: false, isStale: false, fetchStatus: 'idle' }),
      0,
    );
    const pending = searchRemoteEntry('album', query(), 0);

    expect(resolveSearchAggregateRemoteState([knownEmpty, pending]).body).toBe('partial');
    expect(resolveSearchAggregateRemoteState([knownEmpty]).body).toBe('empty');
  });

  it('preserves known-empty and non-empty responses under refresh failures', () => {
    const emptyError = new Error('empty refresh failed');
    const knownEmpty = searchRemoteEntry(
      'track',
      query({ data: [], error: emptyError, isPending: false, isFetching: false, fetchStatus: 'idle' }),
      0,
    );
    const offline = { status: 0, message: 'offline' };
    const cachedContent = searchRemoteEntry(
      'album',
      query({ data: [{ id: 'album-1' }], error: offline, isPending: false, isFetching: false, fetchStatus: 'idle' }),
      1,
    );

    expect(resolveSearchAggregateRemoteState([knownEmpty])).toMatchObject({
      body: 'empty',
      issues: [{ key: 'track', kind: 'cached-refresh-error', error: emptyError }],
    });
    expect(resolveSearchAggregateRemoteState([cachedContent])).toMatchObject({
      body: 'content',
      issues: [{ key: 'album', kind: 'cached-offline', error: offline }],
    });
  });

  it('distinguishes blocking offline/error from loading and stale success', () => {
    const blockedOffline = searchRemoteEntry(
      'track',
      query({ isPending: false, isFetching: false, fetchStatus: 'paused' }),
      0,
    );
    const blockedError = searchRemoteEntry(
      'album',
      query({ error: new Error('server'), isPending: false, isFetching: false, fetchStatus: 'idle' }),
      0,
    );
    expect(resolveSearchAggregateRemoteState([blockedOffline, blockedError])).toMatchObject({
      body: 'blocked',
      issues: [
        { key: 'track', kind: 'offline' },
        { key: 'album', kind: 'hard-error' },
      ],
    });

    const stale = searchRemoteEntry(
      'artist',
      query({ data: [], isPending: false, isFetching: false, fetchStatus: 'idle' }),
      0,
    );
    expect(resolveSearchAggregateRemoteState([stale])).toMatchObject({
      body: 'empty',
      staleKeys: ['artist'],
    });
  });

  it('rejects impossible counts and an empty aggregate', () => {
    expect(() => searchRemoteEntry('track', query(), -1)).toThrow('non-negative integer');
    expect(() => resolveSearchAggregateRemoteState([])).toThrow('at least one active query');
  });
});
