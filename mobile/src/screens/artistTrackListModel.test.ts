import { describe, expect, it } from 'vitest';
import type { Track } from '../api/types';
import {
  ARTIST_TRACK_SECTION_ORDER,
  artistTrackListItemKey,
  createArtistTrackListSections,
} from './artistTrackListModel';

function track(id: string, title = `Track ${id}`): Track {
  return {
    id,
    title,
    artist: 'Artist',
    artist_id: '9',
    artists: [{ id: '9', name: 'Artist' }],
    album: 'Album',
    album_id: '7',
    cover: '',
    duration_sec: 180,
    preview_url: null,
    rank: 1,
    release_date: '2026-07-15',
  };
}

describe('Artist virtualized track-list model', () => {
  it('keeps Popular and Search in fixed order with their exact playback indexes', () => {
    const popularTracks = [track('1'), track('2')];
    const searchTracks = [track('3'), track('4')];
    const sections = createArtistTrackListSections({
      popularTracks,
      searchTracks,
      searchActive: true,
    });

    expect(sections.map((section) => section.id)).toEqual(ARTIST_TRACK_SECTION_ORDER);
    expect(sections[0]?.data.map(({ track: item, index }) => [item.id, index])).toEqual([
      ['1', 0],
      ['2', 1],
    ]);
    expect(sections[1]?.data.map(({ track: item, index }) => [item.id, index])).toEqual([
      ['3', 0],
      ['4', 1],
    ]);
    expect(sections[0]?.data[0]?.track).toBe(popularTracks[0]);
    expect(sections[1]?.data[1]?.track).toBe(searchTracks[1]);
  });

  it('hides retained search data whenever there is no active normalized query', () => {
    const sections = createArtistTrackListSections({
      popularTracks: [track('1')],
      searchTracks: [track('retained')],
      searchActive: false,
    });

    expect(sections[0]?.data).toHaveLength(1);
    expect(sections[1]?.data).toEqual([]);
  });

  it('creates stable, section-scoped keys for duplicate and punctuation-heavy ids', () => {
    const duplicate = track('same/id');
    const sections = createArtistTrackListSections({
      popularTracks: [duplicate, duplicate],
      searchTracks: [duplicate],
      searchActive: true,
    });
    const keys = sections.flatMap((section) => section.data.map(artistTrackListItemKey));

    expect(new Set(keys).size).toBe(3);
    expect(keys).toEqual([
      'artist-track:popular:same%2Fid:0',
      'artist-track:popular:same%2Fid:1',
      'artist-track:search:same%2Fid:0',
    ]);
    expect(artistTrackListItemKey(sections[0]!.data[0]!)).toBe(keys[0]);
  });
});
