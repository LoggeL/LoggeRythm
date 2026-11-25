import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { filterAndSortPlaylistTracks } from './PlaylistFilterSortBar';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('../ui', () => ({
  ActionButton: 'ActionButton',
  FilterChip: 'FilterChip',
}));

const makeTrack = (
  id: string,
  title: string,
  artist: string,
  durationSec: number,
): Track => ({
  id,
  title,
  artist,
  artist_id: '1',
  artists: [{ id: '1', name: artist }],
  album: 'Album',
  album_id: '10',
  cover: '',
  duration_sec: durationSec,
  preview_url: null,
  rank: 1,
  release_date: '',
});

const tracks: Track[] = [
  makeTrack('1', 'Zebra', 'Beta', 240),
  makeTrack('2', 'Alpha', 'Gamma', 120),
  makeTrack('3', 'Middle', 'Alpha Artist', 180),
];

describe('filterAndSortPlaylistTracks', () => {
  it('filters by title or artist while preserving exact canonical sourceIndex', () => {
    const matches = filterAndSortPlaylistTracks(tracks, 'alpha', 'custom');
    expect(matches.map((row) => [row.track.id, row.sourceIndex])).toEqual([
      ['2', 1],
      ['3', 2],
    ]);
  });

  it('sorts by title, artist, and duration without mutating source order', () => {
    expect(
      filterAndSortPlaylistTracks(tracks, '', 'title').map((row) => row.track.id),
    ).toEqual(['2', '3', '1']);
    expect(
      filterAndSortPlaylistTracks(tracks, '', 'artist').map((row) => row.track.id),
    ).toEqual(['3', '1', '2']);
    expect(
      filterAndSortPlaylistTracks(tracks, '', 'duration').map((row) => row.track.id),
    ).toEqual(['2', '3', '1']);
    expect(tracks.map((track) => track.id)).toEqual(['1', '2', '3']);
  });
});
