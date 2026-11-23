import React, { useCallback, useMemo } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import type {
  ArtistSummary,
  PlaylistSummary,
  Track,
} from '../../api/types';
import type { RecentPlay } from '../../domain/listeningStats';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, spacing } from '../../theme';
import type { AppIconName } from '../AppIcon';
import {
  LibrarySectionFooter,
  LibrarySectionHeader,
  librarySectionShowsContent,
} from './LibrarySection';
import type { LibrarySectionState } from './librarySectionState';

export const LIBRARY_SECTION_ORDER = [
  'playlists',
  'liked',
  'recent',
  'downloads',
  'following',
] as const;

export type LibrarySectionId = (typeof LIBRARY_SECTION_ORDER)[number];

/** `all` lists every section; a section id focuses the list on that one section. */
export type LibraryFilter = 'all' | LibrarySectionId;

export const LIBRARY_FILTER_ORDER: readonly LibraryFilter[] = ['all', ...LIBRARY_SECTION_ORDER];

export type LibraryListItem =
  | { kind: 'playlist'; playlist: PlaylistSummary }
  | { kind: 'playlist-row'; playlists: readonly PlaylistSummary[] }
  | { kind: 'liked-collection' }
  | { kind: 'liked-track'; track: Track; index: number }
  | { kind: 'recent-track'; play: RecentPlay; index: number }
  | { kind: 'downloads-policy' }
  | { kind: 'following-artist'; artist: ArtistSummary }
  | { kind: 'following-row'; artists: readonly ArtistSummary[] };

interface SharedPresentation {
  title: string;
  action?: React.ReactNode;
}

interface QueryPresentation extends SharedPresentation {
  state: Extract<LibrarySectionState, { kind: 'query' }>;
  emptyText: string;
  emptyHint?: string;
  emptyIcon?: AppIconName;
  emptyAction?: React.ReactNode;
  onRetry: () => void;
}

interface PolicyPresentation extends SharedPresentation {
  state: Extract<LibrarySectionState, { kind: 'policy' }>;
}

export interface LibrarySectionPresentations {
  playlists: QueryPresentation;
  liked: QueryPresentation;
  recent: QueryPresentation;
  downloads: PolicyPresentation;
  following: QueryPresentation;
}

export interface LibraryCollections {
  playlists: readonly PlaylistSummary[];
  likedTracks: readonly Track[];
  recentTracks: readonly RecentPlay[];
  following: readonly ArtistSummary[];
}

interface QueryListSection extends QueryPresentation {
  id: Exclude<LibrarySectionId, 'downloads'>;
  data: LibraryListItem[];
  /** Rows were cut to a preview; the section offers "show all". */
  truncated: boolean;
}

interface PolicyListSection extends PolicyPresentation {
  id: 'downloads';
  data: LibraryListItem[];
  truncated: false;
}

export interface LibraryListOptions {
  /** Defaults to `all`. */
  filter?: LibraryFilter;
  /**
   * In the `all` overview, liked and recent tracks are cut to this many rows
   * (occurrence indexes are unchanged). A focused section always lists everything.
   */
  previewCount?: number;
  /**
   * Optional multi-column chunking for 16:9 Android TV grids (`playlists` and
   * `following`). Defaults to 1 (single-column phone list).
   */
  gridColumns?: number;
}

export type LibraryListSection = QueryListSection | PolicyListSection;

function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function visibleItems(
  state: LibrarySectionState,
  items: LibraryListItem[],
): LibraryListItem[] {
  return librarySectionShowsContent(state) ? items : [];
}

/**
 * Builds the five production Library sections in their fixed visual order,
 * optionally focused on one section or with track previews in the overview.
 */
