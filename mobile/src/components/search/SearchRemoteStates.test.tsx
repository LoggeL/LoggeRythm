import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  SearchErrorNotice,
  SearchLoadingStatus,
  SearchPoliteStatus,
  SearchRemoteBoundary,
} from './SearchRemoteStates';

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
  return [element, ...elements(element.props.children)];
}

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`Missing ${testID}`);
  return found;
}

describe('Search remote-state accessibility primitives', () => {
  it('announces loading as a labeled polite progress state', () => {
    const rendered = SearchLoadingStatus({ testID: 'loading', label: 'Searching' });
    expect(byTestId(rendered, 'loading').props).toMatchObject({
      accessibilityRole: 'progressbar',
      accessibilityLabel: 'Searching',
      accessibilityLiveRegion: 'polite',
    });
  });

  it('announces errors assertively and gives the retry exact ownership', () => {
    const retry = vi.fn();
    const rendered = SearchErrorNotice({
      testID: 'track-error',
      message: 'Tracks failed',
      actionLabel: 'Reload tracks',
      onAction: retry,
    });
    expect(byTestId(rendered, 'track-error').props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    const action = elements(rendered).find(
      (element) => element.props.accessibilityLabel === 'Reload tracks',
    );
    (action?.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('announces import input and runtime errors without inventing a retry action', () => {
    for (const testID of ['spotify-import-input-error', 'spotify-import-runtime-error']) {
      const rendered = SearchErrorNotice({ testID, message: 'Import action failed' });

      expect(byTestId(rendered, testID).props).toMatchObject({
        accessibilityRole: 'alert',
        accessibilityLiveRegion: 'assertive',
      });
      expect(elements(rendered).some((element) => element.props.testID === `${testID}-action`))
        .toBe(false);
    }
  });

  it('disables and marks an in-flight retry as busy', () => {
    const rendered = SearchErrorNotice({
      testID: 'track-error',
      message: 'Tracks failed',
      actionLabel: 'Reload tracks',
      actionBusy: true,
      onAction: vi.fn(),
    });
    expect(byTestId(rendered, 'track-error-action').props).toMatchObject({
      disabled: true,
      accessibilityState: { busy: true, disabled: true },
    });
  });

  it('uses a polite live region for refresh, stale, empty, and success copy', () => {
    const rendered = SearchPoliteStatus({ testID: 'status', message: 'Results ready' });
    expect(byTestId(rendered, 'status').props.accessibilityLiveRegion).toBe('polite');
  });

  it('rejects an action without matching accessible copy', () => {
    expect(() => SearchErrorNotice({ testID: 'bad', message: 'Bad', onAction: vi.fn() }))
      .toThrow('both a label and callback');
  });

  it('keeps successful empty data visible with one retryable cached-error notice', () => {
    const retry = vi.fn();
    const rendered = SearchRemoteBoundary({
      id: 'genres',
      state: { body: 'empty', notice: 'cached-refresh-error' },
      loadingLabel: 'Loading genres',
      emptyLabel: 'No genres',
      offlineLabel: 'Genres offline',
      errorLabel: 'Genres failed',
      cachedOfflineLabel: 'Saved genres offline',
      cachedErrorLabel: 'Saved genres after error',
      refreshingLabel: 'Refreshing genres',
      staleLabel: 'Saved genres',
      retryLabel: 'Reload genres',
      retryBusy: false,
      onRetry: retry,
      children: React.createElement('GenreRail'),
    });

    expect(byTestId(rendered, 'genres-empty')).not.toBeNull();
    const noticeElement = byTestId(rendered, 'genres-cached-error');
    const notice = SearchErrorNotice(
      noticeElement.props as unknown as Parameters<typeof SearchErrorNotice>[0],
    );
    expect(byTestId(notice, 'genres-cached-error').props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'polite',
    });
    expect(elements(rendered).some((element) => element.type === 'GenreRail')).toBe(false);
    (byTestId(notice, 'genres-cached-error-action').props.onPress as () => void)();
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders cached content during an offline refresh without a blocking body', () => {
    const rendered = SearchRemoteBoundary({
      id: 'import-result',
      state: { body: 'content', notice: 'cached-offline' },
      loadingLabel: 'Resolving',
      emptyLabel: 'No result',
      offlineLabel: 'Offline',
      errorLabel: 'Failed',
      cachedOfflineLabel: 'Saved import offline',
      cachedErrorLabel: 'Saved import after error',
      refreshingLabel: 'Refreshing import',
      staleLabel: 'Saved import',
      retryLabel: 'Resolve again',
      retryBusy: false,
      onRetry: vi.fn(),
      children: React.createElement('ResolvedImport', { testID: 'resolved-import' }),
    });

    expect(byTestId(rendered, 'resolved-import')).not.toBeNull();
    expect(byTestId(rendered, 'import-result-cached-offline')).not.toBeNull();
    expect(elements(rendered).some((element) => element.props.testID === 'import-result-offline'))
      .toBe(false);
  });
});
