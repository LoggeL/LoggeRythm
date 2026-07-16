import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { catalogStrings } from '../../screens/catalogStrings';
import {
  CatalogContentStatus,
  CatalogPageGate,
  CatalogQueryBoundary,
  CatalogSection,
} from './CatalogStates';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  if (typeof element.type === 'function') {
    const rendered = (element.type as (props: ElementProps) => React.ReactNode)(element.props);
    return [element, ...elements(rendered)];
  }
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => element.props.testID === testID) ?? null;
}

function section(
  overrides: Partial<Parameters<typeof CatalogSection>[0]> = {},
): React.ReactElement {
  return CatalogSection({
    id: 'charts',
    title: catalogStrings.discover.charts,
    hasData: true,
    empty: false,
    isPending: false,
    isFetching: false,
    isStale: false,
    fetchStatus: 'idle',
    error: null,
    onRetry: vi.fn(),
    children: React.createElement('ChartRail', { testID: 'chart-rail' }),
    ...overrides,
  });
}

describe('Catalog remote-state presentation', () => {
  it('renders a labeled live page load and safe retryable blocking failures', () => {
    const loading = CatalogPageGate({
      id: 'album',
      hasData: false,
      isPending: true,
      isFetching: true,
      isStale: true,
      fetchStatus: 'fetching',
      error: null,
      loadingLabel: catalogStrings.album.loading,
      onRetry: vi.fn(),
    });
    expect(byTestId(loading, 'album-loading')?.props.accessibilityLiveRegion).toBe('polite');

    const onRetry = vi.fn();
    const failed = CatalogPageGate({
      id: 'album',
      hasData: false,
      isPending: false,
      isFetching: false,
      isStale: true,
      fetchStatus: 'idle',
      error: new Error('GET /api/album internal detail'),
      loadingLabel: catalogStrings.album.loading,
      onRetry,
    });
    const error = byTestId(failed, 'album-error');
    expect(error?.props.accessibilityRole).toBe('alert');
    expect(error?.props.accessibilityLiveRegion).toBe('assertive');
    expect(elements(error).some((element) => element.props.children === 'GET /api/album internal detail'))
      .toBe(false);
    (byTestId(failed, 'album-retry')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('classifies paused first load as offline rather than loading', () => {
    const tree = CatalogPageGate({
      id: 'artist',
      hasData: false,
      isPending: true,
      isFetching: false,
      isStale: true,
      fetchStatus: 'paused',
      error: null,
      loadingLabel: catalogStrings.artist.loading,
      onRetry: vi.fn(),
    });

    expect(byTestId(tree, 'artist-offline')).not.toBeNull();
    expect(byTestId(tree, 'artist-loading')).toBeNull();
  });

  it('preserves a successful empty section with one retryable refresh-failure notice', () => {
    const onRetry = vi.fn();
    const tree = section({ empty: true, error: new Error('refresh'), isStale: true, onRetry });

    expect(byTestId(tree, 'catalog-section-charts-empty')).not.toBeNull();
    expect(byTestId(tree, 'chart-rail')).toBeNull();
    expect(byTestId(tree, 'catalog-section-charts-cached-error')?.props.accessibilityLiveRegion)
      .toBe('polite');
    expect(byTestId(tree, 'catalog-section-charts-stale')).toBeNull();
    (byTestId(tree, 'catalog-section-charts-retry')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps content mounted with cached offline and no competing notice', () => {
    const tree = section({ fetchStatus: 'paused', isStale: true });

    expect(byTestId(tree, 'chart-rail')).not.toBeNull();
    expect(byTestId(tree, 'catalog-section-charts-cached-offline')).not.toBeNull();
    expect(byTestId(tree, 'catalog-section-charts-cached-error')).toBeNull();
    expect(byTestId(tree, 'catalog-section-charts-stale')).toBeNull();
  });

  it('exposes refreshing as progress and disables duplicate failed-refresh retries', () => {
    const refreshing = section({ isFetching: true, fetchStatus: 'fetching', isStale: true });
    expect(byTestId(refreshing, 'catalog-section-charts-refreshing')?.props.accessibilityRole)
      .toBe('progressbar');
    expect(byTestId(refreshing, 'catalog-section-charts-stale')).toBeNull();

    const failed = section({
      error: new Error('failed'),
      isFetching: true,
      fetchStatus: 'fetching',
    });
    const retry = byTestId(failed, 'catalog-section-charts-retry');
    expect(retry?.props.disabled).toBe(true);
    expect(retry?.props.accessibilityState).toEqual({ busy: true, disabled: true });
  });

  it('uses the same exclusive notice contract for detail-page cached content', () => {
    const tree = CatalogContentStatus({
      id: 'album',
      hasData: true,
      isPending: false,
      isFetching: false,
      isStale: true,
      fetchStatus: 'idle',
      error: new Error('refresh failed'),
      onRetry: vi.fn(),
    });

    expect(byTestId(tree, 'album-cached-error')).not.toBeNull();
    expect(byTestId(tree, 'album-stale')).toBeNull();
    expect(byTestId(tree, 'album-refreshing')).toBeNull();
  });

  it('preserves embedded known-empty and content bodies through refresh failures', () => {
    const render = (empty: boolean, children: React.ReactNode) => CatalogQueryBoundary({
      id: 'artist-song-search-state',
      hasData: true,
      empty,
      isPending: false,
      isFetching: false,
      isStale: true,
      fetchStatus: 'idle',
      error: new Error('raw search diagnostic'),
      loadingLabel: catalogStrings.artist.searchSongsLoading,
      emptyLabel: catalogStrings.artist.searchSongsEmpty('quiet'),
      errorLabel: catalogStrings.artist.searchSongsFailed,
      onRetry: vi.fn(),
      children,
    });

    const knownEmpty = render(true, React.createElement('SongRows', { testID: 'song-rows' }));
    expect(byTestId(knownEmpty, 'artist-song-search-state-empty')).not.toBeNull();
    expect(byTestId(knownEmpty, 'artist-song-search-state-cached-error')).not.toBeNull();
    expect(byTestId(knownEmpty, 'song-rows')).toBeNull();

    const content = render(false, React.createElement('SongRows', { testID: 'song-rows' }));
    expect(byTestId(content, 'song-rows')).not.toBeNull();
    expect(byTestId(content, 'artist-song-search-state-cached-error')).not.toBeNull();
    expect(elements(content).some(
      (element) => element.props.children === 'raw search diagnostic',
    )).toBe(false);
  });
});
