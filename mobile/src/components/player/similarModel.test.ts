import { describe, expect, it } from 'vitest';
import type { Track } from '../../api/types';
import { ownsSimilarSeed, similarPlaybackSelection } from './similarModel';

function track(id: string): Track {
  return {
    id,
    title: `Track ${id}`,
    artist: 'Artist',
    artist_id: '10',
    artists: [{ id: '10', name: 'Artist' }],
    album: 'Album',
    album_id: '20',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 0,
    release_date: '',
  };
}

describe('similar playback model', () => {
  it('preserves the complete ordered result and selected index in a finite semantic queue', () => {
    const tracks = [track('a'), track('b'), track('a')];

    const selected = similarPlaybackSelection(
      { id: 'seed-7' },
      tracks,
      1,
      'Ähnliche Titel zu „Seed“',
    );

    expect(selected.tracks).not.toBe(tracks);
    expect(selected.tracks.map(({ id }) => id)).toEqual(['a', 'b', 'a']);
    expect(selected.startIndex).toBe(1);
    expect(selected.options).toEqual({
      radio: false,
      context: {
        type: 'radio',
        id: 'similar:seed-7',
        label: 'Ähnliche Titel zu „Seed“',
      },
    });
  });

  it('rejects empty results, invalid indices, and missing semantic identities', () => {
    expect(() => similarPlaybackSelection({ id: 'seed' }, [], 0, 'Similar')).toThrow(
      'at least one track',
    );
    expect(() => similarPlaybackSelection({ id: 'seed' }, [track('a')], -1, 'Similar'))
      .toThrow('outside a 1-track result');
    expect(() => similarPlaybackSelection({ id: 'seed' }, [track('a')], 1, 'Similar'))
      .toThrow('outside a 1-track result');
    expect(() => similarPlaybackSelection({ id: ' ' }, [track('a')], 0, 'Similar'))
      .toThrow('similar seed id must not be empty');
    expect(() => similarPlaybackSelection({ id: 'seed' }, [track('a')], 0, '  '))
      .toThrow('similar context label must not be empty');
  });

  it('identifies stale rendered ownership exactly', () => {
    expect(ownsSimilarSeed('seed-a', 'seed-a')).toBe(true);
    expect(ownsSimilarSeed('seed-a', 'seed-b')).toBe(false);
  });
});