export function createLibraryListSections(
  collections: LibraryCollections,
  presentations: LibrarySectionPresentations,
  { filter = 'all', previewCount, gridColumns = 1 }: LibraryListOptions = {},
): LibraryListSection[] {
  if (previewCount !== undefined && (!Number.isInteger(previewCount) || previewCount < 1)) {
    throw new Error('Library previewCount must be a positive integer');
  }
  if (!Number.isInteger(gridColumns) || gridColumns < 1) {
    throw new Error('Library gridColumns must be a positive integer');
  }
  const limit = filter === 'all' && previewCount !== undefined ? previewCount : null;
  const preview = <T,>(items: readonly T[]): readonly T[] =>
    limit === null ? items : items.slice(0, limit);
  const cut = (state: LibrarySectionState, total: number): boolean =>
    limit !== null && total > limit && librarySectionShowsContent(state);

  const playlistItems: LibraryListItem[] =
    gridColumns > 1
      ? chunkItems(collections.playlists, gridColumns).map((playlists) => ({
          kind: 'playlist-row',
          playlists,
        }))
      : collections.playlists.map((playlist) => ({ kind: 'playlist', playlist }));

  const followingItems: LibraryListItem[] =
    gridColumns > 1
      ? chunkItems(collections.following, gridColumns).map((artists) => ({
          kind: 'following-row',
          artists,
        }))
      : collections.following.map((artist) => ({ kind: 'following-artist', artist }));

  const sections: LibraryListSection[] = [
    {
      id: 'playlists',
      ...presentations.playlists,
      truncated: false,
      data: visibleItems(presentations.playlists.state, playlistItems),
    },
    {
      id: 'liked',
      ...presentations.liked,
      truncated: cut(presentations.liked.state, collections.likedTracks.length),
      data: visibleItems(presentations.liked.state, [
        { kind: 'liked-collection' },
        ...preview(collections.likedTracks).map((track, index) => ({
          kind: 'liked-track' as const,
          track,
          index,
        })),
      ]),
    },
    {
      id: 'recent',
      ...presentations.recent,
      truncated: cut(presentations.recent.state, collections.recentTracks.length),
      data: visibleItems(
        presentations.recent.state,
        preview(collections.recentTracks).map((play, index) => ({
          kind: 'recent-track',
          play,
          index,
        })),
      ),
    },
    {
      id: 'downloads',
      ...presentations.downloads,
      truncated: false,
      data: [{ kind: 'downloads-policy' }],
    },
    {
      id: 'following',
      ...presentations.following,
      truncated: false,
      data: visibleItems(presentations.following.state, followingItems),
    },
  ];

  return filter === 'all' ? sections : sections.filter((section) => section.id === filter);
}

/** Stable across virtualized unmount/remount; occurrence indexes preserve duplicates. */
export function libraryListItemKey(item: LibraryListItem): string {
  switch (item.kind) {
    case 'playlist':
      return `playlist:${item.playlist.id}`;
    case 'playlist-row':
      return `playlist-row:${item.playlists.map((playlist) => playlist.id).join(',')}`;
    case 'liked-collection':
      return 'liked:collection';
    case 'liked-track':
      return `liked:${item.track.id}:${item.index}`;
    case 'recent-track':
      return `recent:${item.play.id}:${item.index}`;
    case 'downloads-policy':
      return 'downloads:policy';
    case 'following-artist':
      return `following:${item.artist.id}`;
    case 'following-row':
      return `following-row:${item.artists.map((artist) => artist.id).join(',')}`;
  }
}

function sectionHeading(
  section: LibraryListSection,
  onShowSection: ((id: LibrarySectionId) => void) | undefined,
) {
  if (section.id === 'downloads') {
    return (
      <LibrarySectionHeader
        id={section.id}
        title={section.title}
        state={section.state}
        action={section.action}
      />
    );
  }
  return (
    <LibrarySectionHeader
      id={section.id}
      title={section.title}
      state={section.state}
      emptyText={section.emptyText}
      emptyHint={section.emptyHint}
      emptyIcon={section.emptyIcon}
      emptyAction={section.emptyAction}
      onRetry={section.onRetry}
      action={section.action}
      onShowAll={
        section.truncated && onShowSection !== undefined
          ? () => onShowSection(section.id)
          : undefined
      }
    />
  );
}

