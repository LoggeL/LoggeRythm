import React from 'react';
import { strings } from '../../localization';
import type { SearchEntity } from '../../screens/searchModel';
import type {
  SearchAggregateRemoteState,
  SearchRemoteIssueKind,
} from '../../screens/searchRemoteState';
import {
  SearchErrorNotice,
  SearchLoadingStatus,
  SearchPoliteStatus,
} from './SearchRemoteStates';

/** The query behind one result type, as far as feedback needs to know it. */
export interface SearchIssueOwner {
  key: SearchEntity;
  fetching: boolean;
  retry: () => void;
}

function isOffline(kind: SearchRemoteIssueKind): boolean {
  return kind === 'offline' || kind === 'cached-offline';
}

function isCached(kind: SearchRemoteIssueKind): boolean {
  return kind === 'cached-offline' || kind === 'cached-refresh-error';
}

/** Localized wording for one failed result type or metadata group. */
export function searchIssueMessage(kind: SearchRemoteIssueKind, label: string): string {
  if (isOffline(kind)) {
    return isCached(kind)
      ? strings.search.remoteCachedOffline(label)
      : strings.search.remoteOffline(label);
  }
  return isCached(kind)
    ? strings.search.remoteCachedRefreshFailed(label)
    : strings.search.remoteLoadFailed(label);
}

/** A stale marker is shown only when nothing louder is on screen. */
export function showsPrimaryStaleNotice(state: SearchAggregateRemoteState): boolean {
  return (
    state.issues.length === 0
    && state.loadingKeys.length === 0
    && state.refreshingKeys.length === 0
    && state.staleKeys.length > 0
  );
}

interface SearchResultsFeedbackProps {
  state: SearchAggregateRemoteState;
  owners: readonly SearchIssueOwner[];
  /** Renders the first-load placeholder; receives the contract testID and label. */
  renderLoading: (props: { testID: string; accessibilityLabel: string }) => React.ReactNode;
}

/** Per-type failures with their own retry, then at most one progress/stale line. */
export function SearchResultsFeedback({ state, owners, renderLoading }: SearchResultsFeedbackProps) {
  const loading = state.loadingKeys.length > 0;
  const quiet = state.issues.length === 0 && !loading;
  return (
    <>
      {state.issues.map((issue) => {
        const owner = owners.find((candidate) => candidate.key === issue.key);
        if (owner === undefined) return null;
        const label = strings.search.tabs[owner.key];
        return (
          <SearchErrorNotice
            key={`${owner.key}:${issue.kind}`}
            testID={`search-results-${owner.key}-${issue.kind}`}
            message={searchIssueMessage(issue.kind, label)}
            actionLabel={strings.search.retrySection(label)}
            actionBusy={owner.fetching}
            onAction={owner.retry}
            liveRegion={isCached(issue.kind) ? 'polite' : 'assertive'}
          />
        );
      })}
      {loading
        ? renderLoading({
          testID: 'search-results-loading',
          accessibilityLabel: strings.search.searching,
        })
        : null}
      {quiet && state.refreshingKeys.length > 0 ? (
        <SearchLoadingStatus
          testID="search-results-refreshing"
          label={strings.search.remoteRefreshing(strings.search.tabs.all)}
        />
      ) : null}
      {showsPrimaryStaleNotice(state) ? (
        <SearchPoliteStatus
          testID="search-results-stale"
          message={strings.search.remoteStale(strings.search.tabs.all)}
          compact
        />
      ) : null}
    </>
  );
}

interface SearchMetadataFeedbackProps {
  state: SearchAggregateRemoteState | null;
  retryBusy: boolean;
  onRetry: () => void;
  /** The result list already shows a stale marker. */
  primaryStale: boolean;
}

/** One quiet line for the optional track details (play counts, cache membership). */
export function SearchMetadataFeedback({
  state,
  retryBusy,
  onRetry,
  primaryStale,
}: SearchMetadataFeedbackProps) {
  if (state === null) return null;
  const title = strings.search.metadataTitle;
  if (state.issues.length > 0) {
    const blocking = state.issues.some(({ kind }) => !isCached(kind));
    const offline = state.issues.some(({ kind }) => isOffline(kind));
    const message = blocking
      ? offline
        ? strings.search.remoteOffline(title)
        : strings.search.remoteLoadFailed(title)
      : offline
        ? strings.search.remoteCachedOffline(title)
        : strings.search.remoteCachedRefreshFailed(title);
    return (
      <SearchErrorNotice
        testID="search-metadata-error"
        message={message}
        actionLabel={strings.search.retrySection(title)}
        actionBusy={retryBusy}
        onAction={onRetry}
        liveRegion="polite"
      />
    );
  }
  if (state.loadingKeys.length > 0 || state.refreshingKeys.length > 0) {
    return (
      <SearchPoliteStatus
        testID="search-metadata-refreshing"
        message={state.loadingKeys.length > 0
          ? strings.search.remoteLoading(title)
          : strings.search.remoteRefreshing(title)}
      />
    );
  }
  if (state.staleKeys.length > 0 && !primaryStale) {
    return (
      <SearchPoliteStatus
        testID="search-metadata-stale"
        message={strings.search.remoteStale(title)}
        compact
      />
    );
  }
  return null;
}
