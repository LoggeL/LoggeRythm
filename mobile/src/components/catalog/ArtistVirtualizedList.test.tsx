import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import type { ArtistTrackListItem } from '../../screens/artistTrackListModel';
import { flatStyle } from '../../test/render';
import { ArtistVirtualizedList } from './ArtistVirtualizedList';

vi.mock('react-native', () => ({
  RefreshControl: 'RefreshControl',
  SectionList: 'SectionList',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  View: 'View',
}));
vi.mock('../../hooks/useBottomInset', () => ({ useBottomInset: () => 96 }));

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
    const likedHeader = React.createElement('MockHeader', { testID: 'liked-header' });
    const popularHeader = React.createElement('MockHeader', { testID: 'popular-header' });
    const searchHeader = React.createElement('MockHeader', { testID: 'search-header' });
    const footer = React.createElement('MockFooter', { testID: 'footer' });
    const rendered = ArtistVirtualizedList({
      artistName: 'Artist',
      liked: null,
      popularTracks: [track('same'), track('same')],
      searchTracks: [track('same')],
      searchActive: true,
      refreshing: true,
      refreshAccessibilityLabel: 'Refreshing content',
      onRefresh,
      header,
      likedHeader,
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
    // The last row clears the floating mini player instead of a hardcoded 144dp.
    expect(flatStyle(rendered.props.contentContainerStyle).paddingBottom).toBe(96);
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
      liked: null,
      popularTracks: [],
      searchTracks: [track('retained')],
      searchActive: false,
      refreshing: false,
      refreshAccessibilityLabel: 'Refresh',
      onRefresh: vi.fn(),
      header: React.createElement('MockHeader'),
      likedHeader: React.createElement('MockHeader'),
      popularHeader: React.createElement('MockHeader'),
      searchHeader: React.createElement('MockHeader'),
      footer: React.createElement('MockFooter'),
      renderTrackItem: () => React.createElement('MockTrack'),
    });
    const sections = rendered.props.sections as { data: ArtistTrackListItem[] }[];

    expect(sections).toHaveLength(2);
    expect(sections[1]?.data).toEqual([]);
  });

  function likedList(liked: Parameters<typeof ArtistVirtualizedList>[0]['liked']) {
    const likedHeader = React.createElement('MockHeader', { testID: 'liked-header' });
    const popularHeader = React.createElement('MockHeader', { testID: 'popular-header' });
    const rendered = ArtistVirtualizedList({
      artistName: 'Artist',
      liked,
      popularTracks: [track('1')],
      searchTracks: [],
      searchActive: false,
      refreshing: false,
      refreshAccessibilityLabel: 'Refresh',
      onRefresh: vi.fn(),
      header: React.createElement('MockHeader'),
      likedHeader,
      popularHeader,
      searchHeader: React.createElement('MockHeader'),
      footer: React.createElement('MockFooter'),
      renderTrackItem: (item) =>
        React.createElement('MockTrack', { testID: `${item.kind}-${item.index}` }),
    });
    const sections = rendered.props.sections as {
      id: 'liked' | 'popular' | 'search';
      data: ArtistTrackListItem[];
    }[];
    return { rendered, sections, likedHeader, popularHeader };
  }

  it('lists the liked block above Popular as rows of the same SectionList', () => {
    const likedTracks = Array.from({ length: 7 }, (_, index) => track(`liked-${index}`));
    const { rendered, sections, likedHeader, popularHeader } = likedList({
      tracks: likedTracks,
      expanded: false,
    });

    expect(rendered.type).toBe('SectionList');
    expect(sections.map((section) => [section.id, section.data.length])).toEqual([
      ['liked', 0],
      ['popular', 1],
      ['search', 0],
    ]);
    expect(rendered.props.renderSectionHeader({ section: sections[0] }).props.children)
      .toBe(likedHeader);
    expect(rendered.props.renderSectionHeader({ section: sections[1] }).props.children)
      .toBe(popularHeader);

    const expanded = likedList({ tracks: likedTracks, expanded: true });
    expect(expanded.sections[0]?.data).toHaveLength(7);
    const row = expanded.rendered.props.renderItem({ item: expanded.sections[0]!.data[4]! });
    expect(row.props.testID).toBe('liked-4');
    expect(expanded.sections[0]!.data[4]!.track).toBe(likedTracks[4]);
  });

  it('mounts neither liked rows nor the liked heading while the page has no liked block', () => {
    const { rendered, sections, likedHeader } = likedList(null);

    expect(sections.map((section) => section.id)).toEqual(['popular', 'search']);
    const headings = sections.map(
      (section) => rendered.props.renderSectionHeader({ section }).props.children as unknown,
    );
    expect(headings).not.toContain(likedHeader);
  });
});
