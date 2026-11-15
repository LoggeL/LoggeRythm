import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId, queryByTestId } from '../../test/render';
import { QueueMetadataNoticeView, QueueSnapshotNoticeView } from './QueueNotices';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('queue notices', () => {
  it('keeps a failed queue re-read retryable without blocking the rows', () => {
    const onRetry = vi.fn();
    const rendered = QueueSnapshotNoticeView({
      notice: 'cached-refresh-error',
      retryBusy: false,
      onRetry,
    });

    expect(byTestId(rendered, 'queue-snapshot-cached-error').props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'polite',
    });
    (byTestId(rendered, 'queue-snapshot-retry').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(QueueSnapshotNoticeView({ notice: null, retryBusy: false, onRetry })).toBeNull();
    expect(
      byTestId(
        QueueSnapshotNoticeView({ notice: 'refreshing', retryBusy: true, onRetry }),
        'queue-snapshot-refreshing',
      ).props.accessibilityRole,
    ).toBe('progressbar');
  });

  it.each([
    [{ body: 'loading', notice: null }, 'queue-metadata-loading', false],
    [{ body: 'offline', notice: null }, 'queue-metadata-offline', true],
    [{ body: 'hard-error', notice: null }, 'queue-metadata-error', true],
    [{ body: 'content', notice: 'cached-offline' }, 'queue-metadata-cached-offline', true],
    [{ body: 'content', notice: 'cached-refresh-error' }, 'queue-metadata-cached-error', true],
    [{ body: 'content', notice: 'refreshing' }, 'queue-metadata-refreshing', false],
    [{ body: 'content', notice: 'stale' }, 'queue-metadata-stale', false],
  ] as const)('renders %o as %s', (state, testID, retryable) => {
    const rendered = QueueMetadataNoticeView({ state, retryBusy: true, onRetry: vi.fn() });

    expect(queryByTestId(rendered, testID)).not.toBeNull();
    const retry = queryByTestId(rendered, 'queue-metadata-retry');
    expect(retry !== null).toBe(retryable);
    if (retry !== null) {
      expect(retry.props).toMatchObject({
        accessibilityLabel: strings.search.retrySection(strings.search.metadataTitle),
        disabled: true,
        accessibilityState: { disabled: true, busy: true },
      });
    }
  });

  it('renders nothing while the metadata query is disabled or settled', () => {
    expect(QueueMetadataNoticeView({ state: null, retryBusy: false, onRetry: vi.fn() })).toBeNull();
    expect(
      QueueMetadataNoticeView({
        state: { body: 'content', notice: null },
        retryBusy: false,
        onRetry: vi.fn(),
      }),
    ).toBeNull();
  });
});
