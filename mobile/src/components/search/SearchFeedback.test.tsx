import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import type { SearchAggregateRemoteState } from '../../screens/searchRemoteState';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import {
  SearchLibraryLikesNotice,
  SearchMetadataFeedback,
  SearchResultsFeedback,
  searchIssueMessage,
  showsPrimaryStaleNotice,
} from './SearchFeedback';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

const state = (overrides: Partial<SearchAggregateRemoteState> = {}): SearchAggregateRemoteState => ({
  body: 'content',
  resultCount: 3,
  loadingKeys: [],
  refreshingKeys: [],
  staleKeys: [],
  issues: [],
  ...overrides,
});

const renderLoading = (props: { testID: string; accessibilityLabel: string }) =>
  React.createElement('SearchSkeleton', props);

describe('library likes notice', () => {
  const label = strings.navigation.likedSongs;

  it('reports liked songs that never loaded as an alert with retry', () => {
    const onRetry = vi.fn();
    const failed = SearchLibraryLikesNotice({ kind: 'hard-error', retryBusy: false, onRetry });
    const notice = byTestId(failed, 'search-library-likes-hard-error');

    expect(notice.props.accessibilityRole).toBe('alert');
    expect(notice.props.accessibilityLiveRegion).toBe('assertive');
    expect(textContent(failed)).toContain(strings.search.libraryLikesLoadFailed);
    const action = byTestId(failed, 'search-library-likes-hard-error-action');
    expect(action.props.accessibilityLabel).toBe(strings.search.retrySection(label));
    expect(action.props.disabled).toBe(false);
    (action.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('words an offline pause as offline, not as a server error', () => {
    const offline = SearchLibraryLikesNotice({ kind: 'offline', retryBusy: false, onRetry: vi.fn() });

    expect(byTestId(offline, 'search-library-likes-offline')).not.toBeNull();
    expect(textContent(offline)).toContain(strings.search.libraryLikesOffline);
    expect(textContent(offline)).not.toContain(strings.search.libraryLikesLoadFailed);
  });

  it('keeps cached likes notices polite and words them like the result sections', () => {
    const refreshFailed = SearchLibraryLikesNotice({
      kind: 'cached-refresh-error', retryBusy: true, onRetry: vi.fn(),
    });
    expect(byTestId(refreshFailed, 'search-library-likes-cached-refresh-error')
      .props.accessibilityLiveRegion).toBe('polite');
    expect(textContent(refreshFailed)).toContain(strings.search.remoteCachedRefreshFailed(label));
    // A retry in flight cannot be started twice.
    expect(byTestId(refreshFailed, 'search-library-likes-cached-refresh-error-action').props.disabled)
      .toBe(true);

    const cachedOffline = SearchLibraryLikesNotice({
      kind: 'cached-offline', retryBusy: false, onRetry: vi.fn(),
    });
    expect(byTestId(cachedOffline, 'search-library-likes-cached-offline')
      .props.accessibilityLiveRegion).toBe('polite');
    expect(textContent(cachedOffline)).toContain(strings.search.remoteCachedOffline(label));
  });
});

describe('search feedback', () => {
  it('words every issue kind for its section', () => {
    expect(searchIssueMessage('offline', 'Tracks')).toBe(strings.search.remoteOffline('Tracks'));
    expect(searchIssueMessage('hard-error', 'Tracks'))
      .toBe(strings.search.remoteLoadFailed('Tracks'));
    expect(searchIssueMessage('cached-offline', 'Tracks'))
      .toBe(strings.search.remoteCachedOffline('Tracks'));
    expect(searchIssueMessage('cached-refresh-error', 'Tracks'))
      .toBe(strings.search.remoteCachedRefreshFailed('Tracks'));
  });

  it('gives each failed result type its own retry and live-region urgency', () => {
    const retryTracks = vi.fn();
    const rendered = SearchResultsFeedback({
      state: state({
        issues: [
          { key: 'track', kind: 'hard-error', error: new Error('x') },
          { key: 'album', kind: 'cached-offline', error: new Error('y') },
        ],
      }),
      owners: [
        { key: 'track', fetching: false, retry: retryTracks },
        { key: 'album', fetching: true, retry: vi.fn() },
      ],
      renderLoading,
    });

    expect(byTestId(rendered, 'search-results-track-hard-error').props.accessibilityLiveRegion)
      .toBe('assertive');
    expect(byTestId(rendered, 'search-results-album-cached-offline').props.accessibilityLiveRegion)
      .toBe('polite');
    const retry = byTestId(rendered, 'search-results-track-hard-error-action');
    expect(retry.props.accessibilityLabel)
      .toBe(strings.search.retrySection(strings.search.tabs.track));
    (retry.props.onPress as () => void)();
    expect(retryTracks).toHaveBeenCalledOnce();
    expect(byTestId(rendered, 'search-results-album-cached-offline-action').props.disabled)
      .toBe(true);
  });

  it('hands first-load progress to the owner and never stacks refresh or stale on top', () => {
    const loading = SearchResultsFeedback({
      state: state({ body: 'loading', loadingKeys: ['track'], refreshingKeys: ['album'], staleKeys: ['artist'] }),
      owners: [],
      renderLoading,
    });

    expect(byTestId(loading, 'search-results-loading').props.accessibilityLabel)
      .toBe(strings.search.searching);
    expect(queryByTestId(loading, 'search-results-refreshing')).toBeNull();
    expect(queryByTestId(loading, 'search-results-stale')).toBeNull();

    const refreshing = SearchResultsFeedback({
      state: state({ refreshingKeys: ['album'], staleKeys: ['artist'] }),
      owners: [],
      renderLoading,
    });
    expect(byTestId(refreshing, 'search-results-refreshing')).not.toBeNull();
    expect(queryByTestId(refreshing, 'search-results-stale')).toBeNull();

    const stale = state({ staleKeys: ['artist'] });
    expect(showsPrimaryStaleNotice(stale)).toBe(true);
    expect(byTestId(
      SearchResultsFeedback({ state: stale, owners: [], renderLoading }),
      'search-results-stale',
    ).props.accessibilityLabel).toBe(strings.search.remoteStale(strings.search.tabs.all));
  });

  it('reports optional track details quietly and only once', () => {
    const base = { retryBusy: false, onRetry: vi.fn(), primaryStale: false };
    const title = strings.search.metadataTitle;

    expect(SearchMetadataFeedback({ ...base, state: null })).toBeNull();
    expect(SearchMetadataFeedback({ ...base, state: state() })).toBeNull();

    const onRetry = vi.fn();
    const failed = SearchMetadataFeedback({
      ...base,
      onRetry,
      state: state({ issues: [{ key: 'track-plays', kind: 'offline', error: null }] }),
    });
    expect(byTestId(failed, 'search-metadata-error').props.accessibilityLiveRegion).toBe('polite');
    (byTestId(failed, 'search-metadata-error-action').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();

    expect(byTestId(
      SearchMetadataFeedback({ ...base, state: state({ loadingKeys: ['track-plays'] }) }),
      'search-metadata-refreshing',
    ).props.children).toBe(strings.search.remoteLoading(title));
    expect(byTestId(
      SearchMetadataFeedback({ ...base, state: state({ staleKeys: ['track-plays'] }) }),
      'search-metadata-stale',
    )).not.toBeNull();
    expect(SearchMetadataFeedback({
      ...base,
      primaryStale: true,
      state: state({ staleKeys: ['track-plays'] }),
    })).toBeNull();
  });
});
