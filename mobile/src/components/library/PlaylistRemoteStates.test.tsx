import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { libraryStrings } from '../../screens/libraryStrings';
import {
  PlaylistQueryGate,
  PlaylistQueryNotice,
  resolvePlaylistRemoteVisualState,
  type PlaylistRemoteQueryState,
} from './PlaylistRemoteStates';

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

const base: PlaylistRemoteQueryState = {
  hasData: true,
  empty: false,
  isPending: false,
  isFetching: false,
  isStale: false,
  fetchStatus: 'idle',
  error: null,
};

describe('Playlist collection remote states', () => {
  it('renders a labeled live first-load body', () => {
    const visual = resolvePlaylistRemoteVisualState({
      ...base,
      hasData: false,
      isPending: true,
      isFetching: true,
      fetchStatus: 'fetching',
    });
    const tree = PlaylistQueryGate({ visual, retryBusy: true, onRetry: vi.fn() });
    const loading = byTestId(tree, 'playlist-loading');

    expect(visual).toEqual({ body: 'loading', notice: null });
    expect(loading?.props.accessibilityRole).toBe('progressbar');
    expect(loading?.props.accessibilityLabel).toBe(libraryStrings.playlist.loading);
    expect(loading?.props.accessibilityLiveRegion).toBe('polite');
  });

  it('classifies paused first load as offline and owns a safe retry', () => {
    const onRetry = vi.fn();
    const visual = resolvePlaylistRemoteVisualState({
      ...base,
      hasData: false,
      isPending: true,
      fetchStatus: 'paused',
    });
    const tree = PlaylistQueryGate({ visual, retryBusy: false, onRetry });
    const offline = byTestId(tree, 'playlist-offline');

    expect(offline?.props.accessibilityRole).toBe('alert');
    expect(offline?.props.accessibilityLiveRegion).toBe('assertive');
    expect(byTestId(tree, 'playlist-error')).not.toBeNull();
    (byTestId(tree, 'playlist-retry')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('does not expose raw diagnostics for an uncached query failure', () => {
    const diagnostic = 'GET /api/playlist bearer=private';
    const visual = resolvePlaylistRemoteVisualState({
      ...base,
      hasData: false,
      error: new Error(diagnostic),
    });
    const tree = PlaylistQueryGate({ visual, retryBusy: false, onRetry: vi.fn() });

    expect(byTestId(tree, 'playlist-error')).not.toBeNull();
    expect(textContent(tree)).toContain(libraryStrings.common.loadFailed);
    expect(textContent(tree)).not.toContain(diagnostic);
  });

  it('preserves a successful empty collection under a retryable refresh failure', () => {
    const onRetry = vi.fn();
    const visual = resolvePlaylistRemoteVisualState({
      ...base,
      empty: true,
      isStale: true,
      error: new Error('refresh failed'),
    });
    const tree = PlaylistQueryNotice({ visual, retryBusy: false, onRetry });

    expect(visual).toEqual({ body: 'empty', notice: 'cached-refresh-error' });
    expect(byTestId(tree, 'playlist-cached-error')?.props.accessibilityLiveRegion).toBe('polite');
    expect(byTestId(tree, 'playlist-stale')).toBeNull();
    (byTestId(tree, 'playlist-notice-retry')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('preserves populated content and prioritizes cached offline over other notices', () => {
    const visual = resolvePlaylistRemoteVisualState({
      ...base,
      isFetching: true,
      isStale: true,
      fetchStatus: 'paused',
    });
    const tree = PlaylistQueryNotice({ visual, retryBusy: false, onRetry: vi.fn() });

    expect(visual).toEqual({ body: 'content', notice: 'cached-offline' });
    expect(byTestId(tree, 'playlist-cached-offline')).not.toBeNull();
    expect(byTestId(tree, 'playlist-refreshing')).toBeNull();
    expect(byTestId(tree, 'playlist-stale')).toBeNull();
  });

  it('exposes refresh progress and disables duplicate retry while fetching', () => {
    const refreshing = resolvePlaylistRemoteVisualState({
      ...base,
      isFetching: true,
      isStale: true,
      fetchStatus: 'fetching',
    });
    const refreshTree = PlaylistQueryNotice({
      visual: refreshing,
      retryBusy: true,
      onRetry: vi.fn(),
    });
    expect(byTestId(refreshTree, 'playlist-refreshing')?.props.accessibilityRole)
      .toBe('progressbar');
    expect(byTestId(refreshTree, 'playlist-stale')).toBeNull();

    const failed = resolvePlaylistRemoteVisualState({
      ...base,
      isFetching: true,
      fetchStatus: 'fetching',
      error: new Error('failed'),
    });
    const failedTree = PlaylistQueryNotice({ visual: failed, retryBusy: true, onRetry: vi.fn() });
    const retry = byTestId(failedTree, 'playlist-notice-retry');
    expect(retry?.props.disabled).toBe(true);
    expect(retry?.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
