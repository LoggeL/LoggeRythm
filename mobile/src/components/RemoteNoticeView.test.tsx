import { describe, expect, it, vi } from 'vitest';
import { byTestId, byType, queryByTestId } from '../test/render';
import { RemoteNoticeView, type RemoteNoticeViewProps } from './RemoteNoticeView';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

const copy = {
  cachedOffline: 'Offline, showing saved data',
  cachedRefreshFailed: 'Refresh failed, showing saved data',
  refreshing: 'Refreshing',
  stale: 'Saved data',
};

function notice(overrides: Partial<RemoteNoticeViewProps>) {
  return RemoteNoticeView({
    notice: null,
    testIDPrefix: 'stats',
    copy,
    retryAccessibilityLabel: 'Reload stats',
    busy: false,
    onRetry: vi.fn(),
    ...overrides,
  });
}

describe('RemoteNoticeView', () => {
  it('renders nothing without a notice', () => {
    expect(notice({})).toBeNull();
  });

  it.each([
    ['cached-offline', 'stats-cached-offline', 'stats-cached-offline-retry', copy.cachedOffline],
    ['cached-refresh-error', 'stats-cached-error', 'stats-cached-error-retry', copy.cachedRefreshFailed],
  ] as const)('shows %s as a polite alert with the shared retry', (kind, testID, retryID, text) => {
    const onRetry = vi.fn();
    const tree = notice({ notice: kind, onRetry });
    const alert = byTestId(tree, testID);
    const retry = byTestId(tree, retryID);

    expect(alert.props.accessibilityRole).toBe('alert');
    expect(alert.props.accessibilityLiveRegion).toBe('polite');
    expect(byType(alert, 'Text').map((element) => element.props.children)).toContain(text);
    expect(retry.props.accessibilityLabel).toBe('Reload stats');
    (retry.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('blocks the retry while the request is in flight and honours a custom retry id', () => {
    const tree = notice({ notice: 'cached-offline', busy: true, retryTestID: () => 'stats-notice-retry' });
    const retry = byTestId(tree, 'stats-notice-retry');

    expect(retry.props.disabled).toBe(true);
    expect(retry.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(queryByTestId(tree, 'stats-cached-offline-retry')).toBeNull();
  });

  it('announces a refresh as labelled polite progress and stale data as a plain hint', () => {
    const refreshing = byTestId(notice({ notice: 'refreshing' }), 'stats-refreshing');
    expect(refreshing.props.accessibilityRole).toBe('progressbar');
    expect(refreshing.props.accessibilityLabel).toBe(copy.refreshing);
    expect(refreshing.props.accessibilityLiveRegion).toBe('polite');

    const stale = byTestId(notice({ notice: 'stale' }), 'stats-stale');
    expect(stale.props.children).toBe(copy.stale);
    expect(stale.props.accessibilityLiveRegion).toBe('polite');
    expect(queryByTestId(notice({ notice: 'stale' }), 'stats-refreshing')).toBeNull();
  });
});
