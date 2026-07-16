import { describe, expect, it } from 'vitest';
import type { LyricsLine, LyricsResponse } from '../api/types';
import {
  activeLyricIndex,
  lyricLineKey,
  lyricsFollowTarget,
  lyricsSourceKind,
  resolveLyricsVisualState,
} from './lyricsModel';

const lines: LyricsLine[] = [
  { t: 10, text: 'First' },
  { t: 20, text: 'Second' },
  { t: 30, text: 'Third' },
];

const response = (overrides: Partial<LyricsResponse> = {}): LyricsResponse => ({
  lines,
  synced: true,
  source: 'lrclib',
  ai_generated: false,
  ...overrides,
});

describe('lyrics timing model', () => {
  it('matches the web 150 ms lead at every active-line boundary', () => {
    expect(activeLyricIndex(lines, 9.84)).toBe(-1);
    expect(activeLyricIndex(lines, 9.85)).toBe(0);
    expect(activeLyricIndex(lines, 10)).toBe(0);
    expect(activeLyricIndex(lines, 19.84)).toBe(0);
    expect(activeLyricIndex(lines, 19.85)).toBe(1);
    expect(activeLyricIndex(lines, 35)).toBe(2);
  });

  it('fails closed for invalid player positions and handles empty lines', () => {
    expect(activeLyricIndex(lines, -1)).toBe(-1);
    expect(activeLyricIndex(lines, Number.NaN)).toBe(-1);
    expect(activeLyricIndex(lines, Number.POSITIVE_INFINITY)).toBe(-1);
    expect(activeLyricIndex([], 100)).toBe(-1);
  });

  it('positions a replacement track without animation, then follows smoothly', () => {
    expect(
      lyricsFollowTarget(
        { trackId: 'old-track', activeIndex: 2 },
        { trackId: 'new-track', activeIndex: 2 },
      ),
    ).toEqual({ index: 2, animated: false });
    expect(
      lyricsFollowTarget(
        { trackId: 'new-track', activeIndex: 2 },
        { trackId: 'new-track', activeIndex: 3 },
      ),
    ).toEqual({ index: 3, animated: true });
    expect(
      lyricsFollowTarget(
        { trackId: 'new-track', activeIndex: 3 },
        { trackId: 'new-track', activeIndex: 3 },
      ),
    ).toBeNull();
    expect(
      lyricsFollowTarget(
        { trackId: 'old-track', activeIndex: 3 },
        { trackId: 'new-track', activeIndex: -1 },
      ),
    ).toBeNull();
  });
});

describe('lyrics query presentation model', () => {
  it('separates initial loading, hard error, empty, and content', () => {
    expect(resolveLyricsVisualState({
      data: undefined, error: null, isPending: true, isFetching: true,
      isStale: true, fetchStatus: 'fetching',
    })).toEqual({ body: 'loading', notice: null });
    expect(resolveLyricsVisualState({
      data: undefined, error: new Error('server'), isPending: false, isFetching: false,
      isStale: true, fetchStatus: 'idle',
    })).toEqual({ body: 'hard-error', notice: null });
    expect(resolveLyricsVisualState({
      data: response({ lines: null }), error: null, isPending: false, isFetching: false,
      isStale: false, fetchStatus: 'idle',
    })).toEqual({ body: 'empty', notice: null });
    expect(resolveLyricsVisualState({
      data: response(), error: null, isPending: false, isFetching: false,
      isStale: false, fetchStatus: 'idle',
    })).toEqual({ body: 'content', notice: null });
  });

  it('distinguishes offline from a server failure before and after cache hydration', () => {
    expect(resolveLyricsVisualState({
      data: undefined, error: { status: 0 }, isPending: false, isFetching: false,
      isStale: true, fetchStatus: 'idle',
    })).toEqual({ body: 'offline', notice: null });
    expect(resolveLyricsVisualState({
      data: undefined, error: null, isPending: false, isFetching: false,
      isStale: true, fetchStatus: 'paused',
    })).toEqual({ body: 'offline', notice: null });
    expect(resolveLyricsVisualState({
      data: response(), error: null, isPending: false, isFetching: false,
      isStale: true, fetchStatus: 'paused',
    })).toEqual({ body: 'content', notice: 'cached-offline' });
  });

  it('keeps last-good content and known-empty results during refresh/error', () => {
    expect(resolveLyricsVisualState({
      data: response(), error: null, isPending: false, isFetching: true,
      isStale: true, fetchStatus: 'fetching',
    })).toEqual({ body: 'content', notice: 'refreshing' });
    expect(resolveLyricsVisualState({
      data: response(), error: new Error('refresh failed'), isPending: false, isFetching: false,
      isStale: true, fetchStatus: 'idle',
    })).toEqual({ body: 'content', notice: 'cached-refresh-error' });
    expect(resolveLyricsVisualState({
      data: response({ lines: [] }), error: new Error('refresh failed'), isPending: false, isFetching: false,
      isStale: true, fetchStatus: 'idle',
    })).toEqual({ body: 'empty', notice: 'cached-refresh-error' });
  });

  it('labels last-good non-refreshing lyrics as stale', () => {
    expect(resolveLyricsVisualState({
      data: response(), error: null, isPending: false, isFetching: false,
      isStale: true, fetchStatus: 'idle',
    })).toEqual({ body: 'content', notice: 'stale' });
  });

  it('maps provider identifiers without exposing arbitrary backend text', () => {
    expect(lyricsSourceKind(' lrclib ')).toBe('lrclib');
    expect(lyricsSourceKind('groq-word-v1')).toBe('loggerythm-ai');
    expect(lyricsSourceKind('groq')).toBe('loggerythm-ai');
    expect(lyricsSourceKind('provider stack trace secret')).toBe('external');
    expect(lyricsSourceKind(null)).toBeNull();
    expect(lyricLineKey(lines[0], 4)).toBe('10:4');
  });
});
