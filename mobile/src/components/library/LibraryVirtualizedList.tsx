import React from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import type {
  ArtistSummary,
  PlaylistSummary,
  RecentPlay,
  Track,
} from '../../api/types';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors } from '../../theme';
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

export type LibraryListItem =
  | { kind: 'playlist'; playlist: PlaylistSummary }
  | { kind: 'liked-collection' }
  | { kind: 'liked-track'; track: Track; index: number }
  | { kind: 'recent-track'; play: RecentPlay; index: number }
  | { kind: 'downloads-policy' }
  | { kind: 'following-artist'; artist: ArtistSummary };

interface SharedPresentation {
  title: string;
  action?: React.ReactNode;
}

interface QueryPresentation extends SharedPresentation {
  state: Extract<LibrarySectionState, { kind: 'query' }>;
  emptyText: string;
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
}

interface PolicyListSection extends PolicyPresentation {
  id: 'downloads';
  data: LibraryListItem[];
}

export type LibraryListSection = QueryListSection | PolicyListSection;

function visibleItems(
  state: LibrarySectionState,
  items: LibraryListItem[],
): LibraryListItem[] {
  return librarySectionShowsContent(state) ? items : [];
}

/** Builds the five production Library sections in their fixed visual order. */
export function createLibraryListSections(
  collections: LibraryCollections,
  presentations: LibrarySectionPresentations,
): LibraryListSection[] {
  const sections: LibraryListSection[] = [
    {
      id: 'playlists',
      ...presentations.playlists,
      data: visibleItems(
        presentations.playlists.state,
        collections.playlists.map((playlist) => ({ kind: 'playlist', playlist })),
      ),
    },
    {
      id: 'liked',
      ...presentations.liked,
      data: visibleItems(presentations.liked.state, [
        { kind: 'liked-collection' },
        ...collections.likedTracks.map((track, index) => ({
          kind: 'liked-track' as const,
          track,
          index,
        })),
      ]),
    },
    {
      id: 'recent',
      ...presentations.recent,
      data: visibleItems(
        presentations.recent.state,
        collections.recentTracks.map((play, index) => ({
          kind: 'recent-track',
          play,
          index,
        })),
      ),
    },
    {
      id: 'downloads',
      ...presentations.downloads,
      data: [{ kind: 'downloads-policy' }],
    },
    {
      id: 'following',
      ...presentations.following,
      data: visibleItems(
        presentations.following.state,
        collections.following.map((artist) => ({ kind: 'following-artist', artist })),
      ),
    },
  ];

  return sections;
}

/** Stable across virtualized unmount/remount; occurrence indexes preserve duplicates. */
export function libraryListItemKey(item: LibraryListItem): string {
  switch (item.kind) {
    case 'playlist':
      return `playlist:${item.playlist.id}`;
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
  }
}

function sectionHeading(section: LibraryListSection) {
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
      onRetry={section.onRetry}
      action={section.action}
    />
  );
}

function sectionHeader(section: LibraryListSection) {
  return <View style={styles.sectionHeader}>{sectionHeading(section)}</View>;
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

export interface LibraryVirtualizedListProps {
  collections: LibraryCollections;
  presentations: LibrarySectionPresentations;
  refreshing: boolean;
  onRefresh: () => void;
  header: React.ReactElement;
  renderItem: (item: LibraryListItem) => React.ReactElement;
}

/** The Library's only vertical scroll owner. */
export function LibraryVirtualizedList({
  collections,
  presentations,
  refreshing,
  onRefresh,
  header,
  renderItem,
}: LibraryVirtualizedListProps) {
  const sections = createLibraryListSections(collections, presentations);
  return (
    <SectionList
      testID="library-list"
      accessibilityLabel={libraryStrings.library.title}
      sections={sections}
      keyExtractor={libraryListItemKey}
      renderItem={({ item }) => renderItem(item)}
      renderSectionHeader={({ section }) => sectionHeader(section)}
      renderSectionFooter={({ section }) => sectionFooter(section)}
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
      initialNumToRender={14}
      maxToRenderPerBatch={12}
      windowSize={9}
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 24, paddingBottom: 144 },
  sectionHeader: { paddingTop: 30 },
});
