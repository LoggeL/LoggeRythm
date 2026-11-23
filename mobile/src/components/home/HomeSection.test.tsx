import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId, byType, elements, queryByTestId, textContent } from '../../test/render';
import { HomeSection, type HomeSectionSkeletonProps } from './HomeSection';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  CardRailSkeleton: 'CardRailSkeleton',
}));

const title = strings.home.recentlyHeard;
const retryLabel = strings.home.retrySection(title);

function section(overrides: Partial<Parameters<typeof HomeSection>[0]> = {}): React.ReactElement {
  return HomeSection({
    id: 'recently-heard',
    title,
    hasData: true,
    pending: false,
    fetching: false,
    fetchStatus: 'idle',
    stale: false,
    error: null,
    empty: false,
    onRetry: vi.fn(),
    children: React.createElement('RecentContent', { testID: 'recent-content' }),
    ...overrides,
  });
}

/** The pressable host element that carries the section's retry label. */
function retryControl(tree: React.ReactNode) {
  return elements(tree).find(
    (element) =>
      typeof element.type !== 'function' && element.props.accessibilityLabel === retryLabel,
  );
}

describe('HomeSection state contract', () => {
  it('titles the section with a header', () => {
    const header = byType(section(), 'Text').find(
      (element) => element.props.accessibilityRole === 'header',
    );
    expect(header?.props.children).toBe(title);
  });

  it('renders deterministic loading and empty states without leaking cached content', () => {
    const loading = section({
      hasData: false,
      pending: true,
      fetching: true,
      fetchStatus: 'fetching',
      stale: true,
      empty: false,
    });
    // The rail skeleton primitive owns the progressbar role; the section names it.
    const loadingState = byTestId(loading, 'home-section-recently-heard-loading');
    expect(loadingState.type).toBe('CardRailSkeleton');
    expect(loadingState.props.accessibilityLabel).toBe(strings.home.sectionLoading(title));
    expect(queryByTestId(loading, 'home-section-recently-heard-empty')).toBeNull();
    expect(queryByTestId(loading, 'recent-content')).toBeNull();

    const empty = section({ empty: true });
    const emptyState = byTestId(empty, 'home-section-recently-heard-empty');
    expect(emptyState.props.accessibilityLiveRegion).toBe('polite');
    expect(textContent(emptyState)).toContain(strings.home.sectionEmpty(title));
    expect(queryByTestId(empty, 'home-section-recently-heard-loading')).toBeNull();
    expect(queryByTestId(empty, 'recent-content')).toBeNull();
  });

  it('lets a section supply a content-shaped skeleton that keeps the loading contract', () => {
    const skeleton = vi.fn((props: HomeSectionSkeletonProps) =>
      React.createElement('GridSkeleton', props),
    );
    const loading = section({ hasData: false, pending: true, fetching: true, skeleton });

    expect(skeleton).toHaveBeenCalledWith({
      testID: 'home-section-recently-heard-loading',
      accessibilityLabel: strings.home.sectionLoading(title),
    });
    expect(byTestId(loading, 'home-section-recently-heard-loading').type).toBe('GridSkeleton');
  });

  it('forwards matched CardRailSkeleton variants and TV sizing when no custom skeleton is supplied', () => {
    const trackLoading = section({
      hasData: false,
      pending: true,
      fetching: true,
      skeletonVariant: 'track',
      skeletonCardSize: 180,
      paddingHorizontal: 32,
    });
    const skeletonNode = byTestId(trackLoading, 'home-section-recently-heard-loading');
    expect(skeletonNode.type).toBe('CardRailSkeleton');
    expect(skeletonNode.props.variant).toBe('track');
    expect(skeletonNode.props.size).toBe(180);
    expect(skeletonNode.props.style).toEqual({ paddingHorizontal: 32 });
  });

  it('offers the next step of an empty section', () => {
    const empty = section({
      empty: true,
      emptyTitle: 'Nothing yet',
      emptyMessage: 'Play something',
      emptyAction: React.createElement('NextStep', { testID: 'next-step' }),
    });
    const emptyState = byTestId(empty, 'home-section-recently-heard-empty');

    expect(textContent(emptyState)).toEqual(['Nothing yet', 'Play something']);
    expect(queryByTestId(emptyState, 'next-step')).not.toBeNull();
  });

  it('renders a hard error with a working localized retry control', () => {
    const onRetry = vi.fn();
    const failed = section({
      hasData: false,
      pending: false,
      empty: false,
      error: new Error('stats unavailable'),
      onRetry,
    });
    const error = byTestId(failed, 'home-section-recently-heard-error');
    expect(error.props.accessibilityRole).toBe('alert');
    expect(error.props.accessibilityLiveRegion).toBe('assertive');
    expect(textContent(error)).toContain(strings.home.sectionLoadFailed);
    expect(textContent(failed)).not.toContain('stats unavailable');
    expect(queryByTestId(failed, 'home-section-recently-heard-empty')).toBeNull();
    const retry = retryControl(failed);
    expect(retry?.props.testID).toBe('home-section-recently-heard-retry');
    expect(retry?.props.accessibilityRole).toBe('button');
    (retry?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('turns paused and status-zero failures into explicit retryable offline states', () => {
    const pausedRetry = vi.fn();
    const paused = section({
      hasData: false,
      pending: true,
      fetching: false,
      fetchStatus: 'paused',
      empty: false,
      onRetry: pausedRetry,
    });
    const offline = byTestId(paused, 'home-section-recently-heard-offline');
    expect(offline.props.accessibilityRole).toBe('alert');
    expect(textContent(offline)).toContain(strings.home.sectionOffline);
    expect(queryByTestId(paused, 'home-section-recently-heard-loading')).toBeNull();
    (retryControl(paused)?.props.onPress as () => void)();
    expect(pausedRetry).toHaveBeenCalledOnce();

    const networkError = Object.assign(new Error('Network request failed'), { status: 0 });
    const cached = section({ error: networkError, stale: true });
    expect(queryByTestId(cached, 'recent-content')).not.toBeNull();
    const notice = byTestId(cached, 'home-section-recently-heard-cached-offline');
    expect(notice.props.accessibilityLiveRegion).toBe('polite');
    expect(textContent(notice)).toContain(strings.home.cachedOffline);
    expect(queryByTestId(cached, 'home-section-recently-heard-stale')).toBeNull();
  });

  it('keeps cached content visible and prioritizes error, refresh, then stale status', () => {
    const retry = vi.fn();
    const failedRefresh = section({ error: new Error('server unavailable'), stale: true, onRetry: retry });
    expect(queryByTestId(failedRefresh, 'recent-content')).not.toBeNull();
    const cachedError = byTestId(failedRefresh, 'home-section-recently-heard-cached-error');
    expect(cachedError.props.accessibilityRole).toBe('alert');
    expect(textContent(cachedError)).toContain(strings.home.cachedRefreshFailed);
    expect(queryByTestId(failedRefresh, 'home-section-recently-heard-stale')).toBeNull();
    expect(queryByTestId(failedRefresh, 'home-section-recently-heard-refreshing')).toBeNull();
    (retryControl(failedRefresh)?.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledOnce();

    const refreshing = section({ fetching: true, stale: true });
    expect(queryByTestId(refreshing, 'recent-content')).not.toBeNull();
    const refreshingState = byTestId(refreshing, 'home-section-recently-heard-refreshing');
    expect(refreshingState.props.accessibilityLiveRegion).toBe('polite');
    expect(refreshingState.props.focusable).toBe(false);
    expect(refreshingState.props.accessibilityRole).toBe('progressbar');
    expect(refreshingState.props.accessibilityLabel).toBe(
      `${title}. ${strings.home.sectionRefreshing}`,
    );
    expect(queryByTestId(refreshing, 'home-section-recently-heard-stale')).toBeNull();

    const stale = section({ stale: true });
    expect(queryByTestId(stale, 'recent-content')).not.toBeNull();
    const staleState = byTestId(stale, 'home-section-recently-heard-stale');
    expect(staleState.props.accessibilityLiveRegion).toBe('polite');
    expect(staleState.props.focusable).toBe(false);
    expect(staleState.props.accessible).toBe(true);
    expect(staleState.props.accessibilityLabel).toBe(`${title}. ${strings.home.sectionStale}`);

    // On Android TV, status markers disable `accessible` so RN Fabric does not make them D-Pad stops.
    const tvStale = section({ stale: true, tvMode: true });
    const tvStaleState = byTestId(tvStale, 'home-section-recently-heard-stale');
    expect(tvStaleState.props.accessible).toBe(false);
    expect(tvStaleState.props.focusable).toBe(false);
    expect(tvStaleState.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('shows no status marker and no notice for fresh content', () => {
    const fresh = section();
    for (const suffix of ['refreshing', 'stale', 'cached-error', 'cached-offline', 'retry']) {
      expect(queryByTestId(fresh, `home-section-recently-heard-${suffix}`)).toBeNull();
    }
  });

  it('keeps a successful empty response mounted under refresh and offline failures', () => {
    const refreshing = section({ empty: true, fetching: true, stale: true });
    expect(queryByTestId(refreshing, 'home-section-recently-heard-empty')).not.toBeNull();
    expect(queryByTestId(refreshing, 'home-section-recently-heard-refreshing')).not.toBeNull();
    expect(queryByTestId(refreshing, 'home-section-recently-heard-stale')).toBeNull();

    const refreshFailed = section({ empty: true, error: new Error('refresh failed') });
    expect(queryByTestId(refreshFailed, 'home-section-recently-heard-empty')).not.toBeNull();
    expect(queryByTestId(refreshFailed, 'home-section-recently-heard-cached-error')).not.toBeNull();
    expect(queryByTestId(refreshFailed, 'home-section-recently-heard-error')).toBeNull();
    expect(queryByTestId(refreshFailed, 'recent-content')).toBeNull();

    const offline = section({ empty: true, fetchStatus: 'paused' });
    expect(queryByTestId(offline, 'home-section-recently-heard-empty')).not.toBeNull();
    expect(queryByTestId(offline, 'home-section-recently-heard-cached-offline')).not.toBeNull();
    expect(queryByTestId(offline, 'home-section-recently-heard-offline')).toBeNull();
  });

  it('disables the owned retry while a failed refresh is already fetching', () => {
    const tree = section({ error: new Error('refresh failed'), fetching: true, fetchStatus: 'fetching' });
    const retry = byTestId(tree, 'home-section-recently-heard-retry');

    expect(retry.props.disabled).toBe(true);
    expect(retry.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