function sectionHeader(
  section: LibraryListSection,
  onShowSection: ((id: LibrarySectionId) => void) | undefined,
) {
  return <View style={styles.sectionHeader}>{sectionHeading(section, onShowSection)}</View>;
}

function sectionFooter(section: LibraryListSection) {
  if (section.id === 'downloads') {
    return (
      <LibrarySectionFooter
        id={section.id}
        title={section.title}
        state={section.state}
        action={section.action}
      />
    );
  }
  return (
    <LibrarySectionFooter
      id={section.id}
      title={section.title}
      state={section.state}
      emptyText={section.emptyText}
      onRetry={section.onRetry}
      action={section.action}
    />
  );
}

export interface LibraryVirtualizedListProps extends LibraryListOptions {
  collections: LibraryCollections;
  presentations: LibrarySectionPresentations;
  refreshing: boolean;
  onRefresh: () => void;
  header: React.ReactElement;
  renderItem: (item: LibraryListItem) => React.ReactElement;
  /** `paddingBottom` that clears the mini player: pass `useBottomInset()`. */
  bottomInset: number;
  /** Focuses a previewed section when its "show all" link is pressed. */
  onShowSection?: (id: LibrarySectionId) => void;
}

/** The Library's only vertical scroll owner. */
export function LibraryVirtualizedList({
  collections,
  presentations,
  refreshing,
  onRefresh,
  header,
  renderItem,
  bottomInset,
  filter,
  previewCount,
  gridColumns,
  onShowSection,
}: LibraryVirtualizedListProps) {
  const { playlists, likedTracks, recentTracks, following } = collections;
  const {
    playlists: playlistsPresentation,
    liked: likedPresentation,
    recent: recentPresentation,
    downloads: downloadsPresentation,
    following: followingPresentation,
  } = presentations;
  const sections = useMemo(
    () =>
      createLibraryListSections(
        { playlists, likedTracks, recentTracks, following },
        {
          playlists: playlistsPresentation,
          liked: likedPresentation,
          recent: recentPresentation,
          downloads: downloadsPresentation,
          following: followingPresentation,
        },
        { filter, previewCount, gridColumns },
      ),
    [
      playlists,
      likedTracks,
      recentTracks,
      following,
      playlistsPresentation,
      likedPresentation,
      recentPresentation,
      downloadsPresentation,
      followingPresentation,
      filter,
      previewCount,
      gridColumns,
    ],
  );
  const renderListItem = useCallback(
    ({ item }: { item: LibraryListItem }) => renderItem(item),
    [renderItem],
  );
  const renderHeader = useCallback(
    ({ section }: { section: LibraryListSection }) => sectionHeader(section, onShowSection),
    [onShowSection],
  );
  const renderFooter = useCallback(
    ({ section }: { section: LibraryListSection }) => sectionFooter(section),
    [],
  );
  const contentContainerStyle = useMemo(
    () => [styles.content, { paddingBottom: bottomInset }],
    [bottomInset],
  );
  return (
    <SectionList
      testID="library-list"
      accessibilityLabel={libraryStrings.library.title}
      sections={sections}
      keyExtractor={libraryListItemKey}
      renderItem={renderListItem}
      renderSectionHeader={renderHeader}
      renderSectionFooter={renderFooter}
      ListHeaderComponent={header}
      refreshControl={
        <RefreshControl
          testID="library-refresh"
          accessibilityLabel={libraryStrings.library.refreshAll}
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surfaceElevated}
        />
      }
      stickySectionHeadersEnabled={false}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={14}
      maxToRenderPerBatch={12}
      windowSize={9}
      removeClippedSubviews={false}
      contentContainerStyle={contentContainerStyle}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md },
  sectionHeader: { paddingTop: layout.sectionGap },
});
