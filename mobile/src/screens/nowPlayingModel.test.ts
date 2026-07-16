import { describe, expect, it } from 'vitest';
import { resolveNowPlayingBody } from './nowPlayingModel';

describe('Now Playing body state', () => {
  it('does not call cold native-player hydration an empty queue', () => {
    expect(resolveNowPlayingBody(false, false)).toBe('loading');
    expect(resolveNowPlayingBody(true, false)).toBe('empty');
    expect(resolveNowPlayingBody(true, true)).toBe('content');
  });
});
