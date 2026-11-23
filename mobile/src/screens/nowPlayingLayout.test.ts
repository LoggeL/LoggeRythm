import { describe, expect, it } from 'vitest';
import {
  NOW_PLAYING_MAX_ARTWORK_SIZE,
  NOW_PLAYING_TV_MAX_ARTWORK_SIZE,
  nowPlayingArtworkSize,
  nowPlayingTvArtworkSize,
} from './nowPlayingLayout';

describe('Now Playing responsive artwork bounds', () => {
  it('uses the available content width on a portrait phone', () => {
    expect(nowPlayingArtworkSize(360, 800)).toBe(304);
  });

  it('shrinks for a short landscape window so controls can scroll below it', () => {
    expect(nowPlayingArtworkSize(800, 360)).toBeCloseTo(151.2);
  });

  it('caps tablet artwork and never exceeds a very narrow viewport', () => {
    expect(nowPlayingArtworkSize(1000, 1200)).toBe(NOW_PLAYING_MAX_ARTWORK_SIZE);
    expect(nowPlayingArtworkSize(120, 200)).toBe(64);
  });

  it('fails closed for non-finite dimensions', () => {
    expect(nowPlayingArtworkSize(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
    expect(nowPlayingTvArtworkSize(Number.NaN, 540)).toBe(0);
  });

  it('sizes 16:9 Android TV artwork cleanly for TvShellLayout content area and 4K canvases', () => {
    // 960x540dp TV -> TvShellLayout contentWidth 652dp, overscan-adjusted height 486dp
    expect(nowPlayingTvArtworkSize(652, 486)).toBe(155);
    expect(nowPlayingTvArtworkSize(1380, 972)).toBe(NOW_PLAYING_TV_MAX_ARTWORK_SIZE);
  });
});
