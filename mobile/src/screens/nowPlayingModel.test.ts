import { describe, expect, it } from 'vitest';
import { adjacentNowPlayingTab, resolveNowPlayingBody } from './nowPlayingModel';

describe('Now Playing body state', () => {
  it('does not call cold native-player hydration an empty queue', () => {
    expect(resolveNowPlayingBody(false, false)).toBe('loading');
    expect(resolveNowPlayingBody(true, false)).toBe('empty');
    expect(resolveNowPlayingBody(true, true)).toBe('content');
  });

  it('moves between adjacent fullscreen tabs without wrapping', () => {
    expect(adjacentNowPlayingTab('playing', 'next')).toBe('lyrics');
    expect(adjacentNowPlayingTab('lyrics', 'next')).toBe('similar');
    expect(adjacentNowPlayingTab('similar', 'next')).toBe('queue');
    expect(adjacentNowPlayingTab('queue', 'next')).toBe('queue');
    expect(adjacentNowPlayingTab('queue', 'previous')).toBe('similar');
    expect(adjacentNowPlayingTab('playing', 'previous')).toBe('playing');
  });
});
