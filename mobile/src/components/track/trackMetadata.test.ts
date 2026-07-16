import { describe, expect, it } from 'vitest';
import type { RecentPlay, Track } from '../../api/types';
import {
  buildTrackMetadata,
  formatTrackDuration,
  trackPopularityPercent,
} from './trackMetadata';

const track: Track = {
  id: '3135556',
  title: 'Harder Better Faster Stronger',
  artist: 'Daft Punk',
  artist_id: 27,
  artists: [{ id: 27, name: 'Daft Punk' }],
  album: 'Discovery',
  album_id: 302127,
  cover: '',
  duration_sec: 224,
  preview_url: null,
  rank: 750_000,
  release_date: '',
};

describe('track metadata model', () => {
  it('builds validated album and occurrence-stable artist destinations', () => {
    const model = buildTrackMetadata({
      ...track,
      artists: [
        { id: 27, name: 'Daft Punk' },
        { id: 0, name: 'Legacy Guest' },
        { id: '00042', name: 'Pharrell Williams' },
        { id: 27, name: 'Daft Punk' },
      ],
    });

    expect(model.albumRoute).toEqual({ albumId: '302127', title: 'Discovery' });
    expect(model.artists.map(({ key, name, route }) => ({ key, name, route }))).toEqual([
      {
        key: 'artist-credit-0',
        name: 'Daft Punk',
        route: { artistId: '27', name: 'Daft Punk' },
      },
      { key: 'artist-credit-1', name: 'Legacy Guest', route: null },
      {
        key: 'artist-credit-2',
        name: 'Pharrell Williams',
        route: { artistId: '00042', name: 'Pharrell Williams' },
      },
      {
        key: 'artist-credit-3',
        name: 'Daft Punk',
        route: { artistId: '27', name: 'Daft Punk' },
      },
    ]);
  });

  it('uses primary artist metadata only when the full credit list is empty', () => {
    expect(buildTrackMetadata({ ...track, artists: [] }).artists).toEqual([
      {
        key: 'artist-credit-0',
        index: 0,
        id: 27,
        name: 'Daft Punk',
        route: { artistId: '27', name: 'Daft Punk' },
      },
    ]);
  });

  it('accepts the narrower RecentPlay descriptor without manufacturing rank data', () => {
    const recent: RecentPlay = {
      id: '12',
      title: 'Recent Signal',
      artist: 'Primary Artist',
      artist_id: '7',
      artists: [],
      album: 'History',
      album_id: '9',
      cover: '',
      duration_sec: 185,
    };

    expect(buildTrackMetadata(recent, { popularity: 'search' })).toMatchObject({
      albumRoute: { albumId: '9', title: 'History' },
      duration: '3:05',
      popularity: null,
    });
  });

  it.each([
    ['', null],
    ['   ', null],
    [0, null],
    ['0', null],
    [-1, null],
    ['12.5', null],
    ['artist-12', null],
    ['1'.repeat(33), null],
    [Number.MAX_SAFE_INTEGER + 1, null],
    [12, { albumId: '12', title: 'Discovery' }],
    ['00012', { albumId: '00012', title: 'Discovery' }],
  ] as const)('validates legacy album id %j before publishing a route', (albumId, route) => {
    expect(buildTrackMetadata({ ...track, album_id: albumId }).albumRoute).toEqual(route);
  });

  it('formats only positive finite duration evidence', () => {
    expect(formatTrackDuration(185.9)).toBe('3:05');
    expect(formatTrackDuration(0)).toBeNull();
    expect(formatTrackDuration(-1)).toBeNull();
    expect(formatTrackDuration(Number.NaN)).toBeNull();
    expect(formatTrackDuration(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatTrackDuration('185')).toBeNull();
  });

  it('applies the exact popularity policy for Search, Artist Popular, and Import', () => {
    expect(buildTrackMetadata(track, {
      popularity: 'search',
      plays: { plays: 12_345, listeners: 6_789 },
    }).popularity).toEqual({ kind: 'plays', plays: 12_345, listeners: 6_789 });

    expect(buildTrackMetadata(track, {
      popularity: 'search',
      plays: { plays: 0, listeners: 4 },
    }).popularity).toEqual({ kind: 'rank', rank: 750_000, percent: 75 });

    expect(buildTrackMetadata(track, {
      popularity: 'artist-popular',
      plays: { plays: 0, listeners: 4 },
    }).popularity).toBeNull();
    expect(buildTrackMetadata(track, { popularity: 'artist-popular' }).popularity).toBeNull();
    expect(buildTrackMetadata(track, {
      popularity: 'artist-popular',
      plays: { plays: 5, listeners: 2 },
    }).popularity).toEqual({ kind: 'plays', plays: 5, listeners: 2 });

    expect(buildTrackMetadata(track, {
      popularity: 'none',
      plays: { plays: 12_345, listeners: 6_789 },
    }).popularity).toBeNull();
  });

  it('bounds positive Deezer rank and hides absent or corrupt rank', () => {
    expect(trackPopularityPercent(1)).toBe(2);
    expect(trackPopularityPercent(750_000)).toBe(75);
    expect(trackPopularityPercent(2_000_000)).toBe(100);
    expect(trackPopularityPercent(0)).toBeNull();
    expect(trackPopularityPercent(-1)).toBeNull();
    expect(trackPopularityPercent(Number.NaN)).toBeNull();
  });
});
