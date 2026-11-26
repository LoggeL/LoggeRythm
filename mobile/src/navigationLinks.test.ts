import { describe, expect, it } from 'vitest';
import {
  deezerReferenceIdFromRouteValue,
  mixKeyFromRouteValue,
  playlistIdFromRouteValue,
  safeRouteLabel,
  trackAlbumRoute,
  trackArtistRoute,
} from './navigationLinks';

describe('playlistIdFromRouteValue', () => {
  it.each([
    [17, 17],
    ['17', 17],
    ['17-my-list', 17],
    ['001-name', 1],
  ])('extracts the positive numeric prefix from %s', (value, expected) => {
    expect(playlistIdFromRouteValue(value)).toBe(expected);
  });

  it.each([undefined, null, '', 'name-only', '0-list', '-3-list', '3.5-list', Number.MAX_VALUE])(
    'rejects malformed or unsafe value %s',
    (value) => expect(playlistIdFromRouteValue(value)).toBeNull(),
  );
});

describe('safeRouteLabel', () => {
  it('normalizes a useful label and rejects non-string/blank values', () => {
    expect(safeRouteLabel('  My list  ', 'Playlist')).toBe('My list');
    expect(safeRouteLabel('   ', 'Playlist')).toBe('Playlist');
    expect(safeRouteLabel(42, 'Playlist')).toBe('Playlist');
  });
});

describe('mixKeyFromRouteValue', () => {
  it('keeps one canonical safe path segment and rejects malformed values', () => {
    expect(mixKeyFromRouteValue('  daily-focus  ')).toBe('daily-focus');
    expect(mixKeyFromRouteValue('')).toBeNull();
    expect(mixKeyFromRouteValue('nested/key')).toBeNull();
    expect(mixKeyFromRouteValue('key?origin=https://evil.example')).toBeNull();
    expect(mixKeyFromRouteValue(42)).toBeNull();
  });
});

describe('track detail routes', () => {
  it.each([
    [42, '42'],
    [' 302127 ', '302127'],
    ['0007', '0007'],
  ])('normalizes safe Deezer reference %j', (value, expected) => {
    expect(deezerReferenceIdFromRouteValue(value)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    'album/12',
    '12?redirect=evil',
    '12#fragment',
    '1'.repeat(33),
    '１２',
  ])('rejects unsafe Deezer reference %j', (value) => {
    expect(deezerReferenceIdFromRouteValue(value)).toBeNull();
  });

  it('builds typed album and artist params without trusting blank labels', () => {
    expect(trackAlbumRoute({ album_id: 12, album: '  Parity  ' })).toEqual({
      albumId: '12',
      title: 'Parity',
    });
    expect(trackArtistRoute({ artist_id: '42', artist: '  LoggeRythm  ' })).toEqual({
      artistId: '42',
      name: 'LoggeRythm',
    });
    expect(trackAlbumRoute({ album_id: '12', album: '   ' })).toEqual({
      albumId: '12',
      title: undefined,
    });
    expect(trackAlbumRoute({ album_id: '', album: 'Legacy' })).toBeNull();
    expect(trackArtistRoute({ artist_id: 0, artist: 'Legacy' })).toBeNull();
  });
});
