import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { HomeSection } from './HorizontalShelf';

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  Pressable: 'Pressable',
  StyleSheet: { create: <T>(styles: T): T => styles },
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

function byTestId(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => element.props.testID === testID) ?? null;
}

function section(
  overrides: Partial<Parameters<typeof HomeSection>[0]> = {},
): React.ReactElement {
  return HomeSection({
    id: 'recently-heard',
    title: strings.home.recentlyHeard,
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

describe('HomeSection state contract', () => {
  it('renders deterministic loading and empty states without leaking cached content', () => {
    const loading = section({
      hasData: false,
      pending: true,
      fetching: true,
      fetchStatus: 'fetching',
      stale: true,
      empty: false,
    });
    const loadingState = byTestId(loading, 'home-section-recently-heard-loading');
    expect(loadingState?.props.accessibilityRole).toBe('progressbar');
    expect(loadingState?.props.accessibilityLabel).toBe(
      strings.home.sectionLoading(strings.home.recentlyHeard),
    );
    expect(byTestId(loading, 'home-section-recently-heard-empty')).toBeNull();
    expect(byTestId(loading, 'recent-content')).toBeNull();

    const empty = section({ empty: true });
    expect(byTestId(empty, 'home-section-recently-heard-empty')).not.toBeNull();
    expect(byTestId(empty, 'home-section-recently-heard-loading')).toBeNull();
    expect(byTestId(empty, 'recent-content')).toBeNull();
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
    expect(error?.props.accessibilityRole).toBe('alert');
    expect(error?.props.accessibilityLiveRegion).toBe('assertive');
    expect(elements(error).some((element) => element.props.children === 'stats unavailable'))
      .toBe(false);
    expect(byTestId(failed, 'home-section-recently-heard-empty')).toBeNull();
    const retry = elements(failed).find(
      (element) =>
        element.props.accessibilityLabel ===
        strings.home.retrySection(strings.home.recentlyHeard),
    );
    expect(retry).toBeDefined();
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
    expect(byTestId(paused, 'home-section-recently-heard-offline')?.props.accessibilityRole)
      .toBe('alert');
    expect(byTestId(paused, 'home-section-recently-heard-loading')).toBeNull();
    const pausedControl = elements(paused).find(
      (element) =>
        element.props.accessibilityLabel ===
        strings.home.retrySection(strings.home.recentlyHeard),
    );
    (pausedControl?.props.onPress as () => void)();
    expect(pausedRetry).toHaveBeenCalledOnce();

    const networkError = Object.assign(new Error('Network request failed'), { status: 0 });
    const cached = section({ error: networkError, stale: true });
    expect(byTestId(cached, 'recent-content')).not.toBeNull();
    expect(byTestId(cached, 'home-section-recently-heard-cached-offline')).not.toBeNull();
    expect(byTestId(cached, 'home-section-recently-heard-cached-offline')?.props.accessibilityLiveRegion)
      .toBe('polite');
    expect(byTestId(cached, 'home-section-recently-heard-stale')).toBeNull();
  });

  it('keeps cached content visible and prioritizes error, refresh, then stale status', () => {
    const retry = vi.fn();
    const failedRefresh = section({ error: new Error('server unavailable'), stale: true, onRetry: retry });
    expect(byTestId(failedRefresh, 'recent-content')).not.toBeNull();
    expect(byTestId(failedRefresh, 'home-section-recently-heard-cached-error')?.props.accessibilityRole)
      .toBe('alert');
    expect(byTestId(failedRefresh, 'home-section-recently-heard-stale')).toBeNull();
    expect(byTestId(failedRefresh, 'home-section-recently-heard-refreshing')).toBeNull();
    const retryControl = elements(failedRefresh).find(
      (element) =>
        element.props.accessibilityLabel ===
        strings.home.retrySection(strings.home.recentlyHeard),
    );
    (retryControl?.props.onPress as () => void)();
    expect(retry).toHaveBeenCalledOnce();

    const refreshing = section({ fetching: true, stale: true });
    expect(byTestId(refreshing, 'recent-content')).not.toBeNull();
    const refreshingState = byTestId(refreshing, 'home-section-recently-heard-refreshing');
    expect(refreshingState?.props.accessibilityLiveRegion).toBe('polite');
    expect(refreshingState?.props.accessibilityRole).toBe('progressbar');
    expect(refreshingState?.props.accessibilityLabel).toBe(
      `${strings.home.recentlyHeard}. ${strings.home.sectionRefreshing}`,
    );
    expect(byTestId(refreshing, 'home-section-recently-heard-stale')).toBeNull();

    const stale = section({ stale: true });
    expect(byTestId(stale, 'recent-content')).not.toBeNull();
    expect(byTestId(stale, 'home-section-recently-heard-stale')?.props.accessibilityLiveRegion)
      .toBe('polite');
  });

  it('keeps a successful empty response mounted under refresh and offline failures', () => {
    const refreshing = section({ empty: true, fetching: true, stale: true });
    expect(byTestId(refreshing, 'home-section-recently-heard-empty')).not.toBeNull();
    expect(byTestId(refreshing, 'home-section-recently-heard-refreshing')).not.toBeNull();
    expect(byTestId(refreshing, 'home-section-recently-heard-stale')).toBeNull();

    const refreshFailed = section({ empty: true, error: new Error('refresh failed') });
    expect(byTestId(refreshFailed, 'home-section-recently-heard-empty')).not.toBeNull();
    expect(byTestId(refreshFailed, 'home-section-recently-heard-cached-error')).not.toBeNull();
    expect(byTestId(refreshFailed, 'home-section-recently-heard-error')).toBeNull();
    expect(byTestId(refreshFailed, 'recent-content')).toBeNull();

    const offline = section({ empty: true, fetchStatus: 'paused' });
    expect(byTestId(offline, 'home-section-recently-heard-empty')).not.toBeNull();
    expect(byTestId(offline, 'home-section-recently-heard-cached-offline')).not.toBeNull();
    expect(byTestId(offline, 'home-section-recently-heard-offline')).toBeNull();
  });

  it('disables the owned retry while a failed refresh is already fetching', () => {
    const tree = section({ error: new Error('refresh failed'), fetching: true, fetchStatus: 'fetching' });
    const retry = byTestId(tree, 'home-section-recently-heard-retry');

    expect(retry?.props.disabled).toBe(true);
    expect(retry?.props.accessibilityState).toEqual({ disabled: true, busy: true });
  });
});
