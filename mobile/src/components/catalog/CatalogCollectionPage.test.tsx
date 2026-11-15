import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { byTestId, queryByTestId, textContent, type TestElement } from '../../test/render';
import { CatalogCollectionPage } from './CatalogCollectionPage';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
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
});
