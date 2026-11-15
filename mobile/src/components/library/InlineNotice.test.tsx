import { describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { colors } from '../../theme';
import { InlineNotice } from './InlineNotice';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('InlineNotice', () => {
  it('announces a polite warning alert by default and has no retry of its own', () => {
    const notice = InlineNotice({ testID: 'notice', message: 'Showing saved data.' });
    const root = byTestId(notice, 'notice');

    expect(root.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'polite',
    });
    expect(flatStyle(root.props.style).backgroundColor).toBe(colors.warningSubtle);
    expect(textContent(notice)).toEqual(['Showing saved data.']);
    expect(byType(notice, 'Pressable')).toHaveLength(0);
  });

  it('renders an assertive danger notice with a title above the message', () => {
    const notice = InlineNotice({
      testID: 'notice',
      tone: 'danger',
      live: 'assertive',
      title: 'Playback failed',
      message: 'Try again.',
    });

    expect(byTestId(notice, 'notice').props.accessibilityLiveRegion).toBe('assertive');
    expect(flatStyle(byTestId(notice, 'notice').props.style).backgroundColor)
      .toBe(colors.dangerSubtle);
    expect(textContent(notice)).toEqual(['Playback failed', 'Try again.']);
  });

  it('wires the shared retry button and blocks it while busy', () => {
    const onRetry = vi.fn();
    const idle = InlineNotice({
      message: 'Refresh failed.',
      retry: { testID: 'notice-retry', accessibilityLabel: 'Retry playlists', busy: false, onRetry },
    });
    const retry = byTestId(idle, 'notice-retry');
    expect(retry.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Retry playlists',
      disabled: false,
    });
    (retry.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();

    const busy = InlineNotice({
      message: 'Refresh failed.',
      retry: { testID: 'notice-retry', busy: true, onRetry },
    });
    expect(queryByTestId(busy, 'notice-retry')?.props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
  });
});
