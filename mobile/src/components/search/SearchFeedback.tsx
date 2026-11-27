import React from 'react';
import { rateLimitRetryAfterSeconds } from '../../api/error';
import { strings } from '../../localization';
import type { SearchEntity } from '../../screens/searchModel';
import type {
  SearchAggregateRemoteState,
  SearchRemoteIssue,
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
  return (
    kind === 'cached-offline'
    || kind === 'cached-refresh-error'
    || kind === 'cached-rate-limited'
  );
}

function isRateLimited(kind: SearchRemoteIssueKind): boolean {
  return kind === 'rate-limited' || kind === 'cached-rate-limited';
}

function maxRetryAfterSeconds(issues: readonly SearchRemoteIssue[]): number | null {
  let max: number | null = null;
  for (const issue of issues) {
    const seconds = rateLimitRetryAfterSeconds(issue.error);
    if (seconds !== null && (max === null || seconds > max)) {
      max = seconds;
    }
  }
  return max;
}

/** Localized wording for one failed result type or metadata group. */
export function searchIssueMessage(
  kind: SearchRemoteIssueKind,
  label: string,
  retryAfterSeconds: number | null = null,
): string {
  if (isRateLimited(kind)) {
    if (isCached(kind)) {
      return retryAfterSeconds !== null
        ? strings.search.remoteCachedRateLimitedWait(label, retryAfterSeconds)
        : strings.search.remoteCachedRateLimited(label);
    }
    return retryAfterSeconds !== null
      ? strings.search.remoteRateLimitedWait(label, retryAfterSeconds)
      : strings.search.remoteRateLimited(label);
  }
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

interface SearchLibraryLikesNoticeProps {
  kind: SearchRemoteIssueKind;
  retryBusy: boolean;
  onRetry: () => void;
  retryAfterSeconds?: number | null;
}

/**
 * The library section could not (re)load the liked songs: without this notice
 * their absence from the instant matches would be indistinguishable from "no
 * liked song matches". Other sources and last-good likes stay searchable.
 */
export function SearchLibraryLikesNotice({
  kind,
  retryBusy,
  onRetry,
  retryAfterSeconds = null,
}: SearchLibraryLikesNoticeProps) {
  const label = strings.navigation.likedSongs;
  const message = isRateLimited(kind)
    ? searchIssueMessage(kind, label, retryAfterSeconds)
    : isCached(kind)
      ? searchIssueMessage(kind, label)
      : isOffline(kind)
        ? strings.search.libraryLikesOffline
        : strings.search.libraryLikesLoadFailed;
  return (
    <SearchErrorNotice
      testID={`search-library-likes-${kind}`}
      message={message}
      actionLabel={strings.search.retrySection(label)}
      actionBusy={retryBusy}
      onAction={onRetry}
      liveRegion={isCached(kind) ? 'polite' : 'assertive'}
    />
  );
}

interface SearchResultsFeedbackProps {
  state: SearchAggregateRemoteState;
  owners: readonly SearchIssueOwner[];
  /** Renders the first-load placeholder; receives the contract testID and label. */
  renderLoading: (props: { testID: string; accessibilityLabel: string }) => React.ReactNode;
  tvMode?: boolean;
}

/** Per-type failures with their own retry (deduping shared 429s), then at most one progress/stale line. */
export function SearchResultsFeedback({
  state,
  owners,
  renderLoading,
  tvMode = false,
}: SearchResultsFeedbackProps) {
  const loading = state.loadingKeys.length > 0;
  const quiet = state.issues.length === 0 && !loading;
  const ownedIssues = state.issues
    .map((issue) => ({
      issue,
      owner: owners.find((candidate) => candidate.key === issue.key),
    }))
    .filter((entry): entry is { issue: SearchRemoteIssue; owner: SearchIssueOwner } =>
      entry.owner !== undefined);
  const rateLimitedEntries = ownedIssues.filter(({ issue }) => isRateLimited(issue.kind));
  const collapseRateLimited = rateLimitedEntries.length >= 2;
  const individualEntries = collapseRateLimited
    ? ownedIssues.filter(({ issue }) => !isRateLimited(issue.kind))
    : ownedIssues;
  const collapsedRetryAfter = collapseRateLimited
    ? maxRetryAfterSeconds(rateLimitedEntries.map(({ issue }) => issue))
    : null;
  const collapsedAllCached = collapseRateLimited
    && rateLimitedEntries.every(({ issue }) => isCached(issue.kind));
  const collapsedMessage = collapsedAllCached
    ? searchIssueMessage('cached-rate-limited', strings.search.tabs.all, collapsedRetryAfter)
    : collapsedRetryAfter !== null
      ? strings.search.rateLimitedWait(collapsedRetryAfter)
      : strings.search.rateLimited;

  return (
    <>
      {collapseRateLimited ? (
        <SearchErrorNotice
          testID="search-results-rate-limited"
          message={collapsedMessage}
          actionLabel={strings.search.retrySection(strings.search.tabs.all)}
          actionBusy={rateLimitedEntries.some(({ owner }) => owner.fetching)}
          onAction={() => {
            for (const { owner } of rateLimitedEntries) owner.retry();
          }}
          liveRegion={collapsedAllCached ? 'polite' : 'assertive'}
        />
      ) : null}
      {individualEntries.map(({ issue, owner }) => {
        const label = strings.search.tabs[owner.key];
        return (
          <SearchErrorNotice
            key={`${owner.key}:${issue.kind}`}
            testID={`search-results-${owner.key}-${issue.kind}`}
            message={searchIssueMessage(
              issue.kind,
              label,
              rateLimitRetryAfterSeconds(issue.error),
            )}
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
          tvMode={tvMode}
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
  tvMode?: boolean;
}

/** One quiet line for the optional track details (play counts, cache membership). */
export function SearchMetadataFeedback({
  state,
  retryBusy,
  onRetry,
  primaryStale,
  tvMode = false,
}: SearchMetadataFeedbackProps) {
  if (state === null) return null;
  const title = strings.search.metadataTitle;
  if (state.issues.length > 0) {
    const blocking = state.issues.some(({ kind }) => !isCached(kind));
    const rateLimited = state.issues.some(({ kind }) => isRateLimited(kind));
    const offline = state.issues.some(({ kind }) => isOffline(kind));
    const waitSec = rateLimited ? maxRetryAfterSeconds(state.issues) : null;
    const message = rateLimited
      ? searchIssueMessage(blocking ? 'rate-limited' : 'cached-rate-limited', title, waitSec)
      : blocking
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
        tvMode={tvMode}
      />
    );
  }
  return null;
}
