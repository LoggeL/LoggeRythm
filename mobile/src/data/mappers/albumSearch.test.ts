import { describe, expect, it } from 'vitest';
import type { AlbumSearchWire } from './albumSearch';
import {
  AlbumSearchDomainMappingError,
  mapAlbumSearchWire,
} from './albumSearch';

describe('album search wire-to-domain mapping', () => {
  it('canonicalizes a numeric legacy album id and prefers album metadata', () => {
    const wire = {
      id: '11',
      title: 'Track title',
      album_id: 42,
      album: '  Album title  ',
      artist: '  Artist  ',
      cover: '  https://img.test/cover.jpg  ',
      duration_sec: 180,
      preview_url: null,
      rank: 900_000,
      release_date: '2026-01-01',
    } satisfies AlbumSearchWire;

    expect(mapAlbumSearchWire(wire)).toStrictEqual({
      id: '42',
      title: 'Album title',
      artistName: 'Artist',
      artworkUrl: 'https://img.test/cover.jpg',
    });
  });

  it('falls back to the track projection identity and title for legacy rows', () => {
    const wire = {
      id: '11',
      title: '  Fallback album  ',
      album_id: '',
      album: '',
    } satisfies AlbumSearchWire;

    expect(mapAlbumSearchWire(wire)).toStrictEqual({
      id: '11',
      title: 'Fallback album',
      artistName: '',
      artworkUrl: null,
    });
    expect(mapAlbumSearchWire({ ...wire, album_id: '   ' })).toMatchObject({ id: '11' });
  });

  it('normalizes absent or empty optional artwork to null', () => {
    expect(mapAlbumSearchWire({ id: '1', title: 'One' })).toMatchObject({ artworkUrl: null });
    expect(mapAlbumSearchWire({ id: '2', title: 'Two', cover: '   ' })).toMatchObject({
      artworkUrl: null,
    });
  });

  it('reports the exact path for missing album identity and title', () => {
    for (const [wire, path] of [
      [{ id: '', title: 'Album' }, 'Search.albums[3].id'],
      [{ id: '3', title: '', album: '  ' }, 'Search.albums[3].title'],
    ] as const) {
      try {
        mapAlbumSearchWire(wire, 'Search.albums[3]');
        throw new Error('Expected mapping to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(AlbumSearchDomainMappingError);
        expect(error).toMatchObject({ path });
      }
    }
    expect(() =>
      mapAlbumSearchWire({ id: '   ', title: 'Album' }, 'Search.albums[4]'),
    ).toThrow('Search.albums[4].id: has no usable album identity');
  });

  it('rejects a malformed non-empty legacy id instead of silently falling back', () => {
    expect(() =>
      mapAlbumSearchWire({ id: '3', title: 'Album', album_id: 'not-an-id' }),
    ).toThrow('searchAlbums.album_id: must be a digit-only Deezer ID');
  });

  it('does not leak Track-only transport fields into the domain card', () => {
    const card = mapAlbumSearchWire({
      id: '11',
      title: 'Track',
      album_id: '42',
      album: 'Album',
      artist_id: '7',
      duration_sec: 180,
      preview_url: null,
      rank: 99,
      release_date: '2026-01-01',
    });

    expect(Object.keys(card).sort()).toEqual(['artistName', 'artworkUrl', 'id', 'title']);
    expect(card).not.toHaveProperty('album_id');
    expect(card).not.toHaveProperty('duration_sec');
    expect(card).not.toHaveProperty('preview_url');
    expect(card).not.toHaveProperty('rank');
    expect(card).not.toHaveProperty('release_date');
  });
});
