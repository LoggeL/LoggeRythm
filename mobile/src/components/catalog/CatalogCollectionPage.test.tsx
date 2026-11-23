import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { byTestId, queryByTestId, textContent, type TestElement } from '../../test/render';
import type { TvEnvironment } from '../../tv';
import { CatalogCollectionPage } from './CatalogCollectionPage';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('./CatalogTrackList', () => ({ CatalogTrackList: 'CatalogTrackList' }));

const track = { id: '7', title: 'Signal' } as Track;

function page(overrides: Partial<Parameters<typeof CatalogCollectionPage>[0]> = {}) {
  return CatalogCollectionPage({
    id: 'album',
    tracks: [track],
    hero: React.createElement('Hero', { testID: 'hero' }),
    status: React.createElement('Status', { testID: 'status' }),
    empty: React.createElement('Empty', { testID: 'empty' }),
    refreshing: true,
    refreshAccessibilityLabel: 'Refreshing',
    onRefresh: vi.fn(),
    renderTrack: vi.fn(),
    ...overrides,
  });
}

function list(rendered: React.ReactNode): TestElement {
  return (byTestId(rendered, 'album-screen').props.children) as TestElement;
}

describe('CatalogCollectionPage', () => {
  it('hands one list the page id, refresh contract, rows and empty state', () => {
    const onRefresh = vi.fn();
    const renderTrack = vi.fn();
    const empty = React.createElement('Empty');
    const rendered = page({ onRefresh, renderTrack, empty });

    expect(list(rendered).type).toBe('CatalogTrackList');
    expect(list(rendered).props).toMatchObject({
      id: 'album',
      tracks: [track],
      refreshing: true,
      refreshAccessibilityLabel: 'Refreshing',
      onRefresh,
      renderTrack,
      empty,
    });
  });

  it('orders the header hero, then status, then a titled track list', () => {
    const header = list(page({ trackListTitle: 'Track list' })).props.header as React.ReactNode;

    expect(byTestId(header, 'hero')).toBeDefined();
    expect(byTestId(header, 'status')).toBeDefined();
    expect(byTestId(header, 'album-track-list')).toBeDefined();
    expect(textContent(header)).toEqual(['Track list']);
  });

  it('marks an untitled track list only while it has rows', () => {
    const withRows = list(page()).props.header as React.ReactNode;
    const withoutRows = list(page({ tracks: [] })).props.header as React.ReactNode;

    expect(byTestId(withRows, 'album-track-list')).toBeDefined();
    expect(textContent(withRows)).toEqual([]);
    expect(queryByTestId(withoutRows, 'album-track-list')).toBeNull();
  });

  it('switches to a 16:9 side-by-side split layout on Android TV without double overscan or inset override', () => {
    const tv = {
      isTv: true,
      contentWidth: 700,
      splitPrimaryRatio: 0.44,
      gridGap: 16,
      overscan: { top: 27, right: 48, bottom: 27, left: 48 },
    } as unknown as TvEnvironment;
    const rendered = page({ tv, bottomInset: 112, trackListTitle: 'Track list' });

    const screen = byTestId(rendered, 'album-screen');
    expect(JSON.stringify(screen.props.style)).not.toContain('"paddingTop":27');
    expect(JSON.stringify(screen.props.style)).not.toContain('"paddingRight":48');
    const heroPane = byTestId(rendered, 'album-tv-hero-pane');
    expect(heroPane.props.contentContainerStyle).toEqual([
      expect.any(Object),
      { paddingBottom: 112 },
    ]);
    const tracksPane = byTestId(rendered, 'album-tv-tracks-pane');
    const trackList = tracksPane.props.children as TestElement;
    expect(trackList.type).toBe('CatalogTrackList');
    expect(trackList.props.contentPaddingBottom).toBeUndefined();
    expect(byTestId(heroPane, 'hero')).toBeDefined();
    expect(byTestId(heroPane, 'status')).toBeDefined();
  });
});
