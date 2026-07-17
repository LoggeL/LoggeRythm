import { describe, expect, it } from 'vitest';
import { trackArtistCredits, trackArtistLabel } from './trackArtists';

describe('track artist presentation', () => {
  it('preserves every ordered performer credit', () => {
    const track = {
      artist: 'Primary',
      artist_id: '1',
      artists: [
        { id: '1', name: 'Primary' },
        { id: '2', name: 'Guest' },
        { id: '3', name: 'Producer' },
      ],
    };

    expect(trackArtistCredits(track)).toBe(track.artists);
    expect(trackArtistLabel(track)).toBe('Primary, Guest, Producer');
  });

  it('uses the explicit primary performer only for legacy empty credit lists', () => {
    const legacy = { artist: 'Primary', artist_id: '1', artists: [] };

    expect(trackArtistCredits(legacy)).toEqual([{ id: '1', name: 'Primary' }]);
    expect(trackArtistLabel(legacy)).toBe('Primary');
  });
});
