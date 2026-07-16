import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ArtistSummary,
  PlaylistSummary,
  RecentPlay,
  Track,
} from '../../api/types';
import { libraryStrings } from '../../screens/libraryStrings';
import {
  LIBRARY_POLICY_SECTION_STATE,
  type LibraryQuerySectionState,
} from './librarySectionState';
import {
  createLibraryListSections,
  LIBRARY_SECTION_ORDER,
  LibraryVirtualizedList,
  libraryListItemKey,
  type LibraryCollections,
  type LibraryListItem,
  type LibrarySectionPresentations,
} from './LibraryVirtualizedList';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  SectionList: 'SectionList',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function propsOf(node: React.ReactNode): ElementProps {
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    throw new Error('Expected a React element');
  }
  return (node as React.ReactElement<ElementProps>).props;
}

function queryState(
  overrides: Partial<LibraryQuerySectionState> = {},
): LibraryQuerySectionState {
  return {
    kind: 'query',
    hasData: true,
    empty: false,
    pending: false,
    fetching: false,
    paused: false,
    stale: false,
    error: null,
    ...overrides,
  };
}

const playlist: PlaylistSummary = {
  id: 7,
  name: 'Night Drive',
  description: null,
  cover_url: null,
  is_public: false,
  track_count: 2,
  owner_name: null,
};

const track = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  artist_id: 'artist-1',
  artists: [{ id: 'artist-1', name: 'Artist' }],
  album: 'Album',
  album_id: 'album-1',
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 1,
  release_date: '',
});

const recent = (id: string): RecentPlay => ({
  id,
  title: `Recent ${id}`,
  artist: 'Artist',
  artist_id: 'artist-1',
  artists: [{ id: 'artist-1', name: 'Artist' }],
  album: 'Album',
  album_id: 'album-1',
  cover: '',
  duration_sec: 180,
});

const artist: ArtistSummary = { id: 'artist-1', name: 'Artist', picture: '' };

function collections(): LibraryCollections {
  return {
    playlists: [playlist],
    likedTracks: [track('duplicate'), track('duplicate')],
    recentTracks: [recent('duplicate'), recent('duplicate')],
    following: [artist],
  };
}

function presentations(
  overrides: Partial<Record<'playlists' | 'liked' | 'recent' | 'following', LibraryQuerySectionState>> = {},
): LibrarySectionPresentations {
  return {
    playlists: {
      title: libraryStrings.library.playlists,
      state: overrides.playlists ?? queryState(),
      emptyText: libraryStrings.library.noPlaylists,
      onRetry: vi.fn(),
    },
    liked: {
      title: libraryStrings.library.likedTracks,
      state: overrides.liked ?? queryState(),
      emptyText: libraryStrings.library.noLikes,
      onRetry: vi.fn(),
    },
    recent: {
      title: libraryStrings.library.recentlyHeard,
      state: overrides.recent ?? queryState(),
      emptyText: libraryStrings.library.noRecent,
      onRetry: vi.fn(),
    },
    downloads: {
      title: libraryStrings.library.downloads,
      state: LIBRARY_POLICY_SECTION_STATE,
    },
    following: {
      title: libraryStrings.library.following,
      state: overrides.following ?? queryState(),
      emptyText: libraryStrings.library.noFollowing,
      onRetry: vi.fn(),
    },
  };
}

describe('Library virtualized presentation', () => {
  it('builds all five sections in product order under one row data model', () => {
    const sections = createLibraryListSections(collections(), presentations());

    expect(sections.map((section) => section.id)).toEqual(LIBRARY_SECTION_ORDER);
    expect(sections.map((section) => section.data.map((item) => item.kind))).toEqual([
      ['playlist'],
      ['liked-collection', 'liked-track', 'liked-track'],
      ['recent-track', 'recent-track'],
      ['downloads-policy'],
      ['following-artist'],
    ]);
  });

  it('withholds rows for loading/empty/error bodies but preserves last-good cached rows', () => {
    const sections = createLibraryListSections(collections(), presentations({
      playlists: queryState({ hasData: false, pending: true, fetching: true }),
      liked: queryState({ empty: true }),
      recent: queryState({ hasData: false, error: new Error('unavailable') }),
      following: queryState({ error: new Error('refresh failed'), stale: true }),
    }));

    expect(sections.find((section) => section.id === 'playlists')?.data).toEqual([]);
    expect(sections.find((section) => section.id === 'liked')?.data).toEqual([]);
    expect(sections.find((section) => section.id === 'recent')?.data).toEqual([]);
    expect(sections.find((section) => section.id === 'downloads')?.data).toEqual([
      { kind: 'downloads-policy' },
    ]);
    expect(sections.find((section) => section.id === 'following')?.data).toEqual([
      { kind: 'following-artist', artist },
    ]);
  });

  it('uses occurrence-aware keys for duplicate play and history rows', () => {
    const sections = createLibraryListSections(collections(), presentations());
    const liked = sections.find((section) => section.id === 'liked')?.data ?? [];
    const recentItems = sections.find((section) => section.id === 'recent')?.data ?? [];
    const keys = [...liked, ...recentItems].map(libraryListItemKey);

    expect(keys).toEqual([
      'liked:collection',
      'liked:duplicate:0',
      'liked:duplicate:1',
      'recent:duplicate:0',
      'recent:duplicate:1',
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('renders one bounded SectionList owner with the shared refresh and section presenters', () => {
    const onRefresh = vi.fn();
    const renderItem = vi.fn((item: LibraryListItem) =>
      React.createElement('LibraryRow', { kind: item.kind }),
    );
    const rendered = LibraryVirtualizedList({
      collections: collections(),
      presentations: presentations(),
      refreshing: true,
      onRefresh,
      header: React.createElement('LibraryHero'),
      renderItem,
    });
    const props = propsOf(rendered);

    expect(rendered.type).toBe('SectionList');
    expect(props).toMatchObject({
      testID: 'library-list',
      accessibilityLabel: libraryStrings.library.title,
      stickySectionHeadersEnabled: false,
      initialNumToRender: 14,
      maxToRenderPerBatch: 12,
      windowSize: 9,
    });
    expect((props.sections as { id: string }[]).map((section) => section.id))
      .toEqual(LIBRARY_SECTION_ORDER);

    const refresh = propsOf(props.refreshControl as React.ReactNode);
    expect(refresh).toMatchObject({
      testID: 'library-refresh',
      accessibilityLabel: libraryStrings.library.refreshAll,
      refreshing: true,
    });
    (refresh.onRefresh as () => void)();
    expect(onRefresh).toHaveBeenCalledOnce();

    const item: LibraryListItem = { kind: 'liked-track', track: track('42'), index: 0 };
    const row = (props.renderItem as (info: { item: LibraryListItem }) => React.ReactElement)({ item });
    expect(propsOf(row).kind).toBe('liked-track');
    expect(renderItem).toHaveBeenCalledWith(item);

    const likedSection = (props.sections as { id: string }[])
      .find((section) => section.id === 'liked');
    const heading = (props.renderSectionHeader as (
      info: { section: unknown },
    ) => React.ReactElement)({ section: likedSection });
    const footer = (props.renderSectionFooter as (
      info: { section: unknown },
    ) => React.ReactElement)({ section: likedSection });
    expect(propsOf(propsOf(heading).children as React.ReactNode)).toMatchObject({
      id: 'liked',
      onRetry: expect.any(Function),
    });
    expect(footer.props).toMatchObject({ id: 'liked', onRetry: expect.any(Function) });
  });
});
