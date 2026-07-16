import { describe, expect, it } from 'vitest';
import { resolveQueueSnapshotVisualState } from './queueSnapshotState';

describe('native queue snapshot visual state', () => {
  it('keeps first load, first failure, successful empty, and content exclusive', () => {
    expect(resolveQueueSnapshotVisualState({
      hasSnapshot: false,
      empty: true,
      refreshing: false,
      error: null,
    })).toEqual({ body: 'loading', notice: null });
    expect(resolveQueueSnapshotVisualState({
      hasSnapshot: false,
      empty: true,
      refreshing: false,
      error: new Error('native bridge failed'),
    })).toEqual({ body: 'hard-error', notice: null });
    expect(resolveQueueSnapshotVisualState({
      hasSnapshot: true,
      empty: true,
      refreshing: false,
      error: null,
    })).toEqual({ body: 'empty', notice: null });
    expect(resolveQueueSnapshotVisualState({
      hasSnapshot: true,
      empty: false,
      refreshing: false,
      error: null,
    })).toEqual({ body: 'content', notice: null });
  });

  it('retains last-good content or known-empty state during refresh and failure', () => {
    expect(resolveQueueSnapshotVisualState({
      hasSnapshot: true,
      empty: false,
      refreshing: true,
      error: null,
    })).toEqual({ body: 'content', notice: 'refreshing' });
    expect(resolveQueueSnapshotVisualState({
      hasSnapshot: true,
      empty: false,
      refreshing: false,
      error: new Error('later read failed'),
    })).toEqual({ body: 'content', notice: 'cached-refresh-error' });
    expect(resolveQueueSnapshotVisualState({
      hasSnapshot: true,
      empty: true,
      refreshing: false,
      error: new Error('later read failed'),
    })).toEqual({ body: 'empty', notice: 'cached-refresh-error' });
  });
});
