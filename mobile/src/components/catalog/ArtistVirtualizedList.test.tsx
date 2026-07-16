import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import type { ArtistTrackListItem } from '../../screens/artistTrackListModel';
import { ArtistVirtualizedList } from './ArtistVirtualizedList';

vi.mock('react-native', () => ({
  RefreshControl: 'RefreshControl',
  SectionList: 'SectionList',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));

function track(id: string): Track {
  return {
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
  };
}

describe('ArtistVirtualizedList', () => {
  it('renders one bounded SectionList owner for Popular and active Search rows', () => {
    const onRefresh = vi.fn();
    const renderTrackItem = vi.fn((item: ArtistTrackListItem) =>
      React.createElement('MockTrack', { testID: `${item.kind}-${item.index}` }),
    );
    const header = React.createElement('MockHeader', { testID: 'header' });
    const popularHeader = React.createElement('MockHeader', { testID: 'popular-header' });
    const searchHeader = React.createElement('MockHeader', { testID: 'search-header' });
    const footer = React.createElement('MockFooter', { testID: 'footer' });
    const rendered = ArtistVirtualizedList({
      artistName: 'Artist',
      popularTracks: [track('same'), track('same')],
      searchTracks: [track('same')],
      searchActive: true,
      refreshing: true,
      refreshAccessibilityLabel: 'Refreshing content',
      onRefresh,
      header,
      popularHeader,
      searchHeader,
      footer,
      renderTrackItem,
    });

    expect(rendered.type).toBe('SectionList');
    expect(rendered.props).toMatchObject({
      testID: 'artist-scroll',
      accessibilityLabel: 'Artist',
      stickySectionHeadersEnabled: false,
      keyboardDismissMode: 'on-drag',
      keyboardShouldPersistTaps: 'handled',
      initialNumToRender: 12,
      maxToRenderPerBatch: 10,
      windowSize: 9,
    });
    expect(rendered.props.ListHeaderComponent).toBe(header);
    expect(rendered.props.ListFooterComponent).toBe(footer);

    const sections = rendered.props.sections as {
      id: 'popular' | 'search';
      data: ArtistTrackListItem[];
    }[];
    expect(sections.map((section) => [section.id, section.data.length])).toEqual([
      ['popular', 2],
      ['search', 1],
    ]);
    const keys = sections.flatMap((section) =>
      section.data.map(rendered.props.keyExtractor as (item: ArtistTrackListItem) => string),
    );
    expect(new Set(keys).size).toBe(3);

    const popularHeading = rendered.props.renderSectionHeader({ section: sections[0] });
    const searchHeading = rendered.props.renderSectionHeader({ section: sections[1] });
    expect(popularHeading.props.children).toBe(popularHeader);
    expect(searchHeading.props.children).toBe(searchHeader);

    const row = rendered.props.renderItem({ item: sections[1]!.data[0]! });
    expect(row.props.testID).toBe('search-0');
    expect(renderTrackItem).toHaveBeenCalledWith(sections[1]!.data[0]);

    const refresh = rendered.props.refreshControl as React.ReactElement<{
      testID: string;
      refreshing: boolean;
      accessibilityLabel: string;
      onRefresh: () => void;
    }>;
    expect(refresh.props).toMatchObject({
      testID: 'artist-refresh',
      refreshing: true,
      accessibilityLabel: 'Refreshing content',
      onRefresh,
    });
    refresh.props.onRefresh();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('keeps the Search section mounted but row-empty when the query is inactive', () => {
    const rendered = ArtistVirtualizedList({
      artistName: 'Artist',
      popularTracks: [],
      searchTracks: [track('retained')],
      searchActive: false,
      refreshing: false,
      refreshAccessibilityLabel: 'Refresh',
      onRefresh: vi.fn(),
      header: React.createElement('MockHeader'),
      popularHeader: React.createElement('MockHeader'),
      searchHeader: React.createElement('MockHeader'),
      footer: React.createElement('MockFooter'),
      renderTrackItem: () => React.createElement('MockTrack'),
    });
    const sections = rendered.props.sections as { data: ArtistTrackListItem[] }[];

    expect(sections).toHaveLength(2);
    expect(sections[1]?.data).toEqual([]);
  });
});
