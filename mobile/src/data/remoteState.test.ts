import { describe, expect, it } from 'vitest';
import {
  isRemoteOffline,
  resolveRemoteVisualState,
  type RemoteVisualStateInput,
} from './remoteState';

const base: RemoteVisualStateInput = {
  hasData: false,
  empty: false,
  pending: true,
  fetching: true,
  stale: true,
  fetchStatus: 'fetching',
  error: null,
};

describe('shared remote visual state', () => {
  it('distinguishes paused and transport-offline failures from server errors', () => {
    expect(isRemoteOffline(null, 'paused')).toBe(true);
    expect(isRemoteOffline({ status: 0 }, 'idle')).toBe(true);
    expect(isRemoteOffline({ status: 503 }, 'idle')).toBe(false);
    expect(isRemoteOffline(new Error('unknown'), 'idle')).toBe(false);
  });

  it.each([
    ['never-loaded', {}, { body: 'loading', notice: null }],
    ['blocking offline', { fetchStatus: 'paused' }, { body: 'offline', notice: null }],
    ['blocking transport failure', { error: { status: 0 } }, { body: 'offline', notice: null }],
    ['blocking server failure', { error: new Error('server') }, { body: 'hard-error', notice: null }],
    [
      'successful empty',
      { hasData: true, empty: true, pending: false, fetching: false, stale: false, fetchStatus: 'idle' },
      { body: 'empty', notice: null },
    ],
    [
      'content',
      { hasData: true, pending: false, fetching: false, stale: false, fetchStatus: 'idle' },
      { body: 'content', notice: null },
    ],
    [
      'cached offline',
      { hasData: true, pending: false, fetchStatus: 'paused' },
      { body: 'content', notice: 'cached-offline' },
    ],
    [
      'cached refresh failure',
      { hasData: true, pending: false, error: new Error('refresh') },
      { body: 'content', notice: 'cached-refresh-error' },
    ],
    [
      'refreshing',
      { hasData: true, pending: false, stale: false },
      { body: 'content', notice: 'refreshing' },
    ],
    [
      'stale',
      { hasData: true, pending: false, fetching: false, fetchStatus: 'idle' },
      { body: 'content', notice: 'stale' },
    ],
  ] as const)('resolves %s exclusively', (_label, patch, expected) => {
    expect(resolveRemoteVisualState({ ...base, ...patch })).toEqual(expected);
  });

  it('preserves a last-good empty result under refresh failure', () => {
    expect(resolveRemoteVisualState({
      ...base,
      hasData: true,
      empty: true,
      pending: false,
      error: new Error('refresh'),
    })).toEqual({ body: 'empty', notice: 'cached-refresh-error' });
  });

  it('prioritizes actionable failures over refreshing and stale flags', () => {
    expect(resolveRemoteVisualState({
      ...base,
      hasData: true,
      pending: false,
      error: { status: 0 },
    })).toEqual({ body: 'content', notice: 'cached-offline' });
  });
});
