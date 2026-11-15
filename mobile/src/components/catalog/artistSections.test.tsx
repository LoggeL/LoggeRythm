import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtistDetail } from '../../api/types';
import { catalogStrings } from '../../screens/catalogStrings';
import { byTestId, byType, elements, queryByTestId, textContent } from '../../test/render';
import { ArtistAbout, artistAboutHasContent } from './ArtistAbout';
import { ArtistFooter } from './ArtistFooter';
import { ArtistHero } from './ArtistHero';
import { ArtistSongSearchHeader } from './ArtistSongSearchHeader';

const mocks = vi.hoisted(() => ({ setExpanded: vi.fn(), useState: vi.fn() }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
// Hook-owning primitives stay opaque; they keep the props passed to them.
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  CardRailSkeleton: 'CardRailSkeleton',
  PressableScale: 'PressableScale',
  Skeleton: 'Skeleton',
  TrackRowSkeleton: 'TrackRowSkeleton',
}));
vi.mock('../track/StandardTrackRow', () => ({ default: 'StandardTrackRow' }));
vi.mock('../track/TrackShelfCard', () => ({ default: 'TrackShelfCard' }));

const settled = {
  isPending: false,
  isFetching: false,
  isStale: false,
  fetchStatus: 'idle' as const,
  error: null,
  refetch: vi.fn(),
};

