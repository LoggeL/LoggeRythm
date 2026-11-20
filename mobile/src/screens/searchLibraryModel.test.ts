import { describe, expect, it } from 'vitest';
import type { Track } from '../api/types';
import {
  collectSearchLibraryTracks,
  createSearchLibraryIndex,
  foldSearchText,
  matchSearchLibrary,
  searchLibraryLimit,
  withoutLibraryTracks,
} from './searchLibraryModel';

const track = (id: string, title: string, overrides: Partial<Track> = {}): Track => ({
  id,
  title,
  artist: 'Artist',
  artist_id: '1',
  artists: [{ id: '1', name: 'Artist' }],
  album: 'Album',
  album_id: '9',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
  ...overrides,
});

const titles = (tracks: readonly Track[]) => tracks.map(({ title }) => title);
const match = (tracks: readonly Track[], input: string) =>
  matchSearchLibrary(createSearchLibraryIndex(tracks), input);

describe('search text folding', () => {
  it('ignores case, diacritics, apostrophes and surrounding whitespace', () => {
    expect(foldSearchText('  Beyoncé  ')).toBe('beyonce');
    expect(foldSearchText('MOTÖRHEAD')).toBe('motorhead');
    expect(foldSearchText('Sigur Rós')).toBe('sigur ros');
    expect(foldSearchText('Don’t  Stop')).toBe('dont stop');
    expect(foldSearchText("Don't Stop")).toBe('dont stop');
  });

  it('folds letters that have no canonical decomposition', () => {
    expect(foldSearchText('Straße')).toBe('strasse');
    expect(foldSearchText('Mø')).toBe('mo');
    expect(foldSearchText('Ænima')).toBe('aenima');
    expect(foldSearchText('Łódź')).toBe('lodz');
  });

  it('treats other punctuation as a word break', () => {
    expect(foldSearchText('AC/DC')).toBe('ac dc');
    expect(foldSearchText('Autobahn (2009 Remaster)')).toBe('autobahn 2009 remaster');
    expect(foldSearchText('Mr. Brightside – Live')).toBe('mr brightside live');
    expect(foldSearchText('…?!')).toBe('');
  });
});

describe('saved track collection', () => {
  it('keeps every saved track once, in likes, own playlists, downloads order', () => {
    const liked = track('1', 'Liked');
    const both = track('2', 'Liked and in a playlist');
    const collected = collectSearchLibraryTracks({
      likes: [liked, both],
      playlists: [
        { is_owner: true, tracks: [track('2', 'Playlist copy'), track('3', 'Playlist only')] },
        { is_owner: true, tracks: [track('3', 'Second playlist copy')] },
      ],
      downloads: [track('3', 'Download copy'), track('4', 'Download only')],
    });

    expect(titles(collected)).toEqual([
      'Liked',
      'Liked and in a playlist',
      'Playlist only',
      'Download only',
    ]);
    expect(collected[0]).toBe(liked);
  });

  it('ignores cached playlists of other users', () => {
    expect(collectSearchLibraryTracks({
      likes: [],
      playlists: [{ is_owner: false, tracks: [track('1', 'Foreign')] }],
      downloads: [],
    })).toEqual([]);
  });

  it('returns catalog tracks without a playlist occurrence identity', () => {
    const [collected] = collectSearchLibraryTracks({
      likes: [],
      playlists: [{ is_owner: true, tracks: [track('1', 'Entry', { playlist_entry_id: 77 })] }],
      downloads: [],
    });

    expect(collected).toEqual(track('1', 'Entry'));
    expect('playlist_entry_id' in collected).toBe(false);
  });

  it('fails loudly on a saved track without an id', () => {
    expect(() => collectSearchLibraryTracks({
      likes: [track(' ', 'Broken')],
      playlists: [],
      downloads: [],
    })).toThrow('Saved liked track "Broken" has no id');
  });
});

