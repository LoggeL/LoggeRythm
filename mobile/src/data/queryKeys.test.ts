import { describe, expect, it } from 'vitest';
import {
  canonicalDeezerIds,
  normalizeSearchQuery,
  queryKeys,
  trackPlaySignature,
} from './queryKeys';

describe('music query keys', () => {
  it('outer-trims search queries while preserving case, internal whitespace, and scope isolation', () => {
    expect(normalizeSearchQuery('  Daft Punk  ')).toBe('Daft Punk');
    expect(normalizeSearchQuery('  Daft   Punk  ')).toBe('Daft   Punk');
    expect(queryKeys.search.tracks('scope-a', '  Daft Punk  ')).toEqual([
      'music',
      'search',
      'scope',
      'scope-a',
      'track',
      'Daft Punk',
    ]);
    // Case and internal whitespace remain distinct per search cache contract.
    expect(queryKeys.search.tracks('scope-a', 'Daft Punk')).not.toEqual(
      queryKeys.search.tracks('scope-a', 'daft punk'),
    );
    expect(queryKeys.search.tracks('scope-a', 'Daft  Punk')).not.toEqual(
      queryKeys.search.tracks('scope-a', 'Daft Punk'),
    );
    // Different server origins / accounts never share search cache entries.
    expect(queryKeys.search.tracks('https://a.test::user:1', 'daft punk')).not.toEqual(
      queryKeys.search.tracks('https://b.test::user:1', 'daft punk'),
    );
    expect(queryKeys.search.albums('scope-a', 'Daft Punk')).not.toEqual(
      queryKeys.search.tracks('scope-a', 'Daft Punk'),
    );
    expect(() => queryKeys.search.tracks('   ', 'daft')).toThrow('search scope must not be empty');
  });

  it('scopes private discovery, follows, stats, and settings by account', () => {
    expect(queryKeys.home.mixes(7)).not.toEqual(queryKeys.home.mixes(8));
    expect(queryKeys.follows.artists(7)).not.toEqual(queryKeys.follows.artists(8));
    expect(queryKeys.library.likes(7)).not.toEqual(queryKeys.library.likes(8));
    expect(queryKeys.profile.stats(7)).not.toEqual(queryKeys.profile.stats(8));
    expect(queryKeys.profile.wrapped(7, '30d')).toEqual([
      'music',
      'profile',
      'private',
      '7',
      'wrapped',
      '30d',
    ]);
    expect(queryKeys.profile.wrapped(7, '30d')).not.toEqual(
      queryKeys.profile.wrapped(8, '30d'),
    );
    expect(queryKeys.profile.settings(7)).not.toEqual(queryKeys.profile.settings(8));
  });

  it('canonicalizes batch ids so request order cannot fork the cache', () => {
    expect(canonicalDeezerIds(['3', '1', '3', '2'])).toEqual(['1', '2', '3']);
    expect(queryKeys.follows.contains('account', ['3', '1', '3'])).toEqual(
      queryKeys.follows.contains('account', ['1', '3']),
    );
  });

  it('fails loudly for empty identity values', () => {
    expect(() => queryKeys.catalog.album('')).toThrow('album id must not be empty');
    expect(() => queryKeys.catalog.artist('   ')).toThrow('artist id must not be empty');
    expect(() => queryKeys.home.mixes('')).toThrow('home scope must not be empty');
    expect(() => queryKeys.radio.similar('  ')).toThrow('radio seed id must not be empty');
  });

  it('keys similar-track radio results by canonical seed identity', () => {
    expect(queryKeys.radio.root()).toEqual(['music', 'radio']);
    expect(queryKeys.radio.similar('  42  ')).toEqual([
      'music',
      'radio',
      'similar',
      '42',
    ]);
    expect(queryKeys.radio.similar('42')).not.toEqual(queryKeys.radio.similar('43'));
  });

  it('viewer-scopes playlist detail, public shelves, parties, and admin data', () => {
    expect(queryKeys.playlists.detail(7, 4)).not.toEqual(queryKeys.playlists.detail(8, 4));
    expect(queryKeys.playlists.detail(7, 4)).toEqual([...queryKeys.playlists.details(7), '4']);
    expect(queryKeys.playlists.public(7)).not.toEqual(queryKeys.playlists.public('anonymous'));
    expect(queryKeys.party.state(7, 'ABC123')).not.toEqual(
      queryKeys.party.state(8, 'ABC123'),
    );
    expect(queryKeys.admin.status(7)).not.toEqual(queryKeys.admin.status(8));
    expect(queryKeys.admin.usage(7, '7d')).not.toEqual(queryKeys.admin.usage(7, '30d'));
    expect(queryKeys.admin.usage(7, 'all')).not.toEqual(queryKeys.admin.usage(8, 'all'));
    expect(queryKeys.admin.userUsage(7, 2, '30d')).toEqual([
      'music',
      'admin',
      '7',
      'usage-user',
      '2',
      '30d',
    ]);
  });

  it('keys lyrics, imports, cache ids, and play-count request metadata exactly', () => {
    expect(queryKeys.lyrics('Artist', 'Title', '12')).toEqual([
      'music',
      'lyrics',
      'Artist',
      'Title',
      '12',
    ]);
    expect(queryKeys.external.deezerPlaylist('99')).toEqual([
      'music',
      'external',
      'deezer-playlist',
      '99',
    ]);
    expect(queryKeys.storage.cachedTrackIds()).toEqual([
      'music',
      'storage',
      'cached-track-ids',
    ]);
    expect(trackPlaySignature([{ id: '12', artist: 'A', title: 'T' }])).toEqual([
      ['12', 'A', 'T'],
    ]);
    // Reordering (e.g. client-side SearchSort changes) must not fork the play-count cache.
    expect(
      trackPlaySignature([
        { id: '20', artist: 'B', title: 'Beta' },
        { id: '10', artist: 'A', title: 'Alpha' },
        { id: '20', artist: 'B', title: 'Beta' },
      ]),
    ).toEqual([
      ['10', 'A', 'Alpha'],
      ['20', 'B', 'Beta'],
    ]);
  });
});