const artist: ArtistDetail = {
  id: '7',
  name: 'LoggeRythm',
  picture: '',
  fans: 1200,
  albums_count: 1,
  top: [{ id: '1' } as ArtistDetail['top'][number]],
  albums: [{ id: '9', title: 'Parity', artist: 'LoggeRythm', cover: '', release_date: '' }],
  related: [{ id: '8', name: 'Neighbour', picture: '' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useState.mockReturnValue([false, mocks.setExpanded]);
});

describe('ArtistHero', () => {
  function hero(overrides: Partial<Parameters<typeof ArtistHero>[0]> = {}) {
    return ArtistHero({
      artist,
      followState: { ...settled, data: { '7': false } },
      following: false,
      followUpdating: false,
      onToggleFollow: vi.fn(),
      onPlay: vi.fn(),
      ...overrides,
    });
  }

  it('keeps title, type label, fans, play and follow contracts', () => {
    const onPlay = vi.fn();
    const onToggleFollow = vi.fn();
    const rendered = hero({ onPlay, onToggleFollow });

    expect(byTestId(rendered, 'artist-title').props.accessibilityRole).toBe('header');
    expect(byTestId(rendered, 'artist-type-label').props.children)
      .toBe(catalogStrings.artist.typeLabel);
    expect(byTestId(rendered, 'artist-fans').props.children)
      .toBe(catalogStrings.artist.fans(1200));

    (byTestId(rendered, 'artist-play-all').props.onPress as () => void)();
    expect(onPlay).toHaveBeenCalledOnce();

    const follow = byTestId(rendered, 'artist-follow-toggle');
    expect(follow.props.accessibilityLabel).toBe(catalogStrings.artist.followArtist('LoggeRythm'));
    (follow.props.onPress as () => void)();
    expect(onToggleFollow).toHaveBeenCalledOnce();
  });

  it('names the reverse action once followed and blocks presses while updating', () => {
    const following = byTestId(hero({ following: true }), 'artist-follow-toggle');
    expect(following.props.accessibilityLabel)
      .toBe(catalogStrings.artist.unfollowArtist('LoggeRythm'));
    expect(textContent(following)).toEqual([catalogStrings.artist.following]);

    const updating = byTestId(hero({ followUpdating: true }), 'artist-follow-toggle');
    expect(updating.props.disabled).toBe(true);
    expect(updating.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it('shows a placeholder, not a guessed state, while the follow state loads', () => {
    const rendered = hero({
      followState: { ...settled, data: undefined, isPending: true, isFetching: true, fetchStatus: 'fetching' },
    });

    expect(byTestId(rendered, 'artist-follow-state-loading').props.accessibilityLabel)
      .toBe(catalogStrings.artist.followLoading);
    expect(queryByTestId(rendered, 'artist-follow-toggle')).toBeNull();
  });

  it('reports a failed follow state with a retry and hides fans it does not have', () => {
    const refetch = vi.fn();
    const rendered = hero({
      artist: { ...artist, fans: 0, top: [] },
      followState: { ...settled, data: undefined, error: new Error('boom'), refetch },
    });

    expect(textContent(byTestId(rendered, 'artist-follow-state-error')))
      .toContain(catalogStrings.artist.followStateFailed);
    (byTestId(rendered, 'artist-follow-state-retry').props.onPress as () => void)();
    expect(refetch).toHaveBeenCalledOnce();
    expect(queryByTestId(rendered, 'artist-fans')).toBeNull();
    expect(byTestId(rendered, 'artist-play-all').props.disabled).toBe(true);
  });
});

describe('ArtistSongSearchHeader', () => {
  function header(overrides: Partial<Parameters<typeof ArtistSongSearchHeader>[0]> = {}) {
    return ArtistSongSearchHeader({
      artistName: 'LoggeRythm',
      input: '',
      onChangeInput: vi.fn(),
      query: '',
      search: { ...settled, data: undefined },
      resultCount: 0,
      ...overrides,
    });
  }

  it('is a labelled field with no result state while the query is inactive', () => {
    const onChangeInput = vi.fn();
    const rendered = header({ onChangeInput });
    const input = byTestId(rendered, 'artist-song-search-input');

    expect(input.props.accessibilityLabel)
      .toBe(catalogStrings.artist.searchSongsLabel('LoggeRythm'));
    (input.props.onChangeText as (value: string) => void)('sig');
    expect(onChangeInput).toHaveBeenCalledWith('sig');
    expect(queryByTestId(rendered, 'artist-song-search-state')).toBeNull();
    expect(queryByTestId(rendered, 'artist-song-search-clear')).toBeNull();
  });

  it('offers a clear control once there is input', () => {
    const onChangeInput = vi.fn();
    const clear = byTestId(header({ input: 'sig', onChangeInput }), 'artist-song-search-clear');

    expect(clear.props.accessibilityLabel).toBe(catalogStrings.artist.clearSongSearch);
    (clear.props.onPress as () => void)();
    expect(onChangeInput).toHaveBeenCalledWith('');
  });

  it('distinguishes results, a successful empty search and a failed one', () => {
    const found = header({ query: 'sig', search: { ...settled, data: [] }, resultCount: 2 });
    expect(byTestId(found, 'artist-song-search-results')).toBeDefined();

    const empty = header({ query: 'sig', search: { ...settled, data: [] }, resultCount: 0 });
    expect(textContent(byTestId(empty, 'artist-song-search-state-empty')))
      .toContain(catalogStrings.artist.searchSongsEmpty('sig'));
    expect(queryByTestId(empty, 'artist-song-search-results')).toBeNull();

    const failed = header({
      query: 'sig',
      search: { ...settled, data: undefined, error: new Error('raw diagnostic') },
    });
    expect(textContent(byTestId(failed, 'artist-song-search-state-error')))
      .toEqual([catalogStrings.artist.searchSongsFailed, catalogStrings.common.retry]);
  });
});

describe('ArtistFooter', () => {
  function footer(overrides: Partial<Parameters<typeof ArtistFooter>[0]> = {}) {
    return ArtistFooter({
      albums: artist.albums,
      related: artist.related,
      about: { ...settled, data: { bio: 'Bio', listeners: 10, playcount: 20, tags: ['house'] } },
      aboutEnabled: true,
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
      ...overrides,
    });
  }

  function railItem(rendered: React.ReactNode, id: string, index = 0) {
    const rail = byTestId(rendered, `catalog-rail-${id}`);
    const data = rail.props.data as unknown[];
    return (rail.props.renderItem as (info: { item: unknown; index: number }) => React.ReactNode)({
      item: data[index],
      index,
    });
  }

  it('routes discography and related cards with exact ids', () => {
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const rendered = footer({ onOpenAlbum, onOpenArtist });

    (byTestId(railItem(rendered, 'artist-albums'), 'artist-album-9').props.onPress as () => void)();
    (byTestId(railItem(rendered, 'artist-related'), 'artist-related-8').props.onPress as () => void)();
    expect(onOpenAlbum).toHaveBeenCalledWith({ albumId: '9', title: 'Parity' });
    expect(onOpenArtist).toHaveBeenCalledWith({ artistId: '8', name: 'Neighbour' });
    expect(byTestId(rendered, 'artist-about-content')).toBeDefined();
  });

  it('omits shelves the artist payload has no items for', () => {
    const rendered = footer({ albums: [], related: [] });

    expect(queryByTestId(rendered, 'catalog-section-artist-albums')).toBeNull();
    expect(queryByTestId(rendered, 'catalog-section-artist-related')).toBeNull();
    expect(byTestId(rendered, 'catalog-section-artist-about')).toBeDefined();
  });

  it('gives the about section its own loading, empty and failure states', () => {
    const loading = footer({
      about: { ...settled, data: undefined, isPending: true, isFetching: true, fetchStatus: 'fetching' },
    });
    expect(byTestId(loading, 'catalog-section-artist-about-loading').props.accessibilityRole)
      .toBe('progressbar');

    const empty = footer({
      about: { ...settled, data: { bio: ' ', listeners: 0, playcount: 0, tags: [] } },
    });
    expect(textContent(byTestId(empty, 'catalog-section-artist-about-empty')))
      .toEqual([catalogStrings.artist.aboutUnavailable]);

    const refetch = vi.fn();
    const failed = footer({ about: { ...settled, data: undefined, error: new Error('x'), refetch } });
    (byTestId(failed, 'catalog-section-artist-about-retry').props.onPress as () => void)();
    expect(refetch).toHaveBeenCalledOnce();

    // Before the artist name is known the about query never ran: that is empty, not loading.
    const disabled = footer({
      aboutEnabled: false,
      about: { ...settled, data: undefined, isPending: true },
    });
    expect(queryByTestId(disabled, 'catalog-section-artist-about-loading')).toBeNull();
    expect(byTestId(disabled, 'catalog-section-artist-about-empty')).toBeDefined();
  });
});

describe('ArtistAbout', () => {
  const longBio = 'Long biography. '.repeat(40).trim();

  it('recognises an about payload without any content', () => {
    expect(artistAboutHasContent(undefined)).toBe(false);
    expect(artistAboutHasContent({ bio: '  ', listeners: 0, playcount: 0, tags: [] })).toBe(false);
    expect(artistAboutHasContent({ bio: '', listeners: 0, playcount: 0, tags: ['house'] })).toBe(true);
  });

  it('collapses a long biography behind a toggle and shows counts and tags', () => {
    const rendered = ArtistAbout({
      about: { bio: longBio, listeners: 10, playcount: 20, tags: ['house', 'techno'] },
    });
    const copy = textContent(rendered);

    expect(byType(rendered, 'Text').find((text) => text.props.children === longBio)
      ?.props.numberOfLines).toBe(5);
    expect(copy).toEqual(expect.arrayContaining([
      catalogStrings.artist.showMoreAbout,
      catalogStrings.artist.listeners(10),
      catalogStrings.artist.plays(20),
      'house',
      'techno',
    ]));
    (byTestId(rendered, 'artist-about-toggle').props.onPress as () => void)();
    const update = mocks.setExpanded.mock.calls[0]?.[0] as (value: boolean) => boolean;
    expect(update(false)).toBe(true);
  });

  it('shows the full text when expanded and no toggle for a short biography', () => {
    mocks.useState.mockReturnValue([true, mocks.setExpanded]);
    const expanded = ArtistAbout({ about: { bio: longBio, listeners: 0, playcount: 0, tags: [] } });
    expect(byType(expanded, 'Text').find((text) => text.props.children === longBio)
      ?.props.numberOfLines).toBeUndefined();
    expect(textContent(expanded)).toContain(catalogStrings.artist.showLessAbout);

    const short = ArtistAbout({ about: { bio: 'Short.', listeners: 0, playcount: 0, tags: [] } });
    expect(queryByTestId(short, 'artist-about-toggle')).toBeNull();
    expect(elements(short).some((element) => element.type === 'Pressable')).toBe(false);
  });
});