describe('library matching', () => {
  it('matches nothing below the minimum search length', () => {
    const library = [track('1', 'A'), track('2', 'Autobahn')];

    expect(match(library, '')).toEqual([]);
    expect(match(library, ' a ')).toEqual([]);
    expect(titles(match(library, 'au'))).toEqual(['Autobahn']);
  });

  it('matches nothing for input made only of punctuation', () => {
    expect(match([track('1', 'Autobahn')], '?!')).toEqual([]);
  });

  it('is case- and diacritics-insensitive in both directions', () => {
    const library = [
      track('1', 'Déjà Vu', { artist: 'Beyoncé', artists: [{ id: '1', name: 'Beyoncé' }] }),
      track('2', 'Deja Blue'),
    ];

    expect(titles(match(library, 'DEJA'))).toEqual(['Déjà Vu', 'Deja Blue']);
    expect(titles(match(library, 'déjà'))).toEqual(['Déjà Vu', 'Deja Blue']);
    expect(titles(match(library, 'beyonce'))).toEqual(['Déjà Vu']);
  });

  it('requires every token, in any order, across title, artists and album', () => {
    const library = [
      track('1', 'Radioactivity', {
        artist: 'Kraftwerk',
        artists: [{ id: '1', name: 'Kraftwerk' }],
        album: 'Radio-Aktivität',
      }),
      track('2', 'Radio Ga Ga', { artist: 'Queen', artists: [{ id: '2', name: 'Queen' }] }),
    ];

    expect(titles(match(library, 'kraftwerk radio'))).toEqual(['Radioactivity']);
    expect(titles(match(library, 'ga queen'))).toEqual(['Radio Ga Ga']);
    expect(titles(match(library, 'aktivitat'))).toEqual(['Radioactivity']);
    expect(match(library, 'radio abba')).toEqual([]);
  });

  it('searches every credited artist, not only the primary one', () => {
    const library = [
      track('1', 'Under Pressure', {
        artist: 'Queen',
        artists: [{ id: '2', name: 'Queen' }, { id: '3', name: 'David Bowie' }],
      }),
    ];

    expect(titles(match(library, 'bowie'))).toEqual(['Under Pressure']);
    expect(titles(match(library, 'queen bowie pressure'))).toEqual(['Under Pressure']);
  });

  it('still finds the plain artist label of tracks without a credit list', () => {
    const library = [track('1', 'Legacy', { artist: 'Old Artist', artists: [] })];

    expect(titles(match(library, 'old artist'))).toEqual(['Legacy']);
  });

  it('ranks exact titles, title prefixes, title words, artists, then album matches', () => {
    const library = [
      track('1', 'Unrelated', { album: 'Home Recordings' }),
      track('2', 'Other', { artist: 'Homeshake', artists: [{ id: '5', name: 'Homeshake' }] }),
      track('3', 'Chromehome'),
      track('4', 'Coming Home'),
      track('5', 'Homeward Bound'),
      track('6', 'Home'),
    ];

    expect(titles(match(library, 'home'))).toEqual([
      'Home',
      'Homeward Bound',
      'Coming Home',
      'Chromehome',
      'Other',
      'Unrelated',
    ]);
  });

  it('ranks a title match above one that needs the artist for a token', () => {
    const library = [
      track('1', 'Blue', { artist: 'Monday Club', artists: [{ id: '1', name: 'Monday Club' }] }),
      track('2', 'Blue Monday'),
    ];

    expect(titles(match(library, 'blue monday'))).toEqual(['Blue Monday', 'Blue']);
  });

  it('keeps the library order between equally ranked matches', () => {
    const library = [track('1', 'Home Again'), track('2', 'Home Alone'), track('3', 'Home Run')];

    expect(titles(match(library, 'home'))).toEqual(['Home Again', 'Home Alone', 'Home Run']);
  });
});

describe('library section contract', () => {
  it('shows a handful in the all tab, more in the tracks tab, nothing elsewhere', () => {
    expect(searchLibraryLimit('all')).toBe(5);
    expect(searchLibraryLimit('track')).toBe(20);
    expect(searchLibraryLimit('album')).toBe(0);
    expect(searchLibraryLimit('artist')).toBe(0);
    expect(searchLibraryLimit('playlist')).toBe(0);
  });

  it('removes library tracks from remote results without reordering the rest', () => {
    const remote = [track('1', 'One'), track('2', 'Two'), track('3', 'Three'), track('2', 'Two')];

    expect(titles(withoutLibraryTracks(remote, new Set(['2'])))).toEqual(['One', 'Three']);
    expect(withoutLibraryTracks(remote, new Set())).toEqual(remote);
    expect(withoutLibraryTracks(remote, new Set(['1', '2', '3']))).toEqual([]);
  });
});
