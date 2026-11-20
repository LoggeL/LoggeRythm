import { describe, expect, it } from 'vitest';
import type { Track } from '../api/types';
import {
  ARTIST_TRACK_SECTION_ORDER,
  artistLikedSectionVisible,
  artistLikedTracksExpandable,
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

const settledLikes = {
  hasData: true,
  isPending: false,
  isFetching: false,
  isStale: false,
  fetchStatus: 'idle' as const,
  error: null,
};

describe('Artist virtualized track-list model', () => {
  it('puts the liked block first, then Popular and Search, with exact playback indexes', () => {
    const likedTracks = [track('5'), track('1')];
    const popularTracks = [track('1'), track('2')];
    const searchTracks = [track('3'), track('4')];
    const sections = createArtistTrackListSections({
      liked: { tracks: likedTracks, expanded: true },
      popularTracks,
      searchTracks,
      searchActive: true,
    });

    expect(ARTIST_TRACK_SECTION_ORDER).toEqual(['liked', 'popular', 'search']);
    expect(sections.map((section) => section.id)).toEqual(ARTIST_TRACK_SECTION_ORDER);
    expect(sections[0]?.data.map(({ kind, track: item, index }) => [kind, item.id, index]))
      .toEqual([
        ['liked', '5', 0],
        ['liked', '1', 1],
      ]);
    expect(sections[0]?.data[1]?.track).toBe(likedTracks[1]);
    expect(sections[2]?.data[1]?.track).toBe(searchTracks[1]);
  });

  it('leaves the liked block out entirely, heading included, when the page has none', () => {
    const sections = createArtistTrackListSections({
      liked: null,
      popularTracks: [track('1')],
      searchTracks: [],
      searchActive: false,
    });

    expect(sections.map((section) => section.id)).toEqual(['popular', 'search']);
  });

  it('keeps a row-less liked section so its heading can report a failed likes load', () => {
    const sections = createArtistTrackListSections({
      liked: { tracks: [], expanded: false },
      popularTracks: [track('1')],
      searchTracks: [],
      searchActive: false,
    });

    expect(sections.map((section) => [section.id, section.data.length])).toEqual([
      ['liked', 0],
      ['popular', 1],
      ['search', 0],
    ]);
  });

  it('lists no liked rows while collapsed and every row, in context order, once expanded', () => {
    const likedTracks = Array.from({ length: 8 }, (_, index) => track(`liked-${index}`));
    const collections = { popularTracks: [track('1')], searchTracks: [], searchActive: false };

    const collapsed = createArtistTrackListSections({
      ...collections,
      liked: { tracks: likedTracks, expanded: false },
    });
    expect(collapsed.map((section) => [section.id, section.data.length])).toEqual([
      ['liked', 0],
      ['popular', 1],
      ['search', 0],
    ]);

    const expanded = createArtistTrackListSections({
      ...collections,
      liked: { tracks: likedTracks, expanded: true },
    })[0]!;
    expect(expanded.id).toBe('liked');
    expect(expanded.data.map(({ track: item }) => item)).toEqual(likedTracks);
    expect(expanded.data.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    expect(artistLikedTracksExpandable(0)).toBe(false);
    expect(artistLikedTracksExpandable(1)).toBe(true);
    expect(() => artistLikedTracksExpandable(-1)).toThrow('is not a row count');
  });

  it('shows the liked block for liked tracks or a failed load, never as a loading placeholder', () => {
    const loading = {
      ...settledLikes,
      hasData: false,
      isPending: true,
      isFetching: true,
      fetchStatus: 'fetching' as const,
    };
    // Loading: absent, so no skeleton can collapse to nothing.
    expect(artistLikedSectionVisible(loading, 0)).toBe(false);
    // Known likes: present only with a liked track by this artist.
    expect(artistLikedSectionVisible(settledLikes, 0)).toBe(false);
    expect(artistLikedSectionVisible(settledLikes, 2)).toBe(true);
    // A background refetch or a failed refresh keeps showing the cached rows.
    expect(artistLikedSectionVisible(
      { ...settledLikes, isFetching: true, fetchStatus: 'fetching' },
      2,
    )).toBe(true);
    expect(artistLikedSectionVisible({ ...settledLikes, error: new Error('refresh') }, 2))
      .toBe(true);
    // Never loaded: the failure is reported, not hidden as "nothing liked".
    expect(artistLikedSectionVisible(
      { ...settledLikes, hasData: false, isPending: true, error: new Error('boom') },
      0,
    )).toBe(true);
    expect(artistLikedSectionVisible(
      { ...settledLikes, hasData: false, isPending: true, fetchStatus: 'paused' },
      0,
    )).toBe(true);

    expect(() => artistLikedSectionVisible(settledLikes, -1)).toThrow('not a row count');
    expect(() => artistLikedSectionVisible(settledLikes, 1.5)).toThrow('not a row count');
  });

  it('keeps Popular and Search in fixed order with their exact playback indexes', () => {
    const popularTracks = [track('1'), track('2')];
    const searchTracks = [track('3'), track('4')];
    const sections = createArtistTrackListSections({
      liked: null,
      popularTracks,
      searchTracks,
      searchActive: true,
    });

    expect(sections.map((section) => section.id)).toEqual(['popular', 'search']);
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
      liked: null,
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
      liked: { tracks: [duplicate], expanded: true },
      popularTracks: [duplicate, duplicate],
      searchTracks: [duplicate],
      searchActive: true,
    });
    const keys = sections.flatMap((section) => section.data.map(artistTrackListItemKey));

    expect(new Set(keys).size).toBe(4);
    expect(keys).toEqual([
      'artist-track:liked:same%2Fid:0',
      'artist-track:popular:same%2Fid:0',
      'artist-track:popular:same%2Fid:1',
      'artist-track:search:same%2Fid:0',
    ]);
    expect(artistTrackListItemKey(sections[0]!.data[0]!)).toBe(keys[0]);
    expect(artistTrackListItemKey(sections[1]!.data[0]!)).toBe(keys[1]);
  });
});
