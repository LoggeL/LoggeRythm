import { describe, expect, it, vi } from 'vitest';
import type { ArtistDetail, GenreDetail, Track } from '../api/types';
import {
  ARTIST_POPULAR_TRACK_LIMIT,
  albumRuntimeMinutes,
  artistHasContent,
  artistPopularTracks,
  artistSongSearchQuery,
  artistSummary,
  artistTrackPlaybackContextId,
  artistTrackPlayMetadata,
  assertAlbumScreenContract,
  assertDiscoverRouteCallbacks,
  assertTrackCatalogRouteCallbacks,
  catalogTestIdSegment,
  filterArtistTracks,
  followingValue,
  genreHasContent,
  playbackSelection,
  releaseYear,
  requireCatalogId,
  withFollowingValue,
} from './catalogModel';

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
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
});

describe('catalog screen model', () => {
  it('preserves exact ordered playback context including duplicate ids', () => {
    const tracks = [track('1'), track('1'), track('2')];
    const selected = playbackSelection(tracks, 1);

    expect(selected.tracks).toBe(tracks);
    expect(selected.tracks.map((item) => item.id)).toEqual(['1', '1', '2']);
    expect(selected.startIndex).toBe(1);
  });

  it('matches the production ten-row popular context without truncating hero playback', () => {
    const complete = Array.from({ length: 12 }, (_, index) => track(String(index + 1)));
    const popular = artistPopularTracks(complete);

    expect(ARTIST_POPULAR_TRACK_LIMIT).toBe(10);
    expect(popular.map((item) => item.id)).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    ]);
    expect(playbackSelection(popular, 9).tracks).toBe(popular);
    expect(playbackSelection(complete, 11).tracks).toBe(complete);
    expect(complete).toHaveLength(12);
  });

  it('keeps Artist Popular and Song Search occurrence contexts distinct', () => {
    expect(artistTrackPlaybackContextId(' 42 ', 'popular')).toBe('42');
    expect(artistTrackPlaybackContextId(' 42 ', 'search', '  midnight signal  ')).toBe(
      '42:search:midnight signal',
    );
    expect(() => artistTrackPlaybackContextId('42', 'search', '   ')).toThrow(
      'requires a query',
    );
  });

  it('builds artist-scoped advanced search and preserves only matching ordered rows', () => {
    expect(artistSongSearchQuery('  The Artist ', ' signal  ')).toBe(
      'artist:"The Artist" track:"signal"',
    );
    expect(artistSongSearchQuery('The Artist', '   ')).toBeNull();

    const byPrimaryId = { ...track('1'), artist_id: 42, artist: 'Alias' };
    const byCreditId = {
      ...track('2'),
      artist_id: '8',
      artist: 'Guest',
      artists: [{ id: '42', name: 'The Artist' }],
    };
    const byLegacyName = {
      ...track('3'),
      artist_id: '8',
      artist: 'The Artist feat. Guest',
      artists: [],
    };
    const noise = { ...track('4'), artist_id: '8', artist: 'Different', artists: [] };
    const duplicate = { ...byPrimaryId };

    expect(
      filterArtistTracks(
        [byPrimaryId, noise, byCreditId, byLegacyName, duplicate],
        '42',
        'The Artist',
      ).map((item) => item.id),
    ).toEqual(['1', '2', '3', '1']);
  });

  it('shows only evidence-backed positive Last.fm play totals', () => {
    const format = vi.fn((plays: number, listeners: number) => `${plays}/${listeners}`);

    expect(artistTrackPlayMetadata(undefined, format)).toBeUndefined();
    expect(artistTrackPlayMetadata({ plays: 0, listeners: 4 }, format)).toBeUndefined();
    expect(artistTrackPlayMetadata({ plays: 12, listeners: 4 }, format)).toBe('12/4');
    expect(format).toHaveBeenCalledTimes(1);
  });

  it('rejects empty and out-of-bounds playback contexts', () => {
    expect(() => playbackSelection([], 0)).toThrow('at least one track');
    expect(() => playbackSelection([track('1')], 1)).toThrow('outside a 1-track context');
    expect(() => playbackSelection([track('1')], 0.5)).toThrow('start index 0.5');
  });

  it('normalizes route ids and fails loudly for missing route contracts', () => {
    expect(requireCatalogId(' 42 ', 'artist id')).toBe('42');
    expect(() => requireCatalogId(' ', 'artist id')).toThrow('artist id must not be empty');
    expect(() => assertDiscoverRouteCallbacks({})).toThrow('onOpenPlaylist');
    expect(() =>
      assertAlbumScreenContract({
        albumId: '1',
        onOpenAlbum: vi.fn(),
        onOpenArtist: null as never,
      }),
    ).toThrow('onOpenArtist');
    expect(() =>
      assertTrackCatalogRouteCallbacks({ onOpenAlbum: vi.fn() }, 'RadarScreen'),
    ).toThrow('RadarScreen requires onOpenAlbum and onOpenArtist');
  });

  it('accepts complete route callback contracts', () => {
    const callbacks = {
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      onOpenGenre: vi.fn(),
      onOpenPlaylist: vi.fn(),
    };
    expect(() => assertDiscoverRouteCallbacks(callbacks)).not.toThrow();
  });

  it('reads and immutably updates strict follow maps', () => {
    const original = { '1': true, '2': false };
    expect(followingValue(original, '1')).toBe(true);
    expect(followingValue(original, '2')).toBe(false);
    expect(followingValue(undefined, '3')).toBe(false);
    expect(withFollowingValue(original, '2', true)).toEqual({ '1': true, '2': true });
    expect(original).toEqual({ '1': true, '2': false });
  });

  it('projects only the repository follow payload from artist detail', () => {
    const detail: ArtistDetail = {
      id: '9',
      name: 'Artist',
      picture: 'artist.jpg',
      fans: 10,
      albums_count: 2,
      top: [track('1')],
      albums: [],
      related: [],
    };
    expect(artistSummary(detail)).toEqual({ id: '9', name: 'Artist', picture: 'artist.jpg' });
    expect(artistHasContent(detail)).toBe(true);
  });

  it('derives detail emptiness across every production section', () => {
    const genre: GenreDetail = {
      id: '1',
      name: 'Genre',
      picture: '',
      tracks: [],
      albums: [],
      artists: [],
    };
    expect(genreHasContent(genre)).toBe(false);
    expect(genreHasContent({ ...genre, tracks: [track('1')] })).toBe(true);
  });

  it('creates stable ids and only accepts exact backend release dates', () => {
    expect(catalogTestIdSegment('  New / Release  ')).toBe('new-release');
    expect(catalogTestIdSegment('***')).toBe('item');
    expect(releaseYear('2026-07-15')).toBe('2026');
    expect(releaseYear('2026')).toBe('2026');
    expect(releaseYear('July 2026')).toBeNull();
  });

  it('matches the production album runtime rounding and rejects corrupt durations', () => {
    expect(albumRuntimeMinutes([])).toBeNull();
    expect(albumRuntimeMinutes([{ ...track('1'), duration_sec: 1 }])).toBe(0);
    expect(
      albumRuntimeMinutes([
        { ...track('1'), duration_sec: 3600 },
        { ...track('2'), duration_sec: 1850 },
      ]),
    ).toBe(91);
    expect(() =>
      albumRuntimeMinutes([{ ...track('bad'), duration_sec: Number.NaN }]),
    ).toThrow('invalid duration');
  });
});
