import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { catalogStrings } from '../screens/catalogStrings';
import { TrackActionsPlaylistPicker } from './TrackActionsPlaylistPicker';

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

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textContent((node as React.ReactElement<ElementProps>).props.children);
}

function picker(
  overrides: Partial<Parameters<typeof TrackActionsPlaylistPicker>[0]> = {},
) {
  return TrackActionsPlaylistPicker({
    hasData: true,
    empty: false,
    isPending: false,
    isFetching: false,
    isStale: false,
    fetchStatus: 'idle',
    error: null,
    actionsDisabled: false,
    onRetry: vi.fn(),
    children: React.createElement('PlaylistRows', { testID: 'playlist-rows' }),
    ...overrides,
  });
}

describe('TrackActions playlist-picker remote states', () => {
  it('renders an accessible first load, then a generic retryable hard failure', () => {
    const loading = picker({
      hasData: false,
      isPending: true,
      isFetching: true,
      fetchStatus: 'fetching',
    });
    expect(byTestId(loading, 'track-action-playlists-loading')?.props.accessibilityRole)
      .toBe('progressbar');
    expect(byTestId(loading, 'playlist-rows')).toBeNull();

    const onRetry = vi.fn();
    const diagnostic = 'GET /api/playlists private diagnostics';
    const failed = picker({ hasData: false, error: new Error(diagnostic), onRetry });
    expect(byTestId(failed, 'track-action-playlists-error')?.props.accessibilityLiveRegion)
      .toBe('assertive');
    expect(textContent(failed)).toContain(catalogStrings.common.loadFailed);
    expect(textContent(failed)).not.toContain(diagnostic);
    (byTestId(failed, 'track-action-playlists-retry')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('classifies a paused first load as offline with an enabled retry', () => {
    const tree = picker({ hasData: false, isPending: true, fetchStatus: 'paused' });
    const offline = byTestId(tree, 'track-action-playlists-offline');
    const retry = byTestId(tree, 'track-action-playlists-retry');

    expect(offline?.props.accessibilityRole).toBe('alert');
    expect(byTestId(tree, 'track-action-playlists-loading')).toBeNull();
    expect(retry?.props.disabled).toBe(false);
  });

  it('keeps a successful empty picker visible under a query-owned refresh failure', () => {
    const onRetry = vi.fn();
    const tree = picker({ empty: true, isStale: true, error: new Error('failed'), onRetry });

    expect(byTestId(tree, 'track-action-playlists-empty')).not.toBeNull();
    expect(byTestId(tree, 'playlist-rows')).toBeNull();
    expect(byTestId(tree, 'track-action-playlists-cached-error')?.props.accessibilityLiveRegion)
      .toBe('polite');
    expect(byTestId(tree, 'track-action-playlists-stale')).toBeNull();
    (byTestId(tree, 'track-action-playlists-retry')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps destination rows mounted and prioritizes cached offline', () => {
    const tree = picker({
      isFetching: true,
      isStale: true,
      fetchStatus: 'paused',
      error: new Error('network unavailable'),
    });

    expect(byTestId(tree, 'playlist-rows')).not.toBeNull();
    expect(byTestId(tree, 'track-action-playlists-cached-offline')).not.toBeNull();
    expect(byTestId(tree, 'track-action-playlists-refreshing')).toBeNull();
    expect(byTestId(tree, 'track-action-playlists-stale')).toBeNull();
  });

  it('renders one refresh notice and disables duplicate retries while fetching', () => {
    const refreshing = picker({
      isFetching: true,
      isStale: true,
      fetchStatus: 'fetching',
    });
    expect(byTestId(refreshing, 'track-action-playlists-refreshing')?.props.accessibilityRole)
      .toBe('progressbar');
    expect(byTestId(refreshing, 'track-action-playlists-stale')).toBeNull();

    const failed = picker({
      isFetching: true,
      fetchStatus: 'fetching',
      error: new Error('failed'),
    });
    const retry = byTestId(failed, 'track-action-playlists-retry');
    expect(retry?.props.disabled).toBe(true);
    expect(retry?.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
